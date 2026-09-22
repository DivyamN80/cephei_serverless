import React from 'react'
import { Link, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth-context.jsx'

export default function PublicLayout() {
  const { isAuthenticated } = useAuth()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              λ
            </span>
            Cephei Serverless
          </Link>
          <nav className="flex items-center gap-3">
            {isAuthenticated ? (
              <Link to="/app" className="btn-primary">
                Go to dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className="btn-secondary">
                  Log in
                </Link>
                <Link to="/register" className="btn-primary">
                  Get started
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 py-8 text-center text-sm text-slate-500">
        © {new Date().getFullYear()} Cephei Serverless. Your infrastructure stays in your own cloud account.
      </footer>
    </div>
  )
}
