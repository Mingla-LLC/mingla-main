# WP7-863 — REWORK NOTE (post-QA FAIL)

**Trigger:** `Mingla_Artifacts/reports/QA_ISSUE-863_WP7.md` §3 — FAIL (1×P1), QA commit `8f8194de0`.
**Rework commit:** `4db139639` (code + 10 append-only R-tests) on branch `issue-863-tiktok-ads-api`.
**Scope discipline:** ONLY the failing findings were fixed — no scope expansion; the tester's `issue863_wp7_tester_adversarial.test.ts` is untouched (its T-1/T-3 headers reserved room for these fixes); no live platform calls, no deploys, no migrations, nothing pushed.

---

## Per-finding status

### F-1 · P1 — sentinel bricked the lane → FIXED (resolver-side exclusion, QA's preferred option)
- **What failed:** a pre-secrets failed connect persists `external_account_id='unconfigured'` (column NOT NULL); `resolveTikTokClient` treated the sentinel as a real advertiser id, so once `TIKTOK_ADVERTISER_ID` landed, every connect/status died `424 advertiser_mismatch` forever — DB-surgery-only recovery.
- **Fix (`supabase/functions/_shared/tiktok.ts`, resolveTikTokClient):** any persisted `external_account_id` that fails the numeric advertiser-id shape (`NUMERIC_ID_REGEX`) — the sentinel included — is treated as **ABSENCE, never a pin**: a single self-contained guard line `if (!NUMERIC_ID_REGEX.test(connAdvertiserId)) connAdvertiserId = "";` before the mismatch guard. The mismatch guard is RETAINED for real numeric ids (R-1c). **Idiom kept consistent with the parallel WP6 reddit fix** (same cross-adapter bug class per the rework dispatch).
- **Regression tests (R-1a…R-1e, `issue863_wp7_rework.test.ts`):** the exact QA sequence — poisoned row + no secrets → `AdNotConnectedError` (recoverable, not mismatch); poisoned row + secrets set → **resolution SUCCEEDS on the same row, no DB surgery** (R-1b); real-id mismatch still hard-fails (R-1c); the whole non-numeric CLASS is absence (R-1d); healthy matching row unchanged (R-1e).
- **Fails-on-revert (TRUE LINE DELETION):** deleting the guard line → `FAILED | 8 passed | 2 failed` (R-1b + R-1d, the healing sequence re-bricks); restored → `ok | 10 passed`. **fails-on-revert verified at `4db139639`.**
- **QA retest pointer:** §5 legs 3→8→15 in order WITHOUT the surgery step; connect must 200 after env lands. (Unit-level equivalent proven in R-1b; runtime leg is the tester's.)

### F-2 · P2 — skin-tone modifiers missed → FIXED
- Added `U+1F3FB–U+1F3FF` via `EMOJI_MODIFIER_OR_TAG_REGEX`, checked by a single shared `isEmojiChar` used by **BOTH** `containsEmoji` and `stripEmoji` — the strip→validate round trip is structurally airtight (one predicate, two consumers).
- QA retest criteria verified: `containsEmoji("\u{1F3FD}")===true`; `stripEmoji("👍🏽")===""`; strip-then-validate clean (R-2a/R-2b/R-2c incl. a 6-input hostile round-trip property covering ZWJ families, flags, keycaps, tones, tag-flags).

### F-3 · P2 — parser TypeError on null element → FIXED
- `parseTikTokRegions` now skips `null` / non-object / array elements (`continue`), honoring its tolerant-parser contract; whole-garbage payloads degrade to `[]`, never a raw TypeError → no wrong-shaped 500 (R-3: QA's exact retest payload returns the one valid region).

### F-4 · P3 — TAG characters survive strip → FIXED
- `U+E0020–E007F` included in the same shared regex; England tag-flag strips to `""` with zero invisible residue; bare tag chars detected + stripped (R-4).

### F-5 · P3 — circular-import TDZ → NOT REWORKED (deliberate, per QA routing)
- QA itself routed this as **Discovery D-2, not WP7 rework**: it is a pre-existing WP1/WP2 class (`meta`/`google` crash identically as entry modules), no shipped entry point is affected (all 5 `admin-ad-*` fns import `adChannel.ts` first, QA-verified), and a real fix (lazy registry) touches WP1's merged design — out of the rework's fix-only scope. Left for the orchestrator to register as its own item.

### P4-c (half-width katakana ×2 weighting) — NOT CHANGED (deliberate)
- QA marked it conservative-direction (rejects early, never over-sends) and unverifiable locally; changing the weight rule without live evidence would trade a safe over-strictness for an unverifiable risk.

---

## Battery at the rework tree (`4db139639`)

- Rework suite: `ok | 10 passed | 0 failed` (type-checked).
- **Scoped ad-engine battery** (QA §6 set + the rework suite): **`ok | 225 passed | 0 failed`** (type-checked; QA's 215 + 10 — all merged WP1/WP2 suites, WP7 implementor 38, WP7 tester 43 untouched and green).
- **Full `_shared/__tests__/` directory** (`--no-check`, house convention): **`829 passed | 35 failed`** — failure set **IDENTICAL** (diff empty) to the pre-rework tree, which QA §6 proved identical to the true pre-change commit `44822322b`. Pass delta = exactly the 10 new tests. Zero new failures.
- **Strict-grep sweep:** 17 failures — **list identical** to the pre-change baseline (all pre-existing, none in this lane); the RT-3 ad-token gate passes explicitly ("16 token names, 7 client trees clean").
- `deno check` clean on all 5 touched runtime files + the new test file.
- Append-only holds: `git diff origin/main...HEAD --name-only` shows test files only ADDED; the tester's suite untouched.

## Files changed in the rework

| File | Δ | What |
|---|---|---|
| `supabase/functions/_shared/tiktok.ts` | +51/−16 net (241 gross incl. tests) | F-1 guard line + comment; F-2/F-4 shared `isEmojiChar` + `EMOJI_MODIFIER_OR_TAG_REGEX`; F-3 element guard |
| `supabase/functions/_shared/__tests__/issue863_wp7_rework.test.ts` | NEW, 10 tests | R-1a–e, R-2a–c, R-3, R-4 |

No edge-function `index.ts` changed in the rework (the F-1 fix is resolver-side, exactly as QA preferred — `markTikTokInvalid`'s sentinel persistence is now harmless because the resolver treats it as absence and a successful connect overwrites it with the real id).

## For the tester (retest pointers)

1. F-1: QA §5 legs 3→8→15 **without** the DB-surgery step — connect must 200 once env lands; `action:'status'` likewise.
2. F-2/F-4: the three §3 retest probes + R-2c's round-trip property.
3. F-3: the §3 retest payload (already R-3).
4. Everything else unchanged since `8f8194de0` — the QA-passed legs (DISABLE wire order, BALANCE_EXCEED 200+warning, Meta-branch-unaffected, preflight amber shape) had zero code churn except the three fixed functions.
