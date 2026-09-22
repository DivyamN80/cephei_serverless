// recommendationService.js
//
// `recommend` returns a one-line, human-readable recommendation string for a
// project's post-deploy dashboard.
//
// SIMULATED heuristic — a real version would look at trailing-30-day
// CloudWatch invocation/error/duration trends (via customerAwsClients.js)
// rather than the single current snapshot used here.
export function recommend(project, metrics) {
  const tier = project.trafficTier;
  const invocations = metrics?.invocations ?? 0;

  if (tier === 'steady' && invocations > 500000) {
    return 'Traffic is steady and high-volume — Lambda Managed Instances would likely cut cold starts further while keeping costs predictable.';
  }
  if (tier === 'steady') {
    return 'Traffic is steady — current setup looks cost-efficient; re-check in 30 days as volume grows.';
  }
  if (tier === 'steady_spikes') {
    return 'Spiky-but-steady traffic is well suited to Lambda Managed Instances — provisioned concurrency is absorbing your peaks.';
  }
  if (tier === 'low_spiky') {
    if (invocations < 10000) {
      return 'Low, bursty traffic — classic Lambda (pay-per-invocation) remains the cheapest option; no change recommended.';
    }
    return 'Traffic volume is growing — keep an eye on invocation count, you may outgrow classic Lambda pricing soon.';
  }
  return 'Set a traffic tier to get a tailored infrastructure recommendation.';
}
