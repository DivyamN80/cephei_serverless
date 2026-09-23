import crypto from 'crypto';
import { SecretClient } from '@azure/keyvault-secrets';
import { AzureProviderError } from './clients.js';

// Built-in RBAC role "Key Vault Secrets User" — grants secrets/get +
// secrets/list data-plane access and nothing else (verified GUID:
// learn.microsoft.com/azure/key-vault/general/rbac-guide and the
// az-roles-advertizer entry for this exact id). This is the role the
// app-service-key-vault-references doc names as the correct grant for an
// app's managed identity when the vault uses RBAC authorization.
const KEY_VAULT_SECRETS_USER_ROLE_ID = '4633458b-17de-408a-b874-0445c86b69e6';

// Key Vault secret names may only contain letters, digits and dashes —
// env var names commonly contain underscores, which aren't legal here.
// The Function App setting KEY itself is left completely unchanged
// (the unmodified app keeps reading process.env.MY_VAR normally); only
// the Key Vault-internal secret name is sanitized.
function sanitizeSecretName(key) {
  return key.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'secret';
}

export async function ensureKeyVault(clients, { keyVaultName }, onLog) {
  const { keyVault, resourceGroup, location, tenantId } = clients;
  if (!tenantId) {
    throw new AzureProviderError(
      'No Azure AD tenant ID available to create a Key Vault — connect an Azure account for this project, or set CEPHEI_LOCAL_AZURE_TENANT_ID for local testing without a connected account.',
      400
    );
  }

  let vault;
  try {
    vault = await keyVault.vaults.get(resourceGroup, keyVaultName);
  } catch (err) {
    if (err.statusCode !== 404) throw err;
    onLog(`Creating Key Vault ${keyVaultName}...`);
    const poller = await keyVault.vaults.createOrUpdate(resourceGroup, keyVaultName, {
      location,
      properties: {
        tenantId,
        sku: { family: 'A', name: 'standard' },
        enableRbacAuthorization: true,
        accessPolicies: [],
      },
    });
    vault = await poller.pollUntilDone();
  }
  return vault;
}

// Grants the Function App's system-assigned managed identity permission
// to read secrets from the vault via Azure RBAC (the vault was created
// with enableRbacAuthorization: true, so access-policy grants would be
// ignored — RBAC role assignment is the only mechanism that applies).
// Idempotent: a 409 (role assignment already exists for this principal
// at this scope) is treated as success, same spirit as the
// ResourceConflictException swallow in aws/apiGateway.js's AddPermission
// call.
export async function grantKeyVaultAccess(clients, { vaultId, principalId }, onLog) {
  if (!principalId) {
    throw new AzureProviderError('Function App has no managed identity principalId to grant Key Vault access to.');
  }
  onLog('Granting the Function App managed identity access to Key Vault secrets...');
  const { authorization, subscriptionId } = clients;
  const roleDefinitionId = `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${KEY_VAULT_SECRETS_USER_ROLE_ID}`;
  // Deterministic per (vault, principal) so redeploys don't pile up
  // duplicate role assignments and idempotently no-op via the 409 catch.
  const roleAssignmentName = crypto
    .createHash('sha1')
    .update(`${vaultId}:${principalId}:${KEY_VAULT_SECRETS_USER_ROLE_ID}`)
    .digest('hex')
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12}).*/, '$1-$2-$3-$4-$5');

  try {
    await authorization.roleAssignments.create(vaultId, roleAssignmentName, {
      roleDefinitionId,
      principalId,
      principalType: 'ServicePrincipal',
    });
  } catch (err) {
    if (err.statusCode !== 409) throw err;
  }
}

// Writes each project secret as a Key Vault secret (§5) and returns the
// Function App Application Settings that should be set for them, using
// Azure's native Key Vault reference syntax:
//   @Microsoft.KeyVault(SecretUri=<versioned secret URI>)
// Azure resolves this itself at request time via the Function App's own
// managed identity — no SDK, no extra code in the customer's app; it
// just reads process.env.KEY like it always did. This is a cleaner
// mechanism than AWS's compromise (writing to Secrets Manager AND
// duplicating the same values into the function's own env config,
// because Lambda has no native Secrets-Manager-backed env var), and is
// the same "cloud resolves the reference natively" spirit as GCP's
// native secret reference support.
export async function writeProjectSecrets(clients, { vaultUri, secrets }, onLog) {
  const secretClient = new SecretClient(vaultUri, clients.credential);
  const appSettings = {};

  for (const [key, value] of Object.entries(secrets || {})) {
    const secretName = sanitizeSecretName(key);
    onLog(`Writing secret ${key} to Key Vault as '${secretName}'...`);
    const result = await secretClient.setSecret(secretName, String(value));
    const secretUri = result.properties.id;
    appSettings[key] = `@Microsoft.KeyVault(SecretUri=${secretUri})`;
  }

  return appSettings;
}
