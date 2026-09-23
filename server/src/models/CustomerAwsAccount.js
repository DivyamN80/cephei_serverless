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
    // Optional — only needed when the customer's database (or anything
    // else the function talks to) isn't publicly reachable. Subnet/security
    // group IDs are supplied by the customer directly (see
    // PATCH /api/customer-aws-accounts/:id), not discovered by Cephei, so
    // the deploy role needs no new EC2 permissions for this. Unset means
    // the deployed Lambda gets no VpcConfig at all — the exact behavior
    // every project had before this field existed.
    lambdaVpc: {
      subnetIds: [String],
      securityGroupIds: [String],
    },

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

// Enforces the "never returned by any route" promise made in the Azure
// field comments above — every route in customerAwsAccounts.js does
// res.json(account)/res.json(accounts) without ever hand-picking fields,
// so this transform is the only thing actually keeping the encrypted
// client secret's ciphertext/iv/authTag out of API responses.
customerAwsAccountSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.azureClientSecretCiphertext;
    delete ret.azureClientSecretIv;
    delete ret.azureClientSecretAuthTag;
    return ret;
  },
});

export default mongoose.model('CustomerAwsAccount', customerAwsAccountSchema);
