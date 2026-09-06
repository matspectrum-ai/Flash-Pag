export type Merchant = {
  id: string
  name: string
  status: string
  created_at?: string
}

export type Organization = {
  id: string
  merchant_id: string
  name: string
  slug: string
  status: string
  created_at?: string
}

export type CurrentUser = {
  id: string
  email: string
  platform_admin: boolean
}

export type MeResponse = {
  user: CurrentUser
  merchants: Merchant[]
  organizations: Organization[]
  installed_providers: string[]
}

export type Account = {
  id: string
  name: string
  currency: string
  status: string
  is_default: boolean
  created_at?: string
}

export type Balance = {
  available_minor?: number
  reserved_minor?: number
  clearing_minor?: number
  total_minor?: number
  available?: number
  reserved?: number
  clearing?: number
  total?: number
}

export type Transaction = {
  id: string
  account_id?: string
  customer_id?: string
  provider_connection_id?: string | null
  provider_code?: string
  provider_external_id?: string | null
  kind: string
  direction?: string
  status: string
  amount_minor: number
  currency: string
  description?: string
  pix_key?: string
  failure_code?: string | null
  failure_message?: string | null
  created_at: string
  updated_at?: string
}

export type Customer = {
  id: string
  external_id?: string
  name?: string
  email?: string
  document?: string
  created_at?: string
  updated_at?: string
}

export type ProviderConnection = {
  id: string
  provider_code: string
  label: string
  config?: Record<string, unknown>
  status: string
  created_at?: string
  updated_at?: string
}

export type ApiKey = {
  id: string
  name: string
  prefix: string
  scopes: string[]
  last_used_at?: string | null
  revoked_at?: string | null
  created_at?: string
}

export type WebhookEndpoint = {
  id: string
  url: string
  description?: string
  events: string[]
  status: string
  created_at?: string
}

export type SummaryResponse = {
  account: Account
  balance: Balance
  recent_transactions: Transaction[]
}

export type ListResponse<T> = {
  data: T[]
}

export type TransferInput = {
  account_id?: string
  amount_minor: number
  currency: 'BRL'
  pix_key: string
  description?: string
  provider?: string
  provider_connection_id?: string
}

export type ApiErrorShape = {
  error?: {
    code?: string
    message?: string
  }
}
