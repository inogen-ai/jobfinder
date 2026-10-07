import { assertEquals } from 'jsr:@std/assert@1'
import { isAllowedUser } from './auth.ts'

const u = (email: string | null, provider: string | null) => ({ id: 'x', email, provider })

Deno.test('allows inogen.ai via Microsoft, any case', () => {
  assertEquals(isAllowedUser(u('Mike@InoGen.AI', 'azure')), true)
})
Deno.test('refuses look-alikes, other domains, other providers and missing email', () => {
  for (const user of [u('eve@inogen.ai.evil.com', 'azure'), u('eve@notinogen.ai', 'azure'), u('eve@example.com', 'azure'),
    u('a@inogen.ai', 'email'), u('a@inogen.ai', null), u(null, 'azure')]) {
    assertEquals(isAllowedUser(user), false, JSON.stringify(user))
  }
})
