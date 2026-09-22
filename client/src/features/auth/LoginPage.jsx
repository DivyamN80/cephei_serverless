import React, { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth-context.jsx'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const from = location.state?.from?.pathname || '/app'

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const result = await login(email, password)
    setSubmitting(false)
    if (result.ok) {
      navigate(from, { replace: true })
    } else {
      setError(result.error)
    }
  }

  async function handleDemoLogin(demoEmail, demoPassword, destination) {
    setSubmitting(true)
    setError(null)
    const result = await login(demoEmail, demoPassword)
    setSubmitting(false)
    if (result.ok) {
      navigate(destination, { replace: true })
    } else {
      setError(result.error)
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Log in</h1>
        <p className="mt-1 text-sm text-slate-500">Welcome back to Cephei Serverless.</p>
      </div>
      <form onSubmit={handleSubmit} className="card flex flex-col gap-4">
        {error ? (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200">
            {error}
          </div>
        ) : null}
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="text-center text-sm text-slate-500">
        Don't have an account?{' '}
        <Link to="/register" className="font-semibold text-brand-600 hover:text-brand-700">
          Sign up
        </Link>
      </p>

      {import.meta.env.DEV ? (
        <div className="card flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Dev only — demo login
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              className="btn-secondary flex-1"
              disabled={submitting}
              onClick={() => handleDemoLogin('demo@cephei.dev', 'Demo12345!', from)}
            >
              Log in as user
            </button>
            <button
              type="button"
              className="btn-secondary flex-1"
              disabled={submitting}
              onClick={() => handleDemoLogin('demo-admin@cephei.dev', 'DemoAdmin12345!', '/admin')}
            >
              Log in as admin
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
