type Block = { type: string; text?: string; content?: { type?: string } }

export function interpretFetch(content: Block[], stopReason: string | null): { text: string } | { unavailable: true } {
  if (stopReason === 'refusal') return { unavailable: true }
  const failed = content.some((b) => b.type === 'web_fetch_tool_result' && b.content?.type !== 'web_fetch_result')
  const text = content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim()
  if (failed || !text || text === 'UNAVAILABLE') return { unavailable: true }
  return { text }
}
