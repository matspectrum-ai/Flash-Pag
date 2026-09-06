import type {
  AdminMerchantInput,
  AdminOrganizationInput,
  ApiErrorShape,
  ApiKeyInput,
  CreatedApiKey,
  CreatedWebhookEndpoint,
  Customer,
  CustomerInput,
  ListResponse,
  MeResponse,
  MemberInput,
  MemberRole,
  Merchant,
  MerchantMember,
  Organization,
  OrganizationAccess,
  SummaryResponse,
  Transaction,
  WebhookInput,
} from './types'

export class ApiError extends Error {
  status: number
  code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    ...init,
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
