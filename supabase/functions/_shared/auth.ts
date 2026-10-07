import type { UserCtx } from './types.ts'

/** Mirrors public.is_inogen(): exact inogen.ai domain (any case) and a Microsoft (Entra) sign-in. */
export function isAllowedUser(u: UserCtx): boolean {
  if (!u.email || u.provider !== 'azure') return false
  const at = u.email.lastIndexOf('@')
  return at > 0 && u.email.slice(at + 1).toLowerCase() === 'inogen.ai'
}
