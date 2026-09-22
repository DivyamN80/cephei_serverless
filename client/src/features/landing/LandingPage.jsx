import React from 'react'
import { Link } from 'react-router-dom'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import {
  Cloud,
  Gauge,
  RotateCcw,
  CheckCircle2,
  TrendingUp,
  Lock,
  ArrowRight,
  Sparkles,
} from 'lucide-react'
import PricingSection from './PricingSection.jsx'
import { CLOUD_PROVIDERS } from '../../lib/cloudProviders.js'

// Reference-palette blue (categorical slot 1) — kept the same everywhere the
// product charts invocations/cost, including this purely illustrative
// preview so the hero doesn't introduce a color the app never uses again.
const COLOR_BLUE = '#2a78d6'

// Static, illustrative only — not tied to any real account's data. Gives the
// hero's "product preview" card a believable trend line without pretending
// it's live.
const PREVIEW_SERIES = [4, 5, 4.5, 6, 5.5, 7, 6.5, 8, 7.5, 9, 8.5, 10, 9.5, 11].map((v, i) => ({ i, v }))

const STEPS = [
  {
    title: 'Connect repo',
    description: "Paste your API's repo URL. We detect your stack and flag anything that needs attention before migrating.",
  },
  {
    title: 'See the diff & savings',
    description: 'Pick your traffic pattern and get a concrete before/after diff plus a projected monthly savings number.',
  },
  {
    title: 'Pick a cloud & deploy',
    description: 'AWS, Azure, or GCP — connect a scoped account on whichever you run. Nothing runs in ours — it deploys straight into yours.',
  },
  {
    title: 'Watch cost & latency live',
    description: 'A centralized dashboard tracks cost, p95 latency, cold starts and errors, with one-click rollback.',
  },
]

const FEATURES = [
  {
    icon: Cloud,
    title: 'Your choice of cloud',
    description: 'Deploy to AWS Lambda, Azure Functions, or GCP Cloud Functions — picked per project, always in your own account.',
  },
  {
    icon: Gauge,
    title: 'A real dashboard, not a promise',
    description: 'Cost, p95 latency, error rate, and cold starts, updated continuously across every project you run.',
  },
  {
    icon: RotateCcw,
    title: 'One-click rollback',
    description: 'Every deploy is versioned. If a release regresses, roll back to the last good version in seconds.',
  },
  {
    icon: CheckCircle2,
    title: 'Compatibility checklist',
    description: "Before you migrate, see exactly what won't translate — cron jobs, local disk, sticky sessions — up front.",
  },
  {
    icon: TrendingUp,
    title: 'Traffic-aware recommendations',
    description: 'Steady, spiky, or somewhere in between — get a target and a projected savings number matched to your load.',
  },
  {
    icon: Lock,
    title: 'Scoped, revocable access',
    description: 'A narrowly-scoped role you grant and can revoke at any time. No standing access to anything else in your account.',
  },
]

const STATS = [
  { value: '3 clouds', label: 'AWS, Azure, or GCP — your choice, per project' },
  { value: '100%', label: 'Of your infra stays in your own account' },
  { value: '1 click', label: 'To roll back a bad deploy' },
]

function PreviewChart() {
  return (
    <div className="h-16 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={PREVIEW_SERIES} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="fill-hero-preview" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLOR_BLUE} stopOpacity={0.3} />
              <stop offset="100%" stopColor={COLOR_BLUE} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={COLOR_BLUE} strokeWidth={2} fill="url(#fill-hero-preview)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function ProductPreviewCard() {
  return (
    <div className="mx-auto w-full max-w-md rounded-2xl bg-white p-2 shadow-xl ring-1 ring-slate-900/5">
      <div className="flex items-center gap-1.5 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
        <span className="ml-2 text-xs font-medium text-slate-400">order-service-api · dashboard</span>
        <span className={`ml-auto mr-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${CLOUD_PROVIDERS[0].badgeClass}`}>
          {CLOUD_PROVIDERS[0].name}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 px-3 pb-2">
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Projected savings</div>
          <div className="text-lg font-bold text-emerald-600">$220/mo</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">p95 latency</div>
          <div className="text-lg font-bold text-slate-900">184ms</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Error rate</div>
          <div className="text-lg font-bold text-slate-900">0.4%</div>
        </div>
      </div>
      <div className="rounded-lg bg-slate-50 px-3 pb-1 pt-2">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">Invocations (14d)</div>
        <PreviewChart />
      </div>
    </div>
  )
}

export default function LandingPage() {
  return (
    <div>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-20 sm:pt-24">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <div className="text-center lg:text-left">
            <div className="mb-5 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-200">
              <Sparkles className="h-3.5 w-3.5" />
              Deploy to AWS, Azure, or GCP — your choice
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              See what moving your API to serverless would actually save
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-lg text-slate-600 lg:mx-0">
              Connect your own cloud account — nothing runs in ours. Cephei Serverless migrates your
              containerized API to AWS Lambda, Azure Functions, or GCP Cloud Functions — whichever you
              run — and shows you the cost and performance difference, live.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row lg:justify-start">
              <Link to="/register" className="btn-primary w-full px-6 py-3 text-base sm:w-auto">
                Get started free
              </Link>
              <a href="#pricing" className="btn-secondary w-full px-6 py-3 text-base sm:w-auto">
                See pricing
              </a>
            </div>
            <p className="mt-4 text-xs text-slate-400">No credit card required for the free tier.</p>
          </div>
          <ProductPreviewCard />
        </div>
      </section>

      {/* Choose your cloud */}
      <section className="border-y border-slate-200 bg-white py-8">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center text-xs font-semibold uppercase tracking-wide text-slate-400">
            Deploy to any of the three
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {CLOUD_PROVIDERS.map((p) => (
              <div key={p.key} className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3">
                <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${p.badgeClass}`}>
                  {p.name}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">{p.fullName}</div>
                  <div className="truncate text-xs text-slate-500">{p.tagline}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Framework support strip */}
      <section className="border-b border-slate-200 bg-white py-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-2 px-6 text-sm font-medium text-slate-400">
          <span className="text-xs uppercase tracking-wide text-slate-400">Works with</span>
          {['NestJS', 'Express', 'FastAPI', 'Django', 'Flask', 'Rails'].map((name) => (
            <span key={name} className="text-slate-500">
              {name}
            </span>
          ))}
        </div>
      </section>

      {/* Stats band */}
      <section className="bg-slate-900 py-12">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-6 text-center sm:grid-cols-3">
          {STATS.map((stat) => (
            <div key={stat.label}>
              <div className="text-3xl font-bold text-white">{stat.value}</div>
              <div className="mt-1 text-sm text-slate-400">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Feature grid */}
      <section className="bg-white py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold text-slate-900">Everything you need to migrate with confidence</h2>
            <p className="mt-3 text-slate-500">Not just a diff — a full picture of what changes and what it costs.</p>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="card flex flex-col gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  <feature.icon className="h-5 w-5" strokeWidth={2} />
                </div>
                <h3 className="text-base font-semibold text-slate-900">{feature.title}</h3>
                <p className="text-sm text-slate-500">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-slate-200 bg-slate-50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold text-slate-900">How it works</h2>
          <div className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, idx) => (
              <div key={step.title} className="flex flex-col gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
                  {idx + 1}
                </div>
                <h3 className="text-base font-semibold text-slate-900">{step.title}</h3>
                <p className="text-sm text-slate-500">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <PricingSection />

      {/* Final CTA */}
      <section className="bg-brand-600">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 py-16 text-center">
          <h2 className="text-3xl font-bold text-white">Ready to see your number?</h2>
          <p className="max-w-xl text-brand-50">
            Connect a repo, pick your traffic pattern, and get a projected monthly cost before you commit to anything.
          </p>
          <Link to="/register" className="btn bg-white px-6 py-3 text-base text-brand-700 hover:bg-brand-50">
            Get started free
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  )
}
