import mongoose from 'mongoose';

const projectSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: String,
    repoUrl: String,
    status: { type: String, enum: ['analyzing', 'ready', 'deployed', 'error'], default: 'analyzing' },
    detectedStack: {
      backend: String,
      frontend: String,
      database: String,
      versions: mongoose.Schema.Types.Mixed,
    },
    compatibilityChecklist: [
      { label: String, severity: { type: String, enum: ['blocker', 'warning', 'ok'] } },
    ],
    // Every package.json repoIngest.js found that looks like a backend
    // (matched a known server framework) — length > 1 means the repo is a
    // monorepo and the UI should ask which folder is the real backend
    // instead of silently deploying whichever one was detected first.
    backendCandidates: [
      {
        path: String,
        name: String,
        framework: String,
        database: String,
        hasDockerfile: Boolean,
        // Best-effort .listen() scan result — see repoIngest.js's
        // detectListenPort. listenPortDetected: false means listenPort is
        // just the conventional-default fallback, not a real finding.
        listenPort: Number,
        listenPortDetected: Boolean,
      },
    ],
    // Which backendCandidates[].path the customer explicitly picked via
    // POST /:id/select-backend for a monorepo (multiple candidates) — see
    // repoIngest.js's resolveBackendCandidate, which every provider's
    // prepareBuildSource() uses instead of always deploying candidates[0].
    selectedBackendPath: String,
    trafficTier: { type: String, enum: ['steady', 'steady_spikes', 'low_spiky'] },
    recommendation: {
      target: String,
      projectedMonthlySavingsUsd: Number,
      diff: [{ file: String, before: String, after: String }],
    },
    customerAwsAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerAwsAccount' },
    // Credential for private-repo analysis/deploy — a GitHub PAT or an SSH
    // deploy-key private key, AES-256-GCM encrypted at rest with the same
    // encryptSecretValue()/decryptSecretValue() pair ProjectSecret and
    // CustomerAwsAccount's Azure client secret use (utils/secretsCrypto.js).
    // Stripped from every response by the toJSON transform below.
    githubAuth: {
      method: { type: String, enum: ['pat', 'ssh', null], default: null },
      ciphertext: String,
      iv: String,
      authTag: String,
    },
    deployResult: {
      provider: { type: String, enum: ['aws', 'azure', 'gcp'] },
      invokeUrl: String,
      functionName: String,
      apiId: String, // AWS API Gateway only — unset for Azure/GCP
      region: String,
      lambdaLiveVersion: String, // generic "live version" label, reused across providers
      // §5 real per-cloud secret store reference — Secrets Manager ARN
      // (AWS), Secret Manager path prefix (GCP), or Key Vault URI (Azure).
      // Unset when the project has no secrets configured.
      secretsStoreRef: String,
    },
    frontendDeployResult: {
      provider: { type: String, enum: ['aws', 'azure', 'gcp'] },
      bucket: String, // storage account (Azure) / bucket (AWS, GCP) name
      url: String,
      region: String,
    },
    frontendDeployError: String,
  },
  { timestamps: true }
);

// Enforces the "never returned by any route" promise made in the githubAuth
// field comment above — every route in projects.js does res.json(project)
// without hand-picking fields, so this transform is the only thing actually
// keeping the encrypted PAT/SSH key ciphertext/iv/authTag out of API
// responses. Same pattern as CustomerAwsAccount.js's Azure client secret.
projectSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.githubAuth;
    return ret;
  },
});

export default mongoose.model('Project', projectSchema);
