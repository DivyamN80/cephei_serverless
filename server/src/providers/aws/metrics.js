import { GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { StartQueryCommand, GetQueryResultsCommand } from '@aws-sdk/client-cloudwatch-logs';

// Published on-demand Lambda pricing (us-east-1, Sep 2026) — used only to
// turn real invocation/duration telemetry into a cost *estimate*. This is
// not the AWS Cost Explorer API (that needs Cost Explorer enabled on the
// account, ~24h billing latency, and per-resource cost allocation tags to
// isolate a single function) — it's a deterministic calculation from real
// usage, clearly labeled as an estimate rather than actual billed cost.
const LAMBDA_PRICE_PER_REQUEST_USD = 0.0000002;
const LAMBDA_PRICE_PER_GB_SECOND_USD = 0.0000166667;
const LAMBDA_MEMORY_MB = 512;

// §7 real metrics — reads the actual AWS/Lambda CloudWatch namespace for
// the deployed function. No synthetic/random data: an idle function
// genuinely returns all-zero series here, exactly as CloudWatch reports it.
const METRICS = [
  { id: 'invocations', name: 'Invocations', stat: 'Sum' },
  { id: 'errors', name: 'Errors', stat: 'Sum' },
  { id: 'throttles', name: 'Throttles', stat: 'Sum' },
  { id: 'duration', name: 'Duration', stat: 'Average' },
  // CloudWatch's GetMetricData accepts percentile strings directly as a
  // Stat value (unlike the older GetMetricStatistics API, which needed a
  // separate ExtendedStatistics field) — these are real p50/p95/p99s, not
  // derived/estimated from the average.
  { id: 'durationP50', name: 'Duration', stat: 'p50' },
  { id: 'durationP95', name: 'Duration', stat: 'p95' },
  { id: 'durationP99', name: 'Duration', stat: 'p99' },
];

function sum(points) {
  return (points || []).reduce((acc, p) => acc + p.value, 0);
}

function avg(points) {
  return points && points.length ? sum(points) / points.length : 0;
}

export async function getFunctionMetrics(cloudwatch, functionName, { windowHours = 24, periodSeconds = 3600 } = {}) {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - windowHours * 3600 * 1000);

  const { MetricDataResults } = await cloudwatch.send(
    new GetMetricDataCommand({
      StartTime: startTime,
      EndTime: endTime,
      ScanBy: 'TimestampAscending',
      MetricDataQueries: METRICS.map((m) => ({
        Id: m.id,
        MetricStat: {
          Metric: {
            Namespace: 'AWS/Lambda',
            MetricName: m.name,
            Dimensions: [{ Name: 'FunctionName', Value: functionName }],
          },
          Period: periodSeconds,
          Stat: m.stat,
        },
        ReturnData: true,
      })),
    })
  );

  const series = {};
  for (const result of MetricDataResults || []) {
    series[result.Id] = (result.Timestamps || []).map((ts, i) => ({
      timestamp: ts,
      value: result.Values[i],
    }));
  }

  const invocations = sum(series.invocations);
  const errors = sum(series.errors);

  return {
    provider: 'aws',
    functionName,
    windowHours,
    periodSeconds,
    series,
    totals: {
      invocations,
      errors,
      throttles: sum(series.throttles),
      avgDurationMs: avg(series.duration),
      p50DurationMs: avg(series.durationP50),
      p95DurationMs: avg(series.durationP95),
      p99DurationMs: avg(series.durationP99),
      errorRate: invocations > 0 ? errors / invocations : 0,
    },
  };
}

// Buckets metrics into one point per calendar day over the last `days`
// days — the shape the dashboard's activity chart expects. Each point is
// a real CloudWatch daily Sum/percentile for that UTC day, not a
// client-side re-bucketing of finer-grained data.
export async function getDailyFunctionMetrics(cloudwatch, functionName, days = 14) {
  const { series } = await getFunctionMetrics(cloudwatch, functionName, {
    windowHours: days * 24,
    periodSeconds: 86400,
  });

  const byIndex = (arr, i) => arr?.[i]?.value ?? 0;
  const length = series.invocations?.length || 0;

  const out = [];
  for (let i = 0; i < length; i++) {
    const ts = series.invocations[i].timestamp;
    out.push({
      date: new Date(ts).toISOString().slice(0, 10),
      invocations: byIndex(series.invocations, i),
      errors: byIndex(series.errors, i),
      p95Ms: Math.round(byIndex(series.durationP95, i)),
    });
  }
  return out;
}

// Real cold-start count, derived from Lambda's own REPORT log lines (every
// cold-start invocation's REPORT line includes an "Init Duration" field;
// warm invocations don't have one) via a real CloudWatch Logs Insights
// query — not a random/estimated number.
async function getColdStartCount(logs, functionName, windowHours) {
  const logGroupName = `/aws/lambda/${functionName}`;
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - windowHours * 3600;

  let queryId;
  try {
    ({ queryId } = await logs.send(
      new StartQueryCommand({
        logGroupName,
        startTime,
        endTime,
        queryString: 'filter @message like /Init Duration/ | stats count() as coldStarts',
        limit: 1,
      })
    ));
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') return 0; // no invocations yet — log group doesn't exist
    throw err;
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise((r) => setTimeout(r, 400));
    const { status, results } = await logs.send(new GetQueryResultsCommand({ queryId }));
    if (status === 'Complete') {
      const count = results?.[0]?.find((f) => f.field === 'coldStarts')?.value;
      return count ? Number(count) : 0;
    }
    if (status === 'Failed' || status === 'Cancelled') return 0;
  }
  return 0; // gave up waiting (~3s) — better to show 0 than block the dashboard
}

// Assembles the full {cost, metrics} shape the dashboard route expects —
// the real-data replacement for metricsService.js's old seeded-random
// buildSimulatedMetrics(). invocations/errors/latency/coldStarts are all
// genuine CloudWatch data for this exact function; cost is a labeled
// estimate computed from that same real usage (see the pricing constants
// above), not a random number and not real Cost Explorer billing data.
export async function getDashboardMetrics(clients, functionName, days = 14) {
  const [daily, coldStarts] = await Promise.all([
    getDailyFunctionMetrics(clients.cloudwatch, functionName, days),
    getColdStartCount(clients.logs, functionName, days * 24),
  ]);

  const invocations = daily.reduce((s, d) => s + d.invocations, 0);
  const errors = daily.reduce((s, d) => s + d.errors, 0);

  const { totals } = await getFunctionMetrics(clients.cloudwatch, functionName, {
    windowHours: days * 24,
    periodSeconds: days * 24 * 3600,
  });

  const gbSeconds = invocations * (totals.avgDurationMs / 1000) * (LAMBDA_MEMORY_MB / 1024);
  const estUsd =
    invocations * LAMBDA_PRICE_PER_REQUEST_USD + gbSeconds * LAMBDA_PRICE_PER_GB_SECOND_USD;
  const projectedMonthlyUsd = days > 0 ? (estUsd / days) * 30 : 0;

  const windowStart = daily[0]?.date || new Date().toISOString().slice(0, 10);
  const windowEnd = daily[daily.length - 1]?.date || windowStart;

  return {
    cost: {
      projectedMonthlyUsd: Math.round(projectedMonthlyUsd * 100) / 100,
      actualLast30dUsd: Math.round(estUsd * (30 / days) * 100) / 100,
      costAllocationTagsEnabled: false,
      note:
        'Estimated from real invocation count, average duration and function memory using published on-demand Lambda pricing — not actual AWS Cost Explorer billing data.',
    },
    metrics: {
      invocations,
      errors,
      p50Ms: Math.round(totals.p50DurationMs),
      p95Ms: Math.round(totals.p95DurationMs),
      p99Ms: Math.round(totals.p99DurationMs),
      coldStarts,
      windowStart,
      windowEnd,
      series: daily,
    },
  };
}
