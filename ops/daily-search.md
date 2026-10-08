# Daily role search (runs as a scheduled cloud routine)

Goal: keep the tracker current. Add new, relevant, open freelance roles; close untouched roles whose posting is gone.
The routine prompt supplies the candidate profile and the `INGEST_TOKEN`. Never write the token to a file, commit it, or print it.

## 1. Load what's already tracked

    python3 scripts/ingest.py list > /tmp/tracked.json

Use the `url`, `org` and `title` values to avoid re-adding roles. `touched: true` means the user has worked on a role: never try to close those.

## 2. Close postings that have ended (untouched roles only)

For every role with `status: "Shortlist"` and `touched: false`:
- If `deadline` is before today → close with reason `Deadline passed (YYYY-MM-DD)`.
- Otherwise fetch the `url` (curl, follow redirects, 20s timeout). Close only on clear evidence:
  HTTP 404/410, or page text such as "no longer available", "expired", "closed", "position filled",
  "vacature is gesloten", "niet meer beschikbaar", "Bewerbungsfrist abgelaufen", "nicht mehr verfügbar".
  A timeout, 403, 429 or login wall is NOT evidence: leave the role open.

Write `[{"id": ..., "reason": "Posting returns 404"}]` to `/tmp/close.json`, then:

    python3 scripts/ingest.py close /tmp/close.json

## 3. Find new roles

Search these sources, newest first; open every posting before including it:

| Market | Sources that work (2026-10) |
| --- | --- |
| UK | reed.co.uk search, LinkedIn guest jobs API (`linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=...&location=United%20Kingdom&f_TPR=r86400`), outsideir35.org.uk (latest listings), harnham.com job pages |
| NL | freelapp.nl category pages (curl), morganblack.nl jobs, freep.nl, LinkedIn guest jobs API (location=Netherlands) |
| DACH | freelancermap.de category pages (its search box ignores queries; browse skill categories), coopers.ch |
| Rest of EU | emagine public API `https://portal-api.emagine.org/api/JobAds/details/{id}/EN` (scan IDs above the highest seen), Verama (Ework) public API, justjoin.it (B2B), free-work.com |
| Global | himalayas.app API (contractor filter), Braintrust job API, work.mercor.com, Greenhouse/Ashby boards of AI companies, HN "Who is hiring" / "Freelancer?" threads via the Algolia API |

Skip: Striive, Headfirst, gulp.de, freelance.de (JS-only), Indeed (403), Malt, Wellfound/YC/Otta.

Include a role only if ALL hold:
- open, and posted or refreshed in the last 14 days (or a standing listing that is clearly still open);
- freelance / contract / B2B (no permanent-only jobs);
- remote, or hybrid ≤ 2 days/week in the Randstad (NL) — never on-site elsewhere;
- not already tracked (same normalised URL, or same organisation + title);
- not requiring a Dutch passport, security vetting the candidate can't get, or citizenship.

Rate fit: **Strong** = core skills match and workable location/language; **Good** = solid match with one gap; **Stretch** = notable gap (language, stack, clearance, UK-residency hint).
Never invent rates or dates: use "" or null when the posting doesn't state them. Dates must be YYYY-MM-DD.

Write the new roles as a JSON array to `/tmp/new.json`, each:

    {"title", "org", "market": "UK|NL|EU|Global", "location", "remote", "rate", "ir35", "duration",
     "posted", "deadline", "fit": "Strong|Good|Stretch", "why", "caveat", "url", "contact"}

then:

    python3 scripts/ingest.py add /tmp/new.json

## 4. Report

End with a short summary: roles added (by market and fit, naming any Strong ones), roles closed (with reasons),
sources that failed today. Do not commit anything to the repository.
