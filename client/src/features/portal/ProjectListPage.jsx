import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, ArrowRight } from 'lucide-react'
import api, { apiErrorMessage } from '../../lib/api.js'
import { formatDate, formatUsd, formatNumber } from '../../lib/format.js'
import { Spinner, ErrorBanner, EmptyState, Badge, toneForStatus } from '../../components/ui.jsx'

export default function ProjectListPage() {
  const { data: projects, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get('/api/projects')).data,
  })

  // Enriches each row with cost/usage from the same aggregate the centralized
  // dashboard uses — a second cheap request, not a schema change.
  const { data: overview } = useQuery({
    queryKey: ['projects', 'overview'],
    queryFn: async () => (await api.get('/api/projects/overview')).data,
    enabled: !!projects?.length,
  })
  const overviewById = new Map((overview?.projects || []).map((p) => [p._id, p]))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Projects</h1>
          <p className="text-sm text-slate-500">Every API you're migrating to Lambda.</p>
        </div>
        <Link to="/app/new" className="btn-primary gap-1.5">
          <Plus className="h-4 w-4" />
          New project
        </Link>
      </div>

      {isLoading ? <Spinner label="Loading projects…" /> : null}
      {isError ? <ErrorBanner message={apiErrorMessage(error, 'Could not load projects.')} onRetry={refetch} /> : null}

      {!isLoading && !isError ? (
        projects && projects.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => {
              const enriched = overviewById.get(project._id)
              return (
                <Link
                  key={project._id}
                  to={`/app/projects/${project._id}`}
                  className="card flex flex-col gap-3 transition-shadow hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-slate-900">{project.name}</div>
                      <div className="truncate text-xs text-slate-500">{project.repoUrl}</div>
                    </div>
                    <Badge tone={toneForStatus(project.status)}>{project.status}</Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-sm">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-400">Monthly cost</div>
                      <div className="font-medium text-slate-800">
                        {enriched?.cost ? formatUsd(enriched.cost.projectedMonthlyUsd) : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-400">Invocations (14d)</div>
                      <div className="font-medium text-slate-800">
                        {enriched?.metrics ? formatNumber(enriched.metrics.invocations) : '—'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Updated {formatDate(project.updatedAt)}</span>
                    <span className="flex items-center gap-1 font-medium text-brand-700">
                      View <ArrowRight className="h-3 w-3" />
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        ) : (
          <EmptyState
            title="No projects yet"
            description="Connect a repo to see its detected stack, a compatibility checklist, and a projected Lambda cost."
            action={
              <Link to="/app/new" className="btn-primary">
                Create your first project
              </Link>
            }
          />
        )
      ) : null}
    </div>
  )
}
