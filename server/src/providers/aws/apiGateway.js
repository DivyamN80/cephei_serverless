import {
  GetApisCommand,
  CreateApiCommand,
  GetIntegrationsCommand,
  CreateIntegrationCommand,
  GetRoutesCommand,
  CreateRouteCommand,
  GetStageCommand,
  CreateStageCommand,
} from '@aws-sdk/client-apigatewayv2';
import { AddPermissionCommand } from '@aws-sdk/client-lambda';

async function findApiByName(apiGateway, name) {
  const { Items } = await apiGateway.send(new GetApisCommand({}));
  return Items?.find((a) => a.Name === name);
}

// Idempotent create-then-reuse HTTP API with a single catch-all AWS_PROXY
// route to the function's `live` alias — the same shape on every redeploy.
export async function ensureHttpApi(clients, { functionArn, aliasName, accountId, functionName }, onLog) {
  const { apiGateway, lambda, region } = clients;
  // functionName is already `cephei-<slug>` — reuse it as-is rather than
  // prefixing again into `cephei-cephei-<slug>`.
  const apiName = functionName;

  let api = await findApiByName(apiGateway, apiName);
  if (!api) {
    onLog(`Creating API Gateway HTTP API ${apiName}...`);
    api = await apiGateway.send(
      new CreateApiCommand({ Name: apiName, ProtocolType: 'HTTP' })
    );
  }
  const apiId = api.ApiId;
  const aliasedFunctionArn = `${functionArn}:${aliasName}`;

  const { Items: integrations } = await apiGateway.send(new GetIntegrationsCommand({ ApiId: apiId }));
  let integration = integrations?.find((i) => i.IntegrationUri === aliasedFunctionArn);
  if (!integration) {
    onLog('Creating API Gateway integration...');
    integration = await apiGateway.send(
      new CreateIntegrationCommand({
        ApiId: apiId,
        IntegrationType: 'AWS_PROXY',
        IntegrationUri: aliasedFunctionArn,
        PayloadFormatVersion: '2.0',
      })
    );
  }

  const { Items: routes } = await apiGateway.send(new GetRoutesCommand({ ApiId: apiId }));
  const target = `integrations/${integration.IntegrationId}`;
  if (!routes?.some((r) => r.RouteKey === '$default')) {
    onLog('Creating catch-all route...');
    await apiGateway.send(new CreateRouteCommand({ ApiId: apiId, RouteKey: '$default', Target: target }));
  }

  try {
    await apiGateway.send(new GetStageCommand({ ApiId: apiId, StageName: '$default' }));
  } catch (err) {
    if (err.name !== 'NotFoundException') throw err;
    onLog('Creating $default auto-deploy stage...');
    await apiGateway.send(new CreateStageCommand({ ApiId: apiId, StageName: '$default', AutoDeploy: true }));
  }

  // Without this, every request 500s with "Internal Server Error" — API
  // Gateway is never granted permission to invoke the alias by default.
  const statementId = `cephei-apigw-${apiId}`;
  try {
    await lambda.send(
      new AddPermissionCommand({
        FunctionName: functionName,
        Qualifier: aliasName,
        StatementId: statementId,
        Action: 'lambda:InvokeFunction',
        Principal: 'apigateway.amazonaws.com',
        SourceArn: `arn:aws:execute-api:${region}:${accountId}:${apiId}/*/*`,
      })
    );
  } catch (err) {
    if (err.name !== 'ResourceConflictException') throw err;
  }

  return `https://${apiId}.execute-api.${region}.amazonaws.com`;
}
