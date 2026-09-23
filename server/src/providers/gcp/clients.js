import { GoogleAuth, Impersonated } from 'google-auth-library';
import { ServicesClient } from '@google-cloud/run';
import { CloudBuildClient } from '@google-cloud/cloudbuild';
import { ArtifactRegistryClient } from '@google-cloud/artifact-registry';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { MetricServiceClient } from '@google-cloud/monitoring';
import { Storage } from '@google-cloud/storage';

export class GcpProviderError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'GcpProviderError';
    this.status = status;
  }
}

const CLOUD_PLATFORM_SCOPE = ['https://www.googleapis.com/auth/cloud-platform'];

// Mirrors aws/clients.js's AssumeRole trust model, adapted to GCP. Cephei's
// own fixed GCP identity — resolved via the standard Application Default
// Credentials chain (the GOOGLE_APPLICATION_CREDENTIALS env var pointing at
// a service account key, or the metadata server's attached service account
// when Cephei itself runs on GCP) — is always the *source* identity. When a
// customer has connected their GCP account (account.gcpServiceAccountEmail
// is set), every call is instead made as that customer's own service
// account, obtained by having Cephei's fixed identity impersonate it via
// IAM Service Account Credentials' generateAccessToken RPC — this is what
// google-auth-library's `Impersonated` class wraps. For this to work, the
// customer must have granted Cephei's fixed principal
// `roles/iam.serviceAccountTokenCreator` on their own service account —
// the GCP equivalent of AWS's AssumeRole trust policy + ExternalId
// condition. When there is no connected account yet (account is
// null/undefined, or a GCP account with no gcpServiceAccountEmail saved),
// this falls back to Cephei's own ADC identity directly — the same
// "local/legacy credentials" bootstrap path aws/clients.js's buildClients()
// falls back to when roleArn is unset. This path is real code, but is
// literally untestable on this dev machine (no ADC configured here) — that
// is expected.
async function buildAuthClient(account) {
  const baseAuth = new GoogleAuth({ scopes: CLOUD_PLATFORM_SCOPE });

  if (account?.provider === 'gcp' && account?.gcpServiceAccountEmail) {
    const sourceClient = await baseAuth.getClient();
    return new Impersonated({
      sourceClient,
      targetPrincipal: account.gcpServiceAccountEmail,
      targetScopes: CLOUD_PLATFORM_SCOPE,
      lifetime: 3600,
    });
  }

  return baseAuth.getClient();
}

// Builds every GCP SDK client this provider needs, all authenticated as the
// same resolved identity (ADC or impersonated — see buildAuthClient above)
// and scoped to the connected customer's project. Every @google-cloud/*
// client library built on google-gax accepts a pre-resolved AuthClient via
// the `authClient` ClientOptions field (confirmed against the installed
// google-auth-library GoogleAuthOptions type — the non-deprecated,
// recommended way to inject a specific identity, as opposed to the
// deprecated `credentials`/`keyFilename` options); @google-cloud/storage's
// Storage class (built on @google-cloud/common, not gax) accepts the same
// `authClient` option.
export async function buildClients(account) {
  const region = account?.region || 'us-central1';
  const projectId = account?.gcpProjectId;
  if (!projectId) {
    throw new GcpProviderError(
      'No GCP project is configured for this account (gcpProjectId is required).',
      400
    );
  }

  const authClient = await buildAuthClient(account);
  const clientOpts = { authClient, projectId };

  return {
    region,
    projectId,
    authClient,
    run: new ServicesClient(clientOpts),
    cloudBuild: new CloudBuildClient(clientOpts),
    artifactRegistry: new ArtifactRegistryClient(clientOpts),
    secretManager: new SecretManagerServiceClient(clientOpts),
    monitoring: new MetricServiceClient(clientOpts),
    storage: new Storage(clientOpts),
  };
}

// Real verification for CustomerAwsAccount /connect and /verify (§6) — a
// single cheap, real, read-only Cloud Run Admin API call (ListServices) for
// the connected project/region, not a no-op that always marks the account
// connected. An empty list is still success: it proves the resolved
// identity chain (ADC, or impersonation of the customer's service account)
// actually works and holds at least Cloud Run viewer-level access, without
// requiring any resource to already exist.
export async function verifyConnection(account) {
  if (!account?.gcpProjectId) {
    throw new GcpProviderError('gcpProjectId is required to verify a GCP connection', 400);
  }
  const clients = await buildClients(account);
  const parent = `projects/${clients.projectId}/locations/${clients.region}`;
  try {
    const [services] = await clients.run.listServices({ parent });
    return {
      projectId: clients.projectId,
      region: clients.region,
      serviceCount: services.length,
    };
  } catch (err) {
    throw new GcpProviderError(
      `Could not verify GCP connection for project ${clients.projectId}: ${err.message}`,
      400
    );
  }
}
