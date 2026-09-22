import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { ECRClient } from '@aws-sdk/client-ecr';
import { CodeBuildClient } from '@aws-sdk/client-codebuild';
import { S3Client } from '@aws-sdk/client-s3';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { ApiGatewayV2Client } from '@aws-sdk/client-apigatewayv2';
import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';

export class AwsProviderError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'AwsProviderError';
    this.status = status;
  }
}

// Builds every AWS SDK client this provider needs, scoped to the connected
// customer account when one exists. When `account.roleArn` is set, every
// call is made as the assumed cross-account role (the real, least-privilege
// path — see verifyConnection() in connect.js for the same AssumeRole call
// used to validate the connection). When there is no connected account yet
// (account is null/undefined, or an AWS account with no roleArn saved),
// this falls back to whatever credentials the server process itself has
// (env vars / ~/.aws/credentials / instance profile) — the explicitly
// sanctioned "local/legacy credentials" bootstrap path for a first working
// version, per this project's own deploy-strategy notes.
export function buildClients(account) {
  const region = account?.region || 'us-east-1';

  const credentials =
    account?.provider === 'aws' && account?.roleArn
      ? fromTemporaryCredentials({
          params: {
            RoleArn: account.roleArn,
            RoleSessionName: 'cephei-deploy',
            ExternalId: account.externalId,
            DurationSeconds: 3600,
          },
        })
      : undefined;

  const clientConfig = { region, ...(credentials ? { credentials } : {}) };

  return {
    region,
    sts: new STSClient(clientConfig),
    ecr: new ECRClient(clientConfig),
    codebuild: new CodeBuildClient(clientConfig),
    s3: new S3Client(clientConfig),
    lambda: new LambdaClient(clientConfig),
    apiGateway: new ApiGatewayV2Client(clientConfig),
    logs: new CloudWatchLogsClient(clientConfig),
    cloudwatch: new CloudWatchClient(clientConfig),
    secretsManager: new SecretsManagerClient(clientConfig),
  };
}

// Real verification for CustomerAwsAccount /connect and /verify (§6) — an
// actual STS AssumeRole call using the stored externalId as the condition,
// not a no-op that always marks the account connected. Returns the caller
// identity that resulted so the route can surface something concrete.
export async function assumeAndVerify(account) {
  if (!account.roleArn) {
    throw new AwsProviderError('roleArn is required to verify an AWS connection', 400);
  }
  const sts = new STSClient({ region: account.region || 'us-east-1' });
  try {
    const result = await sts.send(
      new AssumeRoleCommand({
        RoleArn: account.roleArn,
        ExternalId: account.externalId,
        RoleSessionName: 'cephei-verify',
        DurationSeconds: 900,
      })
    );
    return {
      assumedRoleId: result.AssumedRoleUser?.AssumedRoleId,
      arn: result.AssumedRoleUser?.Arn,
    };
  } catch (err) {
    throw new AwsProviderError(`Could not assume ${account.roleArn}: ${err.message}`, 400);
  }
}
