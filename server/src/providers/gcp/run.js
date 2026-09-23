// Cloud Run equivalent of aws/lambda.js + aws/apiGateway.js combined: Cloud
// Run's own Admin API v2 is both the compute (function-equivalent) and the
// HTTPS-endpoint layer in one — there is no separate API Gateway resource
// to wire up, because Cloud Run natively terminates HTTPS and proxies
// straight to the container's configured port.
const CONTAINER_PORT = 8080;
const RUN_INVOKER_ROLE = 'roles/run.invoker';

function serviceResourceName(projectId, region, serviceId) {
  return `projects/${projectId}/locations/${region}/services/${serviceId}`;
}

function buildServiceSpec({ imageUri, envRefs, runtimeServiceAccount }) {
  return {
    template: {
      containers: [
        {
          image: imageUri,
          ports: [{ containerPort: CONTAINER_PORT }],
          env: envRefs || [],
          // 1 vCPU / 512MiB, allocated only while handling a request
          // (cpuIdle: true — request-based billing, the cheaper Tier 1
          // default this project's cost estimate in metrics.js assumes).
          resources: { limits: { cpu: '1', memory: '512Mi' }, cpuIdle: true },
        },
      ],
      scaling: { minInstanceCount: 0, maxInstanceCount: 10 },
      ...(runtimeServiceAccount ? { serviceAccount: runtimeServiceAccount } : {}),
    },
    // Every deploy sends 100% of traffic to whatever revision this update
    // just created — the same "the newest thing is live" default AWS's
    // `live` alias repoint gives, and what makes a later rollback() call
    // meaningful (it repoints traffic back to a *specific* older revision
    // instead of "latest").
    traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }],
  };
}

// Idempotent create-then-update Cloud Run service. On create, Cloud Run
// mints a new revision (named `<service>-00001-xxx`) and the create
// operation's LRO resolves once that revision is ready and serving 100% of
// traffic. On update, a full template+traffic replace triggers a brand new
// revision (Cloud Run revisions are immutable — a "redeploy" is always a
// new revision, never a mutation of an old one), which is exactly what
// makes rollback() below meaningful: the previous revision is still sitting
// there, unmodified, to repoint traffic back to.
export async function ensureCloudRunService(
  clients,
  { serviceId, region, projectId, imageUri, envRefs, runtimeServiceAccount },
  onLog
) {
  const { run } = clients;
  const name = serviceResourceName(projectId, region, serviceId);
  const parent = `projects/${projectId}/locations/${region}`;

  let exists = true;
  try {
    await run.getService({ name });
  } catch (err) {
    if (err.code !== 5 /* NOT_FOUND */) throw err;
    exists = false;
  }

  const spec = buildServiceSpec({ imageUri, envRefs, runtimeServiceAccount });
  let service;

  if (!exists) {
    onLog(`Creating Cloud Run service ${serviceId}...`);
    const [operation] = await run.createService({ parent, serviceId, service: spec });
    [service] = await operation.promise();
  } else {
    onLog(`Updating Cloud Run service ${serviceId}...`);
    const [operation] = await run.updateService({
      service: { ...spec, name },
      updateMask: { paths: ['template', 'traffic'] },
    });
    [service] = await operation.promise();
  }

  onLog(`Cloud Run service ready at revision ${service.latestReadyRevision}.`);
  return { service, revision: service.latestReadyRevision };
}

// Real revision-based rollback via Cloud Run's native traffic splitting —
// repoints 100% of traffic to a specific prior revision by name via a
// scoped `traffic`-only update (updateMask so the container template is
// left completely untouched). This is what makes GCP rollback mean
// something real, the same way AWS's `live` Lambda alias repoint does:
// Cloud Run never deletes old revisions on its own, so the target revision
// is still there to receive traffic again.
export async function rollbackTraffic(clients, { projectId, region, serviceId, toRevision }, onLog) {
  const { run } = clients;
  const name = serviceResourceName(projectId, region, serviceId);
  onLog(`Rolling back Cloud Run traffic to revision ${toRevision}...`);
  const [operation] = await run.updateService({
    service: {
      name,
      traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: toRevision, percent: 100 }],
    },
    updateMask: { paths: ['traffic'] },
  });
  await operation.promise();
  onLog(`Traffic now 100% on revision ${toRevision}.`);
}

// Makes the service curl-able with no auth in front, matching how AWS API
// Gateway's $default stage has no authorizer attached — grants
// roles/run.invoker to allUsers via a real IAM policy binding. Read-modify
// -write so any other bindings already on the service (there normally
// aren't any on a Cephei-managed service, but this is the safe way to set
// an IAM policy regardless) are preserved rather than clobbered.
export async function setPublicInvokeAccess(clients, resourceName, onLog) {
  const { run } = clients;
  const [policy] = await run.getIamPolicy({ resource: resourceName });
  const bindings = policy.bindings || [];
  let binding = bindings.find((b) => b.role === RUN_INVOKER_ROLE);
  if (!binding) {
    binding = { role: RUN_INVOKER_ROLE, members: [] };
    bindings.push(binding);
  }
  if (!binding.members.includes('allUsers')) {
    binding.members.push('allUsers');
    onLog('Granting public (unauthenticated) invoke access...');
    await run.setIamPolicy({ resource: resourceName, policy: { ...policy, bindings } });
  }
}

export const CLOUD_RUN_CONTAINER_PORT = CONTAINER_PORT;
