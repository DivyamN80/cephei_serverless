import React, { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import api, { apiErrorMessage } from '../../../lib/api.js'
import { ErrorBanner } from '../../../components/ui.jsx'

export default function RollbackPanel({ projectId, rollback, onRolledBack }) {
  const [confirmingVersion, setConfirmingVersion] = useState(null)

  const doRollback = useMutation({
    mutationFn: async (toVersion) => (await api.post(`/api/projects/${projectId}/rollback`, { toVersion })).data,
    onSuccess: () => {
      setConfirmingVersion(null)
      onRolledBack?.()
    },
  })

  if (!rollback) return null

  return (
    <div className="card flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-slate-900">Rollback</h3>
      <div className="text-sm text-slate-600">
        Current live version: <span className="font-semibold text-slate-900">{rollback.currentVersion}</span>
      </div>

      {doRollback.isError ? (
        <ErrorBanner message={apiErrorMessage(doRollback.error, 'Rollback failed.')} />
      ) : null}

      {!rollback.canRollback ? (
        <p className="text-sm text-slate-500">No earlier versions available to roll back to.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(rollback.previousVersions || []).map((version) => {
            const versionLabel = typeof version === 'object' ? version.version ?? version.lambdaVersion : version
            return (
              <li
                key={versionLabel}
                className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <span className="text-slate-700">Version {versionLabel}</span>
                {confirmingVersion === versionLabel ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Roll back to this version?</span>
                    <button
                      className="btn-danger !px-3 !py-1 text-xs"
                      disabled={doRollback.isPending}
                      onClick={() => doRollback.mutate(versionLabel)}
                    >
                      {doRollback.isPending ? 'Rolling back…' : 'Confirm'}
                    </button>
                    <button className="btn-secondary !px-3 !py-1 text-xs" onClick={() => setConfirmingVersion(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button className="btn-secondary !px-3 !py-1 text-xs" onClick={() => setConfirmingVersion(versionLabel)}>
                    Roll back to this version
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
