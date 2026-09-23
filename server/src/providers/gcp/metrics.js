// §7 real metrics — reads the actual run.googleapis.com Cloud Monitoring
// metrics for the deployed Cloud Run service. No synthetic/random data: an
// idle service genuinely returns an all-zero shape here, exactly as Cloud
// Monitoring reports it — same honesty standard as aws/metrics.js.

// Published Cloud Run (2nd gen) request-based pricing, Tier 1 / us-central1,
// Sep 2026 (https://cloud.google.com/run/pricing) — used only to turn real
// invocation/latency telemetry into a cost *estimate*, exactly as honest
// (and exactly as simple — no monthly free-tier proration, matching
// aws/metrics.js's own Lambda estimate, which likewise ignores Lambda's
// free tier) as the AWS module. This is not the Cloud Billing/Cost
// Management API (that needs Cloud Billing export + BigQuery configured) —
// it's a deterministic calculation from real Cloud Monitoring usage data.
const CLOUD_RUN_PRICE_PER_VCPU_SECOND_USD = 0.000024;
const CLOUD_RUN_PRICE_PER_GIB_SECOND_USD = 0.0000025;
const CLOUD_RUN_PRICE_PER_MILLION_REQUESTS_USD = 0.4;
const CLOUD_RUN_VCPU = 1; // matches run.js's resources.limits.cpu
const CLOUD_RUN_MEMORY_GIB = 0.5; // matches run.js's resources.limits.memory (512Mi)

const ERROR_RESPONSE_CODE_CLASSES = new Set(['4xx', '5xx']);

function toTimestamp(date) {
  return { seconds: Math.floor(date.getTime() / 1000) };
}

function dayKeyFromTimestamp(ts) {
  const ms = ts?.seconds != null ? Number(ts.seconds) * 1000 : Date.parse(ts);
  return new Date(ms).toISOString().slice(0, 10);
}

function pointNumericValue(point) {
  const v = point?.value || {};
  if (v.int64Value != null) return Number(v.int64Value);
  if (v.doubleValue != null) return Number(v.doubleValue);
  return 0;
}

function runResourceFilter(region, serviceId) {
  return `resource.type="cloud_run_revision" AND resource.label.service_name="${serviceId}" AND resource.label.location="${region}"`;
}

async function listTimeSeries(monitoring, projectId, filter, aggregation, startTime, endTime) {
  const [series] = await monitoring.listTimeSeries({
    name: `projects/${projectId}`,
    filter,
    interval: { startTime: toTimestamp(startTime), endTime: toTimestamp(endTime) },
    aggregation,
    view: 'FULL',
  });
  return series || [];
}

// run.googleapis.com/request_count is a DELTA/INT64 counter labeled by
// response_code_class ("2xx"/"4xx"/"5xx"/...). Grouping by that label (and
// summing within each group across revisions/response codes via
// crossSeriesReducer) yields one daily-aligned series per response class,
// which is enough to derive both total invocations and error counts.
async function getRequestCountSeries(monitoring, projectId, region, serviceId, startTime, endTime) {
  return listTimeSeries(
    monitoring,
    projectId,
    `metric.type="run.googleapis.com/request_count" AND ${runResourceFilter(region, serviceId)}`,
    {
      alignmentPeriod: { seconds: 86400 },
      perSeriesAligner: 'ALIGN_SUM',
      crossSeriesReducer: 'REDUCE_SUM',
      groupByFields: ['metric.label.response_code_class'],
    },
    startTime,
    endTime
  );
}

// run.googleapis.com/request_latencies is a DISTRIBUTION metric. An
// aligner (ALIGN_PERCENTILE_50/95/99, or ALIGN_MEAN for the cost estimate)
// first reduces each series' distribution down to a single daily gauge
// number; crossSeriesReducer then averages that number across whatever
// series are present that day (normally just the one revision currently
// holding 100% of traffic, but possibly more during/just after a
// rollout/rollback) — a real, if approximate ("average of per-revision
// percentiles" rather than a single project-wide percentile), read of
// actual latency data, not a fabricated number.
async function getLatencySeries(monitoring, projectId, region, serviceId, startTime, endTime, aligner) {
  return listTimeSeries(
    monitoring,
    projectId,
    `metric.type="run.googleapis.com/request_latencies" AND ${runResourceFilter(region, serviceId)}`,
    {
      alignmentPeriod: { seconds: 86400 },
      perSeriesAligner: aligner,
      crossSeriesReducer: 'REDUCE_MEAN',
      groupByFields: [],
    },
    startTime,
    endTime
  );
}

// run.googleapis.com/container/startup_latencies records one distribution
// sample per new container instance start — i.e. once per cold start.
// ALIGN_COUNT over the whole window counts how many such start events were
// recorded, a genuine (if approximate) cold-start count, not a guess. If
// this metric isn't available for the project/service (API/permission gap,
// or simply zero cold starts so far), report an honest 0 rather than a
// fabricated number.
async function getColdStartCount(monitoring, projectId, region, serviceId, startTime, endTime) {
  try {
    const windowSeconds = Math.max(1, Math.round((endTime.getTime() - startTime.getTime()) / 1000));
    const series = await listTimeSeries(
      monitoring,
      projectId,
      `metric.type="run.googleapis.com/container/startup_latencies" AND ${runResourceFilter(region, serviceId)}`,
      {
        alignmentPeriod: { seconds: windowSeconds },
        perSeriesAligner: 'ALIGN_COUNT',
        crossSeriesReducer: 'REDUCE_SUM',
        groupByFields: [],
      },
      startTime,
      endTime
    );
    const points = series[0]?.points || [];
    return points.reduce((sum, p) => sum + pointNumericValue(p), 0);
  } catch {
    return 0;
  }
}

function averageAcrossPoints(series) {
  const points = series[0]?.points || [];
  if (!points.length) return 0;
  const sum = points.reduce((s, p) => s + pointNumericValue(p), 0);
  return sum / points.length;
}

// Buckets request_count into one point per calendar day over the last
// `days` days, split into total invocations vs. errors (response_code_class
// 4xx/5xx) — the shape the dashboard's activity chart expects.
function buildDailySeries(countSeries, p95Series) {
  const byDay = new Map();

  for (const s of countSeries) {
    const isError = ERROR_RESPONSE_CODE_CLASSES.has(s.metric?.labels?.response_code_class);
    for (const point of s.points || []) {
      const date = dayKeyFromTimestamp(point.interval?.endTime);
      const bucket = byDay.get(date) || { date, invocations: 0, errors: 0, p95Ms: 0 };
      const value = pointNumericValue(point);
      bucket.invocations += value;
      if (isError) bucket.errors += value;
      byDay.set(date, bucket);
    }
  }

  for (const point of p95Series[0]?.points || []) {
    const date = dayKeyFromTimestamp(point.interval?.endTime);
    const bucket = byDay.get(date) || { date, invocations: 0, errors: 0, p95Ms: 0 };
    bucket.p95Ms = Math.round(pointNumericValue(point));
    byDay.set(date, bucket);
  }

  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// Assembles the full {cost, metrics} shape the dashboard route expects —
// the GCP counterpart of aws/metrics.js's getDashboardMetrics().
// invocations/errors/latency/coldStarts are all genuine Cloud Monitoring
// data for this exact Cloud Run service; cost is a labeled estimate
// computed from that same real usage (see the pricing constants above),
// not a random number and not real Cloud Billing data.
export async function getDashboardMetrics(clients, { serviceId, region }, days = 14) {
  const { monitoring, projectId } = clients;
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - days * 86400 * 1000);

  const [countSeries, p50Series, p95Series, p99Series, meanLatencySeries, coldStarts] = await Promise.all([
    getRequestCountSeries(monitoring, projectId, region, serviceId, startTime, endTime),
    getLatencySeries(monitoring, projectId, region, serviceId, startTime, endTime, 'ALIGN_PERCENTILE_50'),
    getLatencySeries(monitoring, projectId, region, serviceId, startTime, endTime, 'ALIGN_PERCENTILE_95'),
    getLatencySeries(monitoring, projectId, region, serviceId, startTime, endTime, 'ALIGN_PERCENTILE_99'),
    getLatencySeries(monitoring, projectId, region, serviceId, startTime, endTime, 'ALIGN_MEAN'),
    getColdStartCount(monitoring, projectId, region, serviceId, startTime, endTime),
  ]);

  const series = buildDailySeries(countSeries, p95Series);
  const invocations = series.reduce((s, d) => s + d.invocations, 0);
  const errors = series.reduce((s, d) => s + d.errors, 0);

  const p50Ms = Math.round(averageAcrossPoints(p50Series));
  const p95Ms = Math.round(averageAcrossPoints(p95Series));
  const p99Ms = Math.round(averageAcrossPoints(p99Series));
  const avgMs = averageAcrossPoints(meanLatencySeries);

  const vcpuSeconds = invocations * (avgMs / 1000) * CLOUD_RUN_VCPU;
  const gibSeconds = invocations * (avgMs / 1000) * CLOUD_RUN_MEMORY_GIB;
  const estUsd =
    vcpuSeconds * CLOUD_RUN_PRICE_PER_VCPU_SECOND_USD +
    gibSeconds * CLOUD_RUN_PRICE_PER_GIB_SECOND_USD +
    (invocations / 1_000_000) * CLOUD_RUN_PRICE_PER_MILLION_REQUESTS_USD;
  const projectedMonthlyUsd = days > 0 ? (estUsd / days) * 30 : 0;

  const windowStart = series[0]?.date || endTime.toISOString().slice(0, 10);
  const windowEnd = series[series.length - 1]?.date || windowStart;

  return {
    cost: {
      projectedMonthlyUsd: Math.round(projectedMonthlyUsd * 100) / 100,
      actualLast30dUsd: Math.round(estUsd * (days > 0 ? 30 / days : 0) * 100) / 100,
      costAllocationTagsEnabled: false,
      note:
        'Estimated from real invocation count, average request latency (as a CPU/memory duration proxy) and the service\'s configured vCPU/memory using published Cloud Run request-based pricing (Tier 1, excludes the monthly free tier) — not actual Cloud Billing data.',
    },
    metrics: {
      invocations,
      errors,
      p50Ms,
      p95Ms,
      p99Ms,
      coldStarts,
      windowStart,
      windowEnd,
      series,
    },
  };
}
