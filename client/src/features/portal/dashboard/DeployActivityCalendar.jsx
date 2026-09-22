import React, { useMemo } from 'react'

// GitHub's own contribution-graph green ramp — used verbatim here because
// the user specifically asked for "the github color", not the app's system
// palette. Level 0 is the neutral "no activity" cell.
const LEVEL_COLORS = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39']
const CELL = 11 // px
const GAP = 3 // px
const WEEKS = 53 // a full rolling year, GitHub's own default window

function dateKey(d) {
  return d.toISOString().slice(0, 10)
}

function buildWeeks() {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - (WEEKS * 7 - 1))
  start.setUTCDate(start.getUTCDate() - start.getUTCDay()) // back up to the preceding Sunday

  const weeks = []
  let cursor = new Date(start)
  while (cursor <= today) {
    const week = []
    for (let dow = 0; dow < 7; dow++) {
      week.push(cursor > today ? null : new Date(cursor))
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}

function monthLabelsFor(weeks) {
  let lastMonth = null
  return weeks.map((week) => {
    const firstDay = week.find(Boolean)
    if (!firstDay) return null
    const month = firstDay.getUTCMonth()
    if (month === lastMonth) return null
    lastMonth = month
    return firstDay.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  })
}

// Relative (quartile) buckets rather than fixed absolute counts, so a young
// project with a max of 2 deploys/day still shows visible color variation
// instead of every active day looking identical.
function buildLevelFn(counts) {
  const nonZero = [...counts.values()].filter((c) => c > 0).sort((a, b) => a - b)
  const q = (p) => (nonZero.length ? nonZero[Math.min(nonZero.length - 1, Math.floor(p * nonZero.length))] : 0)
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)]
  return (count) => {
    if (count <= 0) return 0
    if (count <= q1) return 1
    if (count <= q2) return 2
    if (count <= q3) return 3
    return 4
  }
}

export default function DeployActivityCalendar({ deploys }) {
  const { weeks, monthLabels, counts, levelFor, total } = useMemo(() => {
    const weeks = buildWeeks()
    const counts = new Map()
    for (const d of deploys || []) {
      if (!d.startedAt) continue
      const key = dateKey(new Date(d.startedAt))
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return {
      weeks,
      monthLabels: monthLabelsFor(weeks),
      counts,
      levelFor: buildLevelFn(counts),
      total: [...counts.values()].reduce((s, c) => s + c, 0),
    }
  }, [deploys])

  const colWidth = CELL + GAP

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Deploy activity</h4>
        <span className="text-xs text-slate-400">{total} deploys in the last year</span>
      </div>
      <div className="overflow-x-auto pb-1">
        <div style={{ width: weeks.length * colWidth }}>
          <div className="flex" style={{ height: 14 }}>
            {monthLabels.map((label, i) => (
              <div key={i} style={{ width: colWidth }} className="shrink-0 text-[10px] text-slate-400">
                {label || ''}
              </div>
            ))}
          </div>
          <div className="flex" style={{ gap: GAP }}>
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col" style={{ gap: GAP }}>
                {week.map((day, di) => {
                  if (!day) return <div key={di} style={{ width: CELL, height: CELL }} />
                  const key = dateKey(day)
                  const count = counts.get(key) || 0
                  const label = day.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    timeZone: 'UTC',
                  })
                  return (
                    <div
                      key={di}
                      title={`${count} deploy${count === 1 ? '' : 's'} on ${label}`}
                      style={{ width: CELL, height: CELL, backgroundColor: LEVEL_COLORS[levelFor(count)] }}
                      className="rounded-[2px]"
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5 text-[10px] text-slate-400">
        Less
        {LEVEL_COLORS.map((color) => (
          <span key={color} className="rounded-[2px]" style={{ width: CELL, height: CELL, backgroundColor: color }} />
        ))}
        More
      </div>
    </div>
  )
}
