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

export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer'

export type OrganizationAccess = {
  organization_id: string
  role: MemberRole | 'platform_admin' | string
  can_manage: boolean
  can_manage_members: boolean
  can_manage_admins: boolean
  can_manage_integrations: boolean
  can_view_sensitive_config: boolean
  can_create_customer: boolean
  can_write_operational: boolean
}

export type MerchantMember = {
  user_id: string
  email: string
  role: MemberRole
  created_at?: string
}

export type MemberInput = {
  email: string
  role: MemberRole
}

export type KYCStatus = 'draft' | 'submitted' | 'under_review' | 'needs_changes' | 'approved' | 'rejected'
export type KYCDocumentType = 'articles_of_association' | 'cnpj_card' | 'representative_id' | 'address_proof' | 'ownership_document' | 'bank_proof' | 'other'

export type KYCProfile = {
  merchant_id: string
  status: KYCStatus
  legal_name?: string | null
  trade_name?: string | null
  tax_id?: string | null
  incorporation_date?: string | null
  company_email?: string | null
  company_phone?: string | null
  address_line1?: string | null
  address_line2?: string | null
  district?: string | null
  city?: string | null
  state?: string | null
  postal_code?: string | null
  country?: string | null
  representative_name?: string | null
  representative_document?: string | null
  representative_birth_date?: string | null
  representative_role?: string | null
  representative_email?: string | null
  representative_phone?: string | null
  public_note?: string | null
  created_at: string
  updated_at: string
  submitted_at?: string | null
  reviewed_at?: string | null
  approved_at?: string | null
  rejected_at?: string | null
}

export type KYCProfileInput = {
  legal_name: string
  trade_name: string
  tax_id: string
  incorporation_date: string
  company_email: string
  company_phone: string
  address_line1: string
  address_line2: string
  district: string
  city: string
  state: string
  postal_code: string
  country: string
  representative_name: string
  representative_document: string
  representative_birth_date: string
  representative_role: string
  representative_email: string
  representative_phone: string
}

export type KYCDocument = {
  id: string
  merchant_id: string
  document_type: KYCDocumentType
  original_name: string
  mime_type: string
  size_bytes: number
  sha256: string
  status: 'pending' | 'accepted' | 'needs_changes' | 'rejected'
  admin_feedback?: string | null
  version: number
  is_current: boolean
  uploaded_at: string
  replaced_at?: string | null
}

export type KYCEvent = {
  id: string
  event_type: string
  from_status?: string | null
  to_status?: string | null
  metadata?: Record<string, unknown>
  created_at: string
}

export type KYCResponse = {
  profile: KYCProfile
  documents: KYCDocument[]
  events: KYCEvent[]
  required_documents: KYCDocumentType[]
}

export type PlatformKYCRow = {
  merchant_id: string
  merchant_name: string
  merchant_status: string
  kyc_status: KYCStatus | null
  tax_id?: string | null
  legal_name?: string | null
  company_email?: string | null
  submitted_at?: string | null
  updated_at?: string | null
  document_count: number
}

export type KYCReview = {
  id: string
  reviewer_user_id?: string | null
  reviewer_email?: string | null
  action: string
  public_note?: string | null
  internal_note?: string | null
  created_at: string
}

export type AdminKYCDetail = {
  merchant: Merchant
  profile: KYCProfile
  documents: KYCDocument[]
  reviews: KYCReview[]
  events: KYCEvent[]
}

export type RegisterResult = {
  ok: boolean
  authenticated: boolean
  requires_email_confirmation: boolean
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
  fee_minor?: number
  provider_cost_minor?: number | null
  pricing_version_id?: string
  pricing_version?: number
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
  metadata?: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

export type CustomerInput = {
  external_id?: string
  name?: string
  email?: string
  document?: string
  metadata?: Record<string, unknown>
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

export type ProviderConnectionInput = {
  provider: string
  label: string
  credentials?: Record<string, unknown>
  config?: Record<string, unknown>
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

export type CreatedApiKey = ApiKey & {
  secret: string
}

export type ApiKeyInput = {
  name: string
  scopes?: string[]
}

export type WebhookEndpoint = {
  id: string
  url: string
  description?: string
  events: string[]
  status: string
  created_at?: string
}

export type CreatedWebhookEndpoint = WebhookEndpoint & {
  secret: string
}

export type WebhookInput = {
  url: string
  description?: string
  events?: string[]
}

export type SummaryResponse = {
  account: Account
  balance: Balance
  recent_transactions: Transaction[]
}

export type ListResponse<T> = {
  data: T[]
}

export type AdminTenantInventory = {
  merchants: Merchant[]
  organizations: Organization[]
  merchants_complete: boolean
  organizations_complete: boolean
  complete: boolean
}

export type AdminMerchantMembersResponse = ListResponse<MerchantMember> & {
  complete: boolean
}

export type AdminMerchantInput = {
  name: string
  owner_user_id?: string
}

export type AdminOrganizationInput = {
  merchant_id: string
  name: string
  slug: string
}

export type AdminProvisionOrganizationInput = {
  name: string
  slug: string
  owner_user_id?: string
}

export type AdminProvisionOrganizationResult = {
  organization: Organization
  account: Account
}

export type ApiErrorShape = {
  error?: {
    code?: string
    message?: string
    missing?: string[]
  }
}
