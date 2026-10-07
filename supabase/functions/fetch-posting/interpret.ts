type Block = { type: string; text?: string; content?: { type?: string } }

export function interpretFetch(content: Block[], stopReason: string | null): { text: string } | { unavailable: true } {
  if (stopReason === 'refusal') return { unavailable: true }
  // Only accept text when the page was actually fetched, so the model can't answer from memory.
  const fetched = content.some((b) => b.type === 'web_fetch_tool_result' && b.content?.type === 'web_fetch_result')
  const failed = content.some((b) => b.type === 'web_fetch_tool_result' && b.content?.type !== 'web_fetch_result')
  const text = content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim()
  if (!fetched || failed || !text || text === 'UNAVAILABLE') return { unavailable: true }
  return { text }
}
