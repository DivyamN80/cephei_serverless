import ProjectSecret from '../models/ProjectSecret.js';
import { decryptSecretValue } from '../utils/secretsCrypto.js';

// The only place outside secretsCrypto.js itself that calls
// decryptSecretValue() — matches the "never logged, never returned from an
// API response" guarantee described there. Used at deploy time only, to
// inject this project's env vars into the function that's about to run.
//
// Interim state: this hands plaintext values straight to the provider,
// which currently bakes them into the function's own config (Lambda
// Environment.Variables). Moving this to a real per-cloud secret store
// (Secrets Manager / Secret Manager / Key Vault) with diff-based sync is
// tracked separately — the loader here doesn't change shape either way.
export async function loadProjectSecretsPlaintext(project) {
  const docs = await ProjectSecret.find({ project: project._id });
  return Object.fromEntries(docs.map((d) => [d.key, decryptSecretValue(d)]));
}
