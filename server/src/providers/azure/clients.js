import { ClientSecretCredential, DefaultAzureCredential } from '@azure/identity';
import { ResourceManagementClient } from '@azure/arm-resources';
import { WebSiteManagementClient } from '@azure/arm-appservice';
import { ContainerRegistryManagementClient } from '@azure/arm-containerregistry';
import { KeyVaultManagementClient } from '@azure/arm-keyvault';
import { AuthorizationManagementClient } from '@azure/arm-authorization';
import { MonitorClient } from '@azure/arm-monitor';
import { StorageManagementClient } from '@azure/arm-storage';
import { decryptSecretValue } from '../../utils/secretsCrypto.js';

export class AzureProviderError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'AzureProviderError';
    this.status = status;
  }
}

const DEFAULT_LOCAL_SUBSCRIPTION_ENV = 'CEPHEI_LOCAL_AZURE_SUBSCRIPTION_ID';
const DEFAULT_LOCAL_RESOURCE_GROUP_ENV = 'CEPHEI_LOCAL_AZURE_RESOURCE_GROUP';
const DEFAULT_LOCAL_LOCATION_ENV = 'CEPHEI_LOCAL_AZURE_LOCATION';
const DEFAULT_LOCAL_TENANT_ENV = 'CEPHEI_LOCAL_AZURE_TENANT_ID';
const DEFAULT_LOCATION = 'eastus';

// Trust model (§ auth design): unlike AWS's AssumeRole (Cephei's own fixed
// identity assuming a role the customer trusts) or GCP's impersonation,
// Azure has no equivalent "assume a role with an external ID" primitive.
// Instead the customer registers their OWN Microsoft Entra ID (Azure AD)
// App Registration (a Service Principal) and grants it the Contributor
// role on the exact resource group they want Cephei to deploy into
// (`azureResourceGroup`). Cephei authenticates AS that service principal
// using the client secret the customer generated and pasted in during
// /connect — every ARM call this provider makes is literally the
// customer's own identity acting on their own subscription, scoped to
// that one resource group by the Contributor grant (not by anything
// Cephei enforces itself). This is the standard shape of real
// multi-tenant SaaS-to-Azure integrations (e.g. Terraform Cloud, most
// CI/CD-to-Azure connectors) that don't operate their own AAD tenant
// federation.
function buildCredential(account) {
  if (
    account?.provider === 'azure' &&
    account?.azureTenantId &&
    account?.azureClientId &&
    account?.azureClientSecretCiphertext &&
    account?.azureClientSecretIv &&
    account?.azureClientSecretAuthTag
  ) {
    const clientSecret = decryptSecretValue({
      ciphertext: account.azureClientSecretCiphertext,
      iv: account.azureClientSecretIv,
      authTag: account.azureClientSecretAuthTag,
    });
    return new ClientSecretCredential(account.azureTenantId, account.azureClientId, clientSecret);
  }

  // Local/legacy-credentials bootstrap path (no connected Azure account
  // yet) — mirrors AWS's "fall back to the server's own local
  // credentials" behavior. DefaultAzureCredential tries, in order: env
  // vars (AZURE_CLIENT_ID/AZURE_CLIENT_SECRET/AZURE_TENANT_ID), a
  // workload identity, a managed identity, and the Azure CLI's cached
  // login (`az login`) — whichever this server process happens to have
  // available. Real code, genuinely untestable on this dev machine (no
  // `az` CLI, no AZURE_* env vars configured here) — same caveat as
  // every other local-bootstrap path in this project.
  return new DefaultAzureCredential();
}

// Builds every Azure SDK client this provider needs, scoped to the
// connected customer subscription/resource group when one exists, or to
// the local bootstrap env vars otherwise (mirrors aws/clients.js's
// buildClients region fallback).
export function buildClients(account) {
  const subscriptionId = account?.azureSubscriptionId || process.env[DEFAULT_LOCAL_SUBSCRIPTION_ENV];
  const resourceGroup = account?.azureResourceGroup || process.env[DEFAULT_LOCAL_RESOURCE_GROUP_ENV];
  const location = account?.region || process.env[DEFAULT_LOCAL_LOCATION_ENV] || DEFAULT_LOCATION;
  // Key Vault creation (secrets.js) needs an explicit AAD tenant ID — it
  // isn't reliably recoverable from a credential object at runtime
  // (ClientSecretCredential doesn't expose the tenantId it was built
  // with as a public property, and DefaultAzureCredential doesn't expose
  // one at all), so it's resolved here from the same two real sources as
  // every other identifier this provider needs.
  const tenantId = account?.azureTenantId || process.env[DEFAULT_LOCAL_TENANT_ENV];

  if (!subscriptionId) {
    throw new AzureProviderError(
      `No Azure subscription available — connect an Azure account for this project, or set ${DEFAULT_LOCAL_SUBSCRIPTION_ENV} for local testing without a connected account.`,
      400
    );
  }
  if (!resourceGroup) {
    throw new AzureProviderError(
      `No Azure resource group available — connect an Azure account for this project, or set ${DEFAULT_LOCAL_RESOURCE_GROUP_ENV} for local testing without a connected account.`,
      400
    );
  }

  const credential = buildCredential(account);

  return {
    subscriptionId,
    resourceGroup,
    location,
    tenantId,
    credential,
    resources: new ResourceManagementClient(credential, subscriptionId),
    webSite: new WebSiteManagementClient(credential, subscriptionId),
    acr: new ContainerRegistryManagementClient(credential, subscriptionId),
    keyVault: new KeyVaultManagementClient(credential, subscriptionId),
    authorization: new AuthorizationManagementClient(credential, subscriptionId),
    monitor: new MonitorClient(credential, subscriptionId),
    storage: new StorageManagementClient(credential, subscriptionId),
  };
}

// Real verification for CustomerAwsAccount /connect and /verify (§6) — one
// cheap, real ARM call (ResourceGroups.get, scoped to the stored
// subscriptionId/resourceGroup) using the customer's own Service
// Principal credentials. A wrong tenant/client/secret or a resource group
// the service principal hasn't been granted access to both fail this
// call with the real AAD/ARM error — never a no-op that always succeeds.
export async function verifyAzureConnection(account) {
  if (!account?.azureSubscriptionId || !account?.azureResourceGroup || !account?.azureTenantId || !account?.azureClientId) {
    throw new AzureProviderError(
      'azureSubscriptionId, azureResourceGroup, azureTenantId and azureClientId are all required to verify an Azure connection',
      400
    );
  }
  const clients = buildClients(account);
  try {
    const rg = await clients.resources.resourceGroups.get(clients.resourceGroup);
    return {
      resourceGroupId: rg.id,
      location: rg.location,
      subscriptionId: clients.subscriptionId,
    };
  } catch (err) {
    throw new AzureProviderError(
      `Could not verify access to resource group '${account.azureResourceGroup}' in subscription '${account.azureSubscriptionId}': ${err.message}`,
      400
    );
  }
}
