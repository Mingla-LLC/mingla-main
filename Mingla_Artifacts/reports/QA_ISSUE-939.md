# QA — ISSUE-939 · Instagram delivery for Meta ads

**Working tree:** `~/Desktop/mingla-orchs/issue-940-[meta-instagram-delivery]/` on branch `issue-940-meta-instagram-delivery`
**Under test:** `898091acc..efeb6fe33` (impl `898091acc`, tests `87ec80eae`, report `efeb6fe33`) — HEAD `efeb6fe33`, contains `origin/main` (`12b59e4256`).
**Change:** `supabase/functions/_shared/meta.ts` — thread the Page-linked Instagram identity into the Meta ad creative (env-sourced, lane-correct, optional).
**Mode:** TARGETED + SPEC-COMPLIANCE + SECURITY. Backend edge-function-shared-module only ⇒ **exempt from the live-fire sim gate**; the decisive live-fire is the Meta Graph v25.0 validate-only leg below.

---

## 1. Verdict

# ✅ PASS

**P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 2**

Confidence: **proven** — live-fire validate-only against real Graph v25.0 `act_2393570861066813` confirms BOTH wire shapes; residual-zero verified (0 objects created). Regression gate satisfied (implementor happy-path fails-on-revert independently re-run + tester adversarial with its own fails-on-revert at a **different line**). Zero deletions to any existing test file. Both strict-grep meta gates green.

Routing → **CLOSE**. One operator action is a precondition for production effect (edge-fn redeploy from merged main — see §7/§8), not a code defect.

---

## 2. SC-by-SC matrix

| SC | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| SC-1 | `instagram_user_id` in `object_story_spec` | **PASS** | meta.ts:408 `if (igIdentity) objectStorySpec.instagram_user_id = igIdentity`. Live body A: `object_story_spec.instagram_user_id = 17841477287060530`. |
| SC-2 | `instagram_user_id` also at adcreatives top level | **PASS** | meta.ts:441 `if (igIdentity) body.instagram_user_id = igIdentity`. Live body A top-level `instagram_user_id = 17841477287060530`. Both placements → Meta `{"success":true}`. |
| SC-3 | Sourced via per-lane pattern (`laneEnvName`), resolved once in `resolveMetaEnvConfig` | **PASS** | meta.ts:100 `igUserId: (Deno.env.get(laneEnvName("META_IG_USER_ID", lane)) ?? "").trim() \|\| null`. Live: consumer resolved `17841477287060530`; adversarial T4 proves business→null then business-own `BIZ_IG`, no cross-fallback. |
| SC-4 | OPTIONAL — unset/empty ⇒ field OMITTED everywhere; never empty/undefined; Facebook-only preserved | **PASS** | Live path B: re-resolved `config.igUserId=null` ⇒ `'instagram_user_id' in body = false`, Meta STILL `{"success":true}`. Unit (b)+adversarial T5 cover undefined/null/""/whitespace. |
| SC-5 | Destination policy / PAUSED / money paths unchanged | **PASS** | Diff touches only the two IG lines + the config field + call-site threading; `link`/`call_to_action`/`url_tags`/budget/status untouched. Live body A `link` still canonical `business.usemingla.com/e/…`. buildMetaAdSetBody/Campaign unchanged (adversarial T3). |
| SC-6 | Append-only tests: set⇒both, unset⇒absent, per-lane, fails-on-revert | **PASS** | Implementor suite 5/5 (append-only +154/−0); tester adversarial suite 6/6; both fails-on-revert independently proven (§4, §5). |

---

## 3. LIVE VALIDATE-ONLY WIRE PROOF (the decisive leg)

Ran the ACTUAL adapter (`buildMetaCreativeBody` + `resolveMetaEnvConfig` + `metaGraph` + `resolveMetaClient` imported from the worktree `meta.ts`) against `POST https://graph.facebook.com/v25.0/act_2393570861066813/adcreatives` with `execution_options:["validate_only"]`, Bearer System-User token (redacted, never logged/committed), reusing an EXISTING adimage hash (read-only GET `adimages`, 3 present) so no image object was created.

**Config (env-resolved by the real adapter):** apiVersion `v25.0`, adAccountId `2393570861066813`, pageId `797406353459597`, `config.igUserId = 17841477287060530`.

**PATH A — `META_IG_USER_ID` SET → body carries IG in BOTH placements → Meta success:**
```json
{
  "name": "issue939-validate-probe — creative",
  "object_story_spec": {
    "page_id": "797406353459597",
    "instagram_user_id": "17841477287060530",
    "link_data": {
      "link": "https://business.usemingla.com/e/lorne/tuesday-live",
      "message": "Discover experiences near you.",
      "call_to_action": { "type": "LEARN_MORE", "value": { "link": "https://business.usemingla.com/e/lorne/tuesday-live" } },
      "name": "Tonight in your city", "description": "Live on Mingla",
      "image_hash": "634f8d7878ef8b18ff851aba2670688b"
    }
  },
  "url_tags": "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&placement={{placement}}",
  "instagram_user_id": "17841477287060530",
  "execution_options": ["validate_only"]
}
```
→ **Meta response A: `{"success":true}`**  (top-level `instagram_user_id`=17841477287060530 AND `object_story_spec.instagram_user_id`=17841477287060530)

**PATH B — `META_IG_USER_ID` UNSET (re-resolved `config.igUserId=null`) → NO IG anywhere → Meta STILL success:**
```json
{
  "name": "issue939-validate-probe — creative",
  "object_story_spec": {
    "page_id": "797406353459597",
    "link_data": { "link": "https://business.usemingla.com/e/lorne/tuesday-live", "message": "Discover experiences near you.",
      "call_to_action": { "type": "LEARN_MORE", "value": { "link": "https://business.usemingla.com/e/lorne/tuesday-live" } },
      "name": "Tonight in your city", "description": "Live on Mingla", "image_hash": "634f8d7878ef8b18ff851aba2670688b" }
  },
  "url_tags": "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&placement={{placement}}",
  "execution_options": ["validate_only"]
}
```
→ `'instagram_user_id' anywhere in body B = false` → **Meta response B: `{"success":true}`** (Facebook-only path intact).

**RESIDUAL-ZERO:** `act_..../adcreatives` total_count **BEFORE = 0**, **AFTER = 0**, **DELTA = 0**. No adcreative created; no adimage created (existing hash reused); nothing set ACTIVE. Token sent only as `Authorization: Bearer` header (never a URL param, never in body); temp env material unset at run end; temp probe file deleted.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert

Checked meta.ts baseline (both lines present at 408 + 441). TRUE line-deletion of BOTH `instagram_user_id = igIdentity` assignments (perl `-ni`, not comment-out) → re-ran the implementor suite:
```
ISSUE-939 (a): … BOTH object_story_spec AND the top-level creative body ... FAILED
ISSUE-939 (a): the video creative branch also carries the IG identity … ... FAILED
FAILED | 3 passed | 2 failed
```
Restored via `git checkout -- meta.ts` → `git diff --quiet` clean (byte-identical). Matches the implementor's claimed `FAILED | 3 passed | 2 failed`. **Proof re-run at HEAD `efeb6fe33` (meta.ts `898091acc`, test `87ec80eae`).**

---

## 5. Adversarial test added (tester, different angle)

- **Path:** `supabase/functions/_shared/__tests__/meta_issue939_ig_delivery_tester_adversarial.test.ts` (NEW file, append-only, 6 tests, type-clean).
- **Different angle than implementor:** (T1) exact SERIALIZED-body occurrence count == 2 + no leak into link_data/video_data/call_to_action/url_tags; (T2) top-level is a distinct OWN-property; (T3) **cross-builder isolation** — `buildMetaCampaignBody`/`buildMetaAdSetBody` never carry `instagram_user_id` (no leak into budget/targeting/status — a surface the implementor never tested); (T4) business-lane isolation via the REAL env resolver (null when `META_MINGLABIZ_IG_USER_ID` unset, no consumer-IG bleed); (T5) whitespace-only env → null.
- **Result:** `ok | 6 passed | 0 failed`.
- **fails-on-revert verified at a DIFFERENT line than the implementor's:** deleting ONLY meta.ts:441 (top-level line) → T1(×2) + T2 FAIL while T3/T4/T5 correctly still pass; restored byte-identical. This targets the top-level placement specifically vs. the implementor's both-lines deletion.
- **In closing diff:** both `meta_issue939_ig_delivery.test.ts` (implementor, +154/−0) and this adversarial file appear in `git diff origin/main...HEAD --name-only` once committed. Append-only CI check (`test-append-only-check.js`) reports `✅ ADDED` / `1 passed, 0 failed`.

---

## 6. Constitution 14-rule matrix

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | N/A | No UI surface. |
| 2 | One owner per truth | **PASS** | Delivery IG owned once by `resolveMetaEnvConfig.igUserId`. (Display-side `ad_connections.extra.instagram_user_id` in admin-ad-connect is a separate DISPLAY concern — Discovery, not a competing owner.) |
| 3 | No silent failures | **PASS** | Omission-when-unset is documented intentional design, not a swallowed error; token still fail-closes (`resolveMetaToken` throws `AdNotConnectedError`). |
| 4 | One query key per entity | N/A | No React Query. |
| 5 | Server state server-side | N/A | Edge-function module. |
| 6 | Logout clears everything | N/A | No client state. |
| 7 | `[TRANSITIONAL]` labeled | **PASS** | None introduced. |
| 8 | Subtract before adding | **PASS** | Reuses the existing `laneEnvName` env pattern; no parallel mechanism. |
| 9 | No fabricated data | **PASS** | Never emits empty/placeholder IG; field omitted when the id is absent. |
| 10 | Currency-aware | N/A | No money/currency touched. |
| 11 | One auth instance | N/A | — |
| 12 | Validate at the right time | N/A | No datetime logic. |
| 13 | Exclusion consistency | **PASS** | Omit-when-unset applied consistently across both placements and both lanes. |
| 14 | Persisted-state startup | N/A | — |

---

## 7. Device / parity matrix

| Surface | Result | Note |
|---------|--------|------|
| Consumer iOS / Android | N/A | No app-side change (backend ad-engine only). |
| Buyer / anonymous Web | N/A | Same. |
| Business iOS / Android | N/A | Same. |
| Admin Web (adjacent) | N/A (indirect) | Admins launch Meta ads via the ad engine; no admin UI code changed. |
| Business Web preview (adjacent) | N/A | No code path touched. |
| **Backend — Meta ad-engine (consumer lane)** | **PASS (live validate-only)** | Wire proof §3. Shared module ⇒ automatic parity across all ad-engine callers. |
| **Backend — Meta ad-engine (business lane)** | **PASS** | `META_MINGLABIZ_IG_USER_ID` unset ⇒ `igUserId=null` ⇒ Facebook-only (adversarial T4). |

**Live deploy state:** branch is unmerged, so the currently-deployed prod edge functions still carry the OLD `_shared/meta.ts` (Facebook-only) — expected pre-merge. Consuming functions (campaign create/launch + `admin-ad-connect`'s validate-only probe) must be **redeployed from MERGED main**, preserving each function's existing `verify_jwt`, for the change to take production effect (implementor §11).

## 8. Test battery

- New implementor suite: `ok | 5 passed | 0 failed`.
- Tester adversarial suite: `ok | 6 passed | 0 failed`. Both together: `11 passed | 0 failed`.
- Existing `meta.test.ts`: `ok | 21 passed | 0 failed`.
- Full ad-engine battery (17 files, `--allow-read --allow-env`): `ok | 396 passed | 0 failed`. (An earlier run showed spurious `NotCapable` failures caused solely by omitting `--allow-read`, plus Google/Snapchat `issue867` source-trap tests unrelated to meta.ts — all resolved with the read flag.)
- Strict-grep gates: ISSUE-862 ad-token-env-server-only **passed** (16 token names, 7 client trees clean); ISSUE-866 creative-guards **passed** (G1/G2).
- `deno check` meta.ts + both issue939 tests: clean.
- **Pre-existing `ticketPdf.test.ts` type error:** confirmed byte-identical to origin/main (`git diff origin/main -- ticketPdf.test.ts` empty) — NOT introduced by this change.

---

## 9. Findings

- **P4 (praise):** Optional-by-default design is clean — `.trim() || null` at resolution + `typeof … ? .trim() : ""` normalization in the builder means undefined/null/""/whitespace all collapse to omission with no empty-string leak; live path B proves it on the wire.
- **P4 (praise):** Single shared-module change with call-sites threaded through `client.config.igUserId` gives automatic consumer/business parity and kept the diff to the two intended lines + config + wiring.

## 10. Discoveries for Orchestrator (not fixed here)

1. **Redeploy required for production effect** — the consuming ad-engine edge functions must be redeployed from merged main (verify_jwt preserved). Until then prod stays Facebook-only. (Operator action, not a defect.)
2. **Env-sourced delivery IG vs connection-row IG** — `admin-ad-connect` independently resolves the Page-linked IG into `ad_connections.extra.instagram_user_id` for display/state; this change sources the DELIVERY identity from `META_IG_USER_ID` per the task contract. Both point at the same account today. If a future ORCH wants delivery to track the connection row instead of env, that is a scoped follow-up decision (flagged, not actioned).
3. **COMMS ledger** — no BLOCK+OPEN row addressed to this ISSUE/ALL requires action. COMMS-0108 (main-red) is resolved (main green since `d4f0996df`; HEAD contains `origin/main`). Relevant WARNs factored: COMMS-0105 (git stash BANNED — used only `git checkout -- <file>` for revert proofs), COMMS-0106 (append-only/new-file test discipline honored), COMMS-0061 (gqno = LIVE PROD — only read-only GETs + validate-only POSTs). Acks NOT written back to the anchor ledger because this dispatch's hard guard forbids pushing to main; noted here for the orchestrator to record at CLOSE.

## 11. Accepted conditions

None — this is an unconditional PASS.
