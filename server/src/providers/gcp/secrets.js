const SECRET_ACCESSOR_ROLE = 'roles/secretmanager.secretAccessor';

// Secret Manager secret ids may only contain letters, digits, underscores
// and hyphens (1-255 chars). Project env var keys are free-form, so
// sanitize + namespace by function name to avoid cross-project collisions.
function toSecretId(functionName, key) {
  const cleanedKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${functionName}-${cleanedKey}`.slice(0, 255);
}

async function ensureSecret(secretManager, projectId, secretId, onLog) {
  const name = `projects/${projectId}/secrets/${secretId}`;
  try {
    await secretManager.getSecret({ name });
    return name;
  } catch (err) {
    if (err.code !== 5 /* NOT_FOUND */) throw err;
    onLog(`Creating Secret Manager secret ${secretId}...`);
    const [secret] = await secretManager.createSecret({
      parent: `projects/${projectId}`,
      secretId,
      secret: { replication: { automatic: {} } },
    });
    return secret.name;
  }
}

// Read-modify-write IAM grant so any other bindings already on the secret
// are preserved rather than clobbered — same pattern as run.js's
// setPublicInvokeAccess.
async function grantSecretAccessor(secretManager, secretName, runtimeServiceAccount, onLog) {
  const resource = secretName;
  const [policy] = await secretManager.getIamPolicy({ resource });
  const bindings = policy.bindings || [];
  let binding = bindings.find((b) => b.role === SECRET_ACCESSOR_ROLE);
  if (!binding) {
    binding = { role: SECRET_ACCESSOR_ROLE, members: [] };
    bindings.push(binding);
  }
  const principal = `serviceAccount:${runtimeServiceAccount}`;
  if (!binding.members.includes(principal)) {
    binding.members.push(principal);
    onLog(`Granting ${SECRET_ACCESSOR_ROLE} on ${secretName.split('/').pop()} to ${runtimeServiceAccount}...`);
    await secretManager.setIamPolicy({ resource, policy: { ...policy, bindings } });
  }
}

// Real per-cloud secret store sync (§5): every project's decrypted env vars
// are written to Secret Manager on every deploy — a durable, IAM-
// controlled, Cloud Audit Logs-audited system of record that exists
// independently of Cephei's own database, same intent as aws/secrets.js.
//
// Unlike AWS Lambda — which has no native "env var sourced from Secrets
// Manager" without the app itself calling the Secrets Manager SDK (or the
// Parameters and Secrets Lambda Extension's local HTTP endpoint), either of
// which would break this project's zero-app-code-change guarantee — Cloud
// Run's Admin API lets a container env var reference a Secret Manager
// secret version *directly* (EnvVar.valueSource.secretKeyRef): Cloud Run
// itself resolves the secret value at container start, before the
// customer's code ever runs. So this is a genuinely cleaner integration
// than AWS can offer: the unmodified app just reads `process.env.KEY` like
// it always did, and it's the platform — not the app, and not Cephei
// writing plaintext into the service spec — that talks to Secret Manager.
//
// One Secret Manager secret per env var key (not one JSON blob, unlike
// AWS), because Cloud Run's native env-from-secret binding is necessarily
// per-key. A fresh version is added on every deploy so prior values stay
// recoverable via old secret versions; `version: 'latest'` in the returned
// env ref always resolves to whichever version was just written.
export async function syncSecretsToSecretManager(
  secretManager,
  { projectId, functionName, secrets, runtimeServiceAccount },
  onLog
) {
  const entries = Object.entries(secrets || {});
  const envRefs = [];

  for (const [key, value] of entries) {
    const secretId = toSecretId(functionName, key);
    const secretName = await ensureSecret(secretManager, projectId, secretId, onLog);

    onLog(`Writing new version of secret ${secretId}...`);
    await secretManager.addSecretVersion({
      parent: secretName,
      payload: { data: Buffer.from(String(value), 'utf8') },
    });

    await grantSecretAccessor(secretManager, secretName, runtimeServiceAccount, onLog);

    envRefs.push({
      name: key,
      valueSource: { secretKeyRef: { secret: secretName, version: 'latest' } },
    });
  }

  return envRefs;
}
