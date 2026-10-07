/** With a refusal fallback, content holds the declined model's partial output, a `fallback` block, then the fallback model's answer. */
export function textAfterLastFallback(content: Array<{ type: string; text?: string }>): string {
  let start = 0
  content.forEach((block, i) => { if (block.type === 'fallback') start = i + 1 })
  return content.slice(start).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim()
}
