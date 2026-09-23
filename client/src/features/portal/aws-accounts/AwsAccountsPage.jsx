import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp } from 'lucide-react'
import api, { apiErrorMessage } from '../../../lib/api.js'
import { Spinner, ErrorBanner, EmptyState, Badge, toneForStatus } from '../../../components/ui.jsx'
import { providerMeta } from '../../../lib/cloudProviders.js'

// The one identifier that best names the account on its own provider —
// AWS account ID, Azure subscription, or GCP project.
function accountIdentifier(account) {
  if (account.provider === 'azure') return account.azureSubscriptionId
  if (account.provider === 'gcp') return account.gcpProjectId
  return account.awsAccountId
}

const parseIdList = (raw) =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

export default function AwsAccountsPage() {
  const queryClient = useQueryClient()

  const [expandedId, setExpandedId] = useState(null)
  const [subnetIdsInput, setSubnetIdsInput] = useState('')
  const [securityGroupIdsInput, setSecurityGroupIdsInput] = useState('')

  const { data: accounts, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['customer-aws-accounts'],
    queryFn: async () => (await api.get('/api/customer-aws-accounts')).data,
  })

  const disconnect = useMutation({
    mutationFn: async (id) => (await api.post(`/api/customer-aws-accounts/${id}/disconnect`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customer-aws-accounts'] }),
  })

  const updateLambdaVpc = useMutation({
    mutationFn: async (id) =>
      (
        await api.patch(`/api/customer-aws-accounts/${id}`, {
          subnetIds: parseIdList(subnetIdsInput),
          securityGroupIds: parseIdList(securityGroupIdsInput),
        })
      ).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customer-aws-accounts'] }),
  })

  function toggleVpcPanel(account) {
    if (expandedId === account._id) {
      setExpandedId(null)
      return
    }
    setExpandedId(account._id)
    setSubnetIdsInput((account.lambdaVpc?.subnetIds || []).join(', '))
    setSecurityGroupIdsInput((account.lambdaVpc?.securityGroupIds || []).join(', '))
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Cloud accounts</h1>
          <p className="text-sm text-slate-500">
            Accounts we deploy into — AWS, Azure, or GCP. Everything runs in your own cloud infrastructure.
          </p>
        </div>
        <Link to="/app/new" className="btn-secondary">
          Connect via new project
        </Link>
      </div>

      {isLoading ? <Spinner label="Loading cloud accounts…" /> : null}
      {isError ? <ErrorBanner message={apiErrorMessage(error, 'Could not load cloud accounts.')} onRetry={refetch} /> : null}

      {!isLoading && !isError ? (
        accounts && accounts.length > 0 ? (
          <div className="card overflow-hidden !p-0">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Provider</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Account / Project</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Region</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accounts.map((account) => {
                  const meta = providerMeta(account.provider)
                  const isExpanded = expandedId === account._id
                  return (
                    <React.Fragment key={account._id}>
                      <tr>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${meta.badgeClass}`}>
                            {meta.name}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-800">{accountIdentifier(account) || '—'}</td>
                        <td className="px-4 py-3 text-sm text-slate-500">{account.region || '—'}</td>
                        <td className="px-4 py-3">
                          <Badge tone={toneForStatus(account.status)}>{account.status || 'pending'}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {account.provider === 'aws' ? (
                              <button
                                className="btn-secondary flex items-center gap-1 !px-3 !py-1.5 text-xs"
                                onClick={() => toggleVpcPanel(account)}
                              >
                                VPC settings
                                {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                              </button>
                            ) : null}
                            <button
                              className="btn-danger !px-3 !py-1.5 text-xs"
                              disabled={disconnect.isPending}
                              onClick={() => {
                                if (window.confirm('Disconnect this cloud account?')) {
                                  disconnect.mutate(account._id)
                                }
                              }}
                            >
                              Disconnect
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr>
                          <td colSpan={5} className="bg-slate-50 px-4 py-4">
                            <div className="flex flex-col gap-3">
                              <div>
                                <h4 className="text-sm font-semibold text-slate-900">
                                  Advanced: put this function inside a VPC
                                </h4>
                                <p className="mt-1 text-xs text-slate-500">
                                  Only needed if your database isn't publicly accessible. Lambda functions
                                  inside a VPC lose direct internet access unless a NAT gateway is attached —
                                  if your app calls any external API besides your database, make sure your
                                  subnets have one.
                                </p>
                              </div>
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div>
                                  <label className="label">Subnet IDs</label>
                                  <input
                                    className="input font-mono text-xs"
                                    placeholder="subnet-0123abcd0123abcd0, subnet-0456efgh..."
                                    value={subnetIdsInput}
                                    onChange={(e) => setSubnetIdsInput(e.target.value)}
                                  />
                                </div>
                                <div>
                                  <label className="label">Security group IDs</label>
                                  <input
                                    className="input font-mono text-xs"
                                    placeholder="sg-0123abcd0123abcd0"
                                    value={securityGroupIdsInput}
                                    onChange={(e) => setSecurityGroupIdsInput(e.target.value)}
                                  />
                                </div>
                              </div>
                              {updateLambdaVpc.isError ? (
                                <ErrorBanner
                                  message={apiErrorMessage(updateLambdaVpc.error, 'Could not save VPC settings.')}
                                />
                              ) : null}
                              <button
                                className="btn-primary self-start !px-3 !py-1.5 text-xs"
                                disabled={updateLambdaVpc.isPending}
                                onClick={() => updateLambdaVpc.mutate(account._id)}
                              >
                                {updateLambdaVpc.isPending ? 'Saving…' : 'Save VPC settings'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No cloud accounts connected"
            description="Connect an AWS, Azure, or GCP account from the new project flow to start deploying."
            action={
              <Link to="/app/new" className="btn-primary">
                Start a new project
              </Link>
            }
          />
        )
      ) : null}

      {disconnect.isError ? <ErrorBanner message={apiErrorMessage(disconnect.error, 'Could not disconnect account.')} /> : null}
    </div>
  )
}
