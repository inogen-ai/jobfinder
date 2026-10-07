import { assertEquals } from 'jsr:@std/assert@1'
import { interpretFetch } from './interpret.ts'

Deno.test('returns the posting text', () => {
  assertEquals(interpretFetch([{ type: 'web_fetch_tool_result', content: { type: 'web_fetch_result' } }, { type: 'text', text: ' We need a GCP engineer. ' }], 'end_turn'), { text: 'We need a GCP engineer.' })
})
Deno.test('a failed fetch, UNAVAILABLE, empty text or a refusal is unavailable', () => {
  assertEquals(interpretFetch([{ type: 'web_fetch_tool_result', content: { type: 'web_fetch_tool_result_error' } }, { type: 'text', text: 'Some text' }], 'end_turn'), { unavailable: true })
  assertEquals(interpretFetch([{ type: 'text', text: 'UNAVAILABLE' }], 'end_turn'), { unavailable: true })
  assertEquals(interpretFetch([], 'end_turn'), { unavailable: true })
  assertEquals(interpretFetch([{ type: 'text', text: 'x' }], 'refusal'), { unavailable: true })
})
