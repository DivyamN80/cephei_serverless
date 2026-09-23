import * as aws from './aws/deploy.js';
import * as azure from './azure/deploy.js';
import * as gcp from './gcp/deploy.js';

class UnknownProviderError extends Error {
  constructor(provider) {
    super(`'${provider}' isn't a supported deploy provider.`);
    this.name = 'UnknownProviderError';
    this.status = 400;
  }
}

// All three real: aws (§4.1), azure (§4.2), gcp (§4.3) — each implements
// the same deployBackend/rollback/verifyConnection/getMetrics contract
// against its own cloud's real SDKs. No simulated/stub provider remains.
const PROVIDERS = { aws, azure, gcp };

export function getProvider(providerKey) {
  const provider = PROVIDERS[providerKey];
  if (!provider) {
    throw new UnknownProviderError(providerKey || '(none)');
  }
  return provider;
}
