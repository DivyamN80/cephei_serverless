import {
  GetFunctionCommand,
  CreateFunctionCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  PublishVersionCommand,
  GetAliasCommand,
  CreateAliasCommand,
  UpdateAliasCommand,
  waitUntilFunctionActiveV2,
  waitUntilFunctionUpdatedV2,
} from '@aws-sdk/client-lambda';

const LIVE_ALIAS = 'live';
const WAITER_OPTS = { maxWaitTime: 180 };

// vpcConfig ({ subnetIds, securityGroupIds }) is optional — the customer's
// CustomerAwsAccount.lambdaVpc, when set. Without it (the default), the
// function gets no VpcConfig at all, same as before this option existed —
// only needed when the database (or anything else the function calls)
// isn't reachable over the public internet.
export async function ensureLambdaFunction(lambda, { functionName, imageUri, role, environment, vpcConfig }, onLog) {
  let exists = true;
  try {
    await lambda.send(new GetFunctionCommand({ FunctionName: functionName }));
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') throw err;
    exists = false;
  }

  const VpcConfig = vpcConfig
    ? { SubnetIds: vpcConfig.subnetIds, SecurityGroupIds: vpcConfig.securityGroupIds }
    : undefined;

  if (!exists) {
    onLog(`Creating Lambda function ${functionName}...`);
    await lambda.send(
      new CreateFunctionCommand({
        FunctionName: functionName,
        PackageType: 'Image',
        Code: { ImageUri: imageUri },
        Role: role,
        Timeout: 29, // API Gateway HTTP API's own hard integration timeout is 30s
        MemorySize: 512,
        Environment: { Variables: environment },
        ...(VpcConfig ? { VpcConfig } : {}),
      })
    );
    await waitUntilFunctionActiveV2({ client: lambda, ...WAITER_OPTS }, { FunctionName: functionName });
  } else {
    onLog(`Updating Lambda function ${functionName}...`);
    await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: functionName, ImageUri: imageUri }));
    await waitUntilFunctionUpdatedV2({ client: lambda, ...WAITER_OPTS }, { FunctionName: functionName });

    await lambda.send(
      new UpdateFunctionConfigurationCommand({
        FunctionName: functionName,
        Environment: { Variables: environment },
        ...(VpcConfig ? { VpcConfig } : {}),
      })
    );
    await waitUntilFunctionUpdatedV2({ client: lambda, ...WAITER_OPTS }, { FunctionName: functionName });
  }

  const { Configuration } = await lambda.send(new GetFunctionCommand({ FunctionName: functionName }));
  return Configuration;
}

// Publishes an immutable version from $LATEST and points the `live` alias
// at it — this is what makes Rollback mean something real: an older
// version is still sitting there to repoint the alias back to.
export async function publishVersionAndUpdateAlias(lambda, functionName, onLog) {
  onLog('Publishing new Lambda version...');
  const { Version } = await lambda.send(new PublishVersionCommand({ FunctionName: functionName }));

  try {
    await lambda.send(new GetAliasCommand({ FunctionName: functionName, Name: LIVE_ALIAS }));
    await lambda.send(
      new UpdateAliasCommand({ FunctionName: functionName, Name: LIVE_ALIAS, FunctionVersion: Version })
    );
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') throw err;
    await lambda.send(
      new CreateAliasCommand({ FunctionName: functionName, Name: LIVE_ALIAS, FunctionVersion: Version })
    );
  }
  onLog(`Alias '${LIVE_ALIAS}' now points at version ${Version}.`);
  return Version;
}

export async function repointLiveAlias(lambda, functionName, toVersion, onLog) {
  onLog(`Rolling back Lambda alias '${LIVE_ALIAS}' to version ${toVersion}...`);
  await lambda.send(
    new UpdateAliasCommand({ FunctionName: functionName, Name: LIVE_ALIAS, FunctionVersion: toVersion })
  );
}

export const LAMBDA_LIVE_ALIAS = LIVE_ALIAS;
