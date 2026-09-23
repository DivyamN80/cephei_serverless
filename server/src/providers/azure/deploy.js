import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { downloadRepoSource, resolveProjectGithubAuth, resolveBackendCandidate } from '../../services/repoIngest.js';
import {
  generateDockerfile,
  generateHostJson,
  generateFunctionJson,
  generateHandlerShim,
  AZURE_FUNCTION_NAME,
  AZURE_HANDLER_SHIM_FILENAME,
} from './dockerfile.js';
import { buildClients, verifyAzureConnection, AzureProviderError } from './clients.js';
import { ensureAcrRegistry, buildAndPushImage } from './build.js';
import {
  ensureStorageAccount,
  ensureAppServicePlan,
  ensureFunctionApp,
  buildBaseApplicationSettings,
  setApplicationSettings,
  updateContainerImage,
} from './functionApp.js';
import { ensureKeyVault, grantKeyVaultAccess, writeProjectSecrets } from './secrets.js';
import { getDashboardMetrics } from './metrics.js';

function slugify(name, maxLen = 20) {
  return (
    (name || 'project')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, maxLen) || 'project'
  );
}

// Every Azure resource this provider creates lives in a GLOBALLY unique
// DNS namespace (<name>.azurewebsites.net, <name>.vault.azure.net,
// <name>.azurecr.io, <name>.blob.core.windows.net) — unlike AWS, where
// Lambda/ECR names only need to be unique within one account. A
// human-readable slug alone risks collisions across different Cephei
// customers deploying similarly-named projects, so every globally-scoped
// name is suffixed with a short, deterministic hash of the project's own
// Mongo _id (stable across redeploys, so the same project always reuses
// the same real resources).
function shortId(seed) {
  return crypto.createHash('sha1').update(String(seed)).digest('hex').slice(0, 10);
}

function resourceNames(project) {
  const slug = slugify(project.name, 20);
  const id = shortId(project._id || project.id || project.name || 'project');
  const alnumSlug = slug.replace(/-/g, '');

  return {
    // Function App hostname: <name>.azurewebsites.net — globally unique.
    functionAppName: `cephei-${slug}-${id}`.slice(0, 60),
    // App Service Plan: only unique within the resource group.
    planName: `cephei-${slug}-plan`.slice(0, 40),
    // ACR registry name: 5-50 chars, alphanumeric only, globally unique.
    registryName: `cephei${alnumSlug}${id}`.replace(/[^a-z0-9]/gi, '').slice(0, 50).toLowerCase(),
    // Storage account name: 3-24 chars, lowercase alphanumeric only,
    // globally unique — the tightest constraint of the four.
    storageAccountName: `cephei${id}${alnumSlug}`.replace(/[^a-z0-9]/gi, '').slice(0, 24).toLowerCase(),
    // Key Vault name: 3-24 chars, alphanumeric + dash, must start with a
    // letter, globally unique.
    keyVaultName: `cephei-${slug}-${id}`.slice(0, 24),
  };
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

  // host.json / function.json / the handler shim are Azure-Functions-
  // custom-handler-specific control files an arbitrary repo essentially
  // never already has — always (re)generate them so every deploy uses
  // the current, correct shape regardless of what a previous deploy (or
  // the customer's own repo) may have left behind.
  await fs.writeFile(path.join(sourceDir, 'host.json'), generateHostJson());
  const functionDir = path.join(sourceDir, AZURE_FUNCTION_NAME);
  await fs.mkdir(functionDir, { recursive: true });
  await fs.writeFile(path.join(functionDir, 'function.json'), generateFunctionJson());
  await fs.writeFile(path.join(sourceDir, AZURE_HANDLER_SHIM_FILENAME), generateHandlerShim(pkg));

  return { extractedRoot: dir, sourceDir };
}

export async function deployBackend(project, account, secrets, onLog) {
  if (!project.backendCandidates?.length) {
    throw new AzureProviderError(
      'No backend was detected for this project — re-run repo analysis before deploying.',
      400
    );
  }

  const clients = buildClients(account);
  const { functionAppName, planName, registryName, storageAccountName, keyVaultName } = resourceNames(project);
  const tag = `v${Date.now()}`;

  onLog('Downloading repository source for build...');
  const { extractedRoot, sourceDir } = await prepareBuildSource(project);

  try {
    await ensureAcrRegistry(clients, { registryName }, onLog);

    const imageUri = await buildAndPushImage(
      clients,
      { sourceDir, registryName, repoName: functionAppName, tag },
      onLog
    );

    const registry = await clients.acr.registries.get(clients.resourceGroup, registryName);
    const creds = await clients.acr.registries.listCredentials(clients.resourceGroup, registryName);
    const registryUsername = creds.username;
    const registryPassword = creds.passwords?.[0]?.value;
    if (!registryUsername || !registryPassword) {
      throw new AzureProviderError(`ACR registry ${registryName} has no admin credentials available.`);
    }

    const storageConnectionString = await ensureStorageAccount(clients, { storageAccountName }, onLog);
    const plan = await ensureAppServicePlan(clients, { planName }, onLog);
    const site = await ensureFunctionApp(clients, { functionAppName, planId: plan.id, imageUri }, onLog);

    const appSettings = buildBaseApplicationSettings({
      storageConnectionString,
      registryLoginServer: registry.loginServer,
      registryUsername,
      registryPassword,
    });

    const secretCount = Object.keys(secrets || {}).length;
    let keyVaultUri;
    if (secretCount > 0) {
      const vault = await ensureKeyVault(clients, { keyVaultName }, onLog);
      keyVaultUri = vault.properties.vaultUri;
      await grantKeyVaultAccess(clients, { vaultId: vault.id, principalId: site.identity?.principalId }, onLog);
      onLog(`Injecting ${secretCount} environment variable${secretCount === 1 ? '' : 's'} via Key Vault references...`);
      const keyVaultAppSettings = await writeProjectSecrets(clients, { vaultUri: keyVaultUri, secrets }, onLog);
      Object.assign(appSettings, keyVaultAppSettings);
    }

    await setApplicationSettings(clients, functionAppName, appSettings, onLog);

    onLog('Deploy complete.');

    return {
      provider: 'azure',
      invokeUrl: `https://${site.defaultHostName}`,
      functionName: functionAppName,
      region: clients.location,
      lambdaLiveVersion: tag,
      // Generic cross-provider field (see Project.js's deployResult schema
      // comment) — for Azure this is the Key Vault URI holding this
      // project's secrets. Must use this exact key: deployResult is a
      // fixed Mongoose sub-schema, so any other field name is silently
      // dropped on save.
      ...(keyVaultUri ? { secretsStoreRef: keyVaultUri } : {}),
    };
  } finally {
    await fs.rm(extractedRoot, { recursive: true, force: true });
  }
}

export async function rollback(project, account, toVersion, onLog) {
  const clients = buildClients(account);
  const functionAppName = project.deployResult?.functionName;
  if (!functionAppName) {
    throw new AzureProviderError('This project has no deployed Function App to roll back.', 400);
  }
  const { registryName } = resourceNames(project);
  const registry = await clients.acr.registries.get(clients.resourceGroup, registryName);
  const imageUri = `${registry.loginServer}/${functionAppName}:${toVersion}`;
  await updateContainerImage(clients, { functionAppName, imageUri }, onLog);
}

export async function verifyConnection(account) {
  return verifyAzureConnection(account);
}

// Returns the real {cost, metrics} shape metricsService.js's dashboard
// route expects — see getDashboardMetrics in metrics.js for what's real
// (invocations/errors/response-time) vs. a labeled estimate (cost) vs.
// an honest 0 (coldStarts — no such metric exists for this plan tier).
export async function getMetrics(project, account, { days = 14 } = {}) {
  const functionAppName = project.deployResult?.functionName;
  if (!functionAppName) {
    throw new AzureProviderError('This project has no deployed function to fetch metrics for.', 400);
  }
  const clients = buildClients(account);
  return getDashboardMetrics(clients, functionAppName, days);
}
