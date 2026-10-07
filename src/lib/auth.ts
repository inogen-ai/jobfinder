export const ALLOWED_DOMAIN = 'inogen.ai'

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const at = email.lastIndexOf('@')
  return at > 0 && email.slice(at + 1).toLowerCase() === ALLOWED_DOMAIN
}

export function displayName(who: string | null | undefined): string {
  if (!who) return 'Someone'
  if (who === 'claude-script') return 'Claude'
  const local = who.split('@')[0]
  const first = local.split(/[._-]/)[0]
  return first ? first[0].toUpperCase() + first.slice(1) : 'Someone'
}
