import React from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { formatNumber } from '../../../lib/format.js'
import { StatTile } from '../../../components/ui.jsx'

// Colors from the validated reference palette (dataviz skill):
// categorical slot 1 (blue) for invocations, slot 2 (orange) for latency,
// slot 3 (aqua) for errors — fixed order, never reassigned per-chart.
const COLOR_BLUE = '#2a78d6'
const COLOR_ORANGE = '#eb6834'
const COLOR_AQUA = '#1baf7a'
const GRID = '#e1e0d9'
const AXIS = '#898781'
const INK_SECONDARY = '#52514e'

function ChartTooltip({ active, payload, label, valueKey, valueLabel, color }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg">
      <div className="text-slate-300">{label}</div>
      <div className="mt-1 flex items-center gap-1.5 font-semibold">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        {valueLabel}: {formatNumber(payload[0]?.payload?.[valueKey])}
      </div>
    </div>
  )
}

function MiniAreaChart({ title, data, dataKey, color, valueLabel }) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`fill-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
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
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: AXIS, fontSize: 11 }}
              width={40}
            />
            <Tooltip content={<ChartTooltip valueKey={dataKey} valueLabel={valueLabel} color={color} />} />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              fill={`url(#fill-${dataKey})`}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default function LatencyErrorsPanel({ metrics }) {
  if (!metrics) return null
  const series = metrics.series || []

  return (
    <div className="card flex flex-col gap-6">
      <h3 className="text-sm font-semibold text-slate-900">Latency &amp; errors</h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Invocations" value={formatNumber(metrics.invocations)} />
        <StatTile label="Errors" value={formatNumber(metrics.errors)} />
        <StatTile label="p95 latency" value={metrics.p95Ms != null ? `${metrics.p95Ms} ms` : '—'} />
        <StatTile label="Cold starts" value={formatNumber(metrics.coldStarts)} />
      </div>
      <div className="text-xs text-slate-500">
        p50 {metrics.p50Ms ?? '—'}ms · p95 {metrics.p95Ms ?? '—'}ms · p99 {metrics.p99Ms ?? '—'}ms
      </div>

      {series.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <MiniAreaChart title="Invocations (14d)" data={series} dataKey="invocations" color={COLOR_BLUE} valueLabel="Invocations" />
          <MiniAreaChart title="p95 latency (14d)" data={series} dataKey="p95Ms" color={COLOR_ORANGE} valueLabel="p95 (ms)" />
          <MiniAreaChart title="Errors (14d)" data={series} dataKey="errors" color={COLOR_AQUA} valueLabel="Errors" />
        </div>
      ) : (
        <p style={{ color: INK_SECONDARY }} className="text-sm">
          Not enough data yet to chart a trend.
        </p>
      )}
    </div>
  )
}
