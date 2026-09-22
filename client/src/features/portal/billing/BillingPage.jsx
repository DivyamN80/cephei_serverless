import React, { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import api, { apiErrorMessage } from '../../../lib/api.js'
import { formatPaiseAsRupees, formatDate } from '../../../lib/format.js'
import { Spinner, ErrorBanner, Badge, toneForStatus } from '../../../components/ui.jsx'

const RAZORPAY_SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js'

function loadRazorpayScript() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) {
      resolve(window.Razorpay)
      return
    }
    const script = document.createElement('script')
    script.src = RAZORPAY_SCRIPT_URL
    script.onload = () => resolve(window.Razorpay)
    script.onerror = () => reject(new Error('Could not load Razorpay checkout.'))
    document.body.appendChild(script)
  })
}

export default function BillingPage() {
  const [checkoutError, setCheckoutError] = useState(null)

  const {
    data: subscription,
    isLoading: subLoading,
    isError: subError,
    error: subErrorObj,
    refetch: refetchSubscription,
  } = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: async () => (await api.get('/api/billing/subscription')).data,
  })

  const { data: plans, isLoading: plansLoading, isError: plansError, error: plansErrorObj, refetch: refetchPlans } = useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: async () => (await api.get('/api/billing/plans')).data,
  })

  const checkout = useMutation({
    mutationFn: async (planId) => (await api.post('/api/billing/checkout', { planId })).data,
    onSuccess: async (data) => {
      setCheckoutError(null)
      try {
        await loadRazorpayScript()
        const rzp = new window.Razorpay({
          key: data.keyId,
          subscription_id: data.razorpaySubscriptionId,
          name: 'Cephei Serverless',
          handler: () => {
            refetchSubscription()
          },
        })
        rzp.open()
      } catch (err) {
        setCheckoutError(err.message || 'Could not open the checkout window.')
      }
    },
    onError: (err) => {
      setCheckoutError(apiErrorMessage(err, 'Checkout is not available right now.'))
    },
  })

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Billing</h1>
        <p className="text-sm text-slate-500">Your subscription and usage.</p>
      </div>

      <div className="card flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-slate-900">Current plan</h3>
        {subLoading ? <Spinner label="Loading subscription…" /> : null}
        {subError ? (
          <ErrorBanner message={apiErrorMessage(subErrorObj, 'Could not load subscription.')} onRetry={refetchSubscription} />
        ) : null}
        {!subLoading && !subError ? (
          subscription ? (
            <dl className="grid grid-cols-2 gap-y-2 text-sm sm:grid-cols-4">
              <dt className="text-slate-500">Plan</dt>
              <dd className="text-slate-800">{subscription.plan?.name}</dd>
              <dt className="text-slate-500">Status</dt>
              <dd>
                <Badge tone={toneForStatus(subscription.status)}>{subscription.status}</Badge>
              </dd>
              <dt className="text-slate-500">Price</dt>
              <dd className="text-slate-800">
                {formatPaiseAsRupees(subscription.plan?.priceInPaise)} / {subscription.plan?.interval}
              </dd>
              <dt className="text-slate-500">Renews</dt>
              <dd className="text-slate-800">{formatDate(subscription.currentPeriodEnd)}</dd>
              <dt className="text-slate-500">Project limit</dt>
              <dd className="text-slate-800">{subscription.plan?.maxProjects}</dd>
              <dt className="text-slate-500">Deploys / month</dt>
              <dd className="text-slate-800">{subscription.plan?.maxDeploysPerMonth}</dd>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">You're not subscribed to a plan yet. Pick one below.</p>
          )
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-slate-900">Plans</h3>
        {checkoutError ? <ErrorBanner message={checkoutError} /> : null}
        {plansLoading ? <Spinner label="Loading plans…" /> : null}
        {plansError ? (
          <ErrorBanner message={apiErrorMessage(plansErrorObj, 'Could not load plans.')} onRetry={refetchPlans} />
        ) : null}
        {!plansLoading && !plansError ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {(plans || []).map((plan) => {
              const isCurrent = subscription?.plan?.key === plan.key && subscription?.status === 'active'
              return (
                <div key={plan._id} className="card flex flex-col gap-3">
                  <h4 className="text-base font-semibold text-slate-900">{plan.name}</h4>
                  <p className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-slate-900">{formatPaiseAsRupees(plan.priceInPaise)}</span>
                    <span className="text-xs text-slate-500">/ {plan.interval}</span>
                  </p>
                  <ul className="flex-1 text-sm text-slate-600">
                    <li>Up to {plan.maxProjects} projects</li>
                    <li>{plan.maxDeploysPerMonth} deploys / month</li>
                  </ul>
                  <button
                    className="btn-primary w-full"
                    disabled={isCurrent || checkout.isPending}
                    onClick={() => checkout.mutate(plan._id)}
                  >
                    {isCurrent ? 'Current plan' : checkout.isPending ? 'Starting checkout…' : 'Subscribe'}
                  </button>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}
