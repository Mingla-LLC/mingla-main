# TEST ORCH-1269 — claim-adoption phone country mis-defaults to GB

- **Date:** 2026-07-03 · **Tester:** mingla-tester (TARGETED fast pass, dispatch-scoped)
- **Worktree:** `~/Desktop/mingla-orchs/orch-1269-[claim-phone-country]/` on branch `orch-1269-claim-phone-country`
- **Under test:** fix commit `522834656d56a8a30e5569152b1388541b70fc6e` (impl report `b2963f94c`)
- **Backend:** LIVE prod `gqnoajqerqhnvulmnyvv` (read-only for product data; QA auth fixture created via the app's own signup and deleted — §8)

## 1. Verdict

**PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 2 (discoveries, out of 1269 scope) · P4: 3 (notes).

Layman: claiming a US venue now opens the phone step on the US flag with the venue's real
number beside the "On Mingla" chip — proven live on business web against the production
backend, plus 34 green tests (17 implementor + 17 tester-adversarial), both independently
proven to fail when the fix is deleted. Runtime scope was web-only per dispatch (Seth's live
run is on business web). No claim was submitted; production carries zero residue from this pass.

## 2. Task matrix (dispatch tasks → evidence)

| Task | Result | Evidence |
|---|---|---|
| T-1 17 new tests green | PASS | `claimPhoneCountry.orch1269.test.ts` → `17 passed` |
| T-1 pinned 1263 suites (84) | PASS | happy + tester.adversarial + prefill suites → `Test Suites: 4 passed, Tests: 101 passed` (17+84 in one run) |
| T-1 strict-grep gates | PASS | all 8 individually green on the branch: `orch-1263-claim-front-load-and-overnight`, `orch-1263-claim-stage-only-preapprove`, `orch-1255-*` (×5), `orch-1256-profile-todos-no-false-positive` |
| T-2 tester adversarial suite | PASS | NEW file `mingla-business/src/utils/__tests__/claimPhoneCountry.orch1269.tester.adversarial.test.ts` — 17 tests, all angles below, own fails-on-revert (§5) |
| T-3 runtime web walk to c6 | PASS (proven) | §6 — US flag + adopted US number + On Mingla chips on the c6 step, live prod backend, dev web from this worktree. Place substituted (Academy blocked by Seth's own live claim — §6.1) |
| T-4 prod residue NONE | PASS | §8 — all residue counters 0; Seth's Academy claim row untouched |

## 3. Adversarial coverage (T-2 angles, all in the new file)

- **Mapper taxonomy** — TA-M1..M6: ISO-3 vs ISO-2 vs full-name vs lowercase vs whitespace
  (incl. `\t`/`\n`) vs unicode garbage (`邮政编码`, flag emoji `🇺🇸`, `Ünited States`,
  full-width `ＵＳＡ`) vs null vs empty vs whitespace-only.
- **ISO-2 not a name-prefix** — Germany→DE, Japan→JP, Switzerland→CH; explicit
  `not.toBe("GE")` proves the mapper is real resolution, not the `slice(0,2)` bug the
  pre-existing `countryCode` field carries (a prefix slice would fabricate GE = Georgia).
- **Never fabricate a flag** — non-aliased ISO-3s (DEU/FRA/CAN) → null; unmappable →
  null ISO while the adopted phone VALUE still prefills (TA-P1); c6 callsite has NO
  hardcoded ISO literal and the ProvenanceChip stays bound to the phone value, never the
  country (TA-W1 source contract); store rehydrates pre-1269 blobs `?? null` (TA-W2).
- **E.164 gate actual contract** — TA-V1..V5: valid US under US passes; empty phone +
  email passes and both-empty hits the presence rule first (phone IS optional); digit-free
  under null-ISO (GB-default mirror) and 18-digit under NG blocked; **US number under GB
  ISO is NOT shape-blocked** — see P4-1; s3 isolation below.
- **Create-path s3 byte-equal re-verified** — three ways: (a) `git diff 522834656^..522834656`
  on `venueWizardValidation.ts` shows hunks only at imports, the `c6DialCode` helper, and
  inside `case "c6"` — zero lines of the `case "s3"` body touched; (b) TA-W3 pins exactly ONE
  `composeE164(` call in the file, positioned inside c6 (after `case "c6": {`, before
  `case "c7"`); (c) TA-V5 behavioral — garbage and 18-digit phones sail through s3, s3
  presence rule intact.

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

- Checked out `522834656^` (pre-fix) on the 3 wired files (`prefillDraftFromPoolMatch.ts`,
  `ClaimStepContact.tsx`, `venueWizardValidation.ts`; store + mapper kept so types compile —
  the implementor's stated true-line-deletion shape).
- Implementor suite → **`Tests: 8 failed, 9 passed, 17 total`** — failing set EXACTLY as
  claimed: P-1, P-2, P-3, P-4, W-1, W-2, V-2, V-3. Sample failing assertion: P-1
  `expect(p.contactPhoneCountryIso).toBe("US")` → received `undefined`.
- Restored `git checkout HEAD --` on the same files → **`17 passed`**.
- **Independently re-proven: fails-on-revert at `522834656` CONFIRMED.**

## 5. Tester adversarial fails-on-revert

Same 3-file line-deletion revert → my suite **`7 failed, 10 passed, 17 total`**
(TA-P1, TA-P2, TA-P3, TA-W1, TA-W3, TA-V1, TA-V4 fail — prefill ISO gone, callsite props
gone, `composeE164` count 0). Restore → **`17 passed`**.
**fails-on-revert verified at `522834656d56a8a30e5569152b1388541b70fc6e`.**
Both test files are on-branch, append-only (no existing test file modified), and present in
`git diff origin/main...HEAD --name-only`. tsc: `npx tsc --noEmit` → 871 pre-existing error
lines (implementor baseline 880-line set, all `../packages/*`), **zero** mention either 1269
test file.

## 6. Runtime proof (web, live prod backend) — T-3

Environment: `npx expo start --web --port 8095 --clear` from THIS worktree; Chromium via
Playwright; fresh QA signup `orch1269qa@web-library.net` (mail.tm OTP; deleted after — §8).
Boot required `MINGLA_STRIPE_MODE=live` + the pk_live publishable key (extracted from the
PUBLIC production bundle at business.usemingla.com) — see P4-2/P4-3.

### 6.1 Place substitution (documented deviation)

Dispatch named Academy Street Bistro (`008c13b3-a97e-48bf-908c-5f5eca09aa11`). Read-only probe:
that place already carries **Seth's own live claim** (`venue_listings a5c44a05…`,
`claim_status=pending_review`, created 2026-07-03 07:50 UTC, `contact_phone "(919) 377-0509"`,
`country_code US`). Per the ORCH-1263 fail-close (TA-1, prod-proven in TEST_ORCH-1263), a
pending place renders the blocked "pending" gate with NO "Yes, this is me" — walking it was
impossible without colliding with Seth's held submission. Substituted an equivalent
probe-verified row: **Barcelona Wine Bar (Washington DC)** `f5f544ed-7a5d-4791-81e3-36d84f63dc48`
— `country "USA"`, `national_phone_number "(202) 588-5500"`, unclaimed, zero venue rows.
Same contract, same country value, same code path.

### 6.2 Walk (screenshots in `Mingla_Artifacts/evidence/ORCH-1269/`)

1. Email-OTP signup → home (`/home`).
2. `/venue/create` → gate search "Barcelona Wine Bar" → two directory cards with facts pills
   (`1269_06_gate_matches.png`).
3. "Yes, this is me" (DC card) → adoption detail fetch (read-only) → wizard
   (`1269_07_wizard_entry.png`).
4. Walked c0→c6 via the dock CTAs (cover picked at c4, client-side only).
5. **c6 "How people reach you" (step 7 of 10): the phone picker shows the 🇺🇸 US flag,
   the field holds "(202) 588-5500" with the green "On Mingla" chip; website adopted with
   its own On Mingla chip; dock reads "Keep & continue"** — `1269_08_c6_contact_step.png`.
   Pre-fix this exact screen rendered the GB flag (Seth's prod repro).
6. **STOPPED at c6 — never advanced past it, never submitted** (Seth's live run owns
   submission). Browser closed; ephemeral Playwright profile discarded (client-side draft
   lives only in that discarded localStorage). Metro killed by PID; port 8095 verified free.

Zero-server-write corollary (1263 copy-on-start contract, re-verified live): AFTER the full
walk, `venue_listings` rows for `f5f544ed…` = **0** and `is_claimed=false` — the YES + walk
wrote nothing.

## 7. Findings

- **P4-1 — dispatch expectation vs shipped contract:** the dispatch's angle "US number under
  GB ISO blocked at c6" does NOT hold and is not supposed to: `composeE164`/`isValidE164`
  (`src/utils/phone.ts:27-49`, `/^\+[1-9][0-9]{1,14}$/`) is length/shape-only, so
  `+44` + 10 US digits = 12 digits parses. This is the fix's documented, accepted limit
  (impl report §5); the MAPPING is the real defense (the prod fixture maps to US upstream —
  paired assertion in TA-V1 pins both halves). No action; recorded so nobody expects that block.
- **P4-2 — Stripe-mode fail-close fired correctly:** the worktree dev-web boot hit
  `StripeModeMismatchError` until `MINGLA_STRIPE_MODE=live` + a pk_live key were provided —
  the ORCH-1056 handshake fail-close working as designed against the live-mode backend.
- **P4-3 (DISCOVERY, for orchestrator) — "Stripe still TEST mode" memory/docs are STALE:**
  prod `stripe-mode` edge fn returns `{"mode":"live","publishablePrefix":"pk_live_"}`.
  Update `project_mingla_stripe_test_mode_alignment` or whatever flipped it should own the doc.
- **P3-1 (DISCOVERY, pre-existing, = impl §10.1):** `countryCode: match.country?.slice(0, 2)`
  (`prefillDraftFromPoolMatch.ts:77/:165` post-fix numbering) still feeds
  `venue_listings.country_code` with a naive prefix slice ("United States" → "Un";
  "Germany" → "Ge"→GE=Georgia-shaped). The 1269 mapper is the obvious replacement — follow-up ORCH.
- **P3-2 (DISCOVERY, mine, data-dependent):** the mapper's leading-code tolerance maps ANY
  bare ISO-2 followed by a non-letter — English-word-shaped codes ("NO …" → Norway,
  "IT …" → Italy, "ME …" → Montenegro) would map if such garbage ever lands in
  `place_pool.country`. No such rows exist today (probe); bounded by design (TA-M6 pins the
  4+-letter boundary). Fold into the `place_pool.country` hygiene follow-up (impl §10.2).

## 8. Prod residue — NONE (attestation)

Product data: **read-only throughout** (place_pool / venue_listings SELECTs only; no claim
submitted; zero-write walk proven in §6.2). QA fixture: ONE auth user created via the app's
own signup (`orch1269qa@web-library.net`, `70f9696e-879b-41eb-a5b0-3bd6030950a1`; 0 brands,
0 venues, 0 team rows ever) → deleted; verified `auth_residue=0`, `creator_residue=0`.
Final sweep: `barcelona_dc_venue_rows=0`, `barcelona_dc_is_claimed=false`,
`qa_auth_residue=0`; **Seth's Academy claim row intact and untouched**
(`academy_venue_rows=1`, `claim_status=pending_review` — exactly as found). No storage
objects created. No migrations applied. No edge functions deployed. No other session's
ports/devices touched (only my own Metro PID on :8095 killed).

## 9. Constitution (14-rule) matrix

1 No dead taps — PASS (every walked control fired live: consent, email, OTP, search, YES,
cover tile, 7 dock CTAs). 2 One owner per truth — PASS (mapper derives from shared
`packages/phone-input/countries.ts`; no new table — verified in diff). 3 No silent failures —
PASS (unmappable→null is honest; c6 gate surfaces inline copy; no empty catch in diff).
4 Query-key factory — N/A (no query keys touched). 5 Server state server-side — PASS (ISO is
pre-submit client draft by 1263 design). 6 Logout clears — PASS (field rides the existing
persisted draft store; store reset unchanged in diff). 7 [TRANSITIONAL] — N/A. 8 Subtract
before add — PASS (+411/−0 but additive-by-contract: optional field per pinned-suite
append-only gate). 9 No fabricated data — PASS (adversarially proven: TA-M2/M4/M5, TA-P1,
TA-W1). 10 Currency-aware — N/A. 11 One auth instance — N/A. 12 Validate at right time —
PASS (inline at c6 before submit; s3 untouched). 13 Exclusion consistency — PASS
(`c6DialCode(null)` mirrors the picker's GB default exactly — validation and UI cannot
disagree; V-4 + TA-V4). 14 Persisted-state startup — PASS (`?? null` rehydration, TA-W2;
hydration gate pre-existing).

## 10. Device / parity matrix

| Surface | Result | Reason |
|---|---|---|
| Business Web (worktree dev, LIVE prod) | **PASS (proven)** | §6 walk + screenshots |
| Business iOS / Android | skipped per dispatch | "web is enough — Seth's run is on business web"; same single RN codebase; Seth's live prod run is the acceptance leg |
| Buyer/anon Web | N/A | untouched — buyer checkout uses `@mingla/phone-input` (ORCH-0847), verified in diff scope |
| Consumer iOS / Android | N/A | no consumer surface reads the venue draft store |
| Admin Web | N/A | no admin path in diff; `contact_phone` storage format unchanged |
| Physical iPhone HITL | not requested | Seth's held live production test IS the human leg |

## 11. Step 0.5 citations

- Implementor happy-path: `mingla-business/src/utils/__tests__/claimPhoneCountry.orch1269.test.ts`,
  fails-on-revert independently re-proven at `522834656` (§4).
- Tester adversarial: `mingla-business/src/utils/__tests__/claimPhoneCountry.orch1269.tester.adversarial.test.ts`,
  fails-on-revert at `522834656` (§5). Both in the closing diff.

**Routing: PASS → CLOSE (orchestrator).** OTA reminder carried from COMMS-0052/META-ORCH-1255:
business OTA BRICKS — this fix reaches native only via the next native build; web via the
normal `[deploy]` PR flow (which is the surface Seth is holding).
