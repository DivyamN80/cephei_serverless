import React from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api, { apiErrorMessage } from '../../lib/api.js'
import { formatDate, formatDuration } from '../../lib/format.js'
import { Spinner, ErrorBanner, Badge, toneForStatus, EmptyState } from '../../components/ui.jsx'
import { providerMeta } from '../../lib/cloudProviders.js'

export default function SubscriberDetailPage() {
  const { id } = useParams()
  const queryClient = useQueryClient()

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'users', id],
    queryFn: async () => (await api.get(`/api/admin/users/${id}`)).data,
  })

  const updateStatus = useMutation({
    mutationFn: async (status) => (await api.patch(`/api/admin/users/${id}`, { status })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', id] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })

  if (isLoading) return <Spinner label="Loading subscriber…" />
  if (isError) return <ErrorBanner message={apiErrorMessage(error, 'Could not load subscriber.')} onRetry={refetch} />
  if (!data) return null

  const { user, projects, deployLogs, awsAccounts, subscriptionHistory } = data
  const isSuspended = user?.status === 'suspended'

  return (
    <div className="flex flex-col gap-6">
      <Link to="/admin/subscribers" className="text-sm text-brand-700 hover:underline">
        ← Back to subscribers
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{user?.name}</h1>
          <p className="text-sm text-slate-500">{user?.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={isSuspended ? 'red' : 'green'}>{user?.status || 'active'}</Badge>
          {updateStatus.isError ? (
            <ErrorBanner message={apiErrorMessage(updateStatus.error, 'Could not update status.')} />
          ) : null}
          <button
            className={isSuspended ? 'btn-primary' : 'btn-danger'}
            disabled={updateStatus.isPending}
            onClick={() => {
              const next = isSuspended ? 'active' : 'suspended'
              if (window.confirm(`Set this user's status to "${next}"?`)) {
                updateStatus.mutate(next)
              }
            }}
          >
            {isSuspended ? 'Reactivate' : 'Suspend'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-slate-900">Projects ({projects?.length ?? 0})</h3>
          {projects?.length ? (
            <ul className="flex flex-col gap-2 text-sm">
              {projects.map((p) => (
                <li key={p._id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                  <span className="text-slate-700">{p.name}</span>
                  <Badge tone={toneForStatus(p.status)}>{p.status}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No projects.</p>
          )}
        </div>

        <div className="card flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-slate-900">Cloud accounts ({awsAccounts?.length ?? 0})</h3>
          {awsAccounts?.length ? (
            <ul className="flex flex-col gap-2 text-sm">
              {awsAccounts.map((a) => (
                <li key={a._id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${providerMeta(a.provider).badgeClass}`}>
                      {providerMeta(a.provider).name}
                    </span>
                    <span className="text-slate-700">{a.awsAccountId || a.azureSubscriptionId || a.gcpProjectId || '—'}</span>
                  </span>
                  <Badge tone={toneForStatus(a.status)}>{a.status || 'pending'}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No cloud accounts connected.</p>
          )}
        </div>

        <div className="card flex flex-col gap-3 lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-900">Recent deploy logs</h3>
          {deployLogs?.length ? (
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr>
                  <th className="py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Kind</th>
                  <th className="py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                  <th className="py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Started</th>
                  <th className="py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {deployLogs.map((log) => (
                  <tr key={log._id}>
                    <td className="py-2 pr-3 text-slate-700">{log.kind}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={toneForStatus(log.status)}>{log.status}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-slate-500">{formatDate(log.startedAt)}</td>
                    <td className="py-2 pr-3 text-slate-500">{formatDuration(log.startedAt, log.finishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="No deploy logs" description="This customer hasn't deployed anything yet." />
          )}
        </div>

        <div className="card flex flex-col gap-3 lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-900">Subscription history</h3>
          {subscriptionHistory?.length ? (
            <ul className="flex flex-col gap-2 text-sm">
              {subscriptionHistory.map((s, idx) => (
                <li key={s._id || idx} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                  <span className="text-slate-700">{s.plan?.name || s.planName || 'Plan'}</span>
                  <div className="flex items-center gap-3">
                    <Badge tone={toneForStatus(s.status)}>{s.status}</Badge>
                    <span className="text-slate-500">{formatDate(s.currentPeriodEnd || s.updatedAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No subscription history.</p>
          )}
        </div>
      </div>
    </div>
  )
}
