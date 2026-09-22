import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import api, { setAccessToken, apiErrorMessage } from './api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [subscription, setSubscription] = useState(null)
  const [status, setStatus] = useState('loading') // loading | authenticated | anonymous

  const loadMe = useCallback(async () => {
    try {
      const res = await api.get('/api/auth/me')
      setUser(res.data.user)
      setSubscription(res.data.subscription ?? null)
      setStatus('authenticated')
      return res.data.user
    } catch (err) {
      setUser(null)
      setSubscription(null)
      setStatus('anonymous')
      return null
    }
  }, [])

  // On first mount, try a silent refresh (cookie may still be valid) then
  // load the current user. If there's no cookie this just resolves anonymous.
  useEffect(() => {
    ;(async () => {
      try {
        const res = await api.post('/api/auth/refresh')
        setAccessToken(res.data.accessToken)
        await loadMe()
      } catch {
        setAccessToken(null)
        setStatus('anonymous')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const login = useCallback(
    async (email, password) => {
      try {
        const res = await api.post('/api/auth/login', { email, password })
        setAccessToken(res.data.accessToken)
        setUser(res.data.user)
        setStatus('authenticated')
        await loadMe()
        return { ok: true }
      } catch (err) {
        return { ok: false, error: apiErrorMessage(err, 'Login failed. Check your credentials.') }
      }
    },
    [loadMe],
  )

  const register = useCallback(
    async (email, password, name) => {
      try {
        const res = await api.post('/api/auth/register', { email, password, name })
        setAccessToken(res.data.accessToken)
        setUser(res.data.user)
        setStatus('authenticated')
        await loadMe()
        return { ok: true }
      } catch (err) {
        return { ok: false, error: apiErrorMessage(err, 'Registration failed.') }
      }
    },
    [loadMe],
  )

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout')
    } catch {
      // ignore network errors on logout
    }
    setAccessToken(null)
    setUser(null)
    setSubscription(null)
    setStatus('anonymous')
  }, [])

  const value = {
    user,
    subscription,
    status,
    isAuthenticated: status === 'authenticated' && !!user,
    isLoading: status === 'loading',
    login,
    register,
    logout,
    refreshMe: loadMe,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}

export function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-500">
        Loading…
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return children
}

export function AdminRoute({ children }) {
  const { isAuthenticated, isLoading, user } = useAuth()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-500">
        Loading…
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (user?.role !== 'admin') {
    return <Navigate to="/app" replace />
  }

  return children
}
