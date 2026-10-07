const encoder = new TextEncoder()

export function sseEvent(name: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
}
