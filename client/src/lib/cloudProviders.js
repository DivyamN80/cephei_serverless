// Shared metadata for the three supported deploy targets. Kept in one place
// so the provider picker, the cloud-accounts list, and the project detail
// page all agree on labels/colors instead of re-deriving them.
export const CLOUD_PROVIDERS = [
  {
    key: 'aws',
    name: 'AWS',
    fullName: 'AWS Lambda',
    tagline: 'Container-image Lambda function behind an API Gateway HTTP API.',
    resourceLabel: 'Function',
    badgeClass: 'bg-amber-100 text-amber-700',
    dotClass: 'bg-amber-500',
    credentialHelp: [
      'AWS account ID — top-right account menu in the AWS Console, or run `aws sts get-caller-identity`.',
      'Role ARN & Execution role ARN — create an IAM role with the permissions above (IAM Console → Roles → Create role), then copy the ARN shown at the top of the role summary page.',
    ],
  },
  {
    key: 'azure',
    name: 'Azure',
    fullName: 'Azure Functions',
    tagline: 'Linux container-based Function App with an HTTP trigger.',
    resourceLabel: 'Function App',
    badgeClass: 'bg-blue-100 text-blue-700',
    dotClass: 'bg-blue-500',
    credentialHelp: [
      'Subscription ID — Azure Portal → Subscriptions → your subscription → shown on its Overview page.',
      'Tenant ID — Azure Portal → Microsoft Entra ID → Overview → Tenant ID.',
      'App (client) ID — Azure Portal → Microsoft Entra ID → App registrations → new or existing app → Application (client) ID on its Overview page.',
      'Client secret — same app registration → Certificates & secrets → New client secret. Copy the value immediately; Azure only shows it once. Grant this app Contributor on the resource group below.',
      'Resource group — Azure Portal → Resource groups → create or pick one; use its name.',
      'Prefer one click? "Open Azure custom deployment" above creates the app registration and resource group for you and lists the values in the deployment Outputs.',
    ],
  },
  {
    key: 'gcp',
    name: 'GCP',
    fullName: 'GCP Cloud Functions',
    tagline: '2nd-gen (Cloud Run-backed) Cloud Function with an HTTPS trigger.',
    resourceLabel: 'Cloud Function',
    badgeClass: 'bg-emerald-100 text-emerald-700',
    dotClass: 'bg-emerald-500',
    credentialHelp: [
      'Project ID — Google Cloud Console → project picker (top bar) → use the "Project ID" column, not the display name.',
      'Service account email — Google Cloud Console → IAM & Admin → Service Accounts → create one → copy its email (format: name@project-id.iam.gserviceaccount.com).',
      'Prefer one click? "Open Cloud Shell setup script" above creates the service account for you and prints both values.',
    ],
  },
]

export function providerMeta(key) {
  return CLOUD_PROVIDERS.find((p) => p.key === key) || CLOUD_PROVIDERS[0]
}
