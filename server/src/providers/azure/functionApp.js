import { AzureProviderError } from './clients.js';

// Elastic Premium EP1 (verified: learn.microsoft.com/azure/azure-functions/
// functions-premium-plan — SKU names starting with "E" are the real
// Elastic Premium tier; "P"-prefixed SKUs like P1V2 are Dedicated plans
// that don't scale dynamically). Premium is the plan Microsoft's own docs
// point to for Linux custom-container deployments — "Support for Linux
// container deployments" is listed as a Premium-plan benefit, and the
// custom-handlers doc explicitly calls out Premium for handlers that
// "require additional dependencies" (a custom container always does).
// Consumption is deliberately NOT used here: Microsoft's own container
// quickstart flow defaults new containerized function apps to Premium,
// and Consumption's per-invocation cold-start/idle-teardown model is a
// poor fit for a custom-container process that (per the custom-handlers
// doc) must finish starting within 60 seconds every time it's spun up
// from zero.
const PLAN_SKU = { name: 'EP1', tier: 'ElasticPremium' };
const FUNCTIONS_EXTENSION_VERSION = '~4';
const WAIT_OPTS = {};

export async function ensureStorageAccount(clients, { storageAccountName }, onLog) {
  const { storage, resourceGroup, location } = clients;
  try {
    await storage.storageAccounts.getProperties(resourceGroup, storageAccountName);
  } catch (err) {
    if (err.statusCode !== 404) throw err;
    onLog(`Creating storage account ${storageAccountName} (required by every Function App for internal bookkeeping)...`);
    const poller = await storage.storageAccounts.create(resourceGroup, storageAccountName, {
      location,
      kind: 'StorageV2',
      sku: { name: 'Standard_LRS' },
    });
    await poller.pollUntilDone();
  }

  const { keys } = await storage.storageAccounts.listKeys(resourceGroup, storageAccountName);
  const key = keys?.[0]?.value;
  if (!key) throw new AzureProviderError(`Could not retrieve an access key for storage account ${storageAccountName}.`);
  return `DefaultEndpointsProtocol=https;AccountName=${storageAccountName};AccountKey=${key};EndpointSuffix=core.windows.net`;
}

export async function ensureAppServicePlan(clients, { planName }, onLog) {
  const { webSite, resourceGroup, location } = clients;
  try {
    return await webSite.appServicePlans.get(resourceGroup, planName);
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }
  onLog(`Creating Elastic Premium (${PLAN_SKU.name}) App Service plan ${planName}...`);
  const poller = await webSite.appServicePlans.createOrUpdate(resourceGroup, planName, {
    location,
    sku: PLAN_SKU,
    kind: 'elastic',
    reserved: true, // Linux
    maximumElasticWorkerCount: 20,
  });
  return poller.pollUntilDone(WAIT_OPTS);
}

// Real create-or-update for the Function App itself, pointed at the
// pushed container image, with a system-assigned managed identity
// enabled (consumed by secrets.js to grant Key Vault access). Real
// wait-for-ready polling via the ARM PUT operation's own poller — the
// same LRO convention aws/lambda.js's waitUntilFunctionActiveV2 waiter
// serves for Lambda.
//
// Deliberately does NOT set Application Settings itself (see
// setApplicationSettings below) — webApps.updateApplicationSettings is a
// full-replace of the settings dictionary, so it must be called exactly
// once per deploy with the COMPLETE desired settings (base settings ∪
// any Key Vault secret references), after deploy.js knows whether this
// project has secrets. Calling it a second time here would silently wipe
// out whatever deploy.js sets afterward, or vice versa.
export async function ensureFunctionApp(clients, { functionAppName, planId, imageUri }, onLog) {
  const { webSite, resourceGroup, location } = clients;

  let exists = true;
  try {
    await webSite.webApps.get(resourceGroup, functionAppName);
  } catch (err) {
    if (err.statusCode !== 404) throw err;
    exists = false;
  }

  onLog(exists ? `Updating Function App ${functionAppName}...` : `Creating Function App ${functionAppName}...`);
  const poller = await webSite.webApps.createOrUpdate(resourceGroup, functionAppName, {
    location,
    kind: 'functionapp,linux,container',
    identity: { type: 'SystemAssigned' },
    serverFarmId: planId,
    httpsOnly: true,
    siteConfig: {
      linuxFxVersion: `DOCKER|${imageUri}`,
      alwaysOn: true,
    },
  });
  let site = await poller.pollUntilDone(WAIT_OPTS);

  // The system-assigned identity's principalId is normally populated
  // synchronously in the create/update response; re-fetch defensively in
  // case propagation lagged.
  if (!site.identity?.principalId) {
    site = await webSite.webApps.get(resourceGroup, functionAppName);
  }

  return site;
}

// Builds the base (non-secret) Application Settings every deploy needs —
// storage bookkeeping, the custom-handler worker runtime switch, and the
// ACR pull credentials for the pushed image (see build.js's confidence
// note on why admin credentials rather than a managed-identity ACR pull
// were used here: the simpler, fully doc-verified path).
export function buildBaseApplicationSettings({ storageConnectionString, registryLoginServer, registryUsername, registryPassword }) {
  return {
    AzureWebJobsStorage: storageConnectionString,
    FUNCTIONS_EXTENSION_VERSION,
    FUNCTIONS_WORKER_RUNTIME: 'Custom',
    DOCKER_REGISTRY_SERVER_URL: `https://${registryLoginServer}`,
    DOCKER_REGISTRY_SERVER_USERNAME: registryUsername,
    DOCKER_REGISTRY_SERVER_PASSWORD: registryPassword,
  };
}

// Single full-replace write of the Function App's Application Settings —
// see the note on ensureFunctionApp above for why this must be called
// exactly once per deploy with the complete settings object.
export async function setApplicationSettings(clients, functionAppName, settings, onLog) {
  onLog(`Applying ${Object.keys(settings).length} application setting(s)...`);
  await clients.webSite.webApps.updateApplicationSettings(clients.resourceGroup, functionAppName, {
    properties: settings,
  });
}

// Rollback support: re-points the Function App's container image
// reference at an older, still-present ACR tag by updating
// siteConfig.linuxFxVersion in place — this is the real ARM property
// that controls which image a Linux custom-container Function App runs
// (verified: az functionapp config container set's documented effect,
// and the ARM template samples for "Web App for Containers (Linux)" /
// containerized Function Apps, which all set
// siteConfig.linuxFxVersion = "DOCKER|<image>"). Since Azure Function
// Apps for containers have no Lambda-style immutable numbered version,
// the image tag itself (still sitting in ACR from a prior deploy) IS the
// version being rolled back to.
//
// Uses webApps.updateConfiguration (the dedicated PATCH-style operation
// on the site's /config/web sub-resource) rather than webApps.
// createOrUpdate on the whole Site — createOrUpdate is a full PUT of the
// Site resource and sending only a partial siteConfig would risk
// clobbering unrelated settings (identity, serverFarmId, kind); the
// config-only operation updates just linuxFxVersion in place.
export async function updateContainerImage(clients, { functionAppName, imageUri }, onLog) {
  const { webSite, resourceGroup } = clients;
  onLog(`Rolling back Function App ${functionAppName} to image ${imageUri}...`);
  return webSite.webApps.updateConfiguration(resourceGroup, functionAppName, {
    linuxFxVersion: `DOCKER|${imageUri}`,
  });
}

export const AZURE_FUNCTION_APP_PLAN_SKU = PLAN_SKU;
