# QA RETEST — ISSUE-863 WP7 (TikTok channel) — after REWORK

**Tester:** mingla-tester+claude · **Date:** 2026-07-15 · **Retest cycle:** 1
**Under test:** rework commit `4db139639` (+ note commit `aa9d3ba22`) on branch `issue-863-tiktok-ads-api`, worktree `~/Desktop/mingla-orchs/issue-863-tiktok-ads-api/`
**Prior verdict:** FAIL (1×P1 F-1 · P2 F-2/F-3 · P3 F-4/F-5) — `Mingla_Artifacts/reports/QA_ISSUE-863_WP7.md`, QA commit `8f8194de0`
**Scope:** the dispatched focused legs (F-1 runtime healing, F-2/F-4 emoji round-trip, F-3 parser, fails-on-revert re-derivation, full battery). No live leg needed (nothing in the rework touches the wire shapes the live leg proved). Same environment pattern as the QA round — isolated `qa863tiktok` stack (parallel session's stack coexisted untouched), mock platform server, corrected COMMS-0102 rename mapping (per D-2), everything restored byte-identical after (git-clean verified, 6 duplicate prefixes back, 0 qa863 containers left).

---

## 1. Verdict

**PASS (local scope) — 0 × P0 · 0 × P1 · 0 × P2 · 0 × P3 · 2 × P4** — the deferred live legs in §6 remain binding ship conditions for the post-merge window.

Pre-gate: my adversarial suite is **byte-untouched** since `8f8194de0` (`git diff 8f8194de0..HEAD -- …tester_adversarial.test.ts` → 0 lines). All three prior code findings are fixed exactly as prescribed, the P1 healing sequence was re-proven at RUNTIME with zero DB surgery, the mismatch guard demonstrably survived un-weakened, and every battery line is green with failure sets identical to the pre-change baseline.

## 2. Per-finding retest matrix

| Finding | Prior | Retest verdict | Evidence |
|---|---|---|---|
| **F-1 (P1)** sentinel bricked the lane | FAIL | **FIXED — runtime-proven** | QA §5 legs 3→8→15 re-run IN ORDER, no surgery: phase-1 connect (no secrets) → 424 + `external_account_id='unconfigured'` row (poison reproduced); phase-2 (secrets set, SAME row) → connect **HTTP 200**, row heals to `connected / 7627974536397766673 / identity b3f0f8f4-…`, `action:'status'` → `connected`, token absent from body. Fix line: `tiktok.ts` resolveTikTokClient — non-numeric persisted id = absence (`if (!NUMERIC_ID_REGEX.test(connAdvertiserId)) connAdvertiserId = "";`). |
| **F-1 guard NOT weakened** | n/a | **CONFIRMED** | Row set to a REAL differing numeric id `999888777000111222` → connect **424 `advertiser_mismatch`** naming BOTH ids; the row stays pinned `invalid` on retry — correct §4.3 semantics (two real ids disagreeing is genuine ambiguity, unlike the sentinel). Unit twin R-1c re-run green. |
| **F-2 (P2)** lone skin-tone modifiers | FAIL | **FIXED** | `containsEmoji("\u{1F3FD}")===true`; `stripEmoji("👍🏽")===""` (no stranded modifier); strip-then-validate clean. My widened round-trip property: **12 hostile inputs** (ZWJ family, tones ×5 run, flags, keycaps ±VS16, tag-flag, lone VS16/ZWJ pairs, mixed copy) → **0 leaks** (strip output never still "contains"). Shared `isEmojiChar` predicate makes the round trip structural, not incidental. |
| **F-3 (P2)** parser TypeError on null element | FAIL | **FIXED** | My exact retest payload `{region_info:[null,{location_id:"6252001",region_code:"US"}]}` → returns the one valid region; widened hostile elements (`undefined`, `42`, `"str"`, `[]`, nested array) all skipped, NG row survives; `[null,null]` → `[]`. Fix: non-object element `continue` at `tiktok.ts` parse loop. |
| **F-4 (P3)** TAG chars survive strip | FAIL | **FIXED** | England tag-flag strips to `""` (0 chars, weight 0); bare `\u{E0067}` detected + stripped mid-word (`"ok\u{E0067}ok"` → `"okok"`). |
| **F-5 (P3)** circular-import TDZ | Discovery | **UNCHANGED — as routed** | Deliberately not reworked; QA itself routed it to the orchestrator as D-1 (pre-existing WP1/WP2 class; all 5 entry points verified safe). Still stands as a Discovery. |
| **P4-c** half-width katakana ×2 | Note | **UNCHANGED — deliberate** | Conservative direction kept; live-fire fidelity question parked (§6). |

## 3. Step 0.5 — independent re-derivation of the implementor's fails-on-revert

TRUE LINE DELETION of the F-1 guard (`if (!NUMERIC_ID_REGEX.test(connAdvertiserId)) connAdvertiserId = "";`) at the rework tree → **`8 passed | 2 failed`** — exactly **R-1b** (the healing sequence re-bricks) and **R-1d** (the non-numeric class re-pins), matching the rework note's claim precisely; restored → `ok | 10 passed`, and the combined WP7 set (38 implementor + 43 tester + 10 rework) → **91/91 green**, tree clean. **fails-on-revert re-derived at `4db139639`.**

Rework-suite audit: the 10 R-tests are genuine new-angle assertions (poisoned-row resolution semantics, guard retention, bug-CLASS coverage, shared-predicate round trip, exact QA retest payloads) — not renamed copies; no existing test modified (append-only holds: `git diff origin/main...HEAD` shows the three WP7 test files ADDED only, mine byte-identical).

## 4. Runtime regression spot-checks (paths consuming the 3 changed functions)

- **Preflight** (uses `resolveTikTokClient` + `parseTikTokRegions`): P1 pass · P2 warn · P3 pass · P4 warn · P5 pass · **P6 warn naming GB** · overall **amber** — identical to the QA round.
- **Launch** (uses `resolveTikTokClient`): 200 + **BALANCE_EXCEED warning** ("Advanced Payment Portfolio"), status `ACTIVE`, `delivery_status CAMPAIGN_STATUS_BALANCE_EXCEED` persisted — identical to the QA round.
- No edge-function `index.ts` changed in the rework (diff-verified); Meta branch untouched since its QA-round runtime proof.

## 5. Full battery at the final tree (`aa9d3ba22`, code = `4db139639`)

- `deno check` clean on all touched runtime files + the rework suite.
- Scoped ad-engine battery (QA §6 set + rework suite): **`ok | 225 passed | 0 failed`** (type-checked).
- Full `_shared/__tests__/` directory (`--no-check`): **829 passed | 35 failed** — failure set **IDENTICAL** (diff empty) to the true pre-change baseline `44822322b` (738/35); pass delta = exactly the 91 WP7-family tests. Zero new failures.
- Strict-grep sweep (388 gates): **17 failures — list IDENTICAL** to the pre-change baseline.
- Suites re-verified green at the committed tree; environment torn down (0 qa863 containers, migrations/config byte-identical, git status clean except this report).

## 6. Deferred live legs (restated — binding ship conditions, post-merge window after secrets + funding land)

1. Live paused-create (campaign→adgroup→ad, all DISABLE in Ads Manager) → launch → pause → rollback DELETE, real IDs captured.
2. Live BALANCE_EXCEED read-back on the real advertiser ($10 < $20/day floor) — expected to reproduce §4's warning live.
3. `UPLOAD_BY_URL` against a real bucket URL (10 s fetcher; **Bunny reachability pre-check before #866**).
4. Implementor ambiguity #7: ad-group budget OMITTED under CBO vs the MCP static schema — only a live CBO create resolves; surface TikTok's error verbatim if it disagrees.
5. Live v1.3 error-path shapes beyond the mock.
6. Edge deploy of the 5 functions from MERGED main, `verify_jwt=true` preserved + post-billing-fix PR green rerun (COMMS-0103).

## 7. New issues from the rework

None found. Two P4 notes: (P4-1) the shared `isEmojiChar` predicate is the structurally correct fix shape — praise; (P4-2) after a REAL-id mismatch, the pinned row requires fixing the env or the row to recover — correct guard semantics, but worth one line in the #864 admin-UI error copy ("check TIKTOK_ADVERTISER_ID against the connected account") when that surface lands.

## 8. Routing

**PASS → CLOSE (orchestrator)**, with §6 carried as explicit post-merge conditions. Retest cycle count: 1 (no loop concern).

*Filed by mingla-tester+claude · 2026-07-15 · worktree `~/Desktop/mingla-orchs/issue-863-tiktok-ads-api/` on branch `issue-863-tiktok-ads-api`.*
