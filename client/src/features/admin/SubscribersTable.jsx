import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import api, { apiErrorMessage } from '../../lib/api.js'
import { formatDate } from '../../lib/format.js'
import { Spinner, ErrorBanner, Badge, toneForStatus, EmptyState } from '../../components/ui.jsx'

const PAGE_SIZE = 20

export default function SubscribersTable() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('')
  const [plan, setPlan] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'users', { status, plan, q, page }],
    queryFn: async () =>
      (
        await api.get('/api/admin/users', {
          params: { status: status || undefined, plan: plan || undefined, q: q || undefined, page },
        })
      ).data,
  })

  const items = data?.items || []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Subscribers</h1>
        <p className="text-sm text-slate-500">All registered customers.</p>
      </div>

      <div className="card flex flex-wrap items-end gap-4">
        <div>
          <label className="label">Search</label>
          <input
            className="input"
            placeholder="Name or email"
            value={q}
            onChange={(e) => {
              setPage(1)
              setQ(e.target.value)
            }}
          />
        </div>
        <div>
          <label className="label">Status</label>
          <select
            className="input"
            value={status}
            onChange={(e) => {
              setPage(1)
              setStatus(e.target.value)
            }}
          >
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="past_due">Past due</option>
            <option value="canceled">Canceled</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        <div>
          <label className="label">Plan</label>
          <input
            className="input"
            placeholder="Plan name"
            value={plan}
            onChange={(e) => {
              setPage(1)
              setPlan(e.target.value)
            }}
          />
        </div>
      </div>

      {isLoading ? <Spinner label="Loading subscribers…" /> : null}
      {isError ? <ErrorBanner message={apiErrorMessage(error, 'Could not load subscribers.')} onRetry={refetch} /> : null}

      {!isLoading && !isError ? (
        items.length > 0 ? (
          <div className="card overflow-hidden !p-0">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Plan</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Projects</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((user) => (
                  <tr
                    key={user._id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => navigate(`/admin/subscribers/${user._id}`)}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-slate-800">{user.name}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{user.email}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{user.planName || '—'}</td>
                    <td className="px-4 py-3">
                      <Badge tone={toneForStatus(user.subscriptionStatus)}>{user.subscriptionStatus || 'none'}</Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{user.projectCount}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{formatDate(user.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
              <span>
                Page {page} of {totalPages} · {total} total
              </span>
              <div className="flex gap-2">
                <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </button>
                <button className="btn-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </button>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState title="No subscribers found" description="Try adjusting your filters." />
        )
      ) : null}
    </div>
  )
}
