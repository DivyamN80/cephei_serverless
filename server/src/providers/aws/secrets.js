import {
  CreateSecretCommand,
  PutSecretValueCommand,
  DescribeSecretCommand,
} from '@aws-sdk/client-secrets-manager';

// Real per-cloud secret store sync (§5): every project's decrypted env
// vars are written to a single AWS Secrets Manager secret as a JSON blob
// on every deploy — a durable, IAM-controlled, CloudTrail-audited system
// of record that exists independently of Cephei's own database.
//
// Lambda has no native "env var sourced from Secrets Manager" feature
// without the app itself calling the Secrets Manager SDK (or the
// Parameters and Secrets Lambda Extension's local HTTP endpoint) — both
// would require the customer's app code to change, which breaks this
// project's zero-code-change guarantee. So Secrets Manager here is the
// durable, rotatable, audited source of truth; deploy.js separately
// writes the same current values into the function's own environment
// config (lambda.js) so the unmodified app can keep reading them via
// plain `process.env`. This mirrors how teams commonly run legacy/
// unmodified apps against Secrets Manager in practice.
export async function syncSecretsToSecretsManager(secretsManager, secretName, secrets, onLog) {
  const SecretString = JSON.stringify(secrets || {});

  try {
    await secretsManager.send(new DescribeSecretCommand({ SecretId: secretName }));
    onLog(`Updating Secrets Manager secret ${secretName}...`);
    const { ARN } = await secretsManager.send(
      new PutSecretValueCommand({ SecretId: secretName, SecretString })
    );
    return ARN;
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') throw err;
    onLog(`Creating Secrets Manager secret ${secretName}...`);
    const { ARN } = await secretsManager.send(
      new CreateSecretCommand({
        Name: secretName,
        SecretString,
        Description: 'Cephei-managed project environment variables — synced on every deploy.',
      })
    );
    return ARN;
  }
}
