import type { ApiErrorShape, ListResponse, MeResponse, SummaryResponse } from './types'

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
  summary: (organizationId: string) =>
    request<SummaryResponse>(withOrganization('/console/api/summary', organizationId)),
  list: <T>(resource: string, organizationId: string) =>
    request<ListResponse<T>>(withOrganization(`/console/api/${resource}`, organizationId)),
  testConnection: (connectionId: string, organizationId: string) =>
    request<Record<string, unknown>>(
      withOrganization(`/console/api/provider-connections/${connectionId}/test`, organizationId),
      { method: 'POST', body: '{}' },
    ),
}
