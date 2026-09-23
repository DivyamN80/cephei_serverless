// Generates the real CloudFormation template customers deploy into their
// own AWS account to grant Cephei access — replaces the SIMULATED aws
// branch of routes/customerAwsAccounts.js's buildProviderOnboarding(),
// which used to return only a static permissions list and no template.
//
// Scoped to exactly what providers/aws/*.js calls: ECR (build.js), CodeBuild
// (build.js's primary build path), Lambda (lambda.js), API Gateway
// (apiGateway.js), a PassRole scoped to the two roles this template itself
// creates, and Secrets Manager (secrets.js). No RDS, no S3 bucket/instance
// resources — nothing in this codebase provisions either; the S3 actions
// below are CodeBuild's own build-source-upload mechanism, not a
// customer-facing feature.
const RESOURCE_PREFIX = 'cephei'; // matches functionName = `cephei-${slug}` in deploy.js,
                                    // and repositoryName which reuses that same value

// The CodeBuild service role's own permissions — CodeBuild assumes this
// role itself (see codebuild-trust.json) to run the build, distinct from
// the CepheiDeployRole below, which is what Cephei's server assumes to
// orchestrate everything from outside the account. Inlined verbatim from
// .aws-setup/codebuild-permissions.json (already checked into this repo)
// rather than re-derived, so the manual-setup docs and this generated
// template can't drift apart.
const CODEBUILD_SERVICE_ROLE_POLICY = {
  Version: '2012-10-17',
  Statement: [
    { Sid: 'EcrAuth', Effect: 'Allow', Action: 'ecr:GetAuthorizationToken', Resource: '*' },
    {
      Sid: 'EcrPush',
      Effect: 'Allow',
      Action: [
        'ecr:BatchCheckLayerAvailability',
        'ecr:InitiateLayerUpload',
        'ecr:UploadLayerPart',
        'ecr:CompleteLayerUpload',
        'ecr:PutImage',
        'ecr:BatchGetImage',
      ],
      Resource: `arn:aws:ecr:*:*:repository/${RESOURCE_PREFIX}-*`,
    },
    {
      Sid: 'Logs',
      Effect: 'Allow',
      Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
      Resource: `arn:aws:logs:*:*:log-group:/aws/codebuild/${RESOURCE_PREFIX}-*`,
    },
    {
      Sid: 'SourceBucket',
      Effect: 'Allow',
      Action: ['s3:GetObject', 's3:GetObjectVersion'],
      Resource: `arn:aws:s3:::${RESOURCE_PREFIX}-*/*`,
    },
  ],
};

export function buildDeployRoleTemplate({ vendorAccountId, externalId }) {
  if (!vendorAccountId) throw new Error('vendorAccountId is required to build the CloudFormation template');
  if (!externalId) throw new Error('externalId is required to build the CloudFormation template');

  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description:
      'Cephei Serverless - AWS Lambda backend deploy role. Creates a role Cephei can assume ' +
      '(only with the external ID below) to deploy your backend as a container-image Lambda ' +
      'function behind API Gateway, plus the Lambda execution role your function runs as, ' +
      'plus the CodeBuild service role used to build your container image inside your own ' +
      'account. Delete this stack at any time to revoke access.',
    Parameters: {
      ExternalId: { Type: 'String', Description: 'Paste back into Cephei unchanged.' },
    },
    Resources: {
      CepheiLambdaExecutionRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          RoleName: `${RESOURCE_PREFIX}-lambda-execution-role`,
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
          },
          ManagedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
        },
      },
      // Referenced by name in providers/aws/build.js's CODEBUILD_SERVICE_ROLE_NAME
      // constant (`cephei-codebuild-service-role`) — keep this RoleName in sync with it.
      CepheiCodeBuildServiceRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          RoleName: 'cephei-codebuild-service-role',
          // Matches .aws-setup/codebuild-trust.json exactly.
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [{ Effect: 'Allow', Principal: { Service: 'codebuild.amazonaws.com' }, Action: 'sts:AssumeRole' }],
          },
          Policies: [{ PolicyName: 'cephei-codebuild-permissions', PolicyDocument: CODEBUILD_SERVICE_ROLE_POLICY }],
        },
      },
      CepheiDeployRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          RoleName: `${RESOURCE_PREFIX}-deploy-role`,
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { AWS: `arn:aws:iam::${vendorAccountId}:root` },
                Action: 'sts:AssumeRole',
                Condition: { StringEquals: { 'sts:ExternalId': { Ref: 'ExternalId' } } },
              },
            ],
          },
          Policies: [
            {
              PolicyName: 'cephei-deploy-permissions',
              PolicyDocument: {
                Version: '2012-10-17',
                Statement: [
                  { Sid: 'EcrAuth', Effect: 'Allow', Action: 'ecr:GetAuthorizationToken', Resource: '*' },
                  {
                    Sid: 'EcrRepo',
                    Effect: 'Allow',
                    Action: [
                      'ecr:CreateRepository',
                      'ecr:DescribeRepositories',
                      'ecr:SetRepositoryPolicy',
                      'ecr:BatchCheckLayerAvailability',
                      'ecr:PutImage',
                      'ecr:InitiateLayerUpload',
                      'ecr:UploadLayerPart',
                      'ecr:CompleteLayerUpload',
                      'ecr:BatchGetImage',
                      // Local-Docker fallback path in build.js needs this to log in:
                      'ecr:GetDownloadUrlForLayer',
                    ],
                    Resource: `arn:aws:ecr:*:*:repository/${RESOURCE_PREFIX}-*`,
                  },
                  {
                    // Matches build.js's buildAndPushImageViaCodeBuild exactly:
                    // ensureBuildSourceBucket, CreateProjectCommand/UpdateProjectCommand,
                    // StartBuildCommand, BatchGetBuildsCommand, plus reading the build's
                    // logs. The build-source bucket/CodeBuild project/log group names are
                    // all account- or timestamp-derived (see build.js), so this is left
                    // resource-unscoped rather than guessing at an exact ARN pattern —
                    // a known v1 scoping gap, not an oversight.
                    Sid: 'CodeBuildPipeline',
                    Effect: 'Allow',
                    Action: [
                      's3:CreateBucket',
                      's3:HeadBucket',
                      's3:PutObject',
                      'codebuild:CreateProject',
                      'codebuild:UpdateProject',
                      'codebuild:StartBuild',
                      'codebuild:BatchGetBuilds',
                      'logs:GetLogEvents',
                    ],
                    Resource: '*',
                  },
                  {
                    Sid: 'Lambda',
                    Effect: 'Allow',
                    Action: [
                      'lambda:GetFunction',
                      'lambda:CreateFunction',
                      'lambda:UpdateFunctionCode',
                      'lambda:UpdateFunctionConfiguration',
                      'lambda:AddPermission',
                      'lambda:PublishVersion',
                      'lambda:GetAlias',
                      'lambda:CreateAlias',
                      'lambda:UpdateAlias',
                    ],
                    Resource: `arn:aws:lambda:*:*:function:${RESOURCE_PREFIX}-*`,
                  },
                  {
                    Sid: 'ApiGateway',
                    Effect: 'Allow',
                    Action: ['apigateway:GET', 'apigateway:POST', 'apigateway:PATCH', 'apigateway:DELETE'],
                    Resource: ['arn:aws:apigateway:*::/apis', 'arn:aws:apigateway:*::/apis/*'],
                  },
                  {
                    // Deliberately separate from CodeBuildPipeline's Resource: '*' above —
                    // iam:PassRole is the one action where a broad '*' resource would let
                    // Cephei pass ANY role in the account, silently defeating these two
                    // scoped grants. Every iam:PassRole this template grants lives only here.
                    Sid: 'PassLambdaExecutionRoleOnly',
                    Effect: 'Allow',
                    Action: 'iam:PassRole',
                    Resource: { 'Fn::GetAtt': ['CepheiLambdaExecutionRole', 'Arn'] },
                    Condition: { StringEquals: { 'iam:PassedToService': 'lambda.amazonaws.com' } },
                  },
                  {
                    Sid: 'PassCodeBuildServiceRoleOnly',
                    Effect: 'Allow',
                    Action: 'iam:PassRole',
                    Resource: { 'Fn::GetAtt': ['CepheiCodeBuildServiceRole', 'Arn'] },
                    Condition: { StringEquals: { 'iam:PassedToService': 'codebuild.amazonaws.com' } },
                  },
                  {
                    // Matches providers/aws/secrets.js's syncSecretsToSecretsManager exactly.
                    Sid: 'BackendSecrets',
                    Effect: 'Allow',
                    Action: ['secretsmanager:CreateSecret', 'secretsmanager:PutSecretValue', 'secretsmanager:DescribeSecret'],
                    Resource: `arn:aws:secretsmanager:*:*:secret:cephei/${RESOURCE_PREFIX}-*`,
                  },
                ],
              },
            },
          ],
        },
      },
    },
    Outputs: {
      DeployRoleArn: { Value: { 'Fn::GetAtt': ['CepheiDeployRole', 'Arn'] } },
      LambdaExecutionRoleArn: { Value: { 'Fn::GetAtt': ['CepheiLambdaExecutionRole', 'Arn'] } },
    },
  };
}

export function summarizeAwsPermissions() {
  return [
    'Push container images to ECR repositories it creates, named cephei-*, and grant Lambda permission to pull from them',
    'Build container images via CodeBuild (cephei-* projects only) — falls back to a local Docker build only if this AWS account has no CodeBuild quota available',
    'Create and update Lambda functions, publish versions, and manage the `live` alias (cephei-* function names only)',
    'Create and manage API Gateway HTTP APIs for deployed functions',
    'Pass exactly two IAM roles this same stack creates — one to Lambda, one to CodeBuild — nothing else',
    'Create and update one Secrets Manager secret per app (cephei/cephei-*) to store the environment variables you provide, e.g. your database connection string',
    'Nothing else — no AdministratorAccess, no ReadOnlyAccess, no RDS, no general S3 access',
  ];
}
