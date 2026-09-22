import mongoose from 'mongoose';

// Despite the model name (kept for backward compatibility with existing
// data/routes), this represents a connected account on ANY supported cloud —
// AWS, Azure, or GCP — selected via `provider`. Each provider has its own
// set of credential-shaped fields below; only the fields for the account's
// own provider are ever populated.
const customerAwsAccountSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, enum: ['aws', 'azure', 'gcp'], default: 'aws', required: true },
    externalId: { type: String, required: true },

    // AWS
    awsAccountId: String,
    roleArn: String,
    executionRoleArn: String,

    // Azure — client secret is AES-256-GCM encrypted at rest (same scheme
    // as ProjectSecret/secretsCrypto.js), never returned by any route.
    // Real Azure AD Service Principal auth (ClientSecretCredential) needs
    // it; there's no AssumeRole-equivalent without either a stored secret
    // or a federated-credential/OIDC trust Cephei doesn't operate yet.
    azureSubscriptionId: String,
    azureTenantId: String,
    azureClientId: String,
    azureClientSecretCiphertext: String,
    azureClientSecretIv: String,
    azureClientSecretAuthTag: String,
    azureResourceGroup: String,

    // GCP
    gcpProjectId: String,
    gcpServiceAccountEmail: String,

    region: { type: String, default: 'us-east-1' },
    status: {
      type: String,
      enum: ['pending', 'connected', 'error', 'revoked', 'needs-update'],
      default: 'pending',
    },
    lastError: String,
    connectedAt: Date,
  },
  { timestamps: true }
);

export default mongoose.model('CustomerAwsAccount', customerAwsAccountSchema);
