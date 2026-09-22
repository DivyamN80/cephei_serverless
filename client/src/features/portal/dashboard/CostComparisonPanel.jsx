import React from 'react'
import { formatUsd } from '../../../lib/format.js'
import { StatTile } from '../../../components/ui.jsx'

export default function CostComparisonPanel({ cost }) {
  if (!cost) return null

  const savings =
    cost.projectedMonthlyUsd != null && cost.actualLast30dUsd != null
      ? cost.projectedMonthlyUsd - cost.actualLast30dUsd
      : null

  return (
    <div className="card flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-slate-900">Cost</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Projected monthly" value={formatUsd(cost.projectedMonthlyUsd)} accent />
        <StatTile label="Actual (last 30d)" value={formatUsd(cost.actualLast30dUsd)} />
        <StatTile
          label="Delta"
          value={savings != null ? formatUsd(savings) : '—'}
          sub={savings != null ? (savings >= 0 ? 'under projection' : 'over projection') : undefined}
        />
      </div>
      {cost.note ? (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
          <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v3.75m0 3.75h.008v.008H12v-.008zM21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>
            <span className="font-medium">Heads up: </span>
            {cost.note}
            {!cost.costAllocationTagsEnabled ? ' Cost allocation tags aren’t enabled yet, so actuals may lag or be approximate.' : ''}
          </span>
        </div>
      ) : null}
    </div>
  )
}
