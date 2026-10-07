# Document generation — Design

Date: 2026-10-07 · Status: draft for review · Builds on: `2026-10-06-jobfinder-design.md`

## Purpose

From any role in jobfinder, a signed-in user can generate a **cover letter**, a **recruiter email or pitch**, a **tailored CV**, or **answers to application questions**. Each document is written from that user's own private profile and the role's job description. Drafts are saved privately against the role, and the user can edit, regenerate, copy, or download them as .docx.

**Success criteria**

- Each user's profile and drafts are visible only to that user. Outsiders get nothing, as with roles.
- A draft streams into the editor as it is generated. It is saved only when generation finishes successfully.
- Regenerating never overwrites an earlier draft or the user's edits.
- The Anthropic API key never reaches the browser.
- Spend is bounded: at most 20 generations per user per rolling hour, inputs are capped, and every call is logged with its token counts.

## Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Document types | `cover_letter`, `pitch`, `cv`, `answers` | Confirmed with Mike |
| Whose background | A private profile per user | Confirmed; the pipeline is shared but searches are personal |
| Output handling | Saved privately per role; edit, regenerate with an instruction, copy, download .docx | Confirmed |
| Job description | A shared `roles.job_description` text field, filled by pasting or by "Fetch from link" with a preview before saving | Confirmed; most job sites block scraping |
| Where generation runs | Supabase Edge Functions (Deno) | Same platform as the database; the caller's JWT reaches the database so RLS still applies |
| Model | `claude-opus-5-5` with adaptive thinking. Effort `high` for `cv`, `medium` for the other types. Server-side fallback `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) | Default current model; fallback handles refusals without maintaining a model list |
| SDK | Official Anthropic TypeScript SDK (`npm:@anthropic-ai/sdk`) with streaming | Project is TypeScript; streaming avoids timeouts and drives the live editor |
| Posting fetch | Claude `web_fetch_20260209` server tool, limited to the role's URL | No scraping code of our own; same key and model |
| API key | A dedicated key in InoGen's existing Anthropic account, stored as Supabase function secret `ANTHROPIC_API_KEY` | Confirmed; spend is visible and the key can be revoked on its own |
| .docx export | In the browser, using the `docx` npm library | No server round-trip; the markdown is already client-side |
| Language | Match the posting's language (Dutch posting → Dutch draft) unless the instruction says otherwise | Many NL postings are in Dutch |

## Data model

Migration `20261007120000_documents.sql`:

**`public.roles`**: add `job_description text not null default ''`. It inherits the existing roles RLS (InoGen + Azure, soft delete).

**`public.profiles`**: one row per user.

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | `uuid` primary key, default `auth.uid()` | References `auth.users(id)` on delete cascade |
| `headline` | `text not null default ''` | e.g. "Freelance AI & GCP data engineer" |
| `cv_text` | `text not null default ''` | Pasted CV, markdown; capped at 40,000 characters by a check constraint |
| `rate` | `text not null default ''` | |
| `available_from` | `date` | |
| `location` | `text not null default ''` | |
| `preferences` | `text not null default ''` | Remote, contract type, sectors |
| `always_mention` | `text not null default ''` | |
| `never_mention` | `text not null default ''` | |
| `updated_at` | `timestamptz not null default now()` | Set by trigger |

**`public.documents`**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` primary key default `gen_random_uuid()` | |
| `user_id` | `uuid not null default auth.uid()` | References `auth.users(id)` on delete cascade |
| `role_id` | `text not null` | References `public.roles(id)` |
| `kind` | `text not null` check in (`cover_letter`,`pitch`,`cv`,`answers`) | |
| `title` | `text not null` | e.g. "Cover letter · 7 Oct 14:02" |
| `body` | `text not null` | Markdown |
| `questions` | `text not null default ''` | Only used for `answers` |
| `instruction` | `text not null default ''` | |
| `model` | `text not null` | The model that actually answered (after any fallback) |
| `input_tokens`, `output_tokens` | `int not null default 0` | |
| `created_at`, `updated_at` | `timestamptz not null default now()` | |
| `deleted_at` | `timestamptz` | Soft delete, same reasoning as roles (realtime and DELETE events) |

**`public.fetch_log`**: `id bigint generated always as identity primary key`, `user_id uuid not null default auth.uid()`, `role_id text not null`, `created_at timestamptz not null default now()`. Used only to rate-limit `fetch-posting`.

**RLS on `profiles`, `documents` and `fetch_log`** (anon has no grants):
- **`profiles`:** all operations require `public.is_inogen() and user_id = auth.uid()`.
- **`documents`:** `select` / `update` require `public.is_inogen() and user_id = auth.uid()`. `insert` requires the same, and the referenced role must be visible to the caller. There is no delete policy (soft delete only).
- **`fetch_log`:** `insert` and `select` require `public.is_inogen() and user_id = auth.uid()`. There is no update or delete.
- An `updated_at` trigger runs on `profiles` and `documents`. On update, `documents.user_id` cannot change, enforced by a trigger that resets it to the old value.

`documents` is not added to the realtime publication. Drafts are personal and only change in the user's own tab.

## Edge Functions

Both functions live in `supabase/functions/`, are deployed with `npx supabase functions deploy`, and verify the JWT (Supabase default `verify_jwt = true`).

### `generate`

**Request** (POST, JSON):

```json
{ "roleId": "...", "kind": "cover_letter", "instruction": "", "questions": "", "previousDocumentId": null }
```

**Flow**
1. **Check the caller.** Build a Supabase client with the caller's `Authorization` header. Read `auth.getUser()` and require an `@inogen.ai` email (exact domain, case-insensitive) and `app_metadata.provider = 'azure'`, otherwise return 401. This mirrors `is_inogen()`, and RLS enforces it again on every read.
2. **Validate the request.** `kind` must be one of the four types. `instruction` ≤ 1,000 characters. `questions` ≤ 8,000 characters and required when `kind = 'answers'`. Otherwise return 400.
3. **Load the inputs.** Read as the caller: the role (with `job_description`), the caller's profile, and the earlier draft if `previousDocumentId` is given. If there is no profile or `cv_text` is empty, return 409 with code `profile_missing`.
4. **Rate limit.** Count the caller's `documents` created in the last 60 minutes. At 20 or more, return 429 with `retryAt`, the time the oldest of those drafts turns 60 minutes old.
5. **Build the prompt** with the pure module `_shared/prompt.ts` (below). The `job_description` is truncated to 30,000 characters, and the response says when that happened.
6. **Call Claude:** `client.beta.messages.stream`, model `claude-opus-5-5`, `max_tokens` 16,000, `thinking: {type: "adaptive"}`, `output_config: {effort}`, `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`.
7. **Stream to the browser.** Forward text deltas as server-sent events: `event: delta` with `{text}`. Thinking blocks are not forwarded.
8. **On completion**, check `stop_reason`:
   - `end_turn`: insert the `documents` row as the caller and send `event: done` with `{documentId, model, usage}`.
   - `refusal`, or no text: send `event: error` with `{code: "refused"}` and save nothing.
   - `max_tokens`: save the draft, with `truncated: true` in the `done` event.
9. **On an exception,** send `event: error` with `{code}` (`upstream`, `timeout`) and save nothing.
10. **Log** one line per call: user id, kind, model, token counts, duration, and outcome. The log never includes document text.

### `fetch-posting`

**Request:** POST with `{ "roleId": "..." }`.

**Flow**
1. Same caller check as `generate`. Load the role as the caller and require `url` to be an http(s) URL.
2. Call `client.messages.create` with `claude-opus-5-5`, effort `low`, and the tool `{type: "web_fetch_20260209", name: "web_fetch", max_uses: 1, allowed_domains: [<host of url>]}`. The prompt asks for only the job description text, verbatim where possible, or the single word `UNAVAILABLE` if the page has no posting or could not be fetched.
3. Return `{ text }`, or `{ code: "unavailable" }` when the tool result is an error or the model answered `UNAVAILABLE`. The function does **not** write `job_description`: the browser shows a preview and saves only when the user clicks "Use this".
4. **Rate limit.** At most 20 fetches per user per rolling hour, counted from `fetch_log`; over the limit, return 429 with `retryAt`. The function inserts a `fetch_log` row, as the caller, before calling Claude. This limit is separate from the generation limit.

### `_shared/prompt.ts` (pure, unit-tested)

`buildPrompt({ kind, role, profile, instruction, questions, previous }) → { system, messages, effort }`

**System prompt** (stable across calls, so it can be cached):
- You are writing on behalf of the candidate.
- Use only facts from the profile and the posting. Never invent employers, dates, numbers or skills.
- Write the posting's language unless the instruction says otherwise.
- Return markdown only, with no preamble.

**One user message** with tagged sections:
- `<posting>`: the role title, organisation, terms, and `job_description`, or "not provided" if empty.
- `<profile>`
- `<task>`: the per-kind requirements below.
- `<questions>`: only for `answers`.
- `<previous_draft>`: only on regenerate.
- `<instruction>`: always last.

**Per-kind requirements:**
- **`cover_letter`:** at most one page, about 250–350 words. Address the posting's top three requirements with concrete evidence from the profile, then a closing call to action.
- **`pitch`:** a subject line plus 120–180 words for email, or LinkedIn length. It must state availability and the rate if the profile has one.
- **`cv`:** a reordered, reworded version of `cv_text` that puts the most relevant experience first. Keep every fact. Mark gaps the profile cannot fill as `[to confirm]`.
- **`answers`:** one answer per question, each a heading with the question and 80–200 words. Where the profile has no evidence, say so rather than inventing.

## Frontend

```
src/lib/profile.ts        getProfile, saveProfile (RLS-scoped; maps snake_case)
src/lib/documents.ts      listDocuments(roleId), updateDocument, removeDocument (soft), countByRole
src/lib/generate.ts       generate(params, {onDelta, signal}) → Promise<{documentId, model, usage, truncated}>; parses SSE; typed errors
                          fetchPosting(roleId) → {text} | {code}
src/lib/markdownDocx.ts   markdownToDocx(markdown, title) → Blob (headings, paragraphs, bullet and numbered lists, bold/italic, links)
src/components/ProfilePage.tsx
src/components/DocumentsPanel.tsx   inside RoleEditor's detail; owns drafts for one role
src/components/JobDescription.tsx   textarea + Fetch from link + preview (Use this / Discard)
src/components/GenerateButtons.tsx  four kinds, questions box for answers, instruction field, disabled states
src/components/DraftEditor.tsx      edit (textarea) / preview tabs, Save, Regenerate with instruction, Copy, Download .docx, Stop while streaming
```

**Navigation:** a "My profile" button in the user bar. The app shows the profile page in place of the pipeline (local view state, no router). An empty profile shows the prompt "Add your CV to start generating documents".

**Draft badge:** the row header shows "N docs" when the user has non-deleted drafts for that role. Counts come from one `countByRole` query on load, updated after a successful generate or delete.

**Copy:** the `Copy` button uses `navigator.clipboard.writeText` and falls back to selecting the text.

**The generate client** uses `fetch` to `${SUPABASE_URL}/functions/v1/generate` with the session's access token, and reads the SSE stream with `ReadableStream`. An `AbortController` drives Stop.

## Errors

| Situation | Behaviour |
| --- | --- |
| No profile or empty CV (409 `profile_missing`) | Generate buttons are disabled with "Add your CV to your profile first." and a link to the profile; the server enforces the same |
| Rate limit (429) | "You've generated 20 drafts this hour — try again at HH:MM." |
| `refused` / `upstream` / `timeout` | "Couldn't generate this draft. Nothing was saved." Streamed text stays visible with a Copy button |
| Stream drops or Stop pressed | Partial text is kept as an unsaved draft; "Generation stopped early." The user can Save it manually |
| `max_tokens` (truncated) | The draft is saved; banner "This draft hit the length limit and may be cut off." |
| Fetch unavailable | "This site doesn't allow fetching — paste the job description instead." |
| Posting truncated to 30k characters | Note under the draft: "The job description was shortened to fit." |
| 401 from either function | Same as other auth errors: sign out |
| Saving an edit to a draft whose role was deleted | "This role was deleted by someone else." (reuses the existing message) |

## Testing

- **Vitest:**
  - `prompt.ts`: each kind includes the right sections, the instruction comes last, questions only for `answers`, previous draft only on regenerate, truncation at 30k, no profile fields leaking into the system prompt.
  - `markdownDocx.ts`: headings, lists and inline styles become the expected docx paragraph structure.
  - `generate.ts`: SSE parsing across chunk boundaries, `done`/`error` mapping, abort.
  - Data-layer mapping for `profile.ts` and `documents.ts`.
- **Component tests:**
  - GenerateButtons: disabled without a profile, and the questions box is required for answers.
  - DraftEditor: streaming text appears, Stop keeps partial text, Save, and the regenerate instruction is passed through.
  - JobDescription: Use this / Discard, and the unavailable message.
  - DocumentsPanel: lists drafts newest first, and the badge count updates.
- **pgTAP** (extends `rls.test.sql` or adds `documents.test.sql`):
  - Users read and write only their own profile and documents.
  - Outsiders and the password provider get nothing.
  - `user_id` cannot be reassigned.
  - Inserting a document for a role the caller cannot see fails.
  - `job_description` follows the roles rules.
- **Deno tests** for the functions, with an injected fake Anthropic client and a local Supabase:
  - 401 without a login or with the wrong provider; 400 for bad input; 409 without a profile; 429 at the limit.
  - A successful stream saves exactly one document with token counts; a refusal saves nothing.
  - Fetch returns `unavailable` when the tool result is an error.
- **CI:** add a job running `deno test` for `supabase/functions`.
- **Live smoke test after deploy** (Mike): generate one cover letter for the Interex AI Engineer role and check the facts against the profile.

## Deployment

1. **Create the key.** Create an Anthropic API key `jobfinder` in InoGen's account (Mike), then `npx supabase secrets set ANTHROPIC_API_KEY=… --project-ref unvfkjsgxmzqasrblszo`. The key never goes into the repo or the chat.
2. **Apply the migration** through the Management API, as in the first release.
3. **Deploy the functions:** `npx supabase functions deploy generate fetch-posting --project-ref unvfkjsgxmzqasrblszo`.
4. **Ship the frontend** through the existing Pages workflow.

## Out of scope

Emailing or submitting applications, PDF export, CV upload as a PDF, sharing drafts with colleagues, and per-organisation spend dashboards. Each can be added later without changing this design.
