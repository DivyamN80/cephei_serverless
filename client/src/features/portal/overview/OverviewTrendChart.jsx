import React from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { formatNumber } from '../../../lib/format.js'

// Same validated reference-palette constants as the per-project
// LatencyErrorsPanel chart, so "invocations" keeps the same color (blue,
// categorical slot 1) everywhere it appears in the portal.
const COLOR_BLUE = '#2a78d6'
const GRID = '#e1e0d9'
const AXIS = '#898781'

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg">
      <div className="text-slate-300">{label}</div>
      <div className="mt-1 flex items-center gap-1.5 font-semibold">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLOR_BLUE }} />
        Invocations: {formatNumber(payload[0]?.payload?.invocations)}
      </div>
    </div>
  )
}

// A single-series area chart is exempt from needing a legend box — the
// panel title above it names the series (dataviz skill, interaction.md).
export default function OverviewTrendChart({ data }) {
  if (!data?.length) return null

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="fill-overview-invocations" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLOR_BLUE} stopOpacity={0.25} />
              <stop offset="100%" stopColor={COLOR_BLUE} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={{ stroke: GRID }}
            tick={{ fill: AXIS, fontSize: 11 }}
            minTickGap={24}
          />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: AXIS, fontSize: 11 }} width={48} />
          <Tooltip content={<ChartTooltip />} />
          <Area
            type="monotone"
            dataKey="invocations"
            stroke={COLOR_BLUE}
            strokeWidth={2}
            fill="url(#fill-overview-invocations)"
            dot={false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
