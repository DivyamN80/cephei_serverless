import * as aws from './aws/deploy.js';

class ProviderNotImplementedError extends Error {
  constructor(provider) {
    super(`The ${provider} provider isn't wired up to real infrastructure yet.`);
    this.name = 'ProviderNotImplementedError';
    this.status = 501;
  }
}

function notImplemented(provider) {
  return new Proxy(
    {},
    {
      get() {
        return () => {
          throw new ProviderNotImplementedError(provider);
        };
      },
    }
  );
}

const PROVIDERS = {
  aws,
  azure: notImplemented('azure'),
  gcp: notImplemented('gcp'),
};

export function getProvider(providerKey) {
  const provider = PROVIDERS[providerKey];
  if (!provider) {
    throw new ProviderNotImplementedError(providerKey || '(none)');
  }
  return provider;
}
