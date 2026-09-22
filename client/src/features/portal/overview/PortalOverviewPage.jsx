import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Rocket,
  DollarSign,
  Activity,
  AlertTriangle,
  Gauge,
  Cloud,
  ArrowRight,
  Plus,
  GitBranch,
} from 'lucide-react'
import api, { apiErrorMessage } from '../../../lib/api.js'
import { useAuth } from '../../../lib/auth-context.jsx'
import { formatUsd, formatNumber, formatDate, formatDuration } from '../../../lib/format.js'
import { Spinner, ErrorBanner, EmptyState, Badge, toneForStatus, StatTile, ProgressBar } from '../../../components/ui.jsx'
import OverviewTrendChart from './OverviewTrendChart.jsx'

function firstName(user) {
  if (user?.name) return user.name.split(' ')[0]
  return user?.email?.split('@')[0] || 'there'
}

export default function PortalOverviewPage() {
  const { user } = useAuth()

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['projects', 'overview'],
    queryFn: async () => (await api.get('/api/projects/overview')).data,
    refetchInterval: 30000,
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Welcome back, {firstName(user)}</h1>
          <p className="text-sm text-slate-500">Here's what's happening across your projects.</p>
        </div>
        <Link to="/app/new" className="btn-primary gap-1.5">
          <Plus className="h-4 w-4" />
          New project
        </Link>
      </div>

      {isLoading ? <Spinner label="Loading dashboard…" /> : null}
      {isError ? <ErrorBanner message={apiErrorMessage(error, 'Could not load your dashboard.')} onRetry={refetch} /> : null}

      {!isLoading && !isError && data ? (
        data.counts.totalProjects === 0 ? (
          <EmptyState
            title="No projects yet"
            description="Connect a repo to see its detected stack, a compatibility checklist, and a projected Lambda cost — your centralized dashboard fills in as soon as you deploy."
            action={
              <Link to="/app/new" className="btn-primary">
                Create your first project
              </Link>
            }
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <StatTile label="Projects" value={formatNumber(data.counts.totalProjects)} icon={<GitBranch className="h-4 w-4" />} />
              <StatTile
                label="Deployed"
                value={formatNumber(data.counts.deployed)}
                sub={`${data.counts.totalProjects} total`}
                icon={<Rocket className="h-4 w-4" />}
                accent
              />
              <StatTile label="Monthly cost" value={formatUsd(data.cost.projectedMonthlyUsd)} sub="projected" icon={<DollarSign className="h-4 w-4" />} />
              <StatTile label="Invocations" value={formatNumber(data.metrics.invocations)} sub="last 14d" icon={<Activity className="h-4 w-4" />} />
              <StatTile
                label="Error rate"
                value={`${(data.metrics.errorRate * 100).toFixed(2)}%`}
                sub={`${formatNumber(data.metrics.errors)} errors`}
                icon={<AlertTriangle className="h-4 w-4" />}
              />
              <StatTile label="Avg p95" value={data.metrics.avgP95Ms != null ? `${data.metrics.avgP95Ms} ms` : '—'} icon={<Gauge className="h-4 w-4" />} />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="card flex flex-col gap-3 lg:col-span-2">
                <h3 className="text-sm font-semibold text-slate-900">Invocations across all projects (14d)</h3>
                <OverviewTrendChart data={data.trend} />
              </div>

              <div className="flex flex-col gap-6">
                <div className="card flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900">Plan</h3>
                    <Badge tone={toneForStatus(data.subscription?.status)}>{data.subscription?.status || 'none'}</Badge>
                  </div>
                  <div className="text-lg font-semibold text-slate-900">{data.subscription?.plan?.name || 'No plan'}</div>
                  {data.subscription?.plan?.maxProjects ? (
                    <ProgressBar
                      value={data.counts.totalProjects}
                      max={data.subscription.plan.maxProjects}
                      label={
                        <>
                          <span>Projects used</span>
                          <span>
                            {data.counts.totalProjects} / {data.subscription.plan.maxProjects}
                          </span>
                        </>
                      }
                    />
                  ) : null}
                  <Link to="/app/billing" className="mt-1 flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                    Manage billing <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>

                <div className="card flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900">Cloud accounts</h3>
                    <Cloud className="h-4 w-4 text-slate-400" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="green">Connected: {data.cloudAccounts.connected}</Badge>
                    {data.cloudAccounts.pending ? <Badge tone="amber">Pending: {data.cloudAccounts.pending}</Badge> : null}
                    {data.cloudAccounts.error ? <Badge tone="red">Error: {data.cloudAccounts.error}</Badge> : null}
                  </div>
                  <Link to="/app/aws-accounts" className="mt-1 flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                    Manage cloud accounts <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="card flex flex-col gap-4 lg:col-span-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">Projects</h3>
                  <Link to="/app/projects" className="text-sm font-medium text-brand-700 hover:underline">
                    View all
                  </Link>
                </div>
                <div className="flex flex-col divide-y divide-slate-100">
                  {data.projects.map((project) => (
                    <Link
                      key={project._id}
                      to={`/app/projects/${project._id}`}
                      className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0 hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-800">{project.name}</div>
                        <div className="text-xs text-slate-500">Updated {formatDate(project.updatedAt)}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-4">
                        {project.cost ? (
                          <span className="text-sm text-slate-500">{formatUsd(project.cost.projectedMonthlyUsd)}/mo</span>
                        ) : null}
                        <Badge tone={toneForStatus(project.status)}>{project.status}</Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="card flex flex-col gap-4">
                <h3 className="text-sm font-semibold text-slate-900">Recent activity</h3>
                {data.recentDeploys?.length ? (
                  <ul className="flex flex-col divide-y divide-slate-100">
                    {data.recentDeploys.map((deploy) => (
                      <li key={deploy.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0 text-sm">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-700">
                            {deploy.kind} · {deploy.projectName}
                          </div>
                          <div className="text-xs text-slate-500">
                            {formatDate(deploy.startedAt)} · {formatDuration(deploy.startedAt, deploy.finishedAt)}
                          </div>
                        </div>
                        <Badge tone={toneForStatus(deploy.status)}>{deploy.status}</Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">No deploys yet.</p>
                )}
              </div>
            </div>
          </>
        )
      ) : null}
    </div>
  )
}
