import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ShieldCheck, Lock, Trash2, HelpCircle } from 'lucide-react'
import api, { apiErrorMessage } from '../../lib/api.js'
import { Badge, ErrorBanner, Spinner } from '../../components/ui.jsx'
import { CLOUD_PROVIDERS, providerMeta } from '../../lib/cloudProviders.js'

const STEPS = ['Repo', 'Cloud account', 'Secrets', 'Deploy']

const SEVERITY_TONE = { blocker: 'red', warning: 'amber', ok: 'green' }

// Which credential fields to collect per provider, and how to label them.
const PROVIDER_FIELDS = {
  aws: [
    { key: 'roleArn', label: 'Role ARN', placeholder: 'arn:aws:iam::123456789012:role/CepheiDeployRole' },
    {
      key: 'executionRoleArn',
      label: 'Execution role ARN',
      placeholder: 'arn:aws:iam::123456789012:role/CepheiExecutionRole',
    },
    { key: 'awsAccountId', label: 'AWS account ID', placeholder: '123456789012' },
  ],
  azure: [
    { key: 'azureSubscriptionId', label: 'Subscription ID', placeholder: '11111111-1111-1111-1111-111111111111' },
    { key: 'azureTenantId', label: 'Tenant ID', placeholder: '22222222-2222-2222-2222-222222222222' },
    { key: 'azureClientId', label: 'App (client) ID', placeholder: '33333333-3333-3333-3333-333333333333' },
    { key: 'azureClientSecret', label: 'Client secret', placeholder: 'App registration → Certificates & secrets → New client secret', type: 'password' },
    { key: 'azureResourceGroup', label: 'Resource group', placeholder: 'cephei-deploy-rg' },
  ],
  gcp: [
    { key: 'gcpProjectId', label: 'Project ID', placeholder: 'my-gcp-project-id' },
    {
      key: 'gcpServiceAccountEmail',
      label: 'Service account email',
      placeholder: 'cephei-deployer@my-project.iam.gserviceaccount.com',
    },
  ],
}

function connectBodyFor(provider, fields) {
  return Object.fromEntries(PROVIDER_FIELDS[provider].map((f) => [f.key, fields[f.key] || '']))
}

// A stray leading/trailing "$" or quotes are the #1 copy-paste mistake when
// pasting from a .env file — stripped so KEY=value / KEY="value" both work.
function cleanEnvKey(raw) {
  return raw.replace(/^\$/, '').toUpperCase()
}

export default function NewProjectFlow() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)

  const [repoUrl, setRepoUrl] = useState('')
  const [project, setProject] = useState(null)

  const [selectedProvider, setSelectedProvider] = useState('aws')
  const [awsAccount, setAwsAccount] = useState(null) // { account, quickCreateUrl, permissions, consoleLabel }
  const [connectFields, setConnectFields] = useState({})
  const [awsConnected, setAwsConnected] = useState(false)

  const [secretKey, setSecretKey] = useState('')
  const [secretValue, setSecretValue] = useState('')

  const [deployLog, setDeployLog] = useState(null)
  const [deployedProject, setDeployedProject] = useState(null)
  const [frontendDeployed, setFrontendDeployed] = useState(false)

  const provider = awsAccount?.account?.provider || selectedProvider
  const providerFields = PROVIDER_FIELDS[provider]
  const allFieldsFilled = providerFields.every((f) => connectFields[f.key]?.trim())

  const createProject = useMutation({
    mutationFn: async () => (await api.post('/api/projects', { repoUrl })).data,
    onSuccess: (data) => {
      // Stay on step 0 so the user sees the detected stack and
      // compatibility checklist below before choosing to continue — the
      // "Continue" button further down advances to step 1.
      setProject(data)
    },
  })

  const createAwsAccount = useMutation({
    mutationFn: async () => (await api.post('/api/customer-aws-accounts', { provider: selectedProvider })).data,
    onSuccess: (data) => setAwsAccount(data),
  })

  const connectAwsAccount = useMutation({
    mutationFn: async () => {
      const accountId = awsAccount.account._id
      const res = await api.post(
        `/api/customer-aws-accounts/${accountId}/connect`,
        connectBodyFor(provider, connectFields),
      )
      await api.post(`/api/projects/${project._id}/aws-account`, {
        customerAwsAccountId: accountId,
      })
      return res.data
    },
    onSuccess: () => setAwsConnected(true),
  })

  const {
    data: secrets,
    isLoading: secretsLoading,
    refetch: refetchSecrets,
  } = useQuery({
    queryKey: ['new-project-secrets', project?._id],
    queryFn: async () => (await api.get(`/api/projects/${project._id}/secrets`)).data,
    enabled: !!project?._id && step >= 2,
  })

  const addSecret = useMutation({
    mutationFn: async () =>
      (await api.post(`/api/projects/${project._id}/secrets`, { key: secretKey, value: secretValue })).data,
    onSuccess: () => {
      setSecretKey('')
      setSecretValue('')
      refetchSecrets()
    },
  })

  const deleteSecret = useMutation({
    mutationFn: async (secretId) => (await api.delete(`/api/projects/${project._id}/secrets/${secretId}`)).data,
    onSuccess: () => refetchSecrets(),
  })

  const deploy = useMutation({
    mutationFn: async () => (await api.post(`/api/projects/${project._id}/deploy`)).data,
    onSuccess: (data) => {
      setDeployLog(data.deployLog)
      setDeployedProject(data.project)
    },
  })

  const deployFrontend = useMutation({
    mutationFn: async () => (await api.post(`/api/projects/${project._id}/deploy-frontend`)).data,
    onSuccess: (data) => {
      setDeployedProject(data)
      setFrontendDeployed(true)
    },
  })

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">New project</h1>
        <p className="text-sm text-slate-500">Migrate a containerized API to the cloud of your choice in four steps.</p>
      </div>

      <ol className="flex items-center gap-2">
        {STEPS.map((label, idx) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                idx < step
                  ? 'bg-brand-600 text-white'
                  : idx === step
                  ? 'bg-brand-100 text-brand-700 ring-2 ring-brand-600'
                  : 'bg-slate-100 text-slate-400'
              }`}
            >
              {idx + 1}
            </div>
            <span className={`text-sm ${idx === step ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>
              {label}
            </span>
            {idx < STEPS.length - 1 ? <div className="h-px flex-1 bg-slate-200" /> : null}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <div className="card flex flex-col gap-4">
          <div>
            <label className="label" htmlFor="repoUrl">
              Repository URL
            </label>
            <input
              id="repoUrl"
              className="input"
              placeholder="https://github.com/acme/checkout-api"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
            />
          </div>
          {createProject.isError ? (
            <ErrorBanner message={apiErrorMessage(createProject.error, 'Could not analyze that repo.')} />
          ) : null}
          <button
            className="btn-primary self-start"
            disabled={!repoUrl || createProject.isPending}
            onClick={() => createProject.mutate()}
          >
            {createProject.isPending ? 'Analyzing…' : 'Analyze repo'}
          </button>

          {project ? (
            <div className="mt-4 flex flex-col gap-4 border-t border-slate-100 pt-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Detected stack</h3>
                {project.detectedStack &&
                (project.detectedStack.backend || project.detectedStack.frontend || project.detectedStack.database) ? (
                  <dl className="mt-2 grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-400">Backend</dt>
                      <dd className="mt-0.5 font-medium text-slate-800">
                        {project.detectedStack.backend === 'ambiguous'
                          ? 'Multiple candidates'
                          : project.detectedStack.backend || 'Not detected'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-400">Frontend</dt>
                      <dd className="mt-0.5 font-medium text-slate-800">
                        {project.detectedStack.frontend || 'Not detected'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-400">Database</dt>
                      <dd className="mt-0.5 font-medium text-slate-800">
                        {project.detectedStack.database || 'Not detected'}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-1 text-sm text-slate-600">Unknown</p>
                )}
                {project.detectedStack?.versions && Object.keys(project.detectedStack.versions).length ? (
                  <p className="mt-2 font-mono text-xs text-slate-500">
                    {Object.entries(project.detectedStack.versions)
                      .filter(([, v]) => v)
                      .map(([k, v]) => `${k}@${v}`)
                      .join('  ·  ')}
                  </p>
                ) : null}
              </div>

              {project.backendCandidates?.length > 1 ? (
                <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
                  <p className="font-semibold">This looks like a monorepo — multiple backend candidates found:</p>
                  <ul className="mt-1.5 list-inside list-disc space-y-0.5">
                    {project.backendCandidates.map((c) => (
                      <li key={c.path}>
                        <span className="font-mono">{c.path}</span> — {c.framework}
                        {c.database ? ` + ${c.database}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {project.compatibilityChecklist?.length ? (
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Compatibility checklist</h3>
                  <ul className="mt-2 flex flex-col gap-2">
                    {project.compatibilityChecklist.map((item, idx) => (
                      <li key={idx} className="flex items-center gap-2 text-sm">
                        <Badge tone={SEVERITY_TONE[item.severity] || 'slate'}>{item.severity}</Badge>
                        <span className="text-slate-700">{item.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <button className="btn-primary self-start" onClick={() => setStep(1)}>
                Continue
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 1 ? (
        <div className="card flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-slate-900">Connect your cloud account</h3>
          <p className="text-sm text-slate-500">
            We deploy straight into your own cloud account via scoped access. Nothing runs in ours.
          </p>

          {!awsAccount ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {CLOUD_PROVIDERS.map((p) => (
                  <label
                    key={p.key}
                    className={`cursor-pointer rounded-lg border p-4 text-sm ${
                      selectedProvider === p.key ? 'border-brand-600 ring-2 ring-brand-200' : 'border-slate-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name="provider"
                      className="sr-only"
                      value={p.key}
                      checked={selectedProvider === p.key}
                      onChange={() => setSelectedProvider(p.key)}
                    />
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${p.badgeClass}`}>
                      {p.name}
                    </span>
                    <div className="mt-2 font-semibold text-slate-900">{p.fullName}</div>
                    <p className="mt-1 text-slate-500">{p.tagline}</p>
                  </label>
                ))}
              </div>
              <button
                className="btn-primary self-start"
                disabled={createAwsAccount.isPending}
                onClick={() => createAwsAccount.mutate()}
              >
                {createAwsAccount.isPending ? 'Preparing…' : `Start ${providerMeta(selectedProvider).name} connection`}
              </button>
              {createAwsAccount.isError ? (
                <ErrorBanner message={apiErrorMessage(createAwsAccount.error, 'Could not start the cloud connection.')} />
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${providerMeta(provider).badgeClass}`}>
                {providerMeta(provider).fullName}
              </span>

              {awsAccount.permissions?.length ? (
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">Permissions requested</h4>
                  <ul className="mt-1 list-inside list-disc text-sm text-slate-600">
                    {awsAccount.permissions.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {awsAccount.quickCreateUrl ? (
                <a
                  href={awsAccount.quickCreateUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary self-start"
                >
                  {awsAccount.consoleLabel || 'Open provider console ↗'}
                </a>
              ) : (
                <p className="text-sm text-slate-500">
                  Automated setup isn't available yet — create a role with the permissions above in your
                  provider console, then enter its details below.
                </p>
              )}

              {providerMeta(provider).credentialHelp?.length ? (
                <div className="flex flex-col gap-1.5 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-700">
                    <HelpCircle className="h-3.5 w-3.5" />
                    Where do I find these?
                  </div>
                  <ul className="list-inside list-disc space-y-1">
                    {providerMeta(provider).credentialHelp.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
                {providerFields.map((f) => (
                  <div key={f.key}>
                    <label className="label">{f.label}</label>
                    <input
                      className="input"
                      type={f.type || 'text'}
                      value={connectFields[f.key] || ''}
                      onChange={(e) => setConnectFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                    />
                  </div>
                ))}
              </div>

              {connectAwsAccount.isError ? (
                <ErrorBanner message={apiErrorMessage(connectAwsAccount.error, 'Could not connect cloud account.')} />
              ) : null}

              <button
                className="btn-primary self-start"
                disabled={!allFieldsFilled || connectAwsAccount.isPending}
                onClick={() => connectAwsAccount.mutate()}
              >
                {connectAwsAccount.isPending ? 'Connecting…' : 'Connect account'}
              </button>

              {awsConnected ? (
                <button className="btn-primary self-start" onClick={() => setStep(2)}>
                  Continue
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="card flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-900">Environment variables</h3>
            <span className="text-xs font-normal text-slate-400">(optional)</span>
          </div>
          <p className="text-sm text-slate-500">
            Add any secrets your app needs at runtime — database URLs, API keys, and the like.
          </p>

          <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-200">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Values are encrypted before they're stored and are never shown again after you save
              them — not to other users, not to Cephei staff, not through any page in this
              dashboard. Only the deploy process for this project can decrypt them when your
              function actually runs.
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div>
              <label className="label">Key</label>
              <input
                className="input font-mono"
                placeholder="DATABASE_URL"
                autoComplete="off"
                value={secretKey}
                onChange={(e) => setSecretKey(cleanEnvKey(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Value</label>
              <input
                className="input"
                type="password"
                placeholder="••••••••"
                autoComplete="new-password"
                value={secretValue}
                onChange={(e) => setSecretValue(e.target.value)}
              />
            </div>
            <button
              className="btn-secondary"
              disabled={!secretKey.trim() || !secretValue.trim() || addSecret.isPending}
              onClick={() => addSecret.mutate()}
            >
              {addSecret.isPending ? 'Adding…' : 'Add'}
            </button>
          </div>

          {addSecret.isError ? (
            <ErrorBanner message={apiErrorMessage(addSecret.error, 'Could not add that secret.')} />
          ) : null}

          {secretsLoading ? <Spinner label="Loading…" /> : null}

          {secrets?.length ? (
            <ul className="flex flex-col divide-y divide-slate-100 border-t border-slate-100">
              {secrets.map((s) => (
                <li key={s._id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-mono text-slate-700">{s.key}</span>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-slate-400">{s.preview}</span>
                    <button
                      className="text-slate-400 hover:text-red-600"
                      disabled={deleteSecret.isPending}
                      onClick={() => deleteSecret.mutate(s._id)}
                      aria-label={`Remove ${s.key}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : !secretsLoading ? (
            <p className="text-xs text-slate-400">No environment variables added yet.</p>
          ) : null}

          <button className="btn-primary self-start" onClick={() => setStep(3)}>
            Continue
          </button>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="card flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-slate-900">Deploy</h3>

          {!deployedProject ? (
            <>
              {deploy.isError ? (
                <ErrorBanner message={apiErrorMessage(deploy.error, 'Deploy failed.')} />
              ) : null}
              <button className="btn-primary self-start" disabled={deploy.isPending} onClick={() => deploy.mutate()}>
                {deploy.isPending ? 'Deploying…' : `Deploy backend to ${providerMeta(provider).fullName}`}
              </button>
              {deploy.isPending ? <Spinner label="Building and deploying your function…" /> : null}
            </>
          ) : null}

          {deployLog?.log?.length ? (
            <pre className="max-h-64 overflow-y-auto rounded-lg bg-slate-900 p-3 font-mono text-xs text-slate-100">
              {deployLog.log.map((l, idx) => (
                <div key={idx}>
                  <span className="text-slate-500">{l.ts}</span> {l.line}
                </div>
              ))}
            </pre>
          ) : null}

          {deployedProject?.deployResult ? (
            <div className="flex flex-col gap-3 rounded-lg bg-emerald-50 p-4 ring-1 ring-inset ring-emerald-200">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-emerald-800">Backend deployed 🎉</span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${providerMeta(deployedProject.deployResult.provider).badgeClass}`}
                >
                  {providerMeta(deployedProject.deployResult.provider).fullName}
                </span>
              </div>
              <div className="text-sm text-emerald-700">
                Invoke URL:{' '}
                <a href={deployedProject.deployResult.invokeUrl} target="_blank" rel="noreferrer" className="underline">
                  {deployedProject.deployResult.invokeUrl}
                </a>
              </div>
              <div className="text-xs text-emerald-700">
                {deployedProject.deployResult.functionName} · {deployedProject.deployResult.region}
              </div>

              {!frontendDeployed ? (
                <button
                  className="btn-secondary self-start"
                  disabled={deployFrontend.isPending}
                  onClick={() => deployFrontend.mutate()}
                >
                  {deployFrontend.isPending ? 'Deploying frontend…' : 'Deploy frontend too'}
                </button>
              ) : (
                <div className="text-sm text-emerald-700">
                  Frontend deployed:{' '}
                  <a href={deployedProject.frontendDeployResult?.url} target="_blank" rel="noreferrer" className="underline">
                    {deployedProject.frontendDeployResult?.url}
                  </a>
                </div>
              )}

              {deployFrontend.isError ? (
                <ErrorBanner message={apiErrorMessage(deployFrontend.error, 'Frontend deploy failed.')} />
              ) : null}

              <button className="btn-primary self-start" onClick={() => navigate(`/app/projects/${project._id}`)}>
                Go to project
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
