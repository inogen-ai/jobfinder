import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0'
import { handleGenerate } from './handler.ts'
import { anthropicRunModel } from './model.ts'
import { supabaseStore } from '../_shared/store.ts'

const url = Deno.env.get('SUPABASE_URL')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const runModel = anthropicRunModel(new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') }))

Deno.serve((req) => handleGenerate(req, { store: (auth) => supabaseStore(url, anonKey, auth), runModel }))
