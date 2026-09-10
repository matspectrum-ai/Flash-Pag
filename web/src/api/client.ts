import type {
  AdminKYCDetail,
  AdminMerchantInput,
  AdminMerchantMembersResponse,
  AdminOrganizationInput,
  AdminProvisionOrganizationInput,
  AdminProvisionOrganizationResult,
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
  LoginResult,
  MFAChallenge,
  MFAEnrollment,
  MFAStatus,
  RecoveryChallenge,
  RecoverySetup,
  RecoveryStatus,
  MeResponse,
  MemberInput,
  MemberRole,
  Merchant,
  MerchantMember,
  Organization,
  OrganizationAccess,
  PlatformKYCRow,
  ProviderConnection,
  ProviderConnectionInput,
  RegisterResult,
  SummaryResponse,
  Transaction,
  WebhookInput,
  WithdrawalDestination,
  WithdrawalDestinationInput,
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
    request<LoginResult>('/console/session', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>('/console/session', { method: 'DELETE' }),
  mfaStatus: () => request<MFAStatus>('/console/mfa/status'),
  mfaEnroll: () => request<MFAEnrollment>('/console/mfa/enroll', { method: 'POST', body: '{}' }),
  mfaChallenge: (factorId?: string) => request<MFAChallenge>(`/console/mfa/challenge${factorId ? `?factor_id=${encodeURIComponent(factorId)}` : ''}`, { method: 'POST', body: '{}' }),
  mfaVerify: (input: { factor_id: string; challenge_id?: string; code: string }) => request<{ ok: boolean }>('/console/mfa/verify', { method: 'POST', body: JSON.stringify(input) }),
  mfaStepUpChallenge: () => request<MFAChallenge>('/console/mfa/step-up/challenge', { method: 'POST', body: '{}' }),
  mfaStepUpVerify: (input: MFAChallenge & { code: string }) => request<{ ok: boolean }>('/console/mfa/step-up/verify', { method: 'POST', body: JSON.stringify(input) }),
  recoveryStatus: () => request<RecoveryStatus>('/console/recovery/status'),
  recoverySetup: () => request<RecoverySetup>('/console/recovery/setup', { method: 'POST', body: '{}' }),
  recoveryChallenge: (identifier: string, kitBase64: string) => request<RecoveryChallenge>('/console/recovery/challenge', { method: 'POST', body: JSON.stringify({ identifier, kit_base64: kitBase64 }) }),
  recoveryResetPassword: (password: string, passwordConfirm: string) => request<{ ok: boolean; login_required: boolean; mfa_reenrollment_required: boolean }>('/console/recovery/reset-password', { method: 'POST', body: JSON.stringify({ password, password_confirm: passwordConfirm }) }),
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
  withdrawalDestinations: (organizationId: string) => request<ListResponse<WithdrawalDestination>>(withOrganization('/console/api/withdrawal-destinations', organizationId)),
  createWithdrawalDestination: (organizationId: string, input: WithdrawalDestinationInput) => request<WithdrawalDestination>(withOrganization('/console/api/withdrawal-destinations', organizationId), { method:'POST', body:JSON.stringify(input) }),
  disableWithdrawalDestination: (organizationId: string, id: string) => request<void>(withOrganization(`/console/api/withdrawal-destinations/${id}`, organizationId), { method:'DELETE' }),
  createWithdrawal: (organizationId: string, input: { destination_id: string; amount_minor: number; description?: string; provider?: string }, idempotencyKey: string) => request<Transaction>(withOrganization('/console/api/withdrawals', organizationId), { method:'POST', headers:{'Idempotency-Key':idempotencyKey}, body:JSON.stringify(input) }),
  createWebhook: (organizationId: string, input: WebhookInput) =>
    request<CreatedWebhookEndpoint>(withOrganization('/console/api/webhook-endpoints', organizationId), {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteWebhook: (organizationId: string, webhookId: string) =>
    request<void>(withOrganization(`/console/api/webhook-endpoints/${webhookId}`, organizationId), {
      method: 'DELETE',
    }),
  createProviderConnection: (organizationId: string, input: ProviderConnectionInput) =>
    request<ProviderConnection>(withOrganization('/console/api/provider-connections', organizationId), {
      method: 'POST',
      body: JSON.stringify(input),
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
  adminOrganizationStats: (organizationId: string) =>
    request<{ accounts: number; customers: number; provider_connections: number }>(
      `/console/api/admin/organizations/${encodeURIComponent(organizationId)}/stats`,
    ),
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
  adminProvisionOrganization: (input: AdminProvisionOrganizationInput) =>
    request<AdminProvisionOrganizationResult>('/console/api/admin/organizations/provision', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
}
