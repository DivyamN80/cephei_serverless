// metricsService.js
//
// getDashboard(project) powers GET /api/projects/:id/dashboard and the
// cross-project /overview aggregate.
//
// §7: `cost` and `metrics` are real, read from the deployed function's own
// cloud provider (CloudWatch for AWS, Cloud Monitoring for GCP, Azure
// Monitor for Azure — see each provider's getMetrics()) rather than
// deterministically-seeded fake numbers. A project with no deploy yet, or
// whose provider call fails (not implemented, account disconnected,
// function since deleted, throttled, etc.), gets an honest all-zero shape
// with a `note` explaining why — never fabricated activity.
//
// `recentDeploys` and `rollback` are real Mongo queries against DeployLog.

import DeployLog from '../models/DeployLog.js';
import { recommend } from './recommendationService.js';
import { getProvider } from '../providers/index.js';

const EMPTY_METRICS = {
  invocations: 0,
  errors: 0,
  p50Ms: 0,
  p95Ms: 0,
  p99Ms: 0,
  coldStarts: 0,
  windowStart: null,
  windowEnd: null,
  series: [],
};

function emptyCost(note) {
  return { projectedMonthlyUsd: 0, actualLast30dUsd: 0, costAllocationTagsEnabled: false, note };
}

async function loadMetrics(project) {
  if (!project.deployResult?.functionName && !project.deployResult?.invokeUrl) {
    return { cost: emptyCost('Not deployed yet.'), metrics: EMPTY_METRICS };
  }

  const providerKey = project.deployResult?.provider || project.customerAwsAccount?.provider || 'aws';
  try {
    const provider = getProvider(providerKey);
    return await provider.getMetrics(project, project.customerAwsAccount, { days: 14 });
  } catch (err) {
    return {
      cost: emptyCost(`Metrics unavailable: ${err.message}`),
      metrics: EMPTY_METRICS,
    };
  }
}

export async function getDashboard(project) {
  const { cost, metrics } = await loadMetrics(project);

  const recentDeployDocs = await DeployLog.find({ project: project._id })
    .sort({ startedAt: -1 })
    .limit(10)
    .lean();

  const recentDeploys = recentDeployDocs.map((d) => ({
    id: d._id,
    kind: d.kind,
    status: d.status,
    startedAt: d.startedAt,
    finishedAt: d.finishedAt,
    lambdaVersion: d.lambdaVersion,
    error: d.error,
  }));

  const successfulBackendDeploys = await DeployLog.find({
    project: project._id,
    kind: { $in: ['backend', 'rollback'] },
    status: 'success',
    lambdaVersion: { $ne: null },
  })
    .sort({ startedAt: -1 })
    .lean();

  const previousVersions = [
    ...new Set(successfulBackendDeploys.map((d) => d.lambdaVersion).filter(Boolean)),
  ];

  const currentVersion = project.deployResult?.lambdaLiveVersion || null;
  const rollback = {
    currentVersion,
    previousVersions: previousVersions.filter((v) => v !== currentVersion),
    canRollback: previousVersions.filter((v) => v !== currentVersion).length > 0,
  };

  const recommendation = recommend(project, metrics);

  return { cost, metrics, recentDeploys, rollback, recommendation };
}
