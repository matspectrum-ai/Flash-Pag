import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { BrandMark } from '../components/brand/BrandMark'
import { LoginPage } from '../features/auth/LoginPage'
import { ConnectionsPage } from '../features/connections/ConnectionsPage'
import { HomePage } from '../features/home/HomePage'
import { TransactionsPage } from '../features/transactions/TransactionsPage'
import { AccountsPage } from '../features/accounts/AccountsPage'
import { useSession } from './session'

const labels: Record<string, string> = {
  customers: 'Clientes',
  'api-keys': 'API Keys',
  webhooks: 'Webhooks',
  docs: 'Documentação',
  organization: 'Organização',
  platform: 'Plataforma',
}

function MigrationPlaceholder({ name }: { name: keyof typeof labels }) {
  return (
    <section className="panel migration-placeholder">
      <span className="eyebrow">Migração React</span>
      <h2>{labels[name]}</h2>
      <p>Esta área está sendo reconstruída na nova arquitetura. O produto atual permanece disponível na branch estável até atingirmos paridade funcional.</p>
    </section>
  )
}

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
        <Route path="customers" element={<MigrationPlaceholder name="customers" />} />
        <Route path="api-keys" element={<MigrationPlaceholder name="api-keys" />} />
        <Route path="webhooks" element={<MigrationPlaceholder name="webhooks" />} />
        <Route path="docs" element={<MigrationPlaceholder name="docs" />} />
        <Route path="connections" element={<ConnectionsPage />} />
        <Route path="organization" element={<MigrationPlaceholder name="organization" />} />
        <Route path="platform" element={<MigrationPlaceholder name="platform" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
