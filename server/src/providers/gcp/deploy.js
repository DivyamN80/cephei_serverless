import fs from 'fs/promises';
import path from 'path';
import { downloadRepoSource, resolveProjectGithubAuth, resolveBackendCandidate } from '../../services/repoIngest.js';
import { generateDockerfile } from './dockerfile.js';
import { buildClients, verifyConnection as verifyGcpConnection, GcpProviderError } from './clients.js';
import { ensureArtifactRegistryRepo, buildAndPushImage } from './build.js';
import { ensureCloudRunService, setPublicInvokeAccess, rollbackTraffic } from './run.js';
import { syncSecretsToSecretManager } from './secrets.js';
import { getDashboardMetrics } from './metrics.js';

const DEFAULT_RUNTIME_SERVICE_ACCOUNT_ENV = 'CEPHEI_LOCAL_GCP_RUNTIME_SERVICE_ACCOUNT_EMAIL';

function slugify(name) {
  return (
    (name || 'project')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || 'project'
  );
}

// The identity the deployed Cloud Run service itself runs as (distinct
// from the identity *deploying* it — see clients.js's buildAuthClient).
// When a GCP account is connected, the customer's own service account
// (which they've already granted Cephei's fixed principal
// serviceAccountTokenCreator on) doubles as the Cloud Run runtime identity
// too — a sensible default since it's the only customer-specific identity
// Cephei has, and it keeps the deployed function running under a real,
// customer-owned principal rather than the project's anonymous default
// compute service account. Mirrors aws/deploy.js's
// resolveExecutionRoleArn() local/legacy-credentials bootstrap pattern.
function resolveRuntimeServiceAccount(account) {
  if (account?.provider === 'gcp' && account?.gcpServiceAccountEmail) return account.gcpServiceAccountEmail;
  return process.env[DEFAULT_RUNTIME_SERVICE_ACCOUNT_ENV] || null;
}

async function prepareBuildSource(project) {
  const { dir } = await downloadRepoSource(project.repoUrl, resolveProjectGithubAuth(project));
  const candidate = resolveBackendCandidate(project);
  const sourceDir = candidate?.path && candidate.path !== '.' ? path.join(dir, candidate.path) : dir;

  const pkgPath = path.join(sourceDir, 'package.json');
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));

  const dockerfilePath = path.join(sourceDir, 'Dockerfile');
  const hasDockerfile = await fs
    .access(dockerfilePath)
    .then(() => true)
    .catch(() => false);
  if (!hasDockerfile) {
    await fs.writeFile(dockerfilePath, generateDockerfile(pkg));
  }

  return { extractedRoot: dir, sourceDir };
}

export async function deployBackend(project, account, secrets, onLog) {
  if (!project.backendCandidates?.length) {
    throw new GcpProviderError(
      'No backend was detected for this project — re-run repo analysis before deploying.',
      400
    );
  }

  const clients = await buildClients(account);
  const { projectId, region } = clients;
  const serviceId = `cephei-${slugify(project.name)}`;
  const repoName = serviceId;
  const tag = `v${Date.now()}`;
  const runtimeServiceAccount = resolveRuntimeServiceAccount(account);

  onLog('Downloading repository source for build...');
  const { extractedRoot, sourceDir } = await prepareBuildSource(project);

  try {
    onLog(`Ensuring Artifact Registry repository ${repoName}...`);
    await ensureArtifactRegistryRepo(clients.artifactRegistry, { projectId, region, repoName }, onLog);

    const imageUri = await buildAndPushImage(
      clients,
      { projectId, region, sourceDir, repoName, imageName: serviceId, tag },
      onLog
    );

    const secretCount = Object.keys(secrets || {}).length;
    let envRefs = [];
    let secretsStoreRef;
    if (secretCount > 0) {
      if (!runtimeServiceAccount) {
        throw new GcpProviderError(
          'This project has environment secrets to inject, but no GCP runtime service account is available to grant Secret Manager access to — connect a GCP account for this project, or set ' +
            `${DEFAULT_RUNTIME_SERVICE_ACCOUNT_ENV} for local testing without a connected account.`,
          400
        );
      }
      envRefs = await syncSecretsToSecretManager(
        clients.secretManager,
        { projectId, functionName: serviceId, secrets, runtimeServiceAccount },
        onLog
      );
      onLog(`Injecting ${secretCount} environment variable${secretCount === 1 ? '' : 's'} via native Secret Manager references...`);
      secretsStoreRef = `projects/${projectId}/secrets`;
    }

    const { service, revision } = await ensureCloudRunService(
      clients,
      { serviceId, region, projectId, imageUri, envRefs, runtimeServiceAccount },
      onLog
    );

    await setPublicInvokeAccess(clients, service.name, onLog);

    onLog('Deploy complete.');

    return {
      provider: 'gcp',
      invokeUrl: service.uri,
      functionName: serviceId,
      region,
      // Generic "live version" label (see Project.js's deployResult schema
      // comment) — for GCP this is the Cloud Run revision name currently
      // holding 100% of traffic, which is exactly what rollback()'s
      // `toVersion` expects.
      lambdaLiveVersion: revision,
      ...(secretsStoreRef ? { secretsStoreRef } : {}),
    };
  } finally {
    await fs.rm(extractedRoot, { recursive: true, force: true });
  }
}

export async function rollback(project, account, toVersion, onLog) {
  const clients = await buildClients(account);
  const serviceId = project.deployResult?.functionName;
  if (!serviceId) {
    throw new GcpProviderError('This project has no deployed Cloud Run service to roll back.', 400);
  }
  await rollbackTraffic(
    clients,
    { projectId: clients.projectId, region: clients.region, serviceId, toRevision: toVersion },
    onLog
  );
}

export async function verifyConnection(account) {
  return verifyGcpConnection(account);
}

// Returns the real {cost, metrics} shape metricsService.js's dashboard
// route expects — see getDashboardMetrics in metrics.js for what's real
// (invocations/errors/latency/coldStarts) vs. a labeled estimate (cost).
export async function getMetrics(project, account, { days = 14 } = {}) {
  const serviceId = project.deployResult?.functionName;
  if (!serviceId) {
    throw new GcpProviderError('This project has no deployed function to fetch metrics for.', 400);
  }
  const clients = await buildClients(account);
  return getDashboardMetrics(clients, { serviceId, region: clients.region }, days);
}
