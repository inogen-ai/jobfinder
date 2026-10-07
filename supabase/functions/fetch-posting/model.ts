import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0'
import type { RunFetch } from './handler.ts'
import { interpretFetch } from './interpret.ts'

const prompt = (url: string) => `Fetch ${url} and return the job posting's description: responsibilities, requirements, terms and how to apply. Copy it verbatim where possible, as plain text or markdown, with no commentary of your own. If the page could not be fetched or contains no job posting, reply with exactly UNAVAILABLE.`

export function anthropicRunFetch(client: Anthropic): RunFetch {
  return async (url) => {
    const msg = await client.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { effort: 'low' },
      tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 1, allowed_domains: [new URL(url).hostname] }],
      messages: [{ role: 'user', content: prompt(url) }],
    })
    const usage = { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens }
    return { ...interpretFetch(msg.content as Array<{ type: string; text?: string; content?: { type?: string } }>, msg.stop_reason), usage }
  }
}
