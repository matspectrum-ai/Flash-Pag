import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { BrandMark } from '../components/brand/BrandMark'
import { LoginPage } from '../features/auth/LoginPage'
import { ConnectionsPage } from '../features/connections/ConnectionsPage'
import { HomePage } from '../features/home/HomePage'
import { TransactionsPage } from '../features/transactions/TransactionsPage'
import { AccountsPage } from '../features/accounts/AccountsPage'
import { CustomersPage } from '../features/customers/CustomersPage'
import { ApiKeysPage } from '../features/api-keys/ApiKeysPage'
import { WebhooksPage } from '../features/webhooks/WebhooksPage'
import { DocsPage } from '../features/docs/DocsPage'
import { OrganizationPage } from '../features/organization/OrganizationPage'
import { PlatformPage } from '../features/platform/PlatformPage'
import { useSession } from './session'

export function App() {
  const { loading, authenticated } = useSession()

  if (loading) {
    return (
      <main className="boot-screen">
        <BrandMark className="brand-mark-large" />
        <div><strong>Flash Pag</strong><span>Carregando sua operação…</span></div>
      </main>
    )
  }

  if (!authenticated) return <LoginPage />

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="api-keys" element={<ApiKeysPage />} />
        <Route path="webhooks" element={<WebhooksPage />} />
        <Route path="docs" element={<DocsPage />} />
        <Route path="connections" element={<ConnectionsPage />} />
        <Route path="organization" element={<OrganizationPage />} />
        <Route path="platform" element={<PlatformPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
