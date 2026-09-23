import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { create as createTar } from 'tar';
import { GcpProviderError } from './clients.js';

const BUILD_POLL_INTERVAL_MS = 5000;
const BUILD_TIMEOUT_MS = 15 * 60 * 1000; // matches aws/build.js's CodeBuild timeout
const CLOUD_BUILD_TIMEOUT_SECONDS = BUILD_TIMEOUT_MS / 1000;

// Cloud Build's Build.status comes back from the generated client as a
// string enum name in the common case, but defensively normalize the raw
// numeric value too (google.devtools.cloudbuild.v1.Build.Status) in case a
// particular transport returns the number instead.
const BUILD_STATUS_NAMES = {
  0: 'STATUS_UNKNOWN',
  1: 'QUEUED',
  2: 'WORKING',
  3: 'SUCCESS',
  4: 'FAILURE',
  5: 'INTERNAL_ERROR',
  6: 'TIMEOUT',
  7: 'CANCELLED',
  9: 'EXPIRED',
  10: 'PENDING',
};
function buildStatusName(status) {
  return typeof status === 'number' ? BUILD_STATUS_NAMES[status] || String(status) : status;
}

function artifactImageUri(region, projectId, repoName, imageName, tag) {
  // Artifact Registry, not the deprecated gcr.io Container Registry —
  // <region>-docker.pkg.dev/<project>/<repo>/<image>:<tag>.
  return `${region}-docker.pkg.dev/${projectId}/${repoName}/${imageName}:${tag}`;
}

// Idempotent create-then-reuse Docker-format Artifact Registry repository,
// mirroring aws/build.js's ensureEcrRepo.
export async function ensureArtifactRegistryRepo(artifactRegistry, { projectId, region, repoName }, onLog) {
  const name = `projects/${projectId}/locations/${region}/repositories/${repoName}`;
  try {
    await artifactRegistry.getRepository({ name });
  } catch (err) {
    if (err.code !== 5 /* NOT_FOUND */) throw err;
    onLog(`Creating Artifact Registry repository ${repoName}...`);
    const [operation] = await artifactRegistry.createRepository({
      parent: `projects/${projectId}/locations/${region}`,
      repositoryId: repoName,
      repository: { format: 'DOCKER' },
    });
    await operation.promise();
  }
}

function tarDirectory(sourceDir, destTarPath) {
  // Same shape as `gcloud builds submit`'s own client-side behavior: tar+
  // gzip the source directory and upload it to GCS for Cloud Build's
  // storageSource to read, instead of requiring a git-backed Cloud Source
  // Repository trigger.
  return createTar({ gzip: true, file: destTarPath, cwd: sourceDir }, ['.']);
}

async function ensureBuildSourceBucket(storage, bucketName, region, onLog) {
  const bucket = storage.bucket(bucketName);
  const [exists] = await bucket.exists();
  if (exists) return bucket;
  onLog(`Creating build-source bucket ${bucketName}...`);
  const [created] = await storage.createBucket(bucketName, { location: region });
  return created;
}

// Zips (tars) the given source directory (already containing a Dockerfile
// — either the repo's own, or one dockerfile.js generated), uploads it to
// Cloud Storage, and runs it through Cloud Build, which builds the image
// and pushes it to Artifact Registry entirely inside GCP — no Docker daemon
// required on this server. This is the primary path (mirrors §3's
// cloud-native build services decision on AWS). Cloud Build automatically
// pushes every URI listed in `images` once the build steps succeed, using
// its own service account's credentials — no manual `docker push` step or
// registry credential-helper configuration needed.
async function buildAndPushImageViaCloudBuild(
  clients,
  { projectId, region, sourceDir, repoName, imageName, tag },
  onLog
) {
  const { storage, cloudBuild } = clients;
  const bucketName = `cephei-build-source-${projectId}`;
  const bucket = await ensureBuildSourceBucket(storage, bucketName, region, onLog);

  const tarPath = path.join(sourceDir, '..', `${repoName}-${tag}.tar.gz`);
  onLog('Packaging build source...');
  await tarDirectory(sourceDir, tarPath);

  const objectKey = `builds/${repoName}/${tag}.tar.gz`;
  onLog(`Uploading build source to gs://${bucketName}/${objectKey}...`);
  await bucket.upload(tarPath, { destination: objectKey });
  await fs.promises.rm(tarPath, { force: true });

  const image = artifactImageUri(region, projectId, repoName, imageName, tag);

  onLog('Starting container build (Cloud Build)...');
  const [operation] = await cloudBuild.createBuild({
    projectId,
    build: {
      source: { storageSource: { bucket: bucketName, object: objectKey } },
      steps: [{ name: 'gcr.io/cloud-builders/docker', args: ['build', '--tag', image, '.'] }],
      images: [image],
      timeout: { seconds: CLOUD_BUILD_TIMEOUT_SECONDS },
    },
  });

  // createBuild's LRO metadata decodes to BuildOperationMetadata, which
  // carries the freshly-created Build (including its id) immediately —
  // used here to poll getBuild for phase-by-phase progress the same way
  // aws/build.js polls CodeBuild's BatchGetBuilds, instead of just blocking
  // silently on operation.promise() until the build reaches a terminal
  // state.
  const buildId = operation.metadata?.build?.id;
  const startedAt = Date.now();

  if (buildId) {
    let lastStatus = null;
    while (true) {
      if (Date.now() - startedAt > BUILD_TIMEOUT_MS) {
        throw new GcpProviderError(`Cloud Build build ${buildId} timed out after ${BUILD_TIMEOUT_MS / 1000}s`);
      }
      await new Promise((r) => setTimeout(r, BUILD_POLL_INTERVAL_MS));

      const [current] = await cloudBuild.getBuild({ projectId, id: buildId });
      const status = buildStatusName(current.status);

      if (status !== lastStatus) {
        onLog(`Build status: ${status}`);
        lastStatus = status;
      }

      if (status === 'QUEUED' || status === 'PENDING' || status === 'WORKING') continue;

      if (status !== 'SUCCESS') {
        throw new GcpProviderError(
          `Cloud Build build ${buildId} ended with status ${status}${
            current.statusDetail ? `: ${current.statusDetail}` : ''
          }. Check the Cloud Build console for full logs${current.logUrl ? ` (${current.logUrl})` : ''}.`
        );
      }
      onLog('Build succeeded.');
      break;
    }
  } else {
    // Defensive fallback in case the LRO metadata wasn't populated with a
    // build id at creation time — still correct (createBuild's LRO
    // ultimately resolves to the finished Build either way), just without
    // incremental phase logs.
    onLog('Waiting for Cloud Build to finish...');
    const [build] = await operation.promise();
    const status = buildStatusName(build.status);
    if (status !== 'SUCCESS') {
      throw new GcpProviderError(`Cloud Build build ended with status ${status}.`);
    }
    onLog('Build succeeded.');
  }

  return image;
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
      else reject(new GcpProviderError(`${command} ${args.join(' ')} failed (exit ${code}): ${stderrTail.slice(-500)}`));
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

function isQuotaOrPermissionIssue(err) {
  const code = err?.code;
  const message = String(err?.message || '');
  return (
    code === 7 /* PERMISSION_DENIED — covers both "API not enabled" and IAM permission gaps */ ||
    code === 8 /* RESOURCE_EXHAUSTED — concurrent-build / build-minute quota */ ||
    /quota|permission denied|has not been used|service_disabled|is disabled/i.test(message)
  );
}

// Fallback path used only when Cloud Build is unavailable on this GCP
// project (API not enabled, or a quota/permission gap — see
// buildAndPushImage below) — builds the same Dockerfile with a local Docker
// daemon on this server and pushes straight to Artifact Registry, using a
// short-lived OAuth2 access token from the same resolved auth identity
// (ADC or impersonated) as the Docker login password, per Artifact
// Registry's documented token-based Docker auth (`docker login -u
// oauth2accesstoken --password-stdin https://<region>-docker.pkg.dev`).
// Not the primary strategy (cloud-native builds so Cephei itself doesn't
// need Docker installed), but a real, working alternative for accounts
// that haven't enabled/sized Cloud Build yet — the exact same lesson
// already learned on this project's real AWS account (CodeBuild's
// concurrent-build quota being 0 by default).
async function buildAndPushImageLocally(clients, { projectId, region, sourceDir, repoName, imageName, tag }, onLog) {
  const { authClient } = clients;
  const registryHost = `${region}-docker.pkg.dev`;
  const image = artifactImageUri(region, projectId, repoName, imageName, tag);

  onLog('Authenticating Docker with Artifact Registry...');
  const { token } = await authClient.getAccessToken();
  if (!token) throw new GcpProviderError('Could not obtain a GCP OAuth2 access token for Docker login.');
  await runCommand(
    'docker',
    ['login', '-u', 'oauth2accesstoken', '--password-stdin', `https://${registryHost}`],
    { input: token },
    onLog
  );

  onLog('Building Docker image locally...');
  await runCommand('docker', ['build', '-t', `${repoName}:${tag}`, '.'], { cwd: sourceDir }, onLog);

  onLog('Tagging image for Artifact Registry...');
  await runCommand('docker', ['tag', `${repoName}:${tag}`, image], {}, onLog);

  onLog('Pushing image to Artifact Registry...');
  await runCommand('docker', ['push', image], {}, onLog);

  onLog('Local build succeeded.');
  return image;
}

// Public entry point: try the cloud-native Cloud Build path first; if
// Cloud Build itself is unavailable on this GCP project (its API isn't
// enabled, or the deploying identity lacks quota/permission to start a
// build — a common state for new/low-usage projects), fall back to a
// local Docker build on this server rather than failing the deploy
// outright. Mirrors aws/build.js's buildAndPushImage exactly.
export async function buildAndPushImage(clients, args, onLog) {
  try {
    return await buildAndPushImageViaCloudBuild(clients, args, onLog);
  } catch (err) {
    if (!isQuotaOrPermissionIssue(err)) throw err;
    onLog(`Cloud Build is unavailable for this project (${err.message}). Checking for a local Docker fallback...`);
    const dockerAvailable = await isLocalDockerAvailable();
    if (!dockerAvailable) {
      throw new GcpProviderError(
        'Cloud Build is unavailable on this GCP project (API not enabled, or a quota/permission gap), and no local Docker daemon was found on this server to fall back to. Enable the Cloud Build API and grant the deploying identity the Cloud Build Editor role, or run Cephei on a host with Docker installed.',
        400
      );
    }
    onLog('Local Docker daemon found — building the image locally instead.');
    return await buildAndPushImageLocally(clients, args, onLog);
  }
}
