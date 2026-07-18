# IMPLEMENTATION — ISSUE-939 · Instagram delivery for Meta ads

**Working tree:** `~/Desktop/mingla-orchs/issue-940-[meta-instagram-delivery]/` on branch `issue-940-meta-instagram-delivery`
**Status:** implemented and verified (source + runtime tests; live re-verify is the tester's leg)
**Commits:** `898091acc` (implementation), `87ec80eae` (regression tests)

---

## 1. Summary (plain English)

Meta ads were delivering **Facebook-only** because the shared creative builder posted no
`instagram_user_id`. The @usemingla IG account `17841477287060530` is already linked at the
Mingla business level, the system user has access, and a validate-only creative WITH that IG id
returns `{"success":true}` (proven live 2026-07-15). This change threads that IG identity into the
ad creative so ads can also run on Instagram — sourced from the **already-seeded** env var
`META_IG_USER_ID`, lane-correct, and **optional**: when the env var is unset/empty the creative
omits `instagram_user_id` entirely and behaves exactly as before. No live calls, no deploys, no
secret changes. Destination policy, the PAUSED invariant, and money paths are untouched.

---

## 2. SPEC success-criteria coverage

The task (issue #939) is the binding contract. Criteria mapped to commits:

| SC | Criterion | Result | Commit |
|----|-----------|--------|--------|
| SC-1 | `instagram_user_id` added to `object_story_spec` in the creative builder | ✓ | `898091acc` (meta.ts:408) |
| SC-2 | `instagram_user_id` also set at the adcreatives top level (matching the validate-only proof: both placements) | ✓ | `898091acc` (meta.ts:441) |
| SC-3 | Sourced via the SAME per-lane pattern as page_id/token (`laneEnvName`): consumer `META_IG_USER_ID`, business `META_MINGLABIZ_IG_USER_ID`, resolved once in `resolveMetaEnvConfig` | ✓ | `898091acc` (meta.ts:100) |
| SC-4 | OPTIONAL — unset/empty ⇒ field OMITTED entirely; never emit empty/undefined; Facebook-only preserved for the business lane and any test env | ✓ | `898091acc` (meta.ts:73,100,405,408,441) |
| SC-5 | Destination policy (canonical dest_url), PAUSED, money paths, and everything else unchanged | ✓ | `898091acc` (no link/status/budget lines touched) |
| SC-6 | Append-only tests: (a) set ⇒ present in both placements; (b) unset/empty ⇒ absent everywhere; (c) per-lane resolution; fails-on-revert proven | ✓ | `87ec80eae` |

---

## 3. Files changed

| File | Change | Δ lines |
|------|--------|---------|
| `supabase/functions/_shared/meta.ts` | thread IG identity through creative builder + config | +38 / −4 |
| `supabase/functions/_shared/__tests__/meta_issue939_ig_delivery.test.ts` | NEW append-only regression suite (5 tests) | +160 / −0 |

Exact change points in `supabase/functions/_shared/meta.ts` (post-commit line numbers):

- **meta.ts:73** — `MetaEnvConfig.igUserId: string | null` (new optional field).
- **meta.ts:100** — `igUserId: (Deno.env.get(laneEnvName("META_IG_USER_ID", lane)) ?? "").trim() || null` — lane-correct, optional resolution mirroring `businessId`/`datasetId` (NOT a fail-close like `adAccountId`/`pageId`).
- **meta.ts:387** — `buildMetaCreativeBody(pageId, input, igUserId?: string | null)` — new optional third param.
- **meta.ts:405** — `const igIdentity = typeof igUserId === "string" ? igUserId.trim() : ""` — normalizes; empty/whitespace/null/undefined all collapse to `""` (no leak).
- **meta.ts:408** — `if (igIdentity) objectStorySpec.instagram_user_id = igIdentity;` — **inside object_story_spec** (THE line whose deletion fails test (a)).
- **meta.ts:441** — `if (igIdentity) body.instagram_user_id = igIdentity;` — **top-level adcreatives body** (THE line whose deletion fails test (a)).
- **meta.ts:558** — `metaValidateOnlyCreativeProbe` call site now passes `client.config.igUserId` (keeps the connect probe faithful to the validate-only proof shape; null for business ⇒ identical to today).
- **meta.ts:715** — `createCreative` adapter call site now passes `client.config.igUserId`.

---

## 4. Data-model changes applied

None. No migration, no schema/RLS/table change. Backend edge-function source only.

---

## 5. Edge functions touched

- `supabase/functions/_shared/meta.ts` is a shared module (not a function with its own `verify_jwt`). It is consumed by the ad-engine edge functions (e.g. `admin-ad-connect`, the campaign create/launch functions). **No `verify_jwt` value changes.** The consuming functions must be **redeployed from MERGED main** to pick up the shared-module change — see §11.

---

## 6. Regression tests added

- **Path:** `supabase/functions/_shared/__tests__/meta_issue939_ig_delivery.test.ts` (NEW file — fully append-only; matches the repo's per-issue `meta_orch_*`/`issue86*` test-file convention, so it does NOT modify the existing `meta.test.ts`).
- **Count:** 5 tests — (a) IG set ⇒ both placements (link + video branches), (b) unset/null/empty/whitespace ⇒ absent everywhere + no serialized leak + arg-omitted case, (c) per-lane env resolution with no cross-lane fallback.
- **Passing run:** `ok | 5 passed | 0 failed`.
- **fails-on-revert verified at `87ec80eae`** — via TRUE LINE DELETION (not comment-out) of BOTH `instagram_user_id` assignment lines (meta.ts:408 + meta.ts:441): re-run → `FAILED | 3 passed | 2 failed` (both test (a) cases fail; (b)/(c) correctly still pass since they assert absence / env-resolution). Restored via `git checkout -- meta.ts` → `ok | 5 passed | 0 failed`.

Note on import order: the new test uses a leading side-effect `import "../adChannel.ts";` before importing from `meta.ts`, because `adChannel.ts` ↔ `meta.ts` form an init cycle (adChannel's `ADAPTER_REGISTRY` references `metaAdapter`). Evaluating `adChannel.ts` first makes `meta.ts` fully initialize before the registry body runs — mirrors the working `meta.test.ts`. Importing `meta.ts` first hits a `metaAdapter` TDZ.

---

## 7. Old → New receipts

### supabase/functions/_shared/meta.ts
**What it did before:** `buildMetaCreativeBody(pageId, input)` built `object_story_spec = { page_id }` (+ link_data/video_data) and returned the adcreatives body with NO `instagram_user_id` at any level; `MetaEnvConfig`/`resolveMetaEnvConfig` had no IG field; both call sites (`metaValidateOnlyCreativeProbe`, `createCreative`) passed only the page id. Result: every Meta ad delivered Facebook-only.
**What it does now:** `resolveMetaEnvConfig` reads a lane-correct, optional `META_IG_USER_ID` (consumer) / `META_MINGLABIZ_IG_USER_ID` (business) into `config.igUserId` (null when unset). `buildMetaCreativeBody` accepts an optional `igUserId` and, when non-empty, sets `instagram_user_id` in BOTH `object_story_spec` AND the top-level adcreatives body; when empty/null/undefined it omits the field from both. Both call sites thread `client.config.igUserId`.
**Why:** SC-1..SC-4 — switch on Instagram delivery via the proven IG identity while keeping the business lane and test envs Facebook-only (no biz IG configured yet).
**Lines changed:** ~+38 / −4.

---

## 8. Cross-surface impact table

| Surface | Affected? | What changes / reason |
|---------|-----------|-----------------------|
| Consumer iOS | No | No app-side change; backend ad-engine only. |
| Consumer Android | No | Same. |
| Buyer / anonymous Web | No | Same. |
| Business iOS | No | Same. |
| Business Android | No | Same. |
| Admin Web (adjacent) | Indirect only | Admins launch Meta ads via the ad engine; once the consuming edge fns are redeployed, consumer-lane creatives request Instagram delivery. No admin UI code changed. |
| Business Web preview (adjacent) | No | No code path touched. |

Parity: the change lives in ONE shared module — automatic parity across every consumer/business ad-engine caller. No manual mirror needed.

---

## 9. Smoke result

- `deno check supabase/functions/_shared/meta.ts` → clean.
- `deno check` on the new test → clean.
- New suite: `ok | 5 passed | 0 failed`.
- Existing `meta.test.ts` (regression): `ok | 21 passed | 0 failed`.
- Ad-engine battery (`meta` + `meta_issue939` + `adCreative` + `issue862`/`issue866` adversarial): `ok | 155 passed | 0 failed`.
- Strict-grep gates that scan meta.ts: ISSUE-866 creative-guards `SELF-TEST passed` + full gate passed; ISSUE-862 ad-token-env-server-only gate passed.
- fails-on-revert: proven (see §6).

No live Meta/Graph calls were made (validate-only proof was already done upstream; live re-verify is the tester's leg).

Pre-existing battery note: the directory-wide `deno test supabase/functions/_shared/__tests__/` run aborts on a PRE-EXISTING type error in `ticketPdf.test.ts` (`endAtIso` fixture drift) — that file is byte-identical to origin/main (`git diff origin/main` empty), so the failure set is identical to main's pre-existing set and is NOT caused by this change. The ad-engine subset (which is what this change touches) is fully green.

---

## 10. Known issues / deferred

- **Business lane Instagram is still OFF by design** — `META_MINGLABIZ_IG_USER_ID` is not configured, so `config.igUserId` is null for business and the creative stays Facebook-only. When a business IG is linked and the env var seeded, delivery switches on with zero further code change.
- No `[TRANSITIONAL]` code introduced.

---

## 11. Operator action required (for the orchestrator/operator)

- **No migration** (none written).
- **No secret changes** — `META_IG_USER_ID=17841477287060530` is already seeded in prod.
- **Edge-function redeploy from MERGED main** (implementor does NOT deploy): the ad-engine functions that consume `_shared/meta.ts` and run the creative-create path — primarily the campaign create/launch function(s) and `admin-ad-connect` (which invokes the validate-only creative probe). Redeploy those after merge so the shared-module change takes effect. Preserve each function's existing `verify_jwt` value (unchanged by this work).
- **Tester leg:** live re-verify that a consumer-lane creative now carries `instagram_user_id` in both placements and that a real (still-PAUSED) ad is eligible for Instagram placement; confirm business lane remains Facebook-only.

---

## 12. Discoveries for Orchestrator

- **Env-sourced IG vs connection-row IG (informational, not a bug):** `admin-ad-connect/index.ts` (~line 909) independently resolves the Page-linked IG from the Graph (`metaFetchIgBusinessAccount`) and stores it in `ad_connections.extra.instagram_user_id` for display/state. This change deliberately sources the **delivery** identity from the env var `META_IG_USER_ID` per the task contract, NOT from that stored row. Both currently point at the same account for the consumer lane. If a future ORCH wants the delivery identity to track the connection row instead of env, that's a scoped follow-up decision — flagged, not actioned.
- **COMMS ledger:** no BLOCK+OPEN row addressed to this ORCH/ALL. WARN COMMS-0109 (rerun-red / rebase-your-branch) and COMMS-0107 (Android device leg) were factored — this branch is rebased onto origin/main, no PR merged this phase, and no OneLink/web-perf/consent surface was touched. Acks were NOT written back to the anchor ledger because this dispatch's hard guard forbids pushing to main; noting here for the orchestrator to record at CLOSE if desired.
