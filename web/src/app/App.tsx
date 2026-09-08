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
import { KYCPage } from '../features/kyc/KYCPage'
import { OrganizationPage } from '../features/organization/OrganizationPage'
import { PlatformDashboardPage } from '../features/platform/PlatformDashboardPage'
import { PlatformOrganizationsPage } from '../features/platform/PlatformOrganizationsPage'
import { Organization360Page } from '../features/platform/Organization360Page'
import { PlatformUsersPage } from '../features/platform/PlatformUsersPage'
import { PlatformTransactionsPage } from '../features/platform/PlatformTransactionsPage'
import { PlatformBalancesPage } from '../features/platform/PlatformBalancesPage'
import { PlatformProcessorsPage } from '../features/platform/PlatformProcessorsPage'
import { PlatformKYCPage } from '../features/platform/PlatformKYCPage'
import { PlatformPricingPage } from '../features/platform/PlatformPricingPage'
import { useSession } from './session'

export function App() {
  const { loading, authenticated } = useSession()
  if (loading) return <main className="boot-screen"><BrandMark className="brand-mark-large" /><div><strong>Flash Pag</strong><span>Carregando sua operação…</span></div></main>
  if (!authenticated) return <LoginPage />

  return <Routes>
    <Route element={<AppShell />}>
      <Route index element={<HomePage />} />
      <Route path="transactions" element={<TransactionsPage />} />
      <Route path="accounts" element={<AccountsPage />} />
      <Route path="customers" element={<CustomersPage />} />
      <Route path="api-keys" element={<ApiKeysPage />} />
      <Route path="webhooks" element={<WebhooksPage />} />
      <Route path="docs" element={<DocsPage />} />
      <Route path="kyc" element={<KYCPage />} />
      <Route path="connections" element={<ConnectionsPage />} />
      <Route path="organization" element={<OrganizationPage />} />
      <Route path="platform" element={<PlatformDashboardPage />} />
      <Route path="platform/organizations" element={<PlatformOrganizationsPage />} />
      <Route path="platform/organizations/:organizationId" element={<Organization360Page />} />
      <Route path="platform/users" element={<PlatformUsersPage />} />
      <Route path="platform/transactions" element={<PlatformTransactionsPage />} />
      <Route path="platform/balances" element={<PlatformBalancesPage />} />
      <Route path="platform/processors" element={<PlatformProcessorsPage />} />
      <Route path="platform/kyc" element={<PlatformKYCPage />} />
      <Route path="platform/pricing" element={<PlatformPricingPage />} />
      <Route path="platform/finance" element={<Navigate to="/platform" replace />} />
      <Route path="platform/merchants/:merchantId" element={<Navigate to="/platform/organizations" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Routes>
}
