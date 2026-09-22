import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import api, { apiErrorMessage } from '../../../lib/api.js'
import { formatDate, formatDuration } from '../../../lib/format.js'
import { Badge, toneForStatus, EmptyState, Spinner, ErrorBanner } from '../../../components/ui.jsx'
import DeployActivityCalendar from './DeployActivityCalendar.jsx'

function DeployLogLines({ log }) {
  if (!log?.length) return <p className="px-3 pb-3 text-xs text-slate-400">No log output recorded for this deploy.</p>
  return (
    <pre className="mx-3 mb-3 max-h-64 overflow-y-auto rounded-lg bg-slate-900 p-3 font-mono text-xs text-slate-100">
      {log.map((l, idx) => (
        <div key={idx}>
          <span className="text-slate-500">{formatDate(l.ts)}</span> {l.line}
        </div>
      ))}
    </pre>
  )
}

export default function DeployHistoryPanel({ projectId }) {
  const [expanded, setExpanded] = useState(() => new Set())

  const { data: deploys, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['projects', projectId, 'deploy-logs'],
    queryFn: async () => (await api.get(`/api/projects/${projectId}/deploy-logs`)).data,
    refetchInterval: 30000,
  })

  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="card flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-slate-900">Deploy history</h3>

      {isLoading ? <Spinner label="Loading deploy history…" /> : null}
      {isError ? <ErrorBanner message={apiErrorMessage(error, 'Could not load deploy history.')} onRetry={refetch} /> : null}

      {!isLoading && !isError ? (
        deploys?.length ? (
          <>
            <DeployActivityCalendar deploys={deploys} />

            <div className="overflow-x-auto border-t border-slate-100 pt-2">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead>
                  <tr>
                    <th className="w-8" />
                    <th className="py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Kind</th>
                    <th className="py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                    <th className="py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Started</th>
                    <th className="py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Duration</th>
                    <th className="py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Version</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {deploys.map((deploy) => {
                    const isOpen = expanded.has(deploy._id)
                    return (
                      <React.Fragment key={deploy._id}>
                        <tr className="cursor-pointer hover:bg-slate-50" onClick={() => toggle(deploy._id)}>
                          <td className="py-2 pl-1 text-slate-400">
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </td>
                          <td className="py-2 pr-3 text-slate-700">{deploy.kind}</td>
                          <td className="py-2 pr-3">
                            <Badge tone={toneForStatus(deploy.status)}>{deploy.status}</Badge>
                          </td>
                          <td className="py-2 pr-3 text-slate-500">{formatDate(deploy.startedAt)}</td>
                          <td className="py-2 pr-3 text-slate-500">{formatDuration(deploy.startedAt, deploy.finishedAt)}</td>
                          <td className="py-2 pr-3 text-slate-500">{deploy.lambdaVersion ?? '—'}</td>
                        </tr>
                        {isOpen ? (
                          <tr>
                            <td colSpan={6} className="p-0">
                              {deploy.error ? (
                                <p className="mx-3 mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-inset ring-red-200">
                                  {deploy.error}
                                </p>
                              ) : null}
                              <DeployLogLines log={deploy.log} />
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptyState title="No deploys yet" description="Deploy history will show up here once you deploy." />
        )
      ) : null}
    </div>
  )
}
