import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0'
import { handleFetchPosting } from './handler.ts'
import { anthropicRunFetch } from './model.ts'
import { supabaseStore } from '../_shared/store.ts'

const url = Deno.env.get('SUPABASE_URL')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const runFetch = anthropicRunFetch(new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') }))

Deno.serve((req) => handleFetchPosting(req, { store: (auth) => supabaseStore(url, anonKey, auth), runFetch }))
