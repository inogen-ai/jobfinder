# jobfinder.inogen.ai — Design

Date: 2026-10-06 · Status: draft for review

## Purpose

A private, shared tracker for freelance roles. It runs at `jobfinder.inogen.ai` and is open to anyone with an `@inogen.ai` Microsoft account. It replaces the claude.ai "Contract Pipeline" artifact (https://claude.ai/artifact/UQ4LBXjMPcDc4thuNC3Vwy) as the single place where roles are tracked.

**Success criteria**

- Only signed-in `@inogen.ai` users can read or change roles. Everyone else sees only the sign-in page.
- All 35 roles from the claude.ai tracker are migrated, with every field intact.
- Edits made by one user appear for others without a reload.
- Claude can add roles from a local script without going through the UI.
- Hosting has no running cost and no servers to maintain.

## Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Hosting | GitHub Pages, repo `inogen-ai/jobfinder`, custom domain via `CNAME` | Same pattern as `kamervragen.inogen.ai` and `kilnworks.inogen.ai` |
| Backend | Supabase (Postgres, Auth, Realtime), EU region (Frankfurt) | Same stack as guitar and mushrooms; row-level security lets a static app stay secure |
| Sign-in | Supabase Auth with the Azure provider, single-tenant Entra app registration | inogen.ai mail runs on Microsoft 365 (MX points to `outlook.com`) |
| Access model | One shared pipeline for all `@inogen.ai` users | Confirmed with Mike |
| Frontend | Vite + React + TypeScript | Static build, fits Pages |
| DNS | GoDaddy: `jobfinder CNAME inogen-ai.github.io` | `jobfinder` is currently unused |

**Constraint:** nothing is deployed to, or created with, a client's cloud account or project; use InoGen accounts only.

## Architecture

```
Browser (jobfinder.inogen.ai, static files on GitHub Pages)
  ├─ Supabase Auth ── Microsoft Entra (inogen.ai tenant only)
  └─ Supabase Postgres  `roles` table, RLS: email domain = inogen.ai
        └─ Realtime channel on `roles` → live updates to all open sessions

Local machine (Mike / Claude)
  └─ scripts/*.py with SUPABASE_SERVICE_ROLE_KEY from .env (git-ignored)
        → migrate roles, add roles
```

Defence in depth: the Entra app is single-tenant, so outside accounts cannot sign in. Separately, the RLS policies reject any JWT whose email does not end in `@inogen.ai`. Either control on its own blocks outsiders.

## Data model

Table `public.roles`:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `text` primary key | Slug, e.g. `nl-interex-ai-engineer`. The same ids as the artifact, so migration is idempotent |
| `title`, `org` | `text not null` | |
| `market` | `text not null` check in (`UK`,`NL`,`EU`,`Global`) | |
| `location`, `remote`, `rate`, `ir35`, `duration` | `text` default `''` | Free text, as in the artifact |
| `posted`, `deadline`, `next_date` | `date` null | |
| `fit` | `text not null` check in (`Strong`,`Good`,`Stretch`) | |
| `status` | `text not null` default `'Shortlist'`, check in (`Shortlist`,`Applied`,`Interviewing`,`Offer`,`Won`,`Rejected`,`Closed`,`Parked`) | |
| `why`, `caveat`, `url`, `contact`, `next_step`, `notes` | `text` default `''` | |
| `cv` | `text` default `''`, check in (`''`,`A`,`B`) | |
| `created_at`, `updated_at` | `timestamptz` default `now()` | `updated_at` is maintained by a trigger |
| `created_by`, `updated_by` | `text` | Email from the JWT, set by a trigger. `'claude-script'` when written with the service key |

**RLS:** enabled. `select`, `insert`, `update` and `delete` all use the same policy: `auth.jwt() ->> 'email' ilike '%@inogen.ai'`. No anonymous access.

**Realtime:** the `roles` table is added to the `supabase_realtime` publication.

Migrations live in `supabase/migrations/` and are applied with the Supabase CLI.

## Frontend

```
src/
  lib/supabase.ts     client from VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
  lib/roles.ts        listRoles, createRole, updateRole, deleteRole, subscribeRoles; DB row <-> Role mapping (snake_case <-> camelCase)
  lib/pipeline.ts     pure: filterRoles, sortRoles, stageCounts, daysTo, contractCountdown
  components/
    SignIn.tsx        "Sign in with Microsoft"; refusal message for other accounts
    Pipeline.tsx      page shell; owns roles state + realtime subscription
    StageStrip.tsx    Active / Shortlist / Applied / Interviewing / Offer / Deadline ≤ 14 days / Archived
    Filters.tsx       market, fit, search (filters remembered in localStorage)
    RoleRow.tsx       summary row with an inline status select
    RoleEditor.tsx    expanded detail: facts plus editable next step, date, rate, deadline, CV, fit, notes; delete with in-page confirm
    AddRoleDialog.tsx
```

`lib/roles.ts` is the only module that talks to Supabase. Components receive data and callbacks as props.

**UI behaviour carried over from the artifact:**
- Countdown to 31 Oct 2026.
- Sort order: stage (Offer → Interviewing → Applied → Shortlist → archived), then nearest upcoming deadline, then fit, then most recently posted.
- Deadlines within 7 days show in amber; passed deadlines show in red.
- Light and dark themes follow the system setting.
- Layout works at phone width.

**New:** each row shows "Updated by <name>, <relative time>".

**Sign-in flow:** `signInWithOAuth({ provider: 'azure', options: { scopes: 'email', redirectTo: origin } })`. After sign-in, if the session email is not `@inogen.ai`, the app signs the user out and shows "This tracker is limited to InoGen accounts."

## Error handling

- **Write fails:** the change is rolled back in the UI and an inline message reads "Couldn't save. Check your connection and try again."
- **RLS refusal (401/403):** the user is signed out and returned to the sign-in page.
- **Realtime channel error or close:** a banner reads "Live updates paused. Reconnecting…", and the app re-subscribes with backoff.
- **Empty table:** a designed empty state with an "Add role" prompt.

## Scripts (Python, uv)

- `scripts/migrate_from_artifact.py`: reads `seed/*.json` exported from the artifact DB and upserts on `id` with the service key. It is idempotent.
- `scripts/add_role.py`: CLI to upsert one role from flags or a JSON file. This is how Claude adds roles.
- `.env.example` lists `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. `.env` is git-ignored.

## Testing

- **Vitest:** unit tests for `pipeline.ts` (filter, sort, counts, date maths, including timezone edges) and the row mapping in `roles.ts`.
- **RLS test:** `supabase/tests/rls.sql` (pgTAP). Checks that an anon role reads 0 rows and cannot insert, an `@example.com` JWT is refused, and an `@inogen.ai` JWT can do full CRUD.
- **Playwright smoke test:** the sign-in page renders, and a stubbed session renders the pipeline from a mocked Supabase response.
- **CI (GitHub Actions):** lint, `tsc --noEmit` and Vitest on every push. Pages deploy only from `main` after checks pass.

## Deployment and setup

1. **Supabase project `jobfinder` in eu-central-1** (Mike, or Claude via CLI with an access token). Apply migrations and enable the Azure provider.
2. **Entra app registration** (Mike, in the inogen.ai tenant):
   - Single tenant.
   - Redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
   - Add the client id, secret and tenant URL to Supabase.
   - Set the Supabase site URL to `https://jobfinder.inogen.ai`.
3. **GitHub:** create `inogen-ai/jobfinder` and set the Pages source to GitHub Actions. Repo variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The anon key is public by design.
4. **GoDaddy:** add the `jobfinder` CNAME to `inogen-ai.github.io`, then enforce HTTPS in Pages.
5. **Migrate the 35 roles, then check:**
   - sign in with an inogen.ai account;
   - try a non-inogen.ai account and confirm it is refused;
   - an edit shows live in a second browser.
6. **Retire the claude.ai artifact** only after Mike confirms. Deleting it is irreversible.

## Out of scope

Automated job scraping, email or calendar reminders, per-user private views, CV and document storage, mobile app. Each can be added later, through Supabase Edge Functions or new tables, without changing this design.
