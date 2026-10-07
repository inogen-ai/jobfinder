export interface UserCtx { id: string; email: string | null; provider: string | null }

export interface RoleCtx {
  title: string; org: string; location: string; remote: string; rate: string; ir35: string; duration: string
  url: string; jobDescription: string
}

export interface ProfileCtx {
  headline: string; cvText: string; rate: string; availableFrom: string | null; location: string
  preferences: string; alwaysMention: string; neverMention: string
}

export interface NewDocumentRow {
  roleId: string; kind: string; title: string; body: string; questions: string; instruction: string
  model: string; inputTokens: number; outputTokens: number
}

/** Everything a function reads or writes, always as the calling user (RLS applies). */
export interface Store {
  getUser(): Promise<UserCtx | null>
  getRole(id: string): Promise<RoleCtx | null>
  getProfile(): Promise<ProfileCtx | null>
  getDocumentBody(id: string): Promise<string | null>
  countDocumentsSince(iso: string): Promise<{ count: number; oldest: string | null }>
  insertDocument(d: NewDocumentRow): Promise<string>
  countFetchesSince(iso: string): Promise<{ count: number; oldest: string | null }>
  insertFetch(roleId: string): Promise<void>
}
