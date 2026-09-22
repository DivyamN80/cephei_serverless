import React from 'react'
import { useQuery } from '@tanstack/react-query'
import api, { apiErrorMessage } from '../../lib/api.js'
import { formatDate, formatNumber } from '../../lib/format.js'
import { Spinner, ErrorBanner, StatTile, EmptyState } from '../../components/ui.jsx'

export default function SystemHealthPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'system-health'],
    queryFn: async () => (await api.get('/api/admin/system-health')).data,
    refetchInterval: 30000,
  })

  if (isLoading) return <Spinner label="Loading system health…" />
  if (isError) return <ErrorBanner message={apiErrorMessage(error, 'Could not load system health.')} onRetry={refetch} />
  if (!data) return null

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">System health</h1>
        <p className="text-sm text-slate-500">Deploy success/failure rates across all customers.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Success (24h)" value={formatNumber(data.last24h?.success)} />
        <StatTile label="Failed (24h)" value={formatNumber(data.last24h?.failed)} />
        <StatTile label="Success (7d)" value={formatNumber(data.last7d?.success)} />
        <StatTile label="Failed (7d)" value={formatNumber(data.last7d?.failed)} />
      </div>

      <div className="card flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-slate-900">Recent failures</h3>
        {data.recentFailures?.length ? (
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead>
              <tr>
                <th className="py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Project</th>
                <th className="py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Owner</th>
                <th className="py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Error</th>
                <th className="py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.recentFailures.map((f) => (
                <tr key={f._id}>
                  <td className="py-2 pr-3 text-slate-700">{f.projectName}</td>
                  <td className="py-2 pr-3 text-slate-500">{f.ownerEmail}</td>
                  <td className="py-2 pr-3 text-red-700">{f.error}</td>
                  <td className="py-2 pr-3 text-slate-500">{formatDate(f.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="No recent failures" description="Everything's been deploying cleanly." />
        )}
      </div>
    </div>
  )
}
