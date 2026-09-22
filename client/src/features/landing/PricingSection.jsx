import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import api, { apiErrorMessage } from '../../lib/api.js'
import { formatPaiseAsRupees } from '../../lib/format.js'
import { Spinner, ErrorBanner } from '../../components/ui.jsx'

export default function PricingSection() {
  const { data: plans, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: async () => (await api.get('/api/billing/plans')).data,
  })

  return (
    <section className="mx-auto max-w-6xl px-6 py-20" id="pricing">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold text-slate-900">Simple, transparent pricing</h2>
        <p className="mt-3 text-slate-500">
          Pay for the migration tooling. Your cloud bill stays with you, in your own account.
        </p>
      </div>

      <div className="mt-12">
        {isLoading ? <Spinner label="Loading plans…" /> : null}
        {isError ? <ErrorBanner message={apiErrorMessage(error, 'Could not load plans.')} onRetry={refetch} /> : null}
        {!isLoading && !isError ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {(plans || []).map((plan) => {
              const isFeatured = plan.key === 'starter'
              return (
                <div
                  key={plan._id}
                  className={`card relative flex flex-col gap-4 ${
                    isFeatured ? 'ring-2 ring-brand-600' : ''
                  }`}
                >
                  {isFeatured ? (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white">
                      Most popular
                    </span>
                  ) : null}
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">{plan.name}</h3>
                    <p className="mt-2 flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-slate-900">
                        {formatPaiseAsRupees(plan.priceInPaise)}
                      </span>
                      <span className="text-sm text-slate-500">/ {plan.interval}</span>
                    </p>
                  </div>
                  <ul className="flex flex-1 flex-col gap-2 text-sm text-slate-600">
                    <li className="flex items-center gap-2">
                      <CheckIcon /> Up to {plan.maxProjects} project{plan.maxProjects === 1 ? '' : 's'}
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckIcon /> {plan.maxDeploysPerMonth} deploys / month
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckIcon /> Live cost &amp; latency dashboard
                    </li>
                  </ul>
                  <Link to="/register" className={isFeatured ? 'btn-primary w-full' : 'btn-secondary w-full'}>
                    Get started
                  </Link>
                </div>
              )
            })}
            {plans && plans.length === 0 ? (
              <p className="col-span-3 text-center text-sm text-slate-500">
                Plans are being configured. Check back shortly.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4 shrink-0 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  )
}
