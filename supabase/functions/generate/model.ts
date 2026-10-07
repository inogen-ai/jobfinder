import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0'
import type { BuiltPrompt } from '../_shared/prompt.ts'
import type { ModelEvent, ModelResult, ModelRun, RunModel } from './handler.ts'
import { textAfterLastFallback } from './result.ts'

export const MODEL = 'claude-opus-5-5'

export function anthropicRunModel(client: Anthropic): RunModel {
  return (prompt: BuiltPrompt, signal: AbortSignal): ModelRun => {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: prompt.effort },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.userMessage }],
    }, { signal })
    return {
      events: (async function* (): AsyncGenerator<ModelEvent> {
        for await (const event of stream) {
          if (event.type === 'content_block_start' && (event.content_block as { type: string }).type === 'fallback') {
            yield { type: 'reset' }
          } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            yield { type: 'text', text: event.delta.text }
          }
        }
      })(),
      async final(): Promise<ModelResult> {
        const msg = await stream.finalMessage()
        return {
          stopReason: msg.stop_reason ?? 'end_turn',
          text: textAfterLastFallback(msg.content as Array<{ type: string; text?: string }>),
          model: msg.model,
          usage: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens },
        }
      },
    }
  }
}
