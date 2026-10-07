import { assertEquals } from 'jsr:@std/assert@1'
import { textAfterLastFallback } from './result.ts'

Deno.test('keeps only text after the last fallback block', () => {
  assertEquals(textAfterLastFallback([
    { type: 'thinking' }, { type: 'text', text: 'declined part' }, { type: 'fallback' },
    { type: 'text', text: 'Final ' }, { type: 'text', text: 'letter' },
  ]), 'Final letter')
  assertEquals(textAfterLastFallback([{ type: 'text', text: ' Plain ' }]), 'Plain')
})
