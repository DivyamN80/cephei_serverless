import React, { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import api, { apiErrorMessage } from '../../lib/api.js'
import { formatDate } from '../../lib/format.js'
import { Spinner, ErrorBanner, Badge, toneForStatus } from '../../components/ui.jsx'
import { providerMeta } from '../../lib/cloudProviders.js'
import CostComparisonPanel from './dashboard/CostComparisonPanel.jsx'
import LatencyErrorsPanel from './dashboard/LatencyErrorsPanel.jsx'
import DeployHistoryPanel from './dashboard/DeployHistoryPanel.jsx'
import RollbackPanel from './dashboard/RollbackPanel.jsx'

const TABS = ['Overview', 'Dashboard', 'Cloud Account']

export default function ProjectDetailPage() {
  const { id } = useParams()
  const [tab, setTab] = useState('Overview')
  const queryClient = useQueryClient()

  const { data: project, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['projects', id],
    queryFn: async () => (await api.get(`/api/projects/${id}`)).data,
  })

  // Redeploys the current backend. This is the only way a real (non-seeded)
  // project ever gets a second version to roll back to — without it,
  // Rollback and a meaningful Deploy history are unreachable in the UI.
  const redeploy = useMutation({
    mutationFn: async () => (await api.post(`/api/projects/${id}/deploy`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', id] })
      queryClient.invalidateQueries({ queryKey: ['projects', id, 'dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['projects', id, 'deploy-logs'] })
    },
  })

  if (isLoading) return <Spinner label="Loading project…" />
  if (isError) return <ErrorBanner message={apiErrorMessage(error, 'Could not load project.')} onRetry={refetch} />
  if (!project) return null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900">{project.name}</h1>
          <p className="text-sm text-slate-500">{project.repoUrl}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {project.deployResult ? (
            <button className="btn-secondary gap-1.5" disabled={redeploy.isPending} onClick={() => redeploy.mutate()}>
              <RefreshCw className={`h-3.5 w-3.5 ${redeploy.isPending ? 'animate-spin' : ''}`} />
              {redeploy.isPending ? 'Redeploying…' : 'Redeploy'}
            </button>
          ) : null}
          <Badge tone={toneForStatus(project.status)}>{project.status}</Badge>
        </div>
      </div>

      {redeploy.isError ? <ErrorBanner message={apiErrorMessage(redeploy.error, 'Redeploy failed.')} /> : null}

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === t
                ? 'border-b-2 border-brand-600 text-brand-700'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' ? <OverviewTab project={project} /> : null}
      {tab === 'Dashboard' ? <DashboardTab projectId={id} /> : null}
      {tab === 'Cloud Account' ? <AwsAccountTab project={project} /> : null}
    </div>
  )
}

function OverviewTab({ project }) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <div className="card flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-slate-900">Repository</h3>
        <dl className="grid grid-cols-3 gap-y-2 text-sm">
          <dt className="col-span-1 text-slate-500">Repo URL</dt>
          <dd className="col-span-2 break-all text-slate-800">{project.repoUrl}</dd>
          <dt className="col-span-1 text-slate-500">Status</dt>
          <dd className="col-span-2">
            <Badge tone={toneForStatus(project.status)}>{project.status}</Badge>
          </dd>
          <dt className="col-span-1 text-slate-500">Updated</dt>
          <dd className="col-span-2 text-slate-800">{formatDate(project.updatedAt)}</dd>
        </dl>
      </div>

      <div className="card flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-slate-900">Detected stack</h3>
        <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-700">
          {project.detectedStack ? JSON.stringify(project.detectedStack, null, 2) : 'Not analyzed yet'}
        </pre>
      </div>

      <div className="card flex flex-col gap-3 md:col-span-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Deploy result</h3>
          {project.deployResult ? (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${providerMeta(project.deployResult.provider).badgeClass}`}
            >
              {providerMeta(project.deployResult.provider).fullName}
            </span>
          ) : null}
        </div>
        {project.deployResult ? (
          <dl className="grid grid-cols-2 gap-y-2 text-sm sm:grid-cols-4">
            <dt className="text-slate-500">Invoke URL</dt>
            <dd className="col-span-3 break-all">
              <a href={project.deployResult.invokeUrl} target="_blank" rel="noreferrer" className="text-brand-700 underline">
                {project.deployResult.invokeUrl}
              </a>
            </dd>
            <dt className="text-slate-500">{providerMeta(project.deployResult.provider).resourceLabel}</dt>
            <dd className="col-span-3 text-slate-800">{project.deployResult.functionName}</dd>
            <dt className="text-slate-500">Region</dt>
            <dd className="col-span-3 text-slate-800">{project.deployResult.region}</dd>
            <dt className="text-slate-500">Live version</dt>
            <dd className="col-span-3 text-slate-800">{project.deployResult.lambdaLiveVersion}</dd>
          </dl>
        ) : (
          <p className="text-sm text-slate-500">Not deployed yet. Finish the new project flow to deploy.</p>
        )}

        {project.frontendDeployResult ? (
          <div className="mt-2 border-t border-slate-100 pt-3 text-sm">
            <span className="text-slate-500">Frontend URL: </span>
            <a href={project.frontendDeployResult.url} target="_blank" rel="noreferrer" className="text-brand-700 underline">
              {project.frontendDeployResult.url}
            </a>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function DashboardTab({ projectId }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['projects', projectId, 'dashboard'],
    queryFn: async () => (await api.get(`/api/projects/${projectId}/dashboard`)).data,
    refetchInterval: 30000,
  })

  if (isLoading) return <Spinner label="Loading dashboard…" />
  if (isError) return <ErrorBanner message={apiErrorMessage(error, 'Could not load dashboard.')} onRetry={refetch} />
  if (!data) return null

  return (
    <div className="flex flex-col gap-6">
      {data.recommendation ? (
        <div className="card border-l-4 border-l-brand-600 bg-brand-50/40 text-sm text-slate-700">
          <span className="font-semibold text-brand-700">Recommendation: </span>
          {data.recommendation}
        </div>
      ) : null}
      <CostComparisonPanel cost={data.cost} />
      <LatencyErrorsPanel metrics={data.metrics} />
      {/* Full width, not a 2-column grid — the GitHub-style activity
          calendar needs the room to stay readable. */}
      <DeployHistoryPanel projectId={projectId} />
      <RollbackPanel projectId={projectId} rollback={data.rollback} onRolledBack={refetch} />
    </div>
  )
}

// Provider-specific identifier rows shown in the "Linked cloud account" card.
function providerDetailRows(account) {
  if (account.provider === 'azure') {
    return [
      ['Subscription ID', account.azureSubscriptionId],
      ['Resource group', account.azureResourceGroup],
      ['Tenant ID', account.azureTenantId],
    ]
  }
  if (account.provider === 'gcp') {
    return [
      ['Project ID', account.gcpProjectId],
      ['Service account', account.gcpServiceAccountEmail],
    ]
  }
  return [
    ['Account ID', account.awsAccountId],
    ['Role ARN', account.roleArn],
  ]
}

function AwsAccountTab({ project }) {
  const account = project.customerAwsAccount

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Linked cloud account</h3>
        {account ? (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${providerMeta(account.provider).badgeClass}`}
          >
            {providerMeta(account.provider).fullName}
          </span>
        ) : null}
      </div>
      {account ? (
        <dl className="grid grid-cols-3 gap-y-2 text-sm">
          {providerDetailRows(account).map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="text-slate-500">{label}</dt>
              <dd className="col-span-2 break-all text-slate-800">{value || '—'}</dd>
            </React.Fragment>
          ))}
          <dt className="text-slate-500">Region</dt>
          <dd className="col-span-2 text-slate-800">{account.region || '—'}</dd>
          <dt className="text-slate-500">Status</dt>
          <dd className="col-span-2">
            <Badge tone={toneForStatus(account.status)}>{account.status || 'pending'}</Badge>
          </dd>
        </dl>
      ) : (
        <p className="text-sm text-slate-500">
          No cloud account linked to this project yet. Manage cloud accounts from the{' '}
          <a href="/app/aws-accounts" className="text-brand-700 underline">
            Cloud accounts
          </a>{' '}
          page.
        </p>
      )}
    </div>
  )
}
