import React from 'react'
import { useQuery } from '@tanstack/react-query'
import api, { apiErrorMessage } from '../../lib/api.js'
import { formatPaiseAsRupees, formatNumber } from '../../lib/format.js'
import { Spinner, ErrorBanner, StatTile, Badge } from '../../components/ui.jsx'

export default function OverviewPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: async () => (await api.get('/api/admin/overview')).data,
  })

  if (isLoading) return <Spinner label="Loading overview…" />
  if (isError) return <ErrorBanner message={apiErrorMessage(error, 'Could not load overview.')} onRetry={refetch} />
  if (!data) return null

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Overview</h1>
        <p className="text-sm text-slate-500">Business metrics across all customers.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total customers" value={formatNumber(data.totalCustomers)} />
        <StatTile label="Active subscriptions" value={formatNumber(data.activeSubscriptions)} />
        <StatTile label="MRR" value={formatPaiseAsRupees(data.mrrInPaise)} accent />
        <StatTile label="Total projects" value={formatNumber(data.totalProjects)} />
        <StatTile label="New signups (7d)" value={formatNumber(data.newSignupsThisWeek)} />
        <StatTile label="New signups (30d)" value={formatNumber(data.newSignupsThisMonth)} />
        <StatTile label="Deploys (7d)" value={formatNumber(data.deploysLast7d)} />
      </div>

      <div className="card flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-slate-900">Cloud connection health</h3>
        <div className="flex flex-wrap gap-3">
          <Badge tone="green">Connected: {formatNumber(data.awsConnections?.connected)}</Badge>
          <Badge tone="red">Error: {formatNumber(data.awsConnections?.error)}</Badge>
          <Badge tone="amber">Revoked: {formatNumber(data.awsConnections?.revoked)}</Badge>
        </div>
      </div>
    </div>
  )
}
