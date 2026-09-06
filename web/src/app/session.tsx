import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import type { MeResponse, Organization } from '../api/types'

type SessionContextValue = {
  me?: MeResponse
  loading: boolean
  authenticated: boolean
  organization?: Organization
  organizationId?: string
  setOrganizationId: (id: string) => void
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [organizationId, setOrganizationIdState] = useState<string | undefined>(() =>
    localStorage.getItem('flashpag.organization') || undefined,
  )

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    retry: false,
    staleTime: 30_000,
  })

  const loginMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => api.login(email, password),
  })

  const logoutMutation = useMutation({ mutationFn: api.logout })

  const me = meQuery.data
  const organizations = me?.organizations ?? []
  const organization = organizations.find((item) => item.id === organizationId) ?? organizations[0]

  useEffect(() => {
    if (!organization?.id) return
    setOrganizationIdState(organization.id)
    localStorage.setItem('flashpag.organization', organization.id)
  }, [organization?.id])

  const setOrganizationId = (id: string) => {
    setOrganizationIdState(id)
    localStorage.setItem('flashpag.organization', id)
  }

  const login = async (email: string, password: string) => {
    await loginMutation.mutateAsync({ email, password })
    await queryClient.invalidateQueries({ queryKey: ['me'] })
  }

  const logout = async () => {
    await logoutMutation.mutateAsync()
    queryClient.clear()
    localStorage.removeItem('flashpag.organization')
    setOrganizationIdState(undefined)
  }

  const authenticated = Boolean(me && !meQuery.isError)
  const unauthorized = meQuery.error instanceof ApiError && meQuery.error.status === 401

  const value = useMemo<SessionContextValue>(
    () => ({
      me,
      loading: meQuery.isLoading && !unauthorized,
      authenticated,
      organization,
      organizationId: organization?.id,
      setOrganizationId,
      login,
      logout,
    }),
    [me, meQuery.isLoading, unauthorized, authenticated, organization],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession must be used inside SessionProvider')
  return value
}
