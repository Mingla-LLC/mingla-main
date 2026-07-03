# TEST — ORCH-1263 [claim-adoption]

**Phase:** TEST (gatekeeper) · **Worktree:** `~/Desktop/mingla-orchs/orch-1263-[claim-adoption]` on branch `orch-1263-claim-adoption` (tip after my commits: see §5)
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1263_CLAIM_ADOPTION.md` v2 (`338e2fca0`) · **Design:** `DESIGN_ORCH-1263_CLAIM_WALKTHROUGH.md` (`3abffeada`)
**Impl reports consumed:** LEG_A (`4db156cc7`) + LEG_B (`be1266a8e`)
**Backend under test:** LIVE prod `gqnoajqerqhnvulmnyvv` — migration `20261202000000` applied; `claim-search-pool` v202 / `admin-review-venue-claim` v199 / `run-business-place-authoring-pipeline` v128, all `verify_jwt=true`, ACTIVE (verified via list_edge_functions).
**Comms:** COMMS-0052/0063 (business OTA freeze) honored — no `eas update`, no deploy, no merge. COMMS-0064/0065 (WARN, OPEN) read and factored; ack rows NOT written to the anchor ledger because the anchor's `COMMS_LEDGER.md` carries another session's uncommitted edits (acks recorded here instead).

---

## 1. VERDICT: **CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 1 (pre-existing) · P3: 1 · P4: 4

Every SC that this session could reach is **proven at `proven` level** — the full 10-step claim walkthrough was live-fired on the iOS sim against LIVE prod (real deployed edge fns, real DB), including the three core write-boundary assertions with byte-level row hashes, a TRUE deployed-edge-fn admin approve with the `authored_applied_keys` receipt, the half-claim resume drill, both blocked-gate variants, and a full create-path regression walk. All suites green (deno 80/80 incl. my 5 adversarial; SQL T-D1/T-D2 + my TA-1..TA-6; jest 272/272 across 18 suites incl. my 55 adversarial + all pinned); G-1 + G-2 + all five orch-1255 gates + orch-1256 gate + append-only (9/9) green; both implementor fails-on-revert proofs independently re-run; three tester adversarial suites added with their own fails-on-revert drills.

CONDITIONAL (not clean PASS) on three dispatch-documented / environment coverage caps — none is a product defect (§9 Accepted conditions): Android runtime spot-check (dispatch scoped runtime to iOS), the c3/c4 photo-**upload** sub-arm (sim photo-library/PHPicker extension broken at the OS level — the app's failure arm is honest and retryable, proven on screen), and the admin-web pixel walk (1255-carried residual; the approve itself WAS live-fired at the deployed edge fn this session, which is stronger than 1255's RPC-layer walk).

**Regression gate: SATISFIED.** Implementor happy-path tests re-proven fails-on-revert at `ce220e4da` (server) and `fe587db6f` (client) by my own true-line-deletion runs; tester adversarial suites (3 files, different angles, on-branch, in the closing diff) each with fails-on-revert receipts (§5).

**PROD RESIDUE: NONE** (§8, verifying SQL all zeros; real-place serving-hash restored byte-identical).

---

## 2. SC-by-SC matrix

| SC | Verdict | Evidence (all live-fire unless noted) |
|----|---------|---------------------------------------|
| SC-1 front-load | **PASS (proven)** | Search: `claim_state` correct live — synthetic place flipped `available→pending→claimed` across the run (curls). Gate UI: **pending** variant (clock + §4.4 copy + Message support, NO Yes) `SC1_pending_blocked_gate_no_yes.png`; **claimed** variant (shield + §4.3 copy, NO Yes) `SC1_claimed_blocked_gate_shield.png`. Facts pills match DB truth on BOTH a synthetic (5 photos/Hours/Phone/Website/Rated) and a REAL place (4 photos/Hours/Phone/Rated, **no Website pill** — website null) `SC1_*.png`. SQL TA-1: ALL non-verified `claim_status` values (pending_review/rejected/suspended/revoked/none) → `pending` + detail fail-close. |
| SC-2 adoption fetch | **PASS (proven)** | YES → deployed detail fetch (v202) → every step pre-filled (screens §SC-3/4/13 rows); detail payload live: full 5-photo gallery uncapped, 23 facets, phone/website/price/summaries; **zero server writes at YES** (detail RPC STABLE `provolatile='s'` prod read-back; serving-hash unchanged until submit). Fetch-failure `Continue anyway` arm: unit T-B5 + my A9 `detailFetched` flags (runtime fetch-error not forceable against a healthy prod — arm proven at unit + source level). |
| SC-3 category confirm | **PASS (proven)** | Confident (`fine_dining_restaurant`): preselected + `On Mingla` chip + `Keep & continue` `SC3_c0_confident_preselect_banner8of9.png`. Unconfident (`coffee_shop`): unselected + "Pick what fits best — our directory wasn't sure." + Continue DISABLED `SC3_c0_unconfident_unselected_honest_copy.png`. Server-computed flag verified in the live search response. |
| SC-4 overnight (D-D) | **PASS (proven, iOS)** | Adopted `22:00→02:00` (Fri+Sat) passed c2 untouched with the `next day` micro-line `SC4_c2_overnight_2200_0200_nextday.png`; submit → approve round-tripped LOSSLESSLY (applied `opening_hours` periods byte-equal incl. `close.day+1`, prod read-back). Boundary matrix (22→02, 00:00→00:00 rejected, 23:59→00:01, 00:01→00:00, 09→09 rejected, mixed-week no-masking) behavioral on BOTH validator arms — my A1 (12 cases) + A2 source-contract on `VenueSettingsModule` predicate. Settings SAVE arm: unit+source (post-approve Settings runtime not walked — venue cleaned; predicate identical & G-2-gated). Android time-picker spot-check → condition C-1. |
| SC-5 cover + gallery ops | **PASS (proven)** with one env-capped sub-arm | c4 disabled-until-cover + caption `SC5_c4_disabled_until_cover_caption.png`; pick → check badge + preview + "Looking good." `SC5_c4_cover_chosen_check_preview.png`. c3: remove → derivable Removed strip + Undo restore (5 photos again, restored appends at end) `SC5_c3_undo_restored_5photos.png`; long-press move menu (edge-aware: last tile offers earlier/first only) + `Make first` reorder `SC5_c3_makefirst_reorder_removed_strip.png`; the c3 order rode into staging verbatim (`business_gallery_urls` = on-screen order, DB read-back). Nothing server-side mutated pre-submit (hash proof, SC-6). **Upload sub-arm env-blocked** (condition C-2): sim photo library import broken (PHPhotos 3302 / picker extension invalidated under synthetic taps); the app surfaced the honest retryable error "Couldn't open photos. Try again." — no silent failure. |
| SC-6 stage-only submit | **PASS (proven, live, twice)** | **Synthetic:** serving-column hash `a0a08d95…` BYTE-IDENTICAL before/after claim submit; staging set exactly (status processing, inputs.tier1 + tier2 seed {website, price_tiers, vibe_chips:[]} + adoption {source, adoptedAt, summarySource, wantsReservations:true} + gallery in c3 order); venue row pending_review with the picked cover. **REAL place (Ironqueen, the dispatch's core assertion):** serving-hash `92f92b04…` byte-identical after a full claim submit; `is_claimed=false`, `claimed_by=null`, `raw_google_data`/AI/bouncer untouched. |
| SC-7 pre-approve stage | **PASS** | Key-set exactness: T-A1/A3/A5/A6 (deno, re-run green) + G-1 live. Runtime corollary: two pending claims held serving columns byte-identical throughout the session (repeated hash checks). |
| SC-8 approve applies | **PASS (proven, live, deployed fn)** | True live-fire on v199 (temp QA admin row, removed after): `mark_called` → `approve` → 200 with **`authored_applied_keys: [opening_hours, stored_photo_urls, generative_summary, price_tiers, price_level, website, is_claimed, claimed_by, raw_google_data]`** (facets correctly omitted — no confirm ran). Place row diff = exactly the authored patch (hours w/ overnight day+1; photos in authored c3 order; summary/price/website; `claimed_by` = brand account). **Archive first-archive-wins:** `archived_google` holds the PRE-application originals (original photo order [a..e], original hours/summary/price/website). Go-live ordering proven live: `rebounced:true` over authored content, `B7:no_google_photos` kept the synthetic place `servable:false` — zero consumer exposure at any moment. Re-approve of an already-verified venue → no re-apply (`authored_applied_keys:null`, P4-3). Card list shows Live vs In-review sibling isolation `SC8_cardlist_live_vs_inreview_isolation.png`. |
| SC-9 hero apply-mode | **PASS (proven, live)** | Post-approve hero re-pick via deployed pipeline: `stored_photo_urls` = [new hero, …] ⊇ gallery (superset SQL check true), venue cover updated; the CLEAR arm (empty `cover_media_url`) left the gallery intact and only nulled the venue cover — never `[]`, never `[hero]`. Repeated-pick superset law: my deno D3 (4 successive heroes over an evolving prior). |
| SC-10 half-claim retry | **PASS (proven, live)** | Forced post-c9 submit failure → §8.3 warm card ("Saved — but the last step hiccuped… Try again") with draft preserved `SC10_83_retry_card_draft_safe.png`; manufactured the exact R-7 state (venue row present, tier-1 dead) → `Try again` → **same venue row reused (count stayed 1, same id), tier-1 completed** — resume-not-recreate through the real pre-check against prod. Foreign-23505 §8.2 arm: unit T-B6 + my A4 (catch re-probes ownership before the support card) + SQL uniq backstop. Discovery D-3: `biz_create_venue_listing` itself rejects an inactive place, so the natural failure order differs from R-7's assumption (see §7). |
| SC-11 whitelist | **PASS (proven, live)** | Prod read-backs: search RPC proargnames carry facts+claim_state, NO rating/review_count; detail STABLE; EXECUTE denied to anon+authenticated on BOTH fns (direct PostgREST calls as an authed user → **403 42501** both) — the grant hardening is live. Live search+detail responses with rating VALUES present on the row (4.7/321): zero forbidden keys, zero values in raw JSON. My deno D1/D2 polluted-row deep-scan + SQL TA-2 (ILIKE `%`/`_` literal, no scrape) + TA-5/TA-6. |
| SC-12 create regression | **PASS (proven)** | Full plain-create walk: gate "Continue without a match" → pre-wizard category phase → "List your venue" 6 steps (s0 address search → s1 name/slug w/ correct `/b/{brand}/v/{slug}` preview → s2 default hours → s3 contact → s4 description → s5 review WITHOUT the dead Photos row `SC12_create_review_no_dead_photos_row.png`) → submit → **inline deck-readiness leg reached** (claim path correctly never enters it); DB: venue pending_review + authored place row (`business_author_brand_id` set, never servable). Pinned suites: 272/272 across the 18-suite sweep. |
| SC-13 design conformance | **PASS (proven, iOS spot-checks per DESIGN)** | Chips: `On Mingla`→`Edited`→revert→`On Mingla` live flip with dock Keep↔Save `SC13_c0_chip_edited_dock_save.png`; banner live-n (8-of-9 rich vs 4-of-9 sparse — both matched my independent recomputation); collapse after c0 to the one-liner; prefilled stepper dots + "· most are quick confirms" appears ≥6 and is absent at 4; c1 cards expand IN PLACE to the untouched Step1/Step2 editors; c5 generative pre-draft + `Start fresh` vs honest-empty; c6 email never chipped; c7 chips preselected vs required; c8 Suggested row consumed on flip + sub-label swap + D-B7 Keep default; c9 KEPT/CHANGED/ADDED groups + §8.1 success copy + 4-business-hours helper. (Full-pixel/motion audit vs DESIGN §7 not re-measured frame-by-frame; reduced-motion arms are the shipped default per D-B6 — noted P4-2.) |

---

## 3. Findings

### P2-1 — claim-search/detail rate limit does not enforce live across isolates (PRE-EXISTING mechanism)
- **Evidence:** 11 sequential curls AND a 12-call single-connection burst as one authed user → all HTTP 200, never 429 (deployed v202). Mechanism unit-proven correct: `checkRateLimit` refuses the 11th call in-window in one isolate (deno eval). Cause: `claim-search-pool/index.ts:37` `const rateBuckets = new Map(...)` — per-isolate memory; Supabase spreads requests across isolates. Byte-identical Map exists on `origin/main` (pre-1263; only the detail mode newly rides it).
- **Impact:** SPEC §A1.2's "shared 10/min bucket" and the security note's "marginal exposure ≈ 10 places/min/user" hold only per-isolate; a deliberate scraper can exceed it. Data exposed = Google-derived public directory data, single place per call, authed users only — bounded.
- **Required fix (follow-on, not this ORCH):** durable rate limit (e.g., a Postgres counter table or KV) for claim-search-pool; sweep the same pattern in other edge fns.
- **Retest:** 11 curls in a minute → 11th returns 429.

### P3-1 — c9 review: a reorder-only c3 lands under KEPT while the c3 dock says "Save & continue"
- **Evidence:** After `Make first` (order changed, nothing removed/added) c9 shows "PHOTOS · 5 kept, 0 removed, 0 added" under KEPT (`SC13_c9_kept_group.png`); `ClaimStepReview.tsx:57–59` groups photos by removed/added counts only, while `claimStepChanged("c3")` (dock) is order-aware. The reorder IS submitted correctly (staging gallery = new order, DB-verified).
- **Impact:** cosmetic honesty nuance — the value string is accurate, the group label under-reports an order change.
- **Required fix:** include order-change in the photos grouping (compare kept vs adopted order) or add "reordered" to the value string. **Retest:** reorder-only → row under CHANGED (or value shows "reordered").

### P4-1 (praise) — the D-A boundary is real, twice over
Serving-column hashes byte-identical through TWO full claim submits (synthetic + REAL place), and the approve receipt lists exactly the authored keys. The `B7` re-bounce keeping the fake place unservable while `rebounced:true` proves scoring ran over authored content, is the fail-close working as designed.

### P4-2 — motion audit scope
M-1 collapse, M-2 step transitions, M-8 dot confirm observed working at runtime; per D-B6 several arms are the DESIGN's reduced-motion variants by construction. No frame-rate measurement performed.

### P4-3 — re-approve of an already-verified venue returns `authored_applied_keys: null`
No state transition → no re-apply. Matches first-archive-wins intent (archive stays byte-identical); "idempotent re-approve" applies to the resubmit→approve cycle. Observation only.

### P4-4 — venue card list is session-cache-stale after out-of-band DB writes
My SQL-inserted venue row didn't appear until app relaunch (React Query cache; in-app flows invalidate correctly — the app's own submits appeared instantly). Expected behavior, noted for future testers.

---

## 4. Step 0.5 — independent re-run of implementor fails-on-revert proofs

- **Server @ `ce220e4da`:** I restored the pre-1263 tier-1 payload myself (true line replacement: `is_claimed/claimed_by/opening_hours: normalizeBusinessHoursForPool(...)` back in, §A3.1 stage payload out) → `T-A1 … FAILED | 29 passed | 1 failed` (exact assertion: "stages EXACTLY §A3.1 — no opening_hours/claimed_by/is_claimed") AND G-1 failed on the exact 2 arms (`opening_hours: normalizeBusinessHoursForPool appears 2x`, `claim branch writes claimed_by/is_claimed`). Restored → 30/30 + gate pass. ✔ matches the implementor's receipt.
- **Client @ `fe587db6f`:** true line deletion of (a) the `o === c` equality arm in `venueWizardValidation.ts` and (b) the ten `CLAIM_STEPS` entries → `3 failed, 25 passed` (exact: T-B1 claim map, T-B3 equality copy, T-B8 hours-honesty). Restored → 28/28. ✔
- **G-2 red→green independently confirmed:** G-2 (with its `--self-test`) passes on the final tree, and my server-side A2/A1 drill re-reds it when the `o >= c` predicate is restored (jest side).

## 5. Tester adversarial suites (added, committed `c47a1499f`, in `git diff origin/main...HEAD`)

| File | Tests | Angles (≠ implementor) | fails-on-revert receipt |
|---|---|---|---|
| `mingla-business/__tests__/orch1263ClaimAdoption.tester.adversarial.test.tsx` | 55 | A1 overnight boundary MATRIX both validator arms (incl. 00:00→00:00, 23:59→00:01, mixed-week masking) · A2 Settings predicate `o>=c` dead · A3 gate sort total/stable + blocked excludes Yes + sparse-facts honesty + no rating values · A4 submit-plan matrix + pre-check-before-createVenue + race-honest catch · A5 provenance revert/trim/set-equality flips · A6 banner-n over-count attacks (invalid adopted hours, editorial summary, <20 generative, c4 never) · A7 dock-label edges (c4 fixed, c8 D-B7, email flips Keep→Save) · A8 reorder boundary ops · A9 prefill purity (frozen inputs) + junk-tier filtering | reverted D-D predicate + `sortMatchesForGate` → **14 tests fail**; restored → 55/55 |
| `supabase/functions/_shared/__tests__/orch1263_tester_adversarial.test.ts` | 5 | D1 polluted detail row deep-key scan vs the FULL forbidden set + non-http filter · D2 polluted search row + `claim_state` exact-match semantics + guard bites · D3 REPEATED hero picks superset law over an evolving prior + degenerate clear · D4 first-archive-wins across a DOUBLE approve with changed authored content + no-new-keys omission · D5 hostile-input omission rules (junk tiers, non-canonical facets, whitespace website, 19-char pitch) | hero-wipe revert → D3 FAILS; `!(key in existingArchive)` guard deletion → D4 FAILS; restored → 5/5 |
| `supabase/migrations/__tests__/orch_1263_tester_adversarial.test.sql` | TA-1..TA-6 | every non-verified `claim_status` (pending_review/suspended/revoked/none) blocks pending + detail fail-close · ILIKE `%`/`_` literal escape · SEARCH-fn grants (not just detail) · nonexistent-uuid zero rows · SECURITY DEFINER + pinned search_path both fns · detail output-contract forbidden columns | `GRANT … TO authenticated` on the search fn → TA-3 FAILS; revoke → PASS (drilled on the local prod-chain container) |

Both the implementor's tests and mine are visible in `git diff origin/main...HEAD --name-only`. Append-only gate: 9 passed / 0 failed.

## 6. Constitution 14-rule matrix

1 No dead taps — PASS (every wizard control fired live; blocked cards route to `/support/inbox`). 2 One owner per truth — PASS (venue row = cover truth proven live via Q-1 curl; provenance computed never stored). 3 No silent failures — PASS (picker failure, tier-1 failure, place_not_available all surfaced honestly on screen). 4 Query-key factory — PASS (no new keys; Leg B diff). 5 Server state server-side — PASS (claim block = pre-submit draft by design, D-B). 6 Logout clears — PASS (store v3 reset() unchanged; A3-1255 precedent). 7 [TRANSITIONAL] labeled — PASS (PoolMatchCard D-B4, photoUris D-B5 both carry exits). 8 Subtract before add — PASS (dead photoUris + dead Photos row killed; killed write-sites carry I-1263 comments). 9 No fabricated data — PASS (sparse facts render nothing; unconfident category honest; hue placeholder not stock). 10 Currency-aware — N/A (no money surfaces). 11 One auth instance — N/A. 12 Validate at right time — PASS (slug at submit; equality-only hours both arms). 13 Exclusion consistency — PASS (claim_state vs detail fail-close vs uniq backstop all agree — TA-1). 14 Persisted-state startup — PASS (v3 persist bump; resume card owns re-entry).

## 7. Device / parity matrix + Discoveries

| Surface | Verdict | Note |
|---|---|---|
| Business iOS (sim, iPhone 17 Pro Max, worktree Metro :8088, pk_live env, LIVE prod) | **PASS (proven)** | full walkthrough §2; 34 screenshots in `Mingla_Artifacts/evidence/ORCH-1263/` |
| Business Android | **skipped per dispatch** (runtime scoped iOS) | shared RN code; new surfaces are flat tints/solid panels (source-verified); condition C-1 |
| Business Web preview | capped at compile per standing memory | my own `npx expo export -p web --clear` exit 0 |
| Admin Web | edge-fn layer PROVEN live (v199 approve + receipt); pixel walk residual | condition C-3 |
| Consumer iOS/Android | N/A (no consumer code); deck passively protected (hash proofs) | — |
| Buyer/anon Web | N/A (no-op per spec §3) | — |
| Physical iPhone (HITL) | not exercised — no physical-device-specific blocker remained; upload retest (C-2) is the one item that would benefit | — |

**Discoveries for Orchestrator:**
1. **P2-1 rate-limit class** — in-memory per-isolate buckets in edge fns don't enforce globally; candidate sweep ORCH (pre-existing).
2. **`_shared/__tests__/bouncer.test.ts` + `scorer.test.ts` fail deno type-check** (20 errors) when the directory is targeted as a whole — pre-existing on origin/main (untouched by this branch; last touched META-ORCH-1009 Sub-B). Same class as Leg A discovery #2 / Leg B discovery #1; fold into the pinned-suite-refresh ORCH.
3. **`biz_create_venue_listing` validates place activity** — an inactive place fails the venue INSERT itself, so the R-7 "venue exists, tier-1 died" state arises only from network/edge death between the two calls; the client handles both orders correctly (proven), but future half-claim drills should manufacture the state as I did.
4. **Sim photo-library import broken on the iOS 26.4 runtime under Xcode 26** (`simctl addmedia` NSInvalidArgument crash; `idb add-media` works only after fixing source-file validity; PHPicker extension dies under synthetic taps) — affects ANY future upload-path QA on this sim.
5. Anchor `COMMS_LEDGER.md` has uncommitted local edits from another session AND anchor main is behind origin/main — ack-write skipped to avoid clobbering; next orchestrator sweep should reconcile.

## 8. Fixture ledger + cleanup attestation

Fixtures (all mine): auth user `orch1263qa@web-library.net` (`b061d037-…`, mail.tm disposable) · brand `ORCH-1263 QA 0703` (`b5cffa8a-…`) · synthetic places `ORCH-1263 QA PLACE Lanternhouse` (`ac1263e0-…0001`, is_servable=false throughout incl. after approve — B7) + `ORCH-1263 QA PLACE Halfclaim Tavern` (`…0002`) · create-path place `7503d879-…` (author-brand keyed, never servable) · REAL place Ironqueen (`a3c8c9c5-…`) claimed NON-DESTRUCTIVELY (stage-only; never approved) · venues ×4 (incl. 1 SQL-manufactured half-claim row) · temp `admin_users` row (alive ≈ 8 minutes, deleted) · 3 admin_audit_log rows (deleted).

Cleanup (ordered, §above): Ironqueen staging columns restored to pre-claim values → brand DELETE (FK cascade took venues/pipeline/hours) → synthetic + authored places hard-DELETED → admin row + audit rows DELETED → auth user DELETED (cascade took creator_accounts). Storage objects: **zero created** (verified). **PROD RESIDUE: NONE** — verifying SQL returned all zeros: qa_brand_residue=0 · **venue_listings global=0** · pipeline global=0 · place_residue=0 · admin_residue=0 · audit_residue=0 · auth_residue=0 · creator_residue=0 · storage_objects=0 · **Ironqueen final serving-hash `92f92b04c7b5fa14c74e27e2f222ab1d` = pre-test snapshot, byte-identical**. Environment: worktree Metro :8088 killed by PID (18012, port verified free); `orch1263-pg` container removed per Leg A §12.5; Max sim left booted (was booted on arrival); no global pkill; no other session's ports/devices touched; mail.tm inbox disposable.

## 9. Accepted conditions (the CONDITIONAL)

1. **C-1 Android runtime spot-check** (SPEC §5: SC-4 time picker / SC-5 image picker / opaque glass) — dispatch scoped this session's runtime to iOS; surfaces are shared RN + source-verified flat tints. → fold into the Raleigh acceptance run or a 10-minute emulator pass at CLOSE.
2. **C-2 c3/c4 photo-UPLOAD sub-arm** — environment-blocked (sim photo library broken at the OS level after full machine-side resolution attempts); the failure arm is honest+retryable on screen; upload services are pre-existing (venueGalleryService / CoverPickerSheet), untouched by 1263. → 30-second HITL on Seth's physical iPhone during the Raleigh run.
3. **C-3 admin-web pixel walk** — 1255-carried residual (2FA admin account); the 1263 delta (approve applies authored content + receipt) IS live-fire-proven at the deployed edge fn this session.

## 10. Routing

**CONDITIONAL PASS → surface to Seth with §9** (C-1/C-2 fold naturally into the SPEC §13 Raleigh acceptance run, which remains tester-owned and pending). No REWORK required: P2-1 is pre-existing (follow-on ORCH), P3-1 is a one-line grouping tweak that can ride any later polish pass. CLOSE reminders: backend already live + verified (deploy list §Leg A 11 satisfied — this session's curls double as the one-curl verifies); business ships NATIVE BUILD ONLY (COMMS-0052/0063); invariants I-PROPOSED-1263-* have live evidence for the DRAFT→ACTIVE flip.
