import express from 'express';
import crypto from 'crypto';
import CustomerAwsAccount from '../models/CustomerAwsAccount.js';
import Project from '../models/Project.js';
import { requireAuth } from '../middleware/auth.js';
import { getProvider } from '../providers/index.js';
import { encryptSecretValue } from '../utils/secretsCrypto.js';
import { buildDeployRoleTemplate, summarizeAwsPermissions } from '../providers/aws/cfnTemplate.js';

const router = express.Router();

router.use(requireAuth);

const PROVIDERS = ['aws', 'azure', 'gcp'];

// Per-provider onboarding info.
//  - aws:   real — builds an actual CloudFormation template (cfnTemplate.js)
//           scoped to exactly what providers/aws/*.js calls. No
//           quickCreateUrl: that requires a publicly-fetchable templateURL,
//           which needs an S3 (or equivalent) publish step this doesn't
//           have — templateBody carries the real JSON instead, for a
//           copy/paste or upload-a-file flow in the console, alongside the
//           externalId shown separately in the UI to paste into the stack's
//           ExternalId parameter.
//  - azure: SIMULATED — a real implementation would publish an ARM/Bicep
//           template and build a real Azure "Deploy to Azure"
//           custom-deployment URL, again carrying the externalId.
//  - gcp:   SIMULATED — a real implementation would publish a Deployment
//           Manager / Terraform config and build a real Cloud Shell
//           "walkthrough" URL that provisions the scoped service account,
//           again carrying the externalId.
function buildProviderOnboarding(provider, externalId) {
  if (provider === 'azure') {
    return {
      consoleLabel: 'Open Azure custom deployment ↗',
      quickCreateUrl:
        `https://portal.azure.com/#create/Microsoft.Template/uri/` +
        `https%3A%2F%2Fcephei-arm-templates.blob.core.windows.net%2Ftemplates%2Fcross-tenant-access.json` +
        `?externalId=${externalId}`,
      permissions: [
        'Push container images to Azure Container Registry (cephei-* repositories only)',
        'Create and update Function Apps (cephei-* function app names only)',
        'Manage HTTP-triggered function routes',
        'A single scoped role assignment limited to the Function App’s managed identity',
        'Read-only Azure Monitor metrics and logs for deployed functions',
        'Read-only Cost Management + Billing access for cost reporting',
        'Bootstrap an Azure Database instance/connection when a database migration is requested',
      ],
    };
  }
  if (provider === 'gcp') {
    return {
      consoleLabel: 'Open Cloud Shell setup script ↗',
      quickCreateUrl:
        `https://console.cloud.google.com/cloudshell/editor` +
        `?cloudshell_git_repo=https%3A%2F%2Fgithub.com%2Fcephei%2Fgcp-bootstrap` +
        `&cloudshell_workspace=.&externalId=${externalId}`,
      permissions: [
        'Push container images to Artifact Registry (cephei-* repositories only)',
        'Create and update Cloud Functions (cephei-* function names only)',
        'Manage HTTPS triggers for deployed functions',
        'roles/iam.serviceAccountUser limited to the Cloud Functions runtime service account',
        'Read-only Cloud Monitoring metrics and logs for deployed functions',
        'Read-only Cloud Billing budget and cost access',
        'Bootstrap a Cloud SQL instance/connection when a database migration is requested',
      ],
    };
  }
  // aws (default) — real template, scoped to exactly what
  // providers/aws/*.js calls (ECR, CodeBuild, Lambda, API Gateway, a
  // PassRole scoped to the two roles the template itself creates, and
  // Secrets Manager).
  const templateBody = buildDeployRoleTemplate({
    vendorAccountId: process.env.AWS_ACCOUNT_ID,
    externalId,
  });
  return {
    templateBody,
    permissions: summarizeAwsPermissions(),
  };
}

router.get('/', async (req, res, next) => {
  try {
    const accounts = await CustomerAwsAccount.find({ owner: req.user._id }).sort({
      createdAt: -1,
    });
    res.json(accounts);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { provider = 'aws' } = req.body || {};
    if (!PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: `provider must be one of ${PROVIDERS.join(', ')}` });
    }

    const externalId = crypto.randomUUID();

    const account = await CustomerAwsAccount.create({
      owner: req.user._id,
      provider,
      externalId,
      status: 'pending',
    });

    const { quickCreateUrl, templateBody, permissions, consoleLabel } = buildProviderOnboarding(provider, externalId);

    res.status(201).json({ account, quickCreateUrl, templateBody, permissions, consoleLabel });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/connect', async (req, res, next) => {
  try {
    const account = await CustomerAwsAccount.findOne({ _id: req.params.id, owner: req.user._id });
    if (!account) {
      return res.status(404).json({ error: 'Cloud account not found' });
    }

    // Every provider is verified for real below via
    // getProvider(provider).verifyConnection(account):
    //  - aws:   STS AssumeRole using the stored externalId as the
    //           ExternalId condition against the customer's roleArn.
    //  - azure: ClientSecretCredential (the customer's own Service
    //           Principal — tenantId/clientId/clientSecret) then a real
    //           ARM call scoped to their subscriptionId/resourceGroup.
    //  - gcp:   Cephei's fixed identity impersonates the customer's
    //           gcpServiceAccountEmail via IAM Credentials
    //           generateAccessToken (the customer grants that fixed
    //           identity roles/iam.serviceAccountTokenCreator on it —
    //           the GCP analog of AWS's AssumeRole+ExternalId).
    if (account.provider === 'azure') {
      const { azureSubscriptionId, azureTenantId, azureClientId, azureClientSecret, azureResourceGroup, region } =
        req.body || {};
      if (!azureSubscriptionId || !azureTenantId || !azureClientId || !azureClientSecret || !azureResourceGroup) {
        return res.status(400).json({
          error:
            'azureSubscriptionId, azureTenantId, azureClientId, azureClientSecret and azureResourceGroup are all required',
        });
      }
      const encrypted = encryptSecretValue(azureClientSecret);
      account.azureSubscriptionId = azureSubscriptionId;
      account.azureTenantId = azureTenantId;
      account.azureClientId = azureClientId;
      account.azureClientSecretCiphertext = encrypted.ciphertext;
      account.azureClientSecretIv = encrypted.iv;
      account.azureClientSecretAuthTag = encrypted.authTag;
      account.azureResourceGroup = azureResourceGroup;
      account.region = region || 'eastus';
    } else if (account.provider === 'gcp') {
      const { gcpProjectId, gcpServiceAccountEmail, region } = req.body || {};
      if (!gcpProjectId || !gcpServiceAccountEmail) {
        return res.status(400).json({ error: 'gcpProjectId and gcpServiceAccountEmail are required' });
      }
      account.gcpProjectId = gcpProjectId;
      account.gcpServiceAccountEmail = gcpServiceAccountEmail;
      account.region = region || 'us-central1';
    } else {
      const { roleArn, executionRoleArn, awsAccountId, region } = req.body || {};
      if (!roleArn || !executionRoleArn || !awsAccountId) {
        return res.status(400).json({ error: 'roleArn, executionRoleArn and awsAccountId are all required' });
      }
      account.roleArn = roleArn;
      account.executionRoleArn = executionRoleArn;
      account.awsAccountId = awsAccountId;
      account.region = region || 'us-east-1';
    }

    try {
      await getProvider(account.provider).verifyConnection(account);
    } catch (verifyErr) {
      account.status = 'error';
      account.lastError = verifyErr.message;
      await account.save();
      return res.status(verifyErr.status || 400).json({ error: verifyErr.message, account });
    }

    account.status = 'connected';
    account.connectedAt = new Date();
    account.lastError = undefined;
    await account.save();

    res.json(account);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/verify', async (req, res, next) => {
  try {
    const account = await CustomerAwsAccount.findOne({ _id: req.params.id, owner: req.user._id });
    if (!account) {
      return res.status(404).json({ error: 'Cloud account not found' });
    }

    // Re-verified for real on every call — if the customer deletes the
    // role/app registration/service account grant, revokes the trust, or
    // rotates the secret on their side, this now genuinely fails instead
    // of silently staying "connected".
    try {
      await getProvider(account.provider).verifyConnection(account);
    } catch (verifyErr) {
      account.status = 'error';
      account.lastError = verifyErr.message;
      await account.save();
      return res.status(verifyErr.status || 400).json({ error: verifyErr.message, account });
    }

    account.status = 'connected';
    account.lastError = undefined;
    if (!account.connectedAt) {
      account.connectedAt = new Date();
    }
    await account.save();

    res.json(account);
  } catch (err) {
    next(err);
  }
});

const SUBNET_ID_PATTERN = /^subnet-[0-9a-f]{8,}$/i;
const SECURITY_GROUP_ID_PATTERN = /^sg-[0-9a-f]{8,}$/i;

// Updates only the optional Lambda VPC placement for an AWS account —
// subnet/security-group IDs the customer supplies directly (Cephei never
// discovers or validates them against the account itself, so this needs no
// new EC2 permissions on the deploy role; see cfnTemplate.js). Sending both
// fields empty clears lambdaVpc, reverting the account to the
// public-network-path-only behavior every account had before this existed.
router.patch('/:id', async (req, res, next) => {
  try {
    const account = await CustomerAwsAccount.findOne({ _id: req.params.id, owner: req.user._id });
    if (!account) {
      return res.status(404).json({ error: 'Cloud account not found' });
    }
    if (account.provider !== 'aws') {
      return res.status(400).json({ error: 'lambdaVpc only applies to AWS accounts' });
    }

    const { subnetIds, securityGroupIds } = req.body || {};
    if (subnetIds !== undefined && !Array.isArray(subnetIds)) {
      return res.status(400).json({ error: 'subnetIds must be an array of strings' });
    }
    if (securityGroupIds !== undefined && !Array.isArray(securityGroupIds)) {
      return res.status(400).json({ error: 'securityGroupIds must be an array of strings' });
    }

    const cleanSubnetIds = (subnetIds || []).map((s) => String(s).trim()).filter(Boolean);
    const cleanSecurityGroupIds = (securityGroupIds || []).map((s) => String(s).trim()).filter(Boolean);

    const badSubnet = cleanSubnetIds.find((s) => !SUBNET_ID_PATTERN.test(s));
    if (badSubnet) {
      return res.status(400).json({ error: `"${badSubnet}" doesn't look like a subnet ID (expected subnet-xxxxxxxx)` });
    }
    const badSecurityGroup = cleanSecurityGroupIds.find((s) => !SECURITY_GROUP_ID_PATTERN.test(s));
    if (badSecurityGroup) {
      return res.status(400).json({ error: `"${badSecurityGroup}" doesn't look like a security group ID (expected sg-xxxxxxxx)` });
    }

    account.lambdaVpc =
      cleanSubnetIds.length || cleanSecurityGroupIds.length
        ? { subnetIds: cleanSubnetIds, securityGroupIds: cleanSecurityGroupIds }
        : undefined;
    await account.save();

    res.json(account);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/disconnect', async (req, res, next) => {
  try {
    const account = await CustomerAwsAccount.findOne({ _id: req.params.id, owner: req.user._id });
    if (!account) {
      return res.status(404).json({ error: 'Cloud account not found' });
    }

    account.status = 'revoked';
    await account.save();

    await Project.updateMany(
      { customerAwsAccount: account._id },
      { $unset: { customerAwsAccount: '' } }
    );

    res.json(account);
  } catch (err) {
    next(err);
  }
});

export default router;
