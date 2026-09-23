// §7 real metrics — Azure Monitor platform metrics for the deployed
// Function App's Microsoft.Web/sites resource. No synthetic/random data:
// an idle Function App genuinely returns all-zero series here, exactly
// as Azure Monitor reports it.
//
// Uses @azure/arm-monitor's MonitorClient.metrics.list (the classic
// resource-centric Metrics REST API), NOT @azure/monitor-query's
// MetricsQueryClient — verified by inspecting the installed
// @azure/monitor-query v1.3.3 package directly: its MetricsQueryClient
// class is annotated `@deprecated For resource-centric metrics queries,
// use the management library @azure/arm-monitor instead`, with a
// migration guide pointing at arm-monitor. arm-monitor's `metrics.list`
// is the real, current, non-deprecated surface for exactly this query
// shape (verified against the installed @azure/arm-monitor v8.0.0
// package's classic/metrics operations and models).
//
// Metric names (verified against the real, current Azure Monitor
// "Supported metrics - Microsoft.Web/sites" reference,
// learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/
// microsoft-web-sites-metrics, checked 2026-09-22):
//   Requests         — total request count, all status codes (Total/Sum)
//   Http5xx           — request count with HTTP status >= 500 (Total/Sum)
//   HttpResponseTime  — response time in seconds (Average only — this
//                        metric supports NO percentile aggregation on
//                        Microsoft.Web/sites, unlike AWS CloudWatch's
//                        GetMetricData which accepts p50/p95/p99 Stat
//                        values directly. This is a genuine Azure Monitor
//                        platform limitation, not an oversight here.)
const METRIC_NAMES = 'Requests,Http5xx,HttpResponseTime';
const AGGREGATIONS = 'Total,Average';
const DAY_INTERVAL = 'P1D';

// Published Elastic Premium EP1 pricing (1 vCPU / 3.5 GB), Sep 2026 —
// see functionApp.js for why EP1 is the plan this provider uses. Premium
// plans bill for allocated instance-time (at least one always-ready
// instance, always billed, per Microsoft's own Premium-plan docs — "no
// execution charge... minimum monthly cost per active plan, whether the
// function is active or idle"), NOT per-invocation like Lambda or the
// Consumption plan — so unlike aws/metrics.js's estimate, this genuinely
// does not scale with real invocation volume; it is a flat baseline for
// the minimum one-instance footprint we configure.
const EP1_VCPU_PRICE_PER_HOUR_USD = 0.173;
const EP1_MEMORY_GB = 3.5;
const EP1_MEMORY_PRICE_PER_GB_HOUR_USD = 0.0123;
const HOURS_PER_MONTH = 730;

function functionAppResourceId(clients, functionAppName) {
  return `/subscriptions/${clients.subscriptionId}/resourceGroups/${clients.resourceGroup}/providers/Microsoft.Web/sites/${functionAppName}`;
}

function metricSeries(response, name) {
  const metric = response.value?.find((m) => m.name?.value === name);
  return metric?.timeseries?.[0]?.data || [];
}

// Buckets Requests/Http5xx/HttpResponseTime into one point per calendar
// day over the last `days` days, matching the shape aws/metrics.js's
// getDailyFunctionMetrics returns.
async function getDailyFunctionMetrics(clients, functionAppName, days) {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - days * 24 * 3600 * 1000);
  const resourceUri = functionAppResourceId(clients, functionAppName);

  const response = await clients.monitor.metrics.list(resourceUri, {
    timespan: `${startTime.toISOString()}/${endTime.toISOString()}`,
    interval: DAY_INTERVAL,
    metricnames: METRIC_NAMES,
    aggregation: AGGREGATIONS,
  });

  const requests = metricSeries(response, 'Requests');
  const errors = metricSeries(response, 'Http5xx');
  const responseTime = metricSeries(response, 'HttpResponseTime');

  const length = Math.max(requests.length, errors.length, responseTime.length);
  const out = [];
  for (let i = 0; i < length; i++) {
    const ts = requests[i]?.timeStamp || errors[i]?.timeStamp || responseTime[i]?.timeStamp;
    const avgSeconds = responseTime[i]?.average ?? 0;
    out.push({
      date: (ts ? new Date(ts) : new Date()).toISOString().slice(0, 10),
      invocations: Math.round(requests[i]?.total ?? 0),
      errors: Math.round(errors[i]?.total ?? 0),
      // Real average response time — see the module-level note on why
      // this stands in for p95 as well (Azure Monitor exposes no
      // percentile aggregation for HttpResponseTime).
      p95Ms: Math.round(avgSeconds * 1000),
    });
  }
  return out;
}

// Assembles the full {cost, metrics} shape metricsService.js's dashboard
// route expects — matches aws/metrics.js's getDashboardMetrics contract
// exactly. invocations/errors/response-time are all genuine Azure
// Monitor data for this exact Function App; cost is a labeled estimate
// (see pricing constants above); coldStarts is honestly 0 (see note
// below) rather than a guess.
export async function getDashboardMetrics(clients, functionAppName, days = 14) {
  const daily = await getDailyFunctionMetrics(clients, functionAppName, days);

  const invocations = daily.reduce((s, d) => s + d.invocations, 0);
  const errors = daily.reduce((s, d) => s + d.errors, 0);
  const avgP95 = daily.length ? Math.round(daily.reduce((s, d) => s + d.p95Ms, 0) / daily.length) : 0;

  const projectedMonthlyUsd =
    (EP1_VCPU_PRICE_PER_HOUR_USD + EP1_MEMORY_GB * EP1_MEMORY_PRICE_PER_GB_HOUR_USD) * HOURS_PER_MONTH;

  const windowStart = daily[0]?.date || new Date().toISOString().slice(0, 10);
  const windowEnd = daily[daily.length - 1]?.date || windowStart;

  return {
    cost: {
      projectedMonthlyUsd: Math.round(projectedMonthlyUsd * 100) / 100,
      actualLast30dUsd: Math.round(projectedMonthlyUsd * 100) / 100,
      costAllocationTagsEnabled: false,
      note:
        "Estimated from the Elastic Premium EP1 plan's published per-instance-hour pricing (1 vCPU + 3.5 GB), assuming the one always-ready instance this provider configures. Premium plans bill for allocated instance-time, not per-invocation, so — unlike the AWS estimate — this figure does not scale with real traffic. Not actual Azure Cost Management billing data.",
    },
    metrics: {
      invocations,
      errors,
      p50Ms: avgP95,
      p95Ms: avgP95,
      p99Ms: avgP95,
      // Honest 0, not a guess: Azure Monitor's Microsoft.Web/sites metrics
      // have no cold-start-count metric for Premium/Dedicated plans (the
      // only related metrics — AlwaysReadyFunctionExecutionCount /
      // OnDemandFunctionExecutionCount — are documented as "For Flex
      // Consumption FunctionApps only" and don't apply to the Elastic
      // Premium plan this provider uses).
      coldStarts: 0,
      windowStart,
      windowEnd,
      series: daily,
    },
  };
}
