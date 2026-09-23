import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { c as tarCreate } from 'tar';
import { AzureProviderError } from './clients.js';

const ACR_SKU = 'Basic';
const ACR_TASKS_API_VERSION = '2019-06-01-preview';
const ARM_BASE = 'https://management.azure.com';
const BUILD_POLL_INTERVAL_MS = 5000;
const BUILD_TIMEOUT_MS = 15 * 60 * 1000;

// Idempotent create-then-reuse Azure Container Registry. Unlike ECR/
// Artifact Registry, ACR repositories are implicit — created on first
// push, no separate "create repository" call — so only the registry
// itself needs to be ensured. adminUserEnabled is turned on so the local-
// Docker fallback below always has a real, documented way to authenticate
// (see container-registry-authentication docs, "Admin account") even if
// ACR Tasks is unavailable on this subscription.
export async function ensureAcrRegistry(clients, { registryName }, onLog) {
  const { acr, resourceGroup, location } = clients;
  try {
    const existing = await acr.registries.get(resourceGroup, registryName);
    if (!existing.adminUserEnabled) {
      onLog(`Enabling admin credentials on ACR registry ${registryName}...`);
      await acr.registries
        .update(resourceGroup, registryName, { properties: { adminUserEnabled: true } })
        .catch(() => {});
    }
    return existing;
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }
  onLog(`Creating Azure Container Registry ${registryName}...`);
  const poller = await acr.registries.create(resourceGroup, registryName, {
    location,
    sku: { name: ACR_SKU },
    adminUserEnabled: true,
  });
  return poller.pollUntilDone();
}

async function getAcrAdminCredentials(clients, registryName) {
  const { acr, resourceGroup } = clients;
  const result = await acr.registries.listCredentials(resourceGroup, registryName);
  const password = result.passwords?.[0]?.value;
  if (!result.username || !password) {
    throw new AzureProviderError(
      `ACR registry ${registryName} has no admin credentials available (adminUserEnabled must be true).`
    );
  }
  return { username: result.username, password };
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
      else reject(new AzureProviderError(`${command} ${args.join(' ')} failed (exit ${code}): ${stderrTail.slice(-500)}`));
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

async function armFetch(clients, urlPath, { method = 'GET', body, extraHeaders } = {}) {
  const token = await clients.credential.getToken('https://management.azure.com/.default');
  const res = await fetch(`${ARM_BASE}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

// Polls a standard ARM async-operation URL (the Azure-AsyncOperation /
// Location header returned from a 202) until it reaches a terminal
// status. This is the generic, well-documented ARM long-running-operation
// convention — used here because ACR "quick run" (Tasks) scheduling
// (Registries_GetBuildSourceUploadUrl / Registries_ScheduleRun,
// api-version 2019-06-01-preview) is NOT exposed by the current
// @azure/arm-containerregistry JS package (verified by inspecting the
// installed v12.0.0 package: its ContainerRegistryManagementClient has
// no `tasks`/`runs` operation group at all, even though the equivalent
// operations are still live in the current stable .NET SDK —
// ContainerRegistryResource.ScheduleRunAsync/GetBuildSourceUploadUrlAsync
// in Azure.ResourceManager.ContainerRegistry — and are what `az acr
// build` uses under the hood for a local source context). We therefore
// call the real REST operations directly.
async function pollArmOperation(clients, operationUrl, onLog) {
  const startedAt = Date.now();
  while (true) {
    if (Date.now() - startedAt > BUILD_TIMEOUT_MS) {
      throw new AzureProviderError(`ACR Tasks run timed out after ${BUILD_TIMEOUT_MS / 1000}s`);
    }
    const token = await clients.credential.getToken('https://management.azure.com/.default');
    const res = await fetch(operationUrl, { headers: { Authorization: `Bearer ${token.token}` } });
    if (!res.ok) {
      throw new AzureProviderError(`ACR Tasks run status check failed: HTTP ${res.status}`);
    }
    const body = await res.json();
    const status = body.status || body.properties?.status;
    if (status === 'Succeeded') return body;
    if (status === 'Failed' || status === 'Canceled') {
      throw new AzureProviderError(`ACR Tasks run ended with status ${status}: ${JSON.stringify(body).slice(0, 500)}`);
    }
    onLog(`ACR Tasks run status: ${status || 'Running'}...`);
    await new Promise((r) => setTimeout(r, BUILD_POLL_INTERVAL_MS));
  }
}

// Primary build path: ACR Tasks "quick run" — builds the Dockerfile
// inside Azure from an uploaded local source archive and pushes straight
// to ACR, entirely cloud-side (no Docker daemon needed on this server),
// mirroring the role aws/build.js's CodeBuild path plays for AWS.
//
// CONFIDENCE NOTE: the exact REST schema below (DockerBuildRequest,
// SourceUploadDefinition) is reconstructed from the real, current field
// names surfaced by Microsoft's own current Go and .NET SDKs (which still
// implement this api-version), not from a live, directly-fetchable REST
// reference page (that page currently 404s on Microsoft Learn). Treat
// this path as best-effort: any failure — schema mismatch, throttling,
// the feature being unavailable on this subscription — falls through to
// the local Docker path below, which is verified against current,
// fetchable documentation and mirrors the AWS fallback already proven to
// work on this exact dev account.
async function buildAndPushImageViaAcrTasks(clients, { sourceDir, registryName, repoName, tag }, onLog) {
  const { resourceGroup, subscriptionId } = clients;
  const base = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.ContainerRegistry/registries/${registryName}`;

  onLog('Requesting an ACR Tasks source-upload URL...');
  const uploadUrlRes = await armFetch(clients, `${base}/getBuildSourceUploadUrl?api-version=${ACR_TASKS_API_VERSION}`, {
    method: 'POST',
  });
  if (!uploadUrlRes.ok) {
    throw new AzureProviderError(`getBuildSourceUploadUrl failed: HTTP ${uploadUrlRes.status}`);
  }
  const { relativePath, uploadUrl } = await uploadUrlRes.json();
  if (!relativePath || !uploadUrl) {
    throw new AzureProviderError('getBuildSourceUploadUrl returned no relativePath/uploadUrl.');
  }

  onLog('Packaging and uploading build source to ACR Tasks...');
  const archivePath = path.join(sourceDir, '..', `${repoName}-${tag}.tar.gz`);
  await tarCreate({ gzip: true, file: archivePath, cwd: sourceDir }, ['.']);
  const archiveBuffer = await fs.promises.readFile(archivePath);
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Length': String(archiveBuffer.length) },
    body: archiveBuffer,
  });
  await fs.promises.rm(archivePath, { force: true });
  if (!putRes.ok) {
    throw new AzureProviderError(`Uploading build source to ACR Tasks failed: HTTP ${putRes.status}`);
  }

  onLog('Scheduling ACR Tasks quick build...');
  const imageName = `${repoName}:${tag}`;
  const scheduleRes = await armFetch(clients, `${base}/scheduleRun?api-version=${ACR_TASKS_API_VERSION}`, {
    method: 'POST',
    body: {
      type: 'DockerBuildRequest',
      dockerFilePath: 'Dockerfile',
      imageNames: [imageName],
      isPushEnabled: true,
      noCache: false,
      isArchiveEnabled: true,
      platform: { os: 'Linux' },
      sourceLocation: relativePath,
    },
  });
  if (!scheduleRes.ok) {
    throw new AzureProviderError(`scheduleRun failed: HTTP ${scheduleRes.status}: ${(await scheduleRes.text()).slice(0, 500)}`);
  }

  const operationUrl =
    scheduleRes.headers.get('azure-asyncoperation') || scheduleRes.headers.get('location');
  if (operationUrl) {
    await pollArmOperation(clients, operationUrl, onLog);
  } else {
    // Some responses return the terminal Run resource synchronously.
    const body = await scheduleRes.json().catch(() => ({}));
    if (body.status && body.status !== 'Succeeded') {
      throw new AzureProviderError(`ACR Tasks run ended with status ${body.status}`);
    }
  }

  onLog('ACR Tasks build succeeded.');
  const registry = await clients.acr.registries.get(resourceGroup, registryName);
  return `${registry.loginServer}/${imageName}`;
}

// Fallback path — builds the same Dockerfile with a local Docker daemon
// on this server and pushes to ACR using the registry's admin
// credentials (verified: learn.microsoft.com/azure/container-registry/
// container-registry-authentication, "Admin account" — one of the two
// currently documented ways to `docker login` against ACR, the other
// being an AAD-token exchange which needs a separate, undocumented-in-
// the-JS-SDK OAuth dance; admin credentials are the simpler, equally
// real, fully doc-verified choice for this server-side fallback). Not
// speculative — this mirrors the exact structure of aws/build.js's
// proven local-Docker fallback, needed on this exact dev account because
// CodeBuild's own concurrent-build quota was 0 by default.
async function buildAndPushImageLocally(clients, { sourceDir, registryName, repoName, tag }, onLog) {
  const registry = await clients.acr.registries.get(clients.resourceGroup, registryName);
  const loginServer = registry.loginServer;
  const imageUri = `${loginServer}/${repoName}:${tag}`;

  onLog('Fetching ACR admin credentials...');
  const { username, password } = await getAcrAdminCredentials(clients, registryName);

  onLog('Authenticating Docker with ACR...');
  await runCommand('docker', ['login', loginServer, '--username', username, '--password-stdin'], { input: password }, onLog);

  onLog('Building Docker image locally...');
  await runCommand('docker', ['build', '-t', `${repoName}:${tag}`, '.'], { cwd: sourceDir }, onLog);

  onLog('Tagging image for ACR...');
  await runCommand('docker', ['tag', `${repoName}:${tag}`, imageUri], {}, onLog);

  onLog('Pushing image to ACR...');
  await runCommand('docker', ['push', imageUri], {}, onLog);

  onLog('Local build succeeded.');
  return imageUri;
}

// Public entry point: try ACR Tasks first; on ANY failure (quota,
// permission, the feature not being enabled on this subscription, or —
// honestly — this module's best-effort REST schema not matching exactly,
// see the confidence note above) fall back to a local Docker build,
// exactly the same resilience pattern aws/build.js's buildAndPushImage
// already uses for CodeBuild → local Docker.
export async function buildAndPushImage(clients, args, onLog) {
  try {
    return await buildAndPushImageViaAcrTasks(clients, args, onLog);
  } catch (err) {
    onLog(`ACR Tasks build was not available or failed (${err.message}). Checking for a local Docker fallback...`);
    const dockerAvailable = await isLocalDockerAvailable();
    if (!dockerAvailable) {
      throw new AzureProviderError(
        'ACR Tasks could not build this image, and no local Docker daemon was found on this server to fall back to. Ensure Microsoft.ContainerRegistry is registered on this subscription and ACR Tasks is available, or run Cephei on a host with Docker installed.',
        400
      );
    }
    onLog('Local Docker daemon found — building the image locally instead.');
    return await buildAndPushImageLocally(clients, args, onLog);
  }
}
