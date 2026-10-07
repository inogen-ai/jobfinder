# jobfinder.inogen.ai

Shared tracker for freelance roles, for InoGen accounts only. Static React app on GitHub Pages,
backed by Supabase (Postgres + Microsoft sign-in + realtime). Design: `docs/superpowers/specs/2026-10-06-jobfinder-design.md`.

## Develop

    npm install
    cp .env.example .env.local      # fill VITE_* values
    npm run dev
    npm test && npm run lint && npm run typecheck
    npm run e2e

Database (needs Docker):

    npx supabase start
    npx supabase db reset               # applies supabase/migrations
    npx supabase test db                # RLS tests

## Add a role from the command line

Needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env` (never commit it; the key bypasses RLS).

    uv run scripts/add_role.py --title "AI Engineer" --org "Acme" --market NL --fit Strong --url https://...

## Deploy

Every push to `main` runs CI and deploys to Pages. Repo variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
Schema changes: `npx supabase db push` against the linked project.

## Security model

- Entra app is single-tenant (inogen.ai only).
- Email/password and phone sign-ups are off (`supabase/config.toml`; on the hosted project: Authentication → Providers → Email: disabled, or `npx supabase config push`).
- RLS also requires `app_metadata.provider = 'azure'`, so only Microsoft sign-ins get data.
- Deletes are soft (`deleted_at`): realtime does not apply RLS to DELETE events.
- RLS on `public.roles` admits only JWTs whose email domain is exactly `inogen.ai`.
- `seed/` and `.env` are git-ignored: exported roles contain recruiter contact details.
