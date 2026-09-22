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
      },
    ],
    trafficTier: { type: String, enum: ['steady', 'steady_spikes', 'low_spiky'] },
    recommendation: {
      target: String,
      projectedMonthlySavingsUsd: Number,
      diff: [{ file: String, before: String, after: String }],
    },
    customerAwsAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerAwsAccount' },
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

export default mongoose.model('Project', projectSchema);
