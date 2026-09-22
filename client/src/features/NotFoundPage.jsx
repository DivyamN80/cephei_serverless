import React from 'react'
import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-4xl font-bold text-slate-900">404</h1>
      <p className="text-slate-500">This page doesn't exist.</p>
      <Link to="/" className="btn-primary">
        Back home
      </Link>
    </div>
  )
}
