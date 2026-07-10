# TEST — ORCH-1332 [partner-brand dead route] + ORCH-1333 [partner-pages re-skin + latent close-glyph]

- **Skill:** mingla-tester (canonical TEST owner) · adversarial independent verification
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1332-[partner-brand-fixes]/` on branch `ORCH-1332-partner-brand-fixes`
- **Surfaces:** business-iOS + business-Android only (`mingla-business`, dark-only). Consumer/admin/buyer-web untouched.
- **Product-code state under test:** `b6765d260` (fix) → HEAD `11a2c446a` (report stamp) · tester adversarial tests committed at **`dfdd53394`**
- **COMMS honored:** COMMS-0052 (BLOCK) + COMMS-0063 — business-app OTA FROZEN; COMMS-0030 — business iOS build broken team-wide. All reinforce the device-build-gated runtime ceiling below. No OPEN BLOCK addressed to tester/ORCH-1332/1333/ALL required a code action this turn.

---

## 1. VERDICT: **CONDITIONAL PASS**

**Findings: P0 = 0 · P1 = 0 · P2 = 0 · P3 = 2 · P4 = 1** (plus 3 Discoveries).

Source-contract, type-integrity, spec-conformance, cross-domain-blast, both implementor regression suites (independently fails-on-revert re-proven), and two NEW tester adversarial suites (different angle, on-branch, in-diff, fails-on-revert) are **all clean and GREEN**. Zero code defects block.

The **single condition** is the **device-build-gated runtime/live-fire seal** (SC-2, SC-3, SC-4-runtime, SC-5, SC-6-runtime). The business app is OTA-frozen (COMMS-0052/0063) and no business dev build (`com.sethogieva.minglabusiness`) is installed on any booted sim — only the consumer app (`com.mingla.app.v2`) is. Driving the partner flow needs a fresh EAS cloud dev build + a partner-flagged test account + a sim/device login — all Seth-gated. Per the dispatch's runtime posture, this deferral is pre-authorized and is NOT an unaccepted P1. The runtime SCs are marked **device-build-gated, source-verified only (suspected)** — not fabricated as proven.

Routing: hold at CONDITIONAL PASS until the on-device seal (§ "What Seth must provide"). No REWORK required.

---

## 2. SC-by-SC matrix

| SC | Criterion | Result | Evidence class |
|----|-----------|--------|----------------|
| **SC-1** | `app/brand/new.tsx` exists + renders `BrandCreationFlow`, NOT `BrandProfileView` | **PASS** | Source-proven. Diff: new 60-line `BrandNewRoute` mounts `<BrandCreationFlow onComplete onCancel/>`; grep confirms `BrandProfileView` absent. Jest SC-1 green + RED on file delete. |
| **SC-2-iOS / SC-2-Android** | Brands empty-state CTA opens client-mode wizard (not "Brand not found") | **device-build-gated (suspected)** | CTA string `/brand/new?partner_mode=client` preserved verbatim (`brands.tsx`); route now resolves. Runtime tap unverifiable without business dev build. |
| **SC-3-iOS / SC-3-Android** | Earnings nudge CTA opens client-mode wizard | **device-build-gated (suspected)** | Same route + `router.push("/brand/new?partner_mode=client")` preserved in `ReadyToEarnNudge`. Runtime device-gated. |
| **SC-4** | `/brand/new` resolves to the static route (wins over dynamic `[id]`); never "Brand not found" | **PASS (source/framework) · runtime device-gated** | Both `app/brand/new.tsx` (static) + `app/brand/[id]/index.tsx` (dynamic) confirmed coexisting. expo-router deterministically ranks a static segment above `[id]` — documented framework guarantee, not probabilistic. Runtime flash-check device-gated. |
| **SC-5** | Client path → exactly one `partner_brand_links` row (`status=awaiting_owner`) + ORCH-1329 email; row appears on `/partner/brands` | **device-build-gated / live-fire (suspected)** | Backend path (`inviteBrandMember`→`invite-brand-member`→link insert) is UNTOUCHED by this diff (confirmed: none of those files in diff). Requires live DB read + partner account + email. |
| **SC-6** | Cold/direct open still lands `mode='client'` once `isPartner` resolves; never sticks in self-mode | **PASS (source) · runtime device-gated** | F-2 `else if` re-apply branch verified line-by-line (BrandCreationFlow.tsx:297-308) with full guard set + correct dep array (isPartner, state.step/name/bio/mode, partnerModeParam). Loop-safe (once mode=client the guard `state.mode==="self"` bars re-fire). Jest SC-6 green + RED on revert. |
| **SC-7** | No-silent-failure preserved (inline Retry steps 1/2 / error Toast step 5) | **PASS (source)** | Error paths in BrandCreationFlow untouched by diff; `handleCreateIdentity` still sets persistent inline `writeError`+Retry on non-slug failure (line 396-403); step-5 invite error Toast intact. |

---

## 3. Findings (P-numbered)

### P3-1 — F-2 re-apply cannot honor a *deliberate* self-switch while `partner_mode=client` persists in the URL (minor, source-only/suspected)
- **Evidence:** BrandCreationFlow.tsx:297-308. The re-apply fires whenever `isPartner && partnerModeParam === "client" && step===1 && mode==="self" && name==="" && bio===""`. A flagged partner who deep-links via the client CTA, backs to step 0, toggles "It's mine" (self), then advances to step 1 (empty name) will be snapped back to client on that step-transition. Pre-F-2 the effect did nothing when `param==="client"`, so a manual self-switch could stick.
- **Impact:** A partner cannot, within the same client-CTA session, convert the brand to a personal (self) brand — the URL param wins. **No data loss** (the live `name`/`bio` useState are untouched; only `state.mode` flips). Extremely narrow: `partner_mode=client` is only ever emitted by the two "set up for a client" CTAs, so the param already encodes client intent.
- **Required fix (optional):** none required for ship. If ever desired, gate the re-apply behind "user has not yet visited step 0" or clear the param on a manual mode toggle. Below blocker.
- **Retest:** drive a partner dev build: client CTA → back → pick self → Continue → observe mode.

### P3-2 — OQ-1 success toast may not render on the popped destination (pre-existing, out of scope)
- **Evidence:** Investigation §16 / Implementation §10. Client-mode step 5 sets a success toast inside BrandCreationFlow, then `onComplete` pops the route (`new.tsx` `router.back()`), so the toast may not paint on `/partner/brands`. Identical to the pre-existing sheet behavior (ORCH-1081).
- **Impact:** cosmetic — the invite still sends + the row still creates; only the confirmation toast may be missed. Partner-page post-return UX is explicitly out of ORCH-1332/1333 scope.
- **Required fix:** none here — flagged for the orchestrator as a candidate follow-up.

### P4-1 — Praise (pattern worth replicating)
- The `void linksQuery.refetch()` / `void statusQuery.refetch()` idiom on the shared `<Button>` (whose `onPress` is `void | Promise<void>`) exactly mirrors the canonical `app/brand/[id]/index.tsx onRetry` — correct, type-clean adaptation of the design spec rather than a hack. The F-2 branch preserves BOTH pre-existing guard clauses and adds the new one symmetrically (both gated on "user hasn't typed"), and is loop-safe by construction. Import hygiene is exact: `glass`/`radius` removed from brands (0 dangling refs), `shadows` removed from earnings (0 dangling), `radius`/`glass` correctly KEPT in earnings (10 live refs). Clean, minimal, in-spirit.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

I did NOT trust the report. I reverted the product code myself (via `git checkout 898e403aa -- <files>` / `rm`), ran the implementor suites, recorded the exact failing assertions, restored, and re-confirmed GREEN.

**ORCH-1332** (`__tests__/routes/orch1332PartnerBrandNewRoute.test.ts`):
- Revert = `rm app/brand/new.tsx` + restore pre-F-2 `BrandCreationFlow.tsx` → **`Tests: 2 failed, 2 passed`**. Exact failures: SC-1 "route exists" (readFileSync throws on missing `app/brand/new.tsx`) and SC-6 "F-2 hardening" (`expect(flow).toContain('setState((prev) => ({ ...prev, mode: "client" }))')` at line 60). Restore → **`4 passed`**. **Confirmed fails-on-revert.**

**ORCH-1333** (`__tests__/partner/orch1333PartnerReskin.test.ts`):
- Revert = restore the 4 pre-reskin files → **`Tests: 4 failed, 4 total`** (D1 icon reappears x4, D2 `MINGLA PARTNER` back, D3 `canvas.profile` back, D4 `primaryBtnText`/`secondaryBtnText` back). Restore → **`4 passed`**. **Confirmed fails-on-revert.**

Both implementor test files appear in `git diff origin/main...HEAD --name-only`.

---

## 5. Adversarial tests added (tester-owned, different angle, on-branch, in-diff)

Committed at **`dfdd53394`**. Both appear in `git diff origin/main...HEAD --name-only`.

**A. `mingla-business/__tests__/routes/orch1332PartnerModeGuardAdversarial.test.ts`** (3 tests)
- Angle: the implementor asserts the F-2 branch *exists*; I assert the branch is *safe*. Extracts the exact `else if (…) { … setState(...mode:"client") }` block via regex and asserts ALL guard clauses are present (`isPartner`, `partnerModeParam === "client"`, `state.step === 1`, `state.mode === "self"`, `state.name === ""`, `state.bio === ""`) — an unguarded re-apply that would clobber committed/typed state would pass the implementor test but FAIL mine. Also asserts the dispatch changes ONLY `mode` (no `name/bio/step` reset → no data loss) and the self-mode invariant (`const max = state.mode === "client" ? 5 : 4` → self never reaches the invite/step-5/partner-link).
- **fails-on-revert verified at `11a2c446a`:** remove the F-2 branch → `Tests: 2 failed, 1 passed` (guard-integrity + no-data-loss RED; the pre-existing self-mode reducer invariant stays green). Restored → 3 passed.

**B. `mingla-business/__tests__/partner/orch1333CloseGlyphAppWideAdversarial.test.ts`** (2 tests)
- Angle: the implementor checks the 4 *named* files; I guard the *whole app*. Recursively walks every `.tsx` under `mingla-business/app` + `src` (asserts >100 files scanned) and asserts ZERO `icon="x"` anywhere — catches any other/future file the 4-file test would miss. Also locks both partner close buttons' exact `testID` + `accessibilityLabel` verbatim and the canonical LEFT-close ChromeRow structure (`headerRightSlot` balanced spacer present; close index < `styles.headerMid` index).
- **fails-on-revert verified at `11a2c446a`:** restore the 4 pre-reskin files → `Tests: 2 failed, 2 total` (app-wide `icon="x"` reappears; `headerRightSlot` disappears). Restored → 2 passed.

Full combined run on HEAD: **4 suites, 13 tests, all GREEN** (2 implementor + 2 adversarial).

---

## 6. Constitution 14-rule matrix (independently re-checked vs the diff)

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | **PASS (source) / runtime device-gated** | The root-cause fix: `/brand/new` now resolves to a real route → CTA no longer dead-ends on "Brand not found." Runtime tap device-gated (SC-2/3/4). |
| 2 | One owner per truth | PASS | Route reads no state it doesn't own; `partner_mode` read once by the flow via `useLocalSearchParams`; brand write owned by `handleCreateIdentity`. |
| 3 | No silent failures | PASS | SC-7 — inline Retry + error Toast paths untouched. |
| 4 | One query-key per entity | N/A | No new query keys; `usePartnerStripeStatus` reused. |
| 5 | Server state server-side | PASS | No Zustand server snapshot added; state is local reducer + React Query. |
| 6 | Logout clears everything | N/A | No new persisted/auth state. |
| 7 | `[TRANSITIONAL]` labelled | N/A | None introduced. |
| 8 | Subtract before adding | PASS | Reskin DELETES bespoke button styles/eyebrow/hero before adding shared `<Button>`; no dead style left (verified 0 dangling `radius`/`glass`/`shadows` refs). |
| 9 | No fabricated data | PASS | No fake ratings/prices/times; header sub-line uses real `activeCount`/`pendingCount`. |
| 10 | Currency-aware | N/A | No currency rendering changed (earnings currency rows untouched). |
| 11 | One auth instance | PASS | Reuses `useAuth` in the flow; the anon-tolerant buyer-web rule N/A (these are authed partner routes, not buyer routes). |
| 12 | Validate at right time | PASS | Create/invite CTAs still gated on `isAuthReady` (unchanged). |
| 13 | Exclusion consistency | N/A | No filtering logic touched. |
| 14 | Persisted-state startup gate | PASS | F-2 handles the cold-start race exactly — a late `isPartner` no longer strands the flow; loop-safe. |

Zero constitutional violations → zero auto-P0.

---

## 7. Device / parity matrix

| Surface | Result | Note |
|---------|--------|------|
| Consumer iOS (`app-mobile`) | **N/A** | Different app; 0 files touched (verified in diff). |
| Consumer Android | **N/A** | Same. |
| Buyer/anon Web | **N/A** | Not a partner surface; partner routes are authed. |
| **Business iOS** | **device-build-gated (source PASS)** | No business dev build (`com.sethogieva.minglabusiness`) installed on the booted sim (only consumer `com.mingla.app.v2`). Building = EAS cloud (COMMS-0030 local build broken) + partner login. |
| **Business Android** | **device-build-gated (source PASS)** | Shared RN code with iOS → parity automatic; same build/login gate. |
| Admin Web | **N/A** | Not involved. |
| Business Web preview | **incidental** | Same RN route renders on biz-web; shared `GlassCard`/`Button` already handle opaque fallback + hover. Not the target surface. |
| Physical iPhone (HITL) | **not exercised** | Would require the same business dev build + partner login → folded into the Seth-provided seal below (not a silent skip). |

Parity across business iOS/Android is automatic (one RN codebase). No manual per-surface split needed beyond the shared build gate.

---

## 8. Discoveries for Orchestrator (never fixed here)

1. **DESIGN spec is UNTRACKED / not committed on-branch.** `Mingla_Artifacts/specs/DESIGN_ORCH-1333_PARTNER_PAGES_RESKIN.md` shows as `??` in `git status` and is ABSENT from `git diff origin/main...HEAD`. The closing PR must `git add` it, or the ORCH-1333 design contract will not land with the code. (Not a product-code defect.)
2. **Pre-existing RED (out of scope — ORCH-1337):** `src/components/venue/__tests__/VenueCreatorWizard.ve2.test.ts` asserts `toContain("CoverPickerSheet")`, but `CoverPickerSheet` has **0 occurrences** on BOTH this branch AND origin/main (`898e403aa`) — already red on main, independent of this diff (the icon swap at line 579 is nowhere near it). Needs its own follow-up. Do not attribute to ORCH-1332/1333.
3. **Worktree `node_modules` is a symlink to the anchor** (`~/Desktop/mingla-main/mingla-business/node_modules`) — this is the source of the implementor's reported ~756-error tsc baseline (unresolved `react`/`react-dom` types resolving against the anchor). Jest runs fine; the 8 touched files are individually type-clean. A real `npm ci` in-worktree would clear the noise. Not blocking.

---

## 9. Accepted conditions (CONDITIONAL PASS)

The verdict is held at CONDITIONAL PASS on exactly ONE condition, pre-authorized by the dispatch's runtime posture (device-build-gated, do-not-fabricate):

- **Runtime/live-fire device seal for SC-2, SC-3, SC-4 (runtime flash), SC-5, SC-6 (runtime)** — deferred to a Seth-provided EAS business dev build + partner-flagged account. No code defect underlies this deferral; it is purely an environment gate.

### What Seth must provide for the final on-device seal
1. **An EAS cloud dev build of `mingla-business`** (iOS + Android) — local iOS build is broken team-wide (COMMS-0030); OTA is frozen (COMMS-0052/0063) so this rides a NATIVE build, not `eas update`.
2. **A partner-flagged test account** (`creator_accounts.partner_enabled = true`) logged into that build on a sim/device.
3. Then drive, on iOS + Android: (a) `/partner/brands` empty state → tap "Set up your first partner brand" → confirm the client wizard opens (title "Create the client's brand"), NOT "Brand not found" (SC-2, SC-4). (b) Same from `/partner/earnings` "Ready to start earning?" nudge (SC-3). (c) Complete step 5 with a test owner email → confirm exactly one `partner_brand_links` row `status=awaiting_owner` (live DB read) + the ORCH-1329 invite email sends, and the row appears on `/partner/brands` (SC-5). (d) Cold-start deep-link `/brand/new?partner_mode=client` with partner status NOT pre-cached → confirm it lands client mode, never sticks self (SC-6). (e) Eyeball the re-skin: thin close ✕ top-LEFT, centered "Brands"/"Earnings" title, no "MINGLA PARTNER" eyebrow, cooler `#0c0e12` canvas, pill `<Button>`s in every state (incl. all 4 Stripe states in earnings).

---

**TEST-COMPLETE** — CONDITIONAL PASS (P0=0, P1=0, P2=0, P3=2, P4=1). Source verification exhaustive and clean; both regression suites independently fails-on-revert re-proven; two tester adversarial suites added (different angle, on-branch, in-diff, fails-on-revert @ `11a2c446a`, committed `dfdd53394`). Sole open item = the device-build-gated runtime seal, pre-authorized for deferral by the dispatch.
