import type {
  AdminKYCDetail,
  AdminMerchantInput,
  AdminMerchantMembersResponse,
  AdminOrganizationInput,
  AdminTenantInventory,
  ApiErrorShape,
  ApiKeyInput,
  CreatedApiKey,
  CreatedWebhookEndpoint,
  Customer,
  CustomerInput,
  KYCProfile,
  KYCProfileInput,
  KYCResponse,
  KYCDocument,
  KYCDocumentType,
  ListResponse,
  MeResponse,
  MemberInput,
  MemberRole,
  Merchant,
  MerchantMember,
  Organization,
  OrganizationAccess,
  PlatformKYCRow,
  RegisterResult,
  SummaryResponse,
  Transaction,
  WebhookInput,
} from './types'

export class ApiError extends Error {
  status: number
  code?: string
  missing?: string[]

  constructor(message: string, status: number, code?: string, missing?: string[]) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.missing = missing
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!(init?.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers,
  })

  if (!response.ok) {
    let payload: ApiErrorShape | undefined
    try {
      payload = (await response.json()) as ApiErrorShape
    } catch {
      payload = undefined
    }
    throw new ApiError(
      payload?.error?.message || `Erro HTTP ${response.status}`,
      response.status,
      payload?.error?.code,
      payload?.error?.missing,
    )
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function withOrganization(path: string, organizationId: string) {
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}organization_id=${encodeURIComponent(organizationId)}`
}

export const api = {
  me: () => request<MeResponse>('/console/api/me'),
  register: (merchantName: string, email: string, password: string) =>
    request<RegisterResult>('/console/register', {
      method: 'POST',
      body: JSON.stringify({ merchant_name: merchantName, organization_name: merchantName, email, password }),
    }),
  login: (email: string, password: string) =>
    request<{ ok: boolean }>('/console/session', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>('/console/session', { method: 'DELETE' }),
  access: (organizationId: string) =>
    request<OrganizationAccess>(withOrganization('/console/api/access', organizationId)),
  summary: (organizationId: string) =>
    request<SummaryResponse>(withOrganization('/console/api/summary', organizationId)),
  list: <T>(resource: string, organizationId: string) =>
    request<ListResponse<T>>(withOrganization(`/console/api/${resource}`, organizationId)),
  transactions: (organizationId: string, limit = 1000) =>
    request<ListResponse<Transaction>>(withOrganization(`/console/api/transactions?limit=${Math.max(1, Math.min(1000, limit))}`, organizationId)),
  members: (organizationId: string) =>
    request<ListResponse<MerchantMember>>(withOrganization('/console/api/members', organizationId)),
  createMember: (organizationId: string, input: MemberInput) =>
    request<MerchantMember>(withOrganization('/console/api/members', organizationId), {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateMemberRole: (organizationId: string, userId: string, role: MemberRole) =>
    request<void>(withOrganization(`/console/api/members/${userId}`, organizationId), {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
  removeMember: (organizationId: string, userId: string) =>
    request<void>(withOrganization(`/console/api/members/${userId}`, organizationId), {
      method: 'DELETE',
    }),
  kyc: (organizationId: string) => request<KYCResponse>(withOrganization('/console/api/kyc', organizationId)),
  updateKYC: (organizationId: string, input: KYCProfileInput) =>
    request<KYCProfile>(withOrganization('/console/api/kyc', organizationId), {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  uploadKYCDocument: (organizationId: string, documentType: KYCDocumentType, file: File) => {
    const data = new FormData()
    data.append('file', file)
    return request<KYCDocument>(withOrganization(`/console/api/kyc/documents?type=${encodeURIComponent(documentType)}`, organizationId), {
      method: 'POST',
      body: data,
    })
  },
  kycDocumentURL: (organizationId: string, documentId: string) =>
    withOrganization(`/console/api/kyc/documents/${encodeURIComponent(documentId)}`, organizationId),
  submitKYC: (organizationId: string) =>
    request<KYCProfile>(withOrganization('/console/api/kyc/submit', organizationId), { method: 'POST', body: '{}' }),
  createCustomer: (organizationId: string, input: CustomerInput) =>
    request<Customer>(withOrganization('/console/api/customers', organizationId), {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  createAPIKey: (organizationId: string, input: ApiKeyInput) =>
    request<CreatedApiKey>(withOrganization('/console/api/api-keys', organizationId), {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  revokeAPIKey: (organizationId: string, keyId: string) =>
    request<void>(withOrganization(`/console/api/api-keys/${keyId}`, organizationId), {
      method: 'DELETE',
    }),
  createWebhook: (organizationId: string, input: WebhookInput) =>
    request<CreatedWebhookEndpoint>(withOrganization('/console/api/webhook-endpoints', organizationId), {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteWebhook: (organizationId: string, webhookId: string) =>
    request<void>(withOrganization(`/console/api/webhook-endpoints/${webhookId}`, organizationId), {
      method: 'DELETE',
    }),
  testConnection: (connectionId: string, organizationId: string) =>
    request<Record<string, unknown>>(
      withOrganization(`/console/api/provider-connections/${connectionId}/test`, organizationId),
      { method: 'POST', body: '{}' },
    ),
  reconcileTransaction: (transactionId: string, organizationId: string) =>
    request<Transaction>(
      withOrganization(`/console/api/transactions/${transactionId}/reconcile`, organizationId),
      { method: 'POST', body: '{}' },
    ),
  adminTenants: () => request<AdminTenantInventory>('/console/api/admin/tenants'),
  adminMerchantMembers: (merchantId: string) =>
    request<AdminMerchantMembersResponse>(`/console/api/admin/merchants/${encodeURIComponent(merchantId)}/members`),
  adminKYCQueue: () => request<ListResponse<PlatformKYCRow>>('/console/api/admin/kyc'),
  adminKYCDetail: (merchantId: string) => request<AdminKYCDetail>(`/console/api/admin/kyc/${encodeURIComponent(merchantId)}`),
  adminKYCStartReview: (merchantId: string, internalNote = '') =>
    request<KYCProfile>(`/console/api/admin/kyc/${encodeURIComponent(merchantId)}/review`, {
      method: 'POST',
      body: JSON.stringify({ internal_note: internalNote }),
    }),
  adminKYCDecision: (merchantId: string, decision: 'approved' | 'needs_changes' | 'rejected', publicNote: string, internalNote: string) =>
    request<KYCProfile>(`/console/api/admin/kyc/${encodeURIComponent(merchantId)}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, public_note: publicNote, internal_note: internalNote }),
    }),
  adminKYCDocumentURL: (merchantId: string, documentId: string) =>
    `/console/api/admin/kyc/${encodeURIComponent(merchantId)}/documents/${encodeURIComponent(documentId)}`,
  adminPricingDetail: (merchantId: string) =>
    request<Record<string, unknown>>(`/console/api/admin/pricing/${encodeURIComponent(merchantId)}`),
  adminSetPricing: (merchantId: string, input: unknown) =>
    request<Record<string, unknown>>(`/console/api/admin/pricing/${encodeURIComponent(merchantId)}`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  adminCreateMerchant: (input: AdminMerchantInput) =>
    request<Merchant>('/console/api/admin/merchants', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  adminCreateOrganization: (input: AdminOrganizationInput) =>
    request<Organization & { accounts?: unknown[] }>('/console/api/admin/organizations', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
}
