import React, { useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  FolderKanban,
  PlusCircle,
  CreditCard,
  Cloud,
  ShieldCheck,
  LogOut,
  Menu,
  X,
} from 'lucide-react'
import { useAuth } from '../lib/auth-context.jsx'
import { Avatar, Badge } from '../components/ui.jsx'

const NAV_SECTIONS = [
  {
    title: 'Overview',
    items: [{ to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    title: 'Workspace',
    items: [
      { to: '/app/projects', label: 'Projects', icon: FolderKanban },
      { to: '/app/new', label: 'New project', icon: PlusCircle },
    ],
  },
  {
    title: 'Account',
    items: [
      { to: '/app/billing', label: 'Billing', icon: CreditCard },
      { to: '/app/aws-accounts', label: 'Cloud accounts', icon: Cloud },
    ],
  },
]

const ALL_NAV_ITEMS = NAV_SECTIONS.flatMap((s) => s.items)

function SidebarLink({ to, label, icon: Icon, end, onNavigate }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
        }`
      }
    >
      {Icon ? <Icon className="h-4 w-4 shrink-0" strokeWidth={2} /> : null}
      {label}
    </NavLink>
  )
}

function SidebarContent({ user, onNavigate }) {
  return (
    <>
      <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-5 text-lg font-bold text-slate-900">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">λ</span>
        Cephei
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto p-3">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {section.title}
            </div>
            <div className="space-y-1">
              {section.items.map((item) => (
                <SidebarLink key={item.to} {...item} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ))}
        {user?.role === 'admin' ? (
          <div>
            <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Admin</div>
            <div className="space-y-1">
              <SidebarLink to="/admin" label="Admin console" icon={ShieldCheck} onNavigate={onNavigate} />
            </div>
          </div>
        ) : null}
      </nav>
      <div className="border-t border-slate-200 p-3">
        <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
          <Avatar name={user?.name} email={user?.email} size={32} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-800">{user?.name || user?.email}</div>
            <div className="truncate text-xs text-slate-500">{user?.email}</div>
          </div>
        </div>
      </div>
    </>
  )
}

export default function PortalLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  // Longest matching nav path wins, so /app/projects doesn't get labeled "Dashboard".
  const currentNavItem = [...ALL_NAV_ITEMS]
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)))
  const pageTitle = currentNavItem?.label || (location.pathname.startsWith('/admin') ? 'Admin console' : 'Cephei')

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <SidebarContent user={user} />
      </aside>

      {/* Mobile sidebar drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-xl">
            <button
              className="absolute right-3 top-4 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent user={user} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex h-16 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
          <button
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h2 className="text-sm font-semibold text-slate-900 sm:text-base">{pageTitle}</h2>
          <div className="ml-auto flex items-center gap-3 sm:gap-4">
            {user?.role === 'admin' ? <Badge tone="blue">Admin</Badge> : null}
            <span className="hidden text-sm text-slate-600 sm:inline">{user?.email}</span>
            <button onClick={handleLogout} className="btn-secondary gap-1.5">
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
