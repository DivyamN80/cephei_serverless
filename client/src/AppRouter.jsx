import React from 'react'
import { Routes, Route } from 'react-router-dom'
import { ProtectedRoute, AdminRoute } from './lib/auth-context.jsx'

import PublicLayout from './layouts/PublicLayout.jsx'
import PortalLayout from './layouts/PortalLayout.jsx'
import AdminLayout from './layouts/AdminLayout.jsx'

import LandingPage from './features/landing/LandingPage.jsx'
import LoginPage from './features/auth/LoginPage.jsx'
import RegisterPage from './features/auth/RegisterPage.jsx'

import PortalOverviewPage from './features/portal/overview/PortalOverviewPage.jsx'
import ProjectListPage from './features/portal/ProjectListPage.jsx'
import NewProjectFlow from './features/portal/NewProjectFlow.jsx'
import ProjectDetailPage from './features/portal/ProjectDetailPage.jsx'
import BillingPage from './features/portal/billing/BillingPage.jsx'
import AwsAccountsPage from './features/portal/aws-accounts/AwsAccountsPage.jsx'

import OverviewPage from './features/admin/OverviewPage.jsx'
import SubscribersTable from './features/admin/SubscribersTable.jsx'
import SubscriberDetailPage from './features/admin/SubscriberDetailPage.jsx'
import SystemHealthPage from './features/admin/SystemHealthPage.jsx'

import NotFoundPage from './features/NotFoundPage.jsx'

export default function AppRouter() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route
        element={
          <ProtectedRoute>
            <PortalLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/app" element={<PortalOverviewPage />} />
        <Route path="/app/projects" element={<ProjectListPage />} />
        <Route path="/app/new" element={<NewProjectFlow />} />
        <Route path="/app/projects/:id" element={<ProjectDetailPage />} />
        <Route path="/app/billing" element={<BillingPage />} />
        <Route path="/app/aws-accounts" element={<AwsAccountsPage />} />
      </Route>

      <Route
        element={
          <AdminRoute>
            <AdminLayout />
          </AdminRoute>
        }
      >
        <Route path="/admin" element={<OverviewPage />} />
        <Route path="/admin/subscribers" element={<SubscribersTable />} />
        <Route path="/admin/subscribers/:id" element={<SubscriberDetailPage />} />
        <Route path="/admin/system-health" element={<SystemHealthPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
