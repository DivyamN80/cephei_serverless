import fs from 'fs/promises';
import path from 'path';
import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { downloadRepoSource, resolveProjectGithubAuth, resolveBackendCandidate } from '../../services/repoIngest.js';
import { generateDockerfile } from './dockerfile.js';
import { buildClients, assumeAndVerify, AwsProviderError } from './clients.js';
import { ensureEcrRepo, ensureLambdaCanPullFromEcr, buildAndPushImage } from './build.js';
import { ensureLambdaFunction, publishVersionAndUpdateAlias, repointLiveAlias } from './lambda.js';
import { ensureHttpApi } from './apiGateway.js';
import { syncSecretsToSecretsManager } from './secrets.js';
import { getDashboardMetrics } from './metrics.js';

const DEFAULT_LAMBDA_EXECUTION_ROLE_ENV = 'CEPHEI_LOCAL_LAMBDA_EXECUTION_ROLE_ARN';

function slugify(name) {
  return (
    (name || 'project')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || 'project'
  );
}

async function resolveAccountId(clients, account) {
  if (account?.awsAccountId) return account.awsAccountId;
  const identity = await clients.sts.send(new GetCallerIdentityCommand({}));
  return identity.Account;
}

function resolveExecutionRoleArn(account, accountId) {
  if (account?.executionRoleArn) return account.executionRoleArn;
  // Local/legacy-credentials bootstrap path (no connected cloud account
  // yet) — an execution role still has to exist for Lambda itself to run
  // as; there's no way to invent one, so this must be provided out of
  // band until a real CustomerAwsAccount is connected.
  const fallback = process.env[DEFAULT_LAMBDA_EXECUTION_ROLE_ENV];
  if (fallback) return fallback;
  throw new AwsProviderError(
    'No Lambda execution role available — connect an AWS account for this project, or set ' +
      `${DEFAULT_LAMBDA_EXECUTION_ROLE_ENV} for local testing without a connected account.`,
    400
  );
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
    await fs.writeFile(dockerfilePath, generateDockerfile(pkg, { listenPort: candidate?.listenPort ?? 3000 }));
  }

  return { extractedRoot: dir, sourceDir };
}

export async function deployBackend(project, account, secrets, onLog) {
  if (!project.backendCandidates?.length) {
    throw new AwsProviderError(
      'No backend was detected for this project — re-run repo analysis before deploying.',
      400
    );
  }

  const clients = buildClients(account);
  const accountId = await resolveAccountId(clients, account);
  const executionRoleArn = resolveExecutionRoleArn(account, accountId);
  const functionName = `cephei-${slugify(project.name)}`;
  const repoName = functionName;
  const tag = `v${Date.now()}`;

  onLog('Downloading repository source for build...');
  const { extractedRoot, sourceDir } = await prepareBuildSource(project);

  try {
    await ensureEcrRepo(clients.ecr, repoName, onLog);

    const imageUri = await buildAndPushImage(
      { ...clients, region: clients.region },
      { accountId, sourceDir, repoName, tag },
      onLog
    );

    await ensureLambdaCanPullFromEcr(clients.ecr, repoName, accountId, executionRoleArn, onLog);

    const secretCount = Object.keys(secrets || {}).length;
    let secretsStoreRef;
    if (secretCount > 0) {
      secretsStoreRef = await syncSecretsToSecretsManager(
        clients.secretsManager,
        `cephei/${functionName}`,
        secrets,
        onLog
      );
      onLog(`Injecting ${secretCount} environment variable${secretCount === 1 ? '' : 's'}...`);
    }

    const fn = await ensureLambdaFunction(
      clients.lambda,
      {
        functionName,
        imageUri,
        role: executionRoleArn,
        environment: secrets || {},
        vpcConfig: account?.lambdaVpc?.subnetIds?.length ? account.lambdaVpc : undefined,
      },
      onLog
    );

    const version = await publishVersionAndUpdateAlias(clients.lambda, functionName, onLog);

    const invokeUrl = await ensureHttpApi(
      clients,
      { functionArn: fn.FunctionArn, aliasName: 'live', accountId, functionName },
      onLog
    );

    onLog('Deploy complete.');

    return {
      provider: 'aws',
      invokeUrl,
      functionName,
      region: clients.region,
      lambdaLiveVersion: version,
      ...(secretsStoreRef ? { secretsStoreRef } : {}),
    };
  } finally {
    await fs.rm(extractedRoot, { recursive: true, force: true });
  }
}

export async function rollback(project, account, toVersion, onLog) {
  const clients = buildClients(account);
  const functionName = project.deployResult?.functionName;
  if (!functionName) {
    throw new AwsProviderError('This project has no deployed Lambda function to roll back.', 400);
  }
  await repointLiveAlias(clients.lambda, functionName, toVersion, onLog);
}

export async function verifyConnection(account) {
  const identity = await assumeAndVerify(account);
  return identity;
}

// Returns the real {cost, metrics} shape metricsService.js's dashboard
// route expects — see getDashboardMetrics in metrics.js for what's real
// (invocations/errors/latency/coldStarts) vs. a labeled estimate (cost).
export async function getMetrics(project, account, { days = 14 } = {}) {
  const functionName = project.deployResult?.functionName;
  if (!functionName) {
    throw new AwsProviderError('This project has no deployed function to fetch metrics for.', 400);
  }
  const clients = buildClients(account);
  return getDashboardMetrics(clients, functionName, days);
}
