import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/lib/auth'
import { Landing } from '@/pages/Landing'
import { Login, Signup } from '@/pages/Login'
import { AppLayout } from '@/pages/app/AppLayout'
import { Dashboard } from '@/pages/app/Dashboard'
import { CommandCenter } from '@/pages/app/CommandCenter'
import { ActivityLog } from '@/pages/app/ActivityLog'
import { FinancePage, HrPage, ProcurementPage, QualityPage, SupplyPage } from '@/pages/app/Departments'
import { SettingsPage } from '@/pages/app/Settings'
import { Insights } from '@/pages/app/Insights'
import { CompanyFeed } from '@/pages/app/CompanyFeed'
import { Approvals } from '@/pages/app/Approvals'
import { AdminPanel } from '@/pages/app/Admin'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="commands" element={<CommandCenter />} />
            <Route path="feed" element={<CompanyFeed />} />
            <Route path="approvals" element={<Approvals />} />
            <Route path="insights" element={<Insights />} />
            <Route path="finance" element={<FinancePage />} />
            <Route path="hr" element={<HrPage />} />
            <Route path="procurement" element={<ProcurementPage />} />
            <Route path="supply" element={<SupplyPage />} />
            <Route path="quality" element={<QualityPage />} />
            <Route path="activity" element={<ActivityLog />} />
            <Route path="admin" element={<AdminPanel />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
