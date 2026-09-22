import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import archiver from 'archiver';
import {
  CreateRepositoryCommand,
  DescribeRepositoriesCommand,
  SetRepositoryPolicyCommand,
  GetAuthorizationTokenCommand,
} from '@aws-sdk/client-ecr';
import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  CreateProjectCommand,
  UpdateProjectCommand,
  StartBuildCommand,
  BatchGetBuildsCommand,
} from '@aws-sdk/client-codebuild';
import { GetLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { AwsProviderError } from './clients.js';

const CODEBUILD_SERVICE_ROLE_NAME = 'cephei-codebuild-service-role';
const CODEBUILD_IMAGE = 'aws/codebuild/standard:7.0';
const BUILD_POLL_INTERVAL_MS = 5000;
const BUILD_TIMEOUT_MS = 15 * 60 * 1000;

function buildSpecYaml() {
  return [
    'version: 0.2',
    'phases:',
    '  pre_build:',
    '    commands:',
    '      - echo Logging in to Amazon ECR...',
    '      - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com',
    '  build:',
    '    commands:',
    '      - echo Building the Docker image...',
    '      - docker build --provenance=false -t $IMAGE_REPO_NAME:$IMAGE_TAG .',
    '      - docker tag $IMAGE_REPO_NAME:$IMAGE_TAG $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG',
    '  post_build:',
    '    commands:',
    '      - echo Pushing the Docker image...',
    '      - docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG',
    '',
  ].join('\n');
}

export async function ensureEcrRepo(ecr, repoName, onLog) {
  try {
    await ecr.send(new DescribeRepositoriesCommand({ repositoryNames: [repoName] }));
  } catch (err) {
    if (err.name !== 'RepositoryNotFoundException') throw err;
    onLog(`Creating ECR repository ${repoName}...`);
    await ecr.send(
      new CreateRepositoryCommand({
        repositoryName: repoName,
        imageScanningConfiguration: { scanOnPush: true },
        imageTagMutability: 'MUTABLE',
      })
    );
  }
}

// REQUIRED, separate from the caller's own IAM permissions — without this,
// CreateFunction fails with "Lambda does not have permission to access the
// ECR image" on every brand-new repo. Safe to call on every deploy.
export async function ensureLambdaCanPullFromEcr(ecr, repoName, accountId, executionRoleArn, onLog) {
  onLog('Granting Lambda pull access on the ECR repository...');
  await ecr.send(
    new SetRepositoryPolicyCommand({
      repositoryName: repoName,
      policyText: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'LambdaECRImageRetrievalPolicy',
            Effect: 'Allow',
            Principal: { Service: 'lambda.amazonaws.com' },
            Action: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'],
            Condition: executionRoleArn
              ? { StringLike: { 'aws:sourceArn': `arn:aws:lambda:*:${accountId}:function:*` } }
              : undefined,
          },
        ],
      }),
    })
  );
}

async function ensureBuildSourceBucket(s3, bucketName, region, onLog) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
    return;
  } catch (err) {
    if (err.$metadata?.httpStatusCode !== 404 && err.name !== 'NotFound') {
      // Some other error (e.g. access denied) — surface it rather than
      // masking it as "bucket doesn't exist".
      if (err.$metadata?.httpStatusCode !== 403) throw err;
    }
  }
  onLog(`Creating build-source bucket ${bucketName}...`);
  await s3.send(
    new CreateBucketCommand({
      Bucket: bucketName,
      ...(region !== 'us-east-1'
        ? { CreateBucketConfiguration: { LocationConstraint: region } }
        : {}),
    })
  );
}

function zipDirectory(sourceDir, destZipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destZipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function ensureCodeBuildProject(codebuild, { projectName, serviceRoleArn }, onLog) {
  const input = {
    name: projectName,
    source: { type: 'NO_SOURCE', buildspec: buildSpecYaml() },
    artifacts: { type: 'NO_ARTIFACTS' },
    environment: {
      type: 'LINUX_CONTAINER',
      image: CODEBUILD_IMAGE,
      computeType: 'BUILD_GENERAL1_SMALL',
      privilegedMode: true, // required for `docker build` (docker-in-docker)
    },
    serviceRole: serviceRoleArn,
  };

  try {
    onLog(`Creating CodeBuild project ${projectName}...`);
    await codebuild.send(new CreateProjectCommand(input));
  } catch (err) {
    if (err.name !== 'ResourceAlreadyExistsException') throw err;
    await codebuild.send(new UpdateProjectCommand(input));
  }
}

async function tailBuildLogs(logs, group, stream, onLog) {
  if (!group || !stream) return;
  try {
    const { events } = await logs.send(
      new GetLogEventsCommand({ logGroupName: group, logStreamName: stream, limit: 60, startFromHead: false })
    );
    for (const e of events || []) {
      const line = e.message?.trim();
      if (line) onLog(`  ${line}`);
    }
  } catch {
    // Best-effort — a build failure is still reported without log detail
    // if CloudWatch Logs isn't reachable (e.g. permissions gap).
  }
}

// Zips the given source directory (already containing a Dockerfile — either
// the repo's own, or one repoIngest/dockerfile.js generated), uploads it to
// S3, and runs it through a CodeBuild project that builds and pushes the
// image entirely inside AWS — no Docker daemon required on this server.
// This is the primary path (§3 decision: cloud-native build services).
async function buildAndPushImageViaCodeBuild(clients, { accountId, sourceDir, repoName, tag }, onLog) {
  const { s3, codebuild, logs, region } = clients;
  const bucketName = `cephei-build-source-${accountId}`;
  await ensureBuildSourceBucket(s3, bucketName, region, onLog);

  const zipPath = path.join(sourceDir, '..', `${repoName}-${tag}.zip`);
  onLog('Packaging build source...');
  await zipDirectory(sourceDir, zipPath);

  const key = `builds/${repoName}/${tag}.zip`;
  onLog(`Uploading build source to s3://${bucketName}/${key}...`);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fs.createReadStream(zipPath),
    })
  );
  await fs.promises.rm(zipPath, { force: true });

  const projectName = repoName;
  const serviceRoleArn = `arn:aws:iam::${accountId}:role/${CODEBUILD_SERVICE_ROLE_NAME}`;
  await ensureCodeBuildProject(codebuild, { projectName, serviceRoleArn }, onLog);

  onLog('Starting container build (CodeBuild)...');
  const { build } = await codebuild.send(
    new StartBuildCommand({
      projectName,
      sourceTypeOverride: 'S3',
      sourceLocationOverride: `${bucketName}/${key}`,
      environmentVariablesOverride: [
        { name: 'AWS_ACCOUNT_ID', value: String(accountId) },
        { name: 'IMAGE_REPO_NAME', value: repoName },
        { name: 'IMAGE_TAG', value: tag },
      ],
    })
  );

  const buildId = build.id;
  const startedAt = Date.now();
  let lastPhase = null;

  while (true) {
    if (Date.now() - startedAt > BUILD_TIMEOUT_MS) {
      throw new AwsProviderError(`CodeBuild build ${buildId} timed out after ${BUILD_TIMEOUT_MS / 1000}s`);
    }
    await new Promise((r) => setTimeout(r, BUILD_POLL_INTERVAL_MS));

    const { builds } = await codebuild.send(new BatchGetBuildsCommand({ ids: [buildId] }));
    const current = builds?.[0];
    if (!current) continue;

    if (current.currentPhase !== lastPhase) {
      onLog(`Build phase: ${current.currentPhase}`);
      lastPhase = current.currentPhase;
    }

    if (current.buildStatus === 'IN_PROGRESS') continue;

    // Terminal state.
    await tailBuildLogs(logs, current.logs?.groupName, current.logs?.streamName, onLog);

    if (current.buildStatus !== 'SUCCEEDED') {
      throw new AwsProviderError(
        `CodeBuild build ${buildId} ended with status ${current.buildStatus}. Check the CodeBuild console for full logs (log group: ${current.logs?.groupName || 'n/a'}).`
      );
    }
    onLog('Build succeeded.');
    break;
  }

  return `${accountId}.dkr.ecr.${region}.amazonaws.com/${repoName}:${tag}`;
}

function runCommand(command, args, { cwd, input } = {}, onLog) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let stderrTail = '';
    const relay = (chunk) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) onLog(`  ${line.trim()}`);
      }
    };
    child.stdout?.on('data', relay);
    child.stderr?.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000);
      relay(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new AwsProviderError(`${command} ${args.join(' ')} failed (exit ${code}): ${stderrTail.slice(-500)}`));
    });
    if (input != null) child.stdin.write(input);
    child.stdin.end();
  });
}

async function isLocalDockerAvailable() {
  return new Promise((resolve) => {
    const child = spawn('docker', ['info'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

// Fallback path used only when the account's CodeBuild concurrent-build
// quota is exhausted (see buildAndPushImage below) — builds the same
// Dockerfile with a local Docker daemon on this server and pushes straight
// to ECR. Not the primary strategy (§3 chose cloud-native builds so Cephei
// itself doesn't need Docker installed), but a real, working alternative
// for accounts that haven't had their CodeBuild quota raised yet, which is
// a genuine default for new/low-usage AWS accounts.
async function buildAndPushImageLocally(clients, { accountId, sourceDir, repoName, tag }, onLog) {
  const { ecr, region } = clients;
  const registry = `${accountId}.dkr.ecr.${region}.amazonaws.com`;
  const imageUri = `${registry}/${repoName}:${tag}`;

  onLog('Authenticating Docker with ECR...');
  const auth = await ecr.send(new GetAuthorizationTokenCommand({}));
  const token = auth.authorizationData?.[0]?.authorizationToken;
  if (!token) throw new AwsProviderError('Could not obtain an ECR authorization token.');
  const password = Buffer.from(token, 'base64').toString('utf8').split(':')[1];
  await runCommand('docker', ['login', '--username', 'AWS', '--password-stdin', registry], { input: password }, onLog);

  onLog('Building Docker image locally...');
  await runCommand('docker', ['build', '--provenance=false', '-t', `${repoName}:${tag}`, '.'], { cwd: sourceDir }, onLog);

  onLog('Tagging image for ECR...');
  await runCommand('docker', ['tag', `${repoName}:${tag}`, imageUri], {}, onLog);

  onLog('Pushing image to ECR...');
  await runCommand('docker', ['push', imageUri], {}, onLog);

  onLog('Local build succeeded.');
  return imageUri;
}

// Public entry point: try the cloud-native CodeBuild path first; if this
// AWS account has no CodeBuild concurrent-build quota available (a common
// default for new/low-usage accounts — see AccountLimitExceededException),
// fall back to a local Docker build on this server rather than failing the
// deploy outright.
export async function buildAndPushImage(clients, args, onLog) {
  try {
    return await buildAndPushImageViaCodeBuild(clients, args, onLog);
  } catch (err) {
    if (err.name !== 'AccountLimitExceededException') throw err;
    onLog(
      'CodeBuild has no concurrent-build quota available on this AWS account (0 by default on new/low-usage accounts). Checking for a local Docker fallback...'
    );
    const dockerAvailable = await isLocalDockerAvailable();
    if (!dockerAvailable) {
      throw new AwsProviderError(
        'CodeBuild has no available concurrent-build quota on this AWS account, and no local Docker daemon was found on this server to fall back to. Request a CodeBuild quota increase (AWS Console → Service Quotas → CodeBuild → "Concurrently running builds for Linux/Small environment"), or run Cephei on a host with Docker installed.',
        400
      );
    }
    onLog('Local Docker daemon found — building the image locally instead.');
    return await buildAndPushImageLocally(clients, args, onLog);
  }
}
