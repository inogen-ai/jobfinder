import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { useSession } from './useSession'

function fakeAuth(initial: Session | null) {
  let listener: (e: string, s: Session | null) => void = () => {}
  const auth = {
    getSession: vi.fn(async () => ({ data: { session: initial }, error: null })),
    onAuthStateChange: vi.fn((cb) => { listener = cb; return { data: { subscription: { unsubscribe: vi.fn() } } } }),
    signOut: vi.fn(async () => { listener('SIGNED_OUT', null); return { error: null } }),
    signInWithOAuth: vi.fn(async () => ({ data: {}, error: null })),
  }
  return { auth: auth as unknown as SupabaseClient['auth'], raw: auth, emit: (s: Session | null) => listener('SIGNED_IN', s) }
}
const session = (email: string) => ({ user: { email } }) as unknown as Session

describe('useSession', () => {
  it('signed out when there is no session', async () => {
    const { auth } = fakeAuth(null)
    const { result } = renderHook(() => useSession(auth))
    await waitFor(() => expect(result.current.status).toBe('signedOut'))
  })
  it('signed in for an inogen.ai account', async () => {
    const { auth } = fakeAuth(session('michael.snow@inogen.ai'))
    const { result } = renderHook(() => useSession(auth))
    await waitFor(() => expect(result.current.status).toBe('signedIn'))
  })
  it('refuses and signs out other accounts, and stays refused after the sign-out event', async () => {
    const { auth, raw } = fakeAuth(session('eve@example.com'))
    const { result } = renderHook(() => useSession(auth))
    await waitFor(() => expect(result.current.status).toBe('refused'))
    expect(raw.signOut).toHaveBeenCalled()
  })
  it('signIn uses the azure provider with the email scope', async () => {
    const { auth, raw } = fakeAuth(null)
    const { result } = renderHook(() => useSession(auth))
    await act(() => result.current.signIn())
    expect(raw.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'azure', options: { scopes: 'email', redirectTo: window.location.origin },
    })
  })
})
