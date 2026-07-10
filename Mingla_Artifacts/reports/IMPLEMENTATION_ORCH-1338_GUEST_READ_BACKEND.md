# IMPLEMENTATION — ORCH-1338 [guest-read-backend]

**META:** META-ORCH-1337 [social-proof-guest-list] · Leg 1 of 5
**Phase:** IMPLEMENT (mingla-implementor)
**Binding contract:** `Mingla_Artifacts/specs/SPEC_ORCH-1338_GUEST_READ_BACKEND.md` (implemented exactly; zero scope widening)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1337-[social-proof-guest-list]` on branch `META-ORCH-1337-social-proof-guest-list`
**Commits:** code+tests `208d8ca7e` · report (this file) — see closing commit
**Date:** 2026-07-10
**Status label:** implemented, partially verified (all static/structural gates green locally; live-DB behavior is the tester's live-fire per SPEC §7 — nothing was applied to prod)

---

## 1. Summary

Built the ONE privacy-aware backend read layer the whole social-proof META rides on — no UI, no RLS change, nothing applied to prod:

1. **`pg_public_social_proof(p_event_id uuid) RETURNS json`** — anon-callable counts + avatar-sample read, uniform across rsvp/event/trip/experience. Fixes F-3 (the ticketed "going" count is now the ABSOLUTE live-ticket count under SECURITY DEFINER — the unlimited-capacity hole is closed). Carries both host gates (`privateGuestList`, `hideRemainingCount`) server-side; `privateGuestList=true` empties the sample IN the RPC (D2). The sample carries EXACTLY `{avatarUrl, isMinglaUser}` — no names/ids for anon AND authed alike (D1).
2. **`peer_list_event_guests(p_event_id, p_limit, p_offset) RETURNS json`** — authed-only, guard-FIRST (auth → event public+scheduled/live → `guest_list_private` → LEAST/GREATEST hard cap ≤100), column-whitelisted guest list with the D1 identity mapping (named / linked-private-anonymous / unlinked-anonymous / blocked-pair-excluded) for the future ORCH-1341 sheet.
3. **`packages/offering-rendering/socialProofTypes.ts`** — the frozen, dep-free TS payload contract (5 types + `SOCIAL_PROOF_SAMPLE_MAX = 5`) that ORCH-1339/1340/1341 consume as props (I-MOR-0827), exported from the package barrel.

Plus three append-only regression suites (27 assertions total, all passing) with a demonstrated fails-on-revert.

## 2. SPEC success-criteria coverage

Caller-class split per SPEC §5. "Static ✓" = structurally pinned by the committed test suites at `208d8ca7e`; live-DB proof is the tester's mandate (headless QA insufficient for SQL RPCs — live-fire vs prod at TEST).

| SC | How it is met | Verification | Status |
|---|---|---|---|
| SC-1 | FN-A rsvp branch: `SUM(1 + r.plus_count)` over going+approved; `capacity := rsvp_capacity`; gates from `events.theme`; sample keys hard-whitelisted | T-13a + §9f + shape-A (static) · live at TEST (T-1) | ✓ static `208d8ca7e` |
| SC-2 | FN-A ticketed branch: absolute `COUNT(tickets valid/used/transferred)` (F-3 fix); capacity NULL iff any non-deleted tier unlimited/uncapped else Σ`quantity_total` | T-13c (static) · live at TEST (T-2/T-3/T-4) | ✓ static `208d8ca7e` |
| SC-3 | `v_private` read server-side in BOTH functions; FN-A returns gates + `sample: []` (agg never runs); FN-B raises `guest_list_private` | §9b + "IF NOT v_private ×2" assertions (static) · live at TEST (T-5, F-11 event) | ✓ static `208d8ca7e` |
| SC-4 | Sample predicates: `visibility_mode IN ('public','friends')`, avatar non-null + non-blank, both-direction `is_blocked_by`, `LIMIT 5` — each pinned ×2 branches | adversarial "FN-A sample" test (static) · live at TEST (T-6/T-7) | ✓ static `208d8ca7e` |
| SC-5 | FN-B: no anon grant (grant-layer denial) + in-function `authentication_required` guard as defense-in-depth — zero rows cross the wire unauthenticated | §9a + §9d (static) · live at TEST (T-8) — see §10 nuance | ✓ static `208d8ca7e` |
| SC-6 | D1 mapping in the SELECT: named only for linked+public/friends+unblocked; linked-private → all-null `isMinglaUser:true, isAnonymous:true`; unlinked → `isMinglaUser:false`; blocked pair excluded by WHERE; profiles column whitelist enforced; zero contact-data tokens in the file | "FN-B rows" + §9e (static) · live at TEST (T-14 live half, T-16) | ✓ static `208d8ca7e` |
| SC-7 | `LEAST(GREATEST(COALESCE(p_limit,50),1),100)`; offset floored 0; fetch `v_limit+1`; `hasMore = fetched > limit`; `returned = LEAST(fetched, limit)`; deterministic `ORDER BY is_named DESC, created_at, row_id` (query + window, both branches) | §9c + shape-B (static) · live scrape-walk at TEST (T-9) | ✓ static `208d8ca7e` |
| SC-8 | FN-A status set `scheduled/live/ended/cancelled` (page parity) + `RETURN NULL` on miss; FN-B restricted `scheduled/live` + `event_not_available` | guards-A + guards-B (static) · live at TEST (T-10/T-11) | ✓ static `208d8ca7e` |
| SC-9 | `NOTIFY pgrst, 'reload schema'` after COMMIT (house pattern of 20261223000000) | adversarial functions-only test (static) · orchestrator one-curl post-apply | ✓ static `208d8ca7e` |
| SC-10 | Migration contains zero policy/table DDL, zero RLS toggles, exactly 2 CREATE FUNCTION | adversarial functions-only test (static) · pg_policies diff at TEST (T-15) | ✓ static `208d8ca7e` |

## 3. Files changed (all at `208d8ca7e`; +1327 / −0)

| File | Δ |
|---|---|
| `supabase/migrations/20261225000000_orch_1338_social_proof_guest_reads.sql` | NEW, ~505 lines |
| `packages/offering-rendering/socialProofTypes.ts` | NEW, ~95 lines |
| `packages/offering-rendering/index.ts` | +13 lines (barrel exports for the new types ONLY) |
| `supabase/migrations/__tests__/orch_1338_social_proof_reads.test.ts` | NEW, ~300 lines |
| `supabase/migrations/__tests__/orch_1338_social_proof_reads.antiScrape.adversarial.test.ts` | NEW, ~265 lines |
| `packages/offering-rendering/__tests__/orch_1338_social_proof_types.test.ts` | NEW, ~150 lines |

Allowlist adherence: exactly the SPEC's 6 allowlisted paths; no DO-NOT-TOUCH file was opened for write. No stop-and-amend was needed.

**Migration version protocol:** live re-scan performed at IMPLEMENT (twice — entry + pre-commit): frontier = `20261223000000` on origin/main + all worktrees EXCEPT `1334-[rsvp-guest-identity]`, which now holds `20261224000000_orch_1334_rsvp_guest_identity.sql` (the SPEC predicted this). Version chosen: `20261225000000` — strictly greater than everything found. No function-name collision with 1334 (it touches `host_list_rsvp_guests` / `admin_list_event_rsvps` / `fetch_user_going_rsvps` only; verified by grep across all worktrees).

## 4. Data-model changes applied

**None.** Functions-only migration: 2 × `DROP FUNCTION IF EXISTS` + `CREATE FUNCTION` (SECURITY DEFINER, STABLE, `SET search_path = public`), REVOKE/GRANT pairs, 2 × `COMMENT ON FUNCTION`, `NOTIFY pgrst`. No table, column, index, constraint, or RLS policy added/dropped/altered (SC-10; SPEC §4.1.3).

Grants: `pg_public_social_proof` → `anon, authenticated`; `peer_list_event_guests` → `authenticated` ONLY. Both `REVOKE ALL ... FROM PUBLIC`.

## 5. Edge functions touched

**None** (SPEC §4.2 — both reads are Postgres RPCs via PostgREST; `verify_jwt` n/a; nothing to deploy at the edge).

## 6. Regression tests added (append-only — new files only; no existing test modified)

| Suite | Covers | Result |
|---|---|---|
| `supabase/migrations/__tests__/orch_1338_social_proof_reads.test.ts` (12 tests) | T-13 both halves + branch-span escape-proofing + guard order + frozen response shapes + pagination contract | PASS |
| `supabase/migrations/__tests__/orch_1338_social_proof_reads.antiScrape.adversarial.test.ts` (10 tests) | SPEC §9 (a)–(f) + sample-privacy predicates + FN-B whitelist scan + functions-only/SC-10 static | PASS |
| `packages/offering-rendering/__tests__/orch_1338_social_proof_types.test.ts` (5 tests) | T-12: purity (no import/fetch/react), 5 symbols + constant 5, compile-time shape check, barrel re-export | PASS |

Passing run (verbatim tail, all three suites):

```
ok | 27 passed | 0 failed (111ms)
```

**Fails-on-revert (true line deletion, not comment-out):** deleted the line `RAISE EXCEPTION 'guest_list_private';` from the migration → adversarial suite:

```
§9b FN-B: guest_list_private gate precedes row reads (D2 server-enforced) ... FAILED (0ms)
FAILED | 9 passed | 1 failed (7ms)
```

Restored via `git checkout --` → full re-run:

```
ok | 27 passed | 0 failed (111ms)
```

**fails-on-revert verified at 208d8ca7e**

Run command (repo root): `deno test --allow-read supabase/migrations/__tests__/orch_1338_social_proof_reads.test.ts supabase/migrations/__tests__/orch_1338_social_proof_reads.antiScrape.adversarial.test.ts packages/offering-rendering/__tests__/orch_1338_social_proof_types.test.ts`

## 7. Old → New receipts

### supabase/migrations/20261225000000_orch_1338_social_proof_guest_reads.sql
**What it did before:** did not exist. No peer/anon guest read path existed at any layer (F-8); the absolute ticketed sold count was not anonymously readable when any tier is unlimited (F-3); the two host privacy toggles were stored but read by nothing public (F-4).
**What it does now:** creates the two guard-first SECURITY DEFINER read RPCs described in §1, per SPEC §4.1.1/§4.1.2 verbatim (formulas byte-parity with `pg_public_rsvp_by_slug` and ORCH-0946; status sets, error tokens, clamps, whitelists, grants exactly as contracted). Carries load-bearing `[ORCH-1338 FN-A/FN-B RSVP/TICKETED-BRANCH-BEGIN/END]` markers that the test suites partition on (COMMS-0057 separation is machine-checked).
**Why:** SC-1…SC-10; D1/D2/D3; F-3/F-4/F-8 fixes.
**Lines:** ~505 new.

### packages/offering-rendering/socialProofTypes.ts
**What it did before:** did not exist; downstream legs had no shared payload contract.
**What it does now:** frozen dep-free contract — `SOCIAL_PROOF_SAMPLE_MAX = 5`, `SocialProofEntityType`, `SocialProofSampleEntry`, `SocialProofSummary`, `PeerGuestRow`, `PeerGuestListPage` — camelCase-identical to the two RPC payloads (no client mapping layer). No imports, no fetch, no react (I-MOR-0827).
**Why:** SPEC §4.4; ORCH-1339 §4.1 imports these names as a frozen API.
**Lines:** ~95 new.

### packages/offering-rendering/index.ts
**What it did before:** barrel without the social-proof contract.
**What it does now:** re-exports the constant + the 5 types from `./socialProofTypes` (one commented block; nothing else touched).
**Why:** SPEC allowlist item 3 ("barrel exports for the new types ONLY").
**Lines:** +13.

### The three test files
**Before:** no guard protecting the new contract. **Now:** 27 assertions pinning branch separation, guard order, grants, whitelists, shapes, purity, and the barrel (receipts folded into §6). **Why:** SPEC §7 T-12/T-13/T-14-static + §9; CLOSE-gate regression protection.

## 8. Cross-surface impact

Backend-only leg — no user-visible behavior changes anywhere until ORCH-1339+ consume the RPCs (SPEC §3).

| Surface | Affected now? | Reason / parity |
|---|---|---|
| Consumer iOS | No | nothing consumes the RPCs yet; future parity AUTOMATIC (single shared RPC + shared types) |
| Consumer Android | No | same |
| Buyer/anon Web | No | same (FN-A is anon-callable for it, unconsumed) |
| Business iOS | No | same |
| Business Android | No | same |
| Admin Web (adjacent) | No | ORCH-1334's admin twin owns admin attendee views |
| Business Web preview (adjacent) | No | same as buyer web |

The per-caller shape difference (anon vs authed) is enforced INSIDE the RPCs — never client-side (D1).

## 9. Smoke result

No sim/device run — backend + types leg with zero UI surface (the SPEC's Cross-Surface Impact declares no user-visible behavior). Gates run instead, inside the worktree:

- 3 Deno suites: **27 passed / 0 failed** (output in §6).
- `meta-orch-0827-package-isolation.mjs` strict-grep gate: **"META-ORCH-0827 package isolation gate PASS."**
- `deno check packages/offering-rendering/socialProofTypes.ts`: clean; `deno test` also type-checks all three suites strict (a TS strictness error was surfaced and fixed during the run).
- tests-append-only posture: only NEW test files added; no existing test modified/deleted.

Unrun gates (environment): `npx tsc -p packages/offering-rendering/tsconfig.json` — no `node_modules` in this worktree (types file is dep-free; deno strict check + T-12d compile-check stand in; CI web-build compiles the barrel). Local SQL parse against a real postgres — no local postgres binary; the SQL follows the verbatim-read house exemplars and is proven at apply + tester live-fire.

## 10. Known issues / deferred

- **SC-5 nuance (per-spec, flagged for the tester):** an anon PostgREST call to `peer_list_event_guests` is rejected at the GRANT layer (permission denied) BEFORE the in-function `authentication_required` guard runs — the guard is defense-in-depth exactly as the SPEC layers it (§4.1.2 grants + guard 1). SC-5's observable ("zero rows ever cross the wire unauthenticated") holds either way; the tester should accept either the Postgres permission error or the `authentication_required` token for the anon case.
- **`event_rsvp_guests.matched_user_id`** identity rows deferred out of FN-B's row model per SPEC §10.1 (plus-ones stay inside `partySize`; live table empty — F-11).
- **SPEC Open Q3 default kept:** FN-A answers on ended/cancelled events (page parity). Flipping to scheduled/live-only is a one-line change if Seth prefers momentum to go dark post-event.
- No `[TRANSITIONAL]` code introduced.

## 11. Operator action required (orchestrator, at DEPLOY — NOT the implementor)

1. **Apply the migration to prod `gqnoajqerqhnvulmnyvv` via the Management API** (SPEC §4.1 mandates Management API, not blind `db push` — migration-history drift memory): execute the full contents of `supabase/migrations/20261225000000_orch_1338_social_proof_guest_reads.sql`, then record the version `20261225000000` per the house migration-registration procedure. The migration is idempotent-safe to re-run (DROP IF EXISTS + CREATE). No pre-apply data probe is required — functions-only, no guards/backfills that can abort on existing rows.
   - Fallback CLI form (only if the linked-CLI path is current house practice at apply time): `cd ~/Desktop/mingla-orchs/META-ORCH-1337-[social-proof-guest-list] && /Users/sethogieva/bin/supabase db push --linked` — NOTE: this worktree is NOT linked (verified: "Cannot find project ref") and remote drift could not be checked from here; reconcile before any CLI push.
2. **One-call verify each function (SC-9):**
   - FN-A (expect a JSON object for a live public event id, `null` for a random uuid):
     `curl -s -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/rest/v1/rpc/pg_public_social_proof" -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>" -H "Content-Type: application/json" -d '{"p_event_id":"<live-public-event-uuid>"}'`
   - FN-B as anon (expect a permission/auth error, NEVER rows):
     `curl -s -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/rest/v1/rpc/peer_list_event_guests" -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>" -H "Content-Type: application/json" -d '{"p_event_id":"<same-uuid>"}'`
3. **Dispatch mingla-tester** for the SPEC §7 live-fire table (T-1…T-11, T-14 live half, T-15, T-16) with the anon key + a real user JWT; dedicated test-event seeds only; never mutate the F-11 live host's event beyond reads.
4. At CLOSE: flip the three I-PROPOSED-1338-* invariants ACTIVE; ORCH-1339 may IMPLEMENT in parallel now (contract frozen at `208d8ca7e`) but must not SHIP before this migration is applied.

## 12. Discoveries for Orchestrator

1. **ORCH-1334's migration has landed in its worktree as `20261224000000_orch_1334_rsvp_guest_identity.sql`** (not on origin/main yet). Versions stay monotonic in any merge order; zero file/function overlap with this leg — but both add DEFINER read RPCs, so apply BOTH via the same Management-API procedure and keep registration order by version.
2. **COMMS-ledger acks not writable from this leg:** the SPEC's DO-NOT-TOUCH list includes `COMMS_LEDGER.md`. All OPEN WARN rows addressed to ALL were read and factored (COMMS-0057 is machine-enforced by T-13; the rest are ship notices / ID-space warnings with no bearing). Please record acks for `mingla-implementor+claude (ORCH-1338)` at the next orchestrator ledger write.
3. **No rebase performed (deliberate deviation from Pre-Flight Step 1 default):** two sibling SPEC agents were actively reading this worktree and the SPEC pins branch commit hashes (`0d3caa388`, `780244dcc`) that a rebase would rewrite. Verified instead that the 5 commits on origin/main not in this branch (`dd10e8308`…`4556ae15b` — partner pages, notifications sheet, docs) touch ZERO files in this leg's allowlist or dependency set. Recommend the orchestrator rebase/merge at PR time.
4. **Worktree is not Supabase-linked** — `supabase migration list --linked` cannot run here; remote-drift check deferred to apply time (item 11.1).
5. **Untracked sibling artifacts present** (`Mingla_Artifacts/specs/SPEC_ORCH-1340_CARD_REAL_AVATARS.md`, `SPEC_ORCH-1342_WEB_FUNNEL.md`) — owned by the sibling SPEC agents; deliberately NOT staged by this leg's commits.
