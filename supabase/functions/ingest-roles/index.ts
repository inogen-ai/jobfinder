import { handleIngest } from './handler.ts'
import { adminStore } from './store.ts'

const store = adminStore(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve((req) => handleIngest(req, { store, token: Deno.env.get('INGEST_TOKEN') ?? '' }))
