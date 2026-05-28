# IMPLEMENTATION_ORCH-0986_PAIRED_PROFILE_REDESIGN

## Status

Implemented, partially verified.

ORCH-0986 paired-profile cards now use server-side friend GPS only, the paired profile UI has the redesigned hero/sheet/card treatment, paired recommendation rows load through the new batched endpoint, and the REVIEW rework items B-1, B-2, F-1, and F-3 are addressed. The database migration has not been pushed and edge functions have not been deployed, per the hard guards.

## Commit Hashes

- Implementation code/gates/migrations commit: `facfa227a` (`ORCH-0986: implement paired profile cards redesign`)
- COMMS ledger coordination commit on anchor `main`: `9d495879f` (`COMMS-0008: coordinate ORCH-0978 video cap migrations`)

## Inputs Read

- `Mingla_Artifacts/specs/SPEC_ORCH-0986_PAIRED_PROFILE_REDESIGN.md`
- `Mingla_Artifacts/reports/REVIEW_ORCH-0986_PAIRED_PROFILE_REDESIGN.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0986_PAIRED_PROFILE_HOLIDAYS.md`
- `Mingla_Artifacts/reports/DESIGN_ORCH-0986_PAIRED_PROFILE_REDESIGN.md`
- COMMS ledger entries `COMMS-0002`, `COMMS-0003`, `COMMS-0004`, and new `COMMS-0008`

## Rework Response

### B-1 Commit Discipline

Committed all scoped ORCH-0986 implementation files on branch `ORCH-0986-paired-profile-holidays-redesign` in commit `facfa227a`. The three untracked symlinks remain excluded:

- `app-mobile/node_modules`
- `mingla-admin/node_modules`
- `mingla-business/node_modules`

### B-2 Occasion-Specific Singles Signals

Fixed the batched endpoint so singles no longer reuse one generic category basis for every occasion. The client no longer sends `DEFAULT_PERSON_SECTIONS` as the initial batched basis for birthday/custom occasions, standard holidays send their own `holiday.sections`, and `get-paired-profile-cards` normalizes every section through the new server helper `resolveHolidayCategorySlugs`.

Server-side behavior now derives section category slugs from `holidayKey` and `getCompositionForHolidayKey` before `resolveBlendedPreferences` and `resolveSignalIds` run. The batched endpoint no longer computes one `preferenceContext` from the first section and reuses it across all sections. Added a Deno regression test proving two different holiday keys with the same generic client slugs produce different singles signal sets.

### F-1 ORCH-0978 Migration Coordination

Confirmed the two ORCH-0978 migration files in this branch byte-for-byte match the ORCH-0978 worktree copies:

- `20260730000000_orch_0978_video_cap_29s_constraints.sql`: `9fb19cefb8e44fc72339d5772d9026c6d7d977dd3eba68d2ed8d269ad949400d`
- `20260730000001_orch_0978_video_cap_generous_source.sql`: `759e7ead504d8e8452f8cc9b9afbb6755f8c98d5074585641f7ad7793154f60f`

`/Users/sethogieva/bin/supabase migration list --linked` shows both versions present locally and already applied remotely. Wrote and pushed `COMMS-0008` on anchor `main`: the decision is that these two ORCH-0978 files intentionally ride ORCH-0986 as source reconciliation only, while ORCH-0978 remains the owner and must not land divergent copies.

### F-3 Config Diff

Verified `supabase/config.toml` changes only add:

```toml
[functions.get-paired-profile-cards]
verify_jwt = true
```

No other function registration or `verify_jwt` value is altered.

## Database Work

Added migration:

- `supabase/migrations/20260730000002_orch_0986_paired_friend_last_location.sql`

The migration adds `public.get_paired_friend_last_location(p_viewer_id uuid, p_friend_id uuid)` as a `SECURITY DEFINER` RPC. It verifies an active pairing in either direction before returning the paired friend's latest `user_location_history` row. It makes no writes, changes no RLS policy, and returns no row for non-paired users.

Migration list result: no remote-only rows remain. `20260730000002` is local-only and is the ORCH-0986 migration Seth must apply after re-review.

Apply command after re-review:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0986-[paired-profile-holidays-redesign]" && /Users/sethogieva/bin/supabase db push --linked
```

## Backend Implementation

Added shared helper:

- `supabase/functions/_shared/personHeroCards.ts`

Key behavior:

- Maps curated combo cards with camelCase and snake_case support.
- Preserves real curated image fields, totals, duration, shopping list, category label, and price tier.
- Falls back only to real stop images when a top-level curated image is missing.
- Resolves friend location server-side through `get_paired_friend_last_location`.
- Keeps friend coordinates inside edge function execution and out of client responses.
- Uses city-scale driving radius for paired combo planning.
- Derives occasion-specific category slugs from composition rules before singles signals are resolved.

Updated endpoints:

- `supabase/functions/get-person-hero-cards/index.ts`
- `supabase/functions/get-paired-profile-cards/index.ts`

Key behavior:

- Paired requests ignore client location and resolve the paired friend's latest GPS server-side.
- Missing friend GPS returns `locationStatus: "missing"` with no fallback cards.
- Batched profile load builds birthday, custom, and holiday sections in one request.
- Single-place cards are deduped across sections in stable section order.
- Responses return per-section cards and summaries without coordinate fields.

Updated producer:

- `supabase/functions/generate-curated-experiences/index.ts`

Key behavior:

- Writes top-level `imageUrl` from real combo stop imagery.

## Mobile Implementation

Updated services and hooks:

- `app-mobile/src/services/personHeroCardsService.ts`
- `app-mobile/src/hooks/queryKeys.ts`
- `app-mobile/src/hooks/usePairedCards.ts`
- `app-mobile/src/hooks/usePairedProfileCards.ts`

Updated UI:

- `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx`
- `app-mobile/src/components/PersonHolidayView.tsx`

Key behavior:

- Full-bleed profile-photo hero and overlapping white sheet.
- Bio quote card, interest pills, dark Message CTA, and redesigned holiday/recommendation content.
- One batched paired-profile query for initial sections.
- Loading, error, friend-GPS-missing, no-cards, and populated row states.
- Curated modal receives stop arrays for expanded multi-stop plans.
- No added hero heart/save button and no "Ideal night out" copy.

## Guardrails

Added strict-grep gate:

- `.github/scripts/strict-grep/orch-0986-paired-profile.mjs`

Added workflow job:

- `.github/workflows/strict-grep-mingla-business.yml`

Updated backend allowlist:

- `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`

## Regression Tests

Added:

- `supabase/functions/_shared/personHeroCards.test.ts`

Coverage:

- Curated combo mapping preserves camelCase image, price, duration, shopping list, category label, and stops.
- Curated image fallback uses a real stop image only, not fabricated media.
- Batched paired profile derivation produces different singles signal sets for birthday and Valentine's Day when the generic client input is identical.

## Verification

Passed:

```bash
/Users/sethogieva/.deno/bin/deno check supabase/functions/get-paired-profile-cards/index.ts
/Users/sethogieva/.deno/bin/deno check supabase/functions/get-person-hero-cards/index.ts
/Users/sethogieva/.deno/bin/deno check supabase/functions/generate-curated-experiences/index.ts
/Users/sethogieva/.deno/bin/deno test supabase/functions/_shared/personHeroCards.test.ts
node .github/scripts/strict-grep/orch-0986-paired-profile.mjs
node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
/Users/sethogieva/bin/supabase migration list --linked
```

Deno test result:

- `3 passed | 0 failed`

Config diff verified:

- `git diff -- supabase/config.toml` only registers `get-paired-profile-cards` with `verify_jwt = true`.

Partially blocked:

```bash
cd app-mobile && npx tsc --noEmit
```

Full app-mobile TypeScript still fails on existing repo-wide issues in Deno-style tests, board discussion, native checkout, and shared packages. A targeted grep of the TypeScript output for touched ORCH-0986 files returned no matching errors:

```bash
npx tsc --noEmit 2>&1 | rg 'PersonHolidayView|ViewFriendProfileScreen|usePairedProfileCards|usePairedCards|personHeroCardsService|queryKeys' || true
```

## Not Run

- Did not run `supabase db push`.
- Did not deploy edge functions.
- Did not run iOS or Android simulator QA; tester owns full device/simulator live-fire after re-review, db push, and edge deploy.

## Changed Files

- `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`
- `.github/scripts/strict-grep/orch-0986-paired-profile.mjs`
- `.github/workflows/strict-grep-mingla-business.yml`
- `app-mobile/src/components/PersonHolidayView.tsx`
- `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx`
- `app-mobile/src/hooks/queryKeys.ts`
- `app-mobile/src/hooks/usePairedCards.ts`
- `app-mobile/src/hooks/usePairedProfileCards.ts`
- `app-mobile/src/services/personHeroCardsService.ts`
- `supabase/config.toml`
- `supabase/functions/_shared/personHeroCards.test.ts`
- `supabase/functions/_shared/personHeroCards.ts`
- `supabase/functions/generate-curated-experiences/index.ts`
- `supabase/functions/get-paired-profile-cards/index.ts`
- `supabase/functions/get-person-hero-cards/index.ts`
- `supabase/migrations/20260730000000_orch_0978_video_cap_29s_constraints.sql`
- `supabase/migrations/20260730000001_orch_0978_video_cap_generous_source.sql`
- `supabase/migrations/20260730000002_orch_0986_paired_friend_last_location.sql`

---

## REWORK (orchestrator-executed) — 2026-05-28 — QA FAIL fixes

### P0-001 — RPC coordinate leak (FIXED + verified live)
Root cause: original migration granted `EXECUTE` to `authenticated`; the SECURITY DEFINER function was thus callable via the PostgREST RPC surface and returned raw friend GPS.
Fix: new migration `supabase/migrations/20260730000003_orch_0986_lock_friend_location_rpc.sql` — `revoke all ... from public, anon, authenticated; grant execute ... to service_role`. Applied to remote via `db push`.
Verification (live):
- Anon REST attack (QA's exact UUIDs + real anon key) → `HTTP 401 {"code":"42501","message":"permission denied for function get_paired_friend_last_location"}`. No coordinates returned.
- ACL after fix (`pg_proc.proacl`): `{postgres=X/postgres,service_role=X/postgres}` — only owner + service_role; anon/authenticated/PUBLIC have no EXECUTE.
- Edge functions unaffected (they call via the service-role admin client) — no redeploy needed (grant-only change, signature/body unchanged).
Regression guard: strict-grep `orch-0986-paired-profile.mjs` C4 asserts the lock migration revokes anon + authenticated and grants service_role.

### P1-002 — Shuffle dead tap (FIXED)
Root cause: `useShufflePairedCards` wrote results into the legacy `personCardKeys.paired(...)` key while the UI reads the batched `personCardKeys.pairedProfile(...)` cache; `CardRow` then called `refetchProfile()` which reloaded default (non-shuffled) cards.
Fix: `useShufflePairedCards` now takes `mode` and splices `result.cards` into the matching `pairedProfile(pairedUserId, mode)` section slice via `setQueryData`. `CardRow.handleShuffle` passes the active `mode` and no longer calls `refetchProfile()`. Shuffle now updates the visible row in place.

### P2-001 — Adversarial test committed
`supabase/functions/_shared/personHeroCards.adversarial.test.ts` (GPS-missing → resolveFriendLocation returns null, no invented fallback) is now committed and allowlisted. `deno test` 4/4 PASS (3 implementor + 1 adversarial).

### P2-002 — Branch pushed
Local review-report commit + this rework pushed to `origin/ORCH-0986-paired-profile-holidays-redesign`.

### Verification evidence
- `deno test _shared/personHeroCards.test.ts _shared/personHeroCards.adversarial.test.ts` → 4 passed / 0 failed.
- `node strict-grep/orch-0986-paired-profile.mjs` → C1/C2/C3/C4 PASS.
- `node strict-grep/orch-0863-marketing-hub-phase-b.mjs` → C7 PASS (new migration + adversarial test allowlisted).

### Not re-run (tester's job)
P1-001 iOS/Android live-fire remains for the tester re-dispatch (use the iOS dev-build rebuild runbook for the splash-hang; Android Gradle hang needs a clean build). No code defect — environment blocker.
