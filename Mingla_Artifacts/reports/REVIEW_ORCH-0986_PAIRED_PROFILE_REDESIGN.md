# REVIEW — ORCH-0986 [Paired-profile redesign]

**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-28
**Branch:** `ORCH-0986-paired-profile-holidays-redesign` (worktree `~/Desktop/mingla-orchs/ORCH-0986-[paired-profile-holidays-redesign]/`)
**Reviewed against:** SPEC `5bd754ce6`, DESIGN `8f8561aca`, INVESTIGATION, IMPLEMENTATION report.

## VERDICT: NEEDS WORK

Code substance is largely strong; two hard blockers (one process, one functional) plus one cross-ORCH flag prevent APPROVED. Routes back to implementor, not tester.

---

## Commit-hash verification (DEC-179 — REQUIRED section)

**FAIL.** HEAD is `5bd754ce6` (the SPEC commit). `git log 5bd754ce6..HEAD` is empty and `git diff --stat 5bd754ce6..HEAD` is empty. All 13 claimed-changed files + the new files are **uncommitted** in the working tree (`git status --porcelain` = 22 entries). Per DEC-179 the verdict is automatically NEEDS WORK — there is no "commit after review" path. The reviewed artifact must be the committed artifact.

## Dependency walk (config-layer changes — REQUIRED section)

Config-layer files touched: `.github/workflows/strict-grep-mingla-business.yml` (new job), `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (backend allowlist), `supabase/config.toml` (new function registration).
- `strict-grep-mingla-business.yml`: additive job (new ORCH-0986 gate). Consistent with the registry pattern (`feedback_strict_grep_registry_pattern`). No existing job altered (verify at commit).
- `orch-0863...mjs` allowlist: adds the 6 ORCH-0986 backend files **plus** two ORCH-0978 migrations (see cross-ORCH flag). COMMS-0002 obligation met for ORCH-0986 files.
- `supabase/config.toml`: registers `get-paired-profile-cards`. Must preserve `verify_jwt` default (authenticated). Verify the diff doesn't alter other functions' settings.

---

## What PASSED (verified against the actual working tree)

1. **DB RPC (SPEC §3.1) — excellent.** `get_paired_friend_last_location`: `SECURITY DEFINER`, `set search_path = public, pg_temp`, both-direction pairing consent gate (returns nothing if not paired → I-0986-PAIR-CONSENT), read-only, `revoke all from public` + `grant execute to authenticated`. Returns latest `user_location_history` row.
2. **Friend-GPS-only, no fallback (I-0986-FRIEND-GPS-ONLY).** `resolveFriendLocation` (`_shared/personHeroCards.ts:286`) calls the RPC and returns `null` on error/no-data — no fallback to viewer or preference location.
3. **No coordinate leak (I-0986-NO-COORD-LEAK).** `get-paired-profile-cards` returns only `{ locationStatus, sections }`; the resolved friend lat/lng is used internally (line 116) and never serialized to the client.
4. **RC-1 curated image/field fix.** Mapper reads camelCase + stop-image fallback; `generate-curated-experiences` writes top-level `imageUrl` from real stop imagery. No fabrication (null stop image → no fabricated media).
5. **Regression anchor (Step 0.5 happy-path) — real.** `_shared/personHeroCards.test.ts` asserts the curated camelCase mapping (image/category/priceTier/totals/duration/shoppingList/stops) + a stop-image fallback test. Reverting the RC-1 fix breaks these assertions — genuine fails-on-revert. (Implementor ran `deno test` PASS.)
6. **No heart/save button** on the hero (I-0986-NO-HEART). The surviving `handleSaveCard`/`onSaveCardPress` is the legitimate save-from-ExpandedCardModal / saves-list flow, not a hero control. Strict-grep C1 (`<Icon name="heart"` / `saveProfile|profileSave|saveButton`) correctly passes.
7. **No "Ideal night out"** (C3) — absent from both profile components.
8. **Strict-grep gate** `orch-0986-paired-profile.mjs` is well-formed: C1 no-hero-heart, C2 no-client-location + server-side `resolveFriendLocation` in both endpoints, C3 no-ideal-night-out. Backend allowlist updated (COMMS-0002).
9. **Batched endpoint shape** (SPEC §3.2d): one call, server-resolved location, per-section results, server-side dedup, `skipDescriptions` path.

---

## Blockers (must fix before re-review)

### B-1 — P0 process: nothing committed (DEC-179)
All ORCH-0986 work is uncommitted. Commit the scoped work atomically on the branch (logical commits acceptable: DB+edge / service+hook / UI / gate+test). **Exclude** `app-mobile/node_modules`, `mingla-admin/node_modules`, `mingla-business/node_modules` (symlinks; never stage). After commit, every changed file must show on `git log`.

### B-2 — P1 functional: batched sections use `DEFAULT_PERSON_SECTIONS` for every occasion (SPEC §3.2d deviation)
`PersonHolidayView.tsx:863,866,869` build all batched requests with `DEFAULT_PERSON_SECTIONS` as the category basis (birthday, custom, holidays alike). SPEC §3.2d requires each section to carry its own occasion-resolved categories so per-occasion singles stay personalized (e.g., Valentine's → fine_dining/drinks/flowers; birthday → play/fine_dining/drinks). As written, every occasion's singles draw from the same generic category set — a real personalization regression vs the pre-redesign per-section path (which used `useHolidayCategories` per occasion). Combos are unaffected (composition is server-derived from `holidayKey`), so the gap is singles-only, but it is a SPEC deviation.
- **Forensics ruling (the implementor's open question):** this MUST be fixed. **Preferred approach:** derive each section's `categorySlugs` **server-side from `holidayKey`** inside `get-paired-profile-cards` (the edge fn already has `INTENT_CATEGORY_MAP` + `getCompositionForHolidayKey`), so the client need not gather per-section AI categories before the batched call. Alternative: gather each occasion's `useHolidayCategories` output at the parent and pass per-section `categorySlugs`. Implementor picks one; document the choice. Add/extend a test asserting two different `holidayKey`s yield different singles signal sets.

---

## Flags (resolve, not necessarily blockers)

### F-1 — cross-ORCH migration contamination (P1 coordination)
The branch carries two ORCH-0978 migrations (`20260730000000_orch_0978_video_cap_29s_constraints.sql`, `..._0001_..._generous_source.sql`), source-reconciled by the implementor because they were remote-only. Per the migration-list rule this fixes local `db push`, BUT committing them on the ORCH-0986 branch means **this PR will introduce them to `main`** — colliding with / pre-empting ORCH-0978's own ownership. Required before re-review: (a) confirm the two files match the already-applied remote versions byte-for-byte (not invented), and (b) coordinate with ORCH-0978 via a COMMS entry — decide whether they ride this PR (operator-approved) or are excluded and ORCH-0978 merges them. Do not silently land another ORCH's migrations.

### F-2 — no simulator QA (expected — tester's job)
Implementor did no iOS/Android sim QA. Not an implementor blocker; flagged so the tester does full `proven`-level live-fire on both platforms (per Prime Directive #7) at the TEST phase.

### F-3 — verify `supabase/config.toml` diff
Confirm the new-function registration doesn't alter other functions' `verify_jwt`/settings (dependency-walk item).

---

## Routing
NEEDS WORK → Codex `implementor-mingla` for B-1 (commit), B-2 (per-occasion categories), F-1 (migration coordination + COMMS), F-3 (config check). After rework returns: re-REVIEW (commit-hash + dependency-walk), then operator `db push`, then orchestrator deploys edge functions (verify-first curl), then `mingla-tester` iOS+Android. The migration + RPC + curated fix are sound — the rework is bounded.

---

# RE-REVIEW (Pass 2) — 2026-05-28 — VERDICT: APPROVED

Reviewed at pushed HEAD `8a8fb284c` (rework commit `facfa227a` + report update `8a8fb284c`).

## Commit-hash verification (REQUIRED)
**PASS.** All scoped ORCH-0986 work is committed in `facfa227a` (18 files, +1974/-1227): the 3 strict-grep/workflow files, 6 mobile files, `config.toml`, the 4 backend function/test files, and the 3 migrations. Report update in `8a8fb284c`. Only the 3 `node_modules` symlinks remain uncommitted (correctly excluded). `git log` shows every claimed-changed file on the branch.

## Dependency walk (REQUIRED)
- `supabase/config.toml`: diff adds ONLY `[functions.get-paired-profile-cards] verify_jwt = true` — no other function's settings altered. ✓
- `.github/workflows/strict-grep-mingla-business.yml`: additive ORCH-0986 job; no existing job changed. ✓
- `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`: additive backend allowlist (6 ORCH-0986 files + 2 source-reconciled ORCH-0978 migrations). ✓

## Blocker / flag resolution
- **B-1 (uncommitted) — RESOLVED.** Work committed atomically; node_modules excluded.
- **B-2 (DEFAULT_PERSON_SECTIONS) — RESOLVED.** New shared `resolveHolidayCategorySlugs(holidayKey)` derives per-occasion categories server-side in `get-paired-profile-cards` (client sends real per-holiday categories where available; birthday/custom server-derived). `DEFAULT_PERSON_SECTIONS`-for-all removed from the batched request build. New test `ORCH-0986 batched profile derives occasion-specific singles signals` asserts birthday ≠ valentines signal sets and birthday includes `play`. Singles personalization restored.
- **F-1 (ORCH-0978 migration contamination) — RESOLVED.** COMMS-0008 written + pushed on `main` (`9d495879f`, WARN → ORCH-0978). Files verified byte-for-byte matching remote (SHA256 recorded in impl report). `migration list --linked` confirms both ORCH-0978 versions already applied remotely (no remote-only drift); only `20260730000002` (ORCH-0986 RPC) is local-only/pending. Decision documented: files ride ORCH-0986 as source-reconciliation; ORCH-0978 retains ownership and must not land divergent copies.
- **F-3 (config.toml) — RESOLVED** (see dependency walk).

## Carry-forward (non-blocking, for CLOSE/tester)
- F-2: no sim QA — `mingla-tester` performs `proven`-level iOS + Android live-fire at TEST.
- At CLOSE/merge: ensure ORCH-0978's eventual PR does NOT re-add `20260730000000/0001` (they land on main via this PR per COMMS-0008).

## Pre-flight for db push (PASS)
`migration list --linked`: no remote-only rows; only `20260730000002` pending. Safe to `db push` (applies the additive read-only RPC only).

**APPROVED → proceed to operator-authorized db push → orchestrator edge deploy (verify-first) → `mingla-tester` iOS+Android.**
