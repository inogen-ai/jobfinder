const ALLOWED_ORIGINS = new Set(['https://jobfinder.inogen.ai', 'http://localhost:5173'])

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://jobfinder.inogen.ai',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } })
}

/** When the oldest item in the rolling hour drops out of the window. */
export function retryAtFrom(oldest: string | null, now: Date): string {
  const base = oldest ? new Date(oldest) : now
  return new Date(base.getTime() + 3_600_000).toISOString()
}
