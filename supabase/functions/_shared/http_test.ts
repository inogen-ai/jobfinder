import { assertEquals } from 'jsr:@std/assert@1'
import { corsHeaders, retryAtFrom } from './http.ts'

Deno.test('CORS echoes allowed origins only', () => {
  const r = (o: string) => new Request('https://x', { headers: { Origin: o } })
  assertEquals(corsHeaders(r('http://localhost:5173'))['Access-Control-Allow-Origin'], 'http://localhost:5173')
  assertEquals(corsHeaders(r('https://evil.example'))['Access-Control-Allow-Origin'], 'https://jobfinder.inogen.ai')
})
Deno.test('retryAt is one hour after the oldest counted item', () => {
  assertEquals(retryAtFrom('2026-10-07T12:10:00.000Z', new Date('2026-10-07T13:00:00Z')), '2026-10-07T13:10:00.000Z')
  assertEquals(retryAtFrom(null, new Date('2026-10-07T13:00:00Z')), '2026-10-07T14:00:00.000Z')
})
