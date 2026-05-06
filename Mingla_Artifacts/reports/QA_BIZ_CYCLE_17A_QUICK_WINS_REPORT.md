# QA REPORT — BIZ Cycle 17a (Quick Wins — TARGETED Verification)

**Cycle:** 17a (BIZ — Refinement Pass mini-cycle 1)
**Mode:** TARGETED
**Generated:** 2026-05-04
**Effort:** ~45 min (static + code-trace; no device available)

---

## 1. Layman summary

Verified 11 implementor items + 2 operator-side checklists against the binding SPEC. Static + code-trace: **all 33 SCs PASS or operator-gated**. tsc clean. All 5 allowlist comments byte-identical to SPEC. DEC-100 row content matches SPEC's DEC-099 prescription. DEC-082 absence + DEC-099 collision both independently confirmed. The events.tsx rightSlot composition is structurally correct: `[search, bell, +]` order, conditional gating preserved, TRANSITIONAL marker in place, kit-pattern style entry mirrors TopBar.tsx default cluster.

**6 runtime checks** (visual cluster rendering, pixel parity, toast z-order, currency rendering) are code-trace PASS but require operator smoke on TestFlight or dev build for pixel-level confirmation. Tester cannot run device.

**Zero P0 / P1 / P2 / P3 findings.** Four P4 notes (one positive observation, three pre-existing kit-wide observations not introduced by 17a).

---

## 2. Verdict

### **CONDITIONAL PASS**

**Conditions to elevate to unconditional PASS:**
1. **Operator runtime smoke** on TestFlight or dev build to verify T-A.1.1 + T-A.1.7 (visual cluster + pixel parity home vs events tab)
2. **Operator deploy-window dashboard work** for §A.5 (Supabase email template) and §B.1 (Sentry env wiring) — explicitly out-of-tester-scope per dispatch §3, included for traceability

**Severity tally:**
- **P0:** 0
- **P1:** 0
- **P2:** 0
- **P3:** 0
- **P4:** 4 (informational)

---

## 3. Static check results (33 SCs)

### §A.1 — events.tsx TopBar right-slot composition
| SC | Method | Result |
|---|---|---|
| SC-A.1.1 | Read events.tsx:393-417; verified `<View style={styles.topBarRightCluster}>` containing 3 IconChromes in order (search, bell, plus) | **PASS** (code-level) — runtime confirmation deferred to operator smoke |
| SC-A.1.2 | Conditional `{canCreateEvent ? <IconChrome plus/> : null}` at line 407 | **PASS** |
| SC-A.1.3 | `+` IconChrome retains `onPress={handleBuildEvent}` at line 411 | **PASS** |
| SC-A.1.4 | search + bell IconChromes have NO `onPress` prop (lines 401, 402-406) | **PASS** |
| SC-A.1.5 | Visual parity home vs events | **PASS (code-level)** — same `IconChrome icon="search"/icon="bell" size={36}` shape as TopBar.tsx DefaultRightSlot (lines 78-92); style `topBarRightCluster` mirrors TopBar.tsx `rightCluster` (lines 221-225). Pixel verification deferred to operator smoke (T-A.1.7) |
| SC-A.1.6 | TRANSITIONAL marker at events.tsx:394-399 | **PASS** |

### §A.2 — events.tsx duplicate `toastWrap` removal
| SC | Method | Result |
|---|---|---|
| SC-A.2.1 | Grep `toastWrap:` in events.tsx → 1 hit | **PASS** |
| SC-A.2.2 | Read events.tsx:733-741 — `position: "absolute"`, `zIndex: 100`, `elevation: 12` all present | **PASS** |
| SC-A.2.3 | Toast renders above sheets/dialogs | **PASS (code-level)** — deferred to operator smoke (T-A.2.1) |

### §A.3 — brandMapping default fills
| SC | Method | Result |
|---|---|---|
| SC-A.3.1 | Read brandMapping.ts:184-191 — `kind: "popup" as const`, `address: null`, `coverHue: 25` present | **PASS** |
| SC-A.3.2 | Re-ran `cd mingla-business && npx tsc --noEmit` independently | **PASS** (no output = 0 errors) |
| SC-A.3.3 | Read brandMapping.ts:26-46 — BrandRow interface unchanged | **PASS** |
| SC-A.3.4 | TRANSITIONAL marker at brandMapping.ts:184-188 | **PASS** |

### §A.4 — TRANSITIONAL marker comment updates
| SC | Method | Result |
|---|---|---|
| SC-A.4.1 | Grep `[TRANSITIONAL]` in recurrenceRule.ts → 0 hits (was 2) | **PASS** |
| SC-A.4.2 | Grep `J-A12` in BrandProfileView.tsx → 0 hits (was 1) | **PASS** |
| SC-A.4.3 | Read BrandProfileView.tsx:62 + :574 — markers unchanged | **PASS** |
| SC-A.4.4 | recurrenceRule.ts:5-6 cites "Cycle 4 wizard validators (CreatorStep2When, draftEventValidation) AND Cycle 9 publish flow" | **PASS** |

### §A.5 — Supabase email template
| SC | Method | Result |
|---|---|---|
| SC-A.5.1, A.5.2, A.5.3 | Operator-gated dashboard work | **OPERATOR-GATED** — IMPL report §C contains verbatim 5-step instructions; tester confirms instructions present |

### §A.6 — `canManualCheckIn` allowlist
| SC | Method | Result |
|---|---|---|
| SC-A.6.1 | Grep `orch-strict-grep-allow canManualCheckIn` → 5 hits across 2 files | **PASS** |
| SC-A.6.2 | All 5 hits byte-identical to verbatim string in SPEC §A.6 | **PASS** |
| SC-A.6.3 | Placement verified per file: scannerInvitationsStore.ts:35 (file-header JSDoc inline `*` style), :126 (inline `//`), :136 (above type field), :145 (above destructure); InviteScannerSheet.tsx:17 (file-header JSDoc inline `*` style) | **PASS** |

### §B.1 — Sentry env wiring
| SC | Method | Result |
|---|---|---|
| SC-B.1.1, B.1.2, B.1.3 | Operator-gated env + EAS Secrets work | **OPERATOR-GATED** — IMPL report §C contains verbatim 4-step instructions including DSN value; tester confirms instructions present |

### §B.2 — `FOUNDER_FEEDBACK.md`
| SC | Method | Result |
|---|---|---|
| SC-B.2.1 | Read `Mingla_Artifacts/FOUNDER_FEEDBACK.md` — file exists | **PASS** |
| SC-B.2.2 | Grep `2026-05-04 — Top bar IA` in file → 1 hit; verbatim quote preserved | **PASS** |
| SC-B.2.3 | Template comment block at lines 5-14 | **PASS** |

### §B.3 — DEC-100 author (renamed from DEC-099 due to collision)
| SC | Method | Result |
|---|---|---|
| SC-B.3.1 | Read DECISION_LOG.md:7 — DEC-100 row present with full content matching SPEC §B.3 prescription (mingla-marketing canonical realisation, DEC-081 supersession, D-CYCLE15-FOR-2 closure) + numbering note documenting DEC-099 collision | **PASS** (with documented ID shift) |
| SC-B.3.2 | Row format: 7 columns aligned with surrounding entries | **PASS** |

### §B.4 — DEC-082 closure (SKIPPED per fallback)
| SC | Method | Result |
|---|---|---|
| SC-B.4.1, B.4.2 | DEC-082 row absence independently verified — table jumps DEC-080 (line 24) → DEC-081 (line 23) → DEC-083 (line 22). Grep `DEC-082` returns hit only inside DEC-081's body text (cross-reference, not a row). Implementor correctly skipped per SPEC fallback (no fabrication) | **N/A — fallback honored** |

### §B.5 — `PAYMENT_METHOD_LABELS` consolidation
| SC | Method | Result |
|---|---|---|
| SC-B.5.1 | Read paymentMethodLabels.ts — exports `PAYMENT_METHOD_LABELS` with 4-key Record<DoorPaymentMethod, string> | **PASS** |
| SC-B.5.2 | Grep `^const PAYMENT_METHOD_LABELS\|^export const PAYMENT_METHOD_LABELS` → 1 hit (paymentMethodLabels.ts) | **PASS** |
| SC-B.5.3 | Grep `from "../../../../src/utils/paymentMethodLabels"` → 3 hits (door/[saleId].tsx, door/index.tsx, guests/[guestId].tsx) | **PASS** |
| SC-B.5.4 | Door sale label rendering unchanged | **PASS (code-level)** — byte-identical lift; same dict values; same call-site usage. Runtime confirmation deferred to operator smoke (T-B.5.2) |

### §B.6 — Currency formatter (no-op — already done)
| SC | Method | Result |
|---|---|---|
| SC-B.6.1 | currency.ts exists at `mingla-business/src/utils/currency.ts` with 3 exports (formatGbp, formatGbpRound, formatCount) | **PASS (pre-existing)** |
| SC-B.6.2 | Grep currency import in home.tsx + __styleguide.tsx → 2 hits (also +2 incidental in delete.tsx + o/[orderId].tsx — additional consumers, not regressions) | **PASS (pre-existing)** |
| SC-B.6.3 | Visual output unchanged | **PASS (code-level)** — no edits made; pre-existing imports continue. Runtime deferred (T-B.6.1, T-B.6.2) |

### §B.7 — Apple JWT D-IMPL-46 close
| SC | Method | Result |
|---|---|---|
| SC-B.7.1 | IMPL report §2 §B.7 contains verbatim closure paragraph citing autorotate spec + investigation + scheduled remote agent + GitHub Actions workflow | **PASS** |
| SC-B.7.2 | No code change beyond IMPL report mention | **PASS** (only artifact change is the IMPL report text) |

---

## 4. Runtime check results

| Test | Method | Result |
|---|---|---|
| **T-A.1.1** Events tab right cluster (high-rank) | Code-trace: events.tsx:393-417 confirms 3 IconChromes render unconditionally except `+` which is conditional on `canCreateEvent` | **PASS (code-level)** — operator smoke required for visual confirmation |
| **T-A.1.2** Events tab right cluster (low-rank) | Code-trace: same conditional logic; `canCreateEvent = canPerformAction(currentRank, "CREATE_EVENT")` returns false for rank<40 | **PASS (code-level)** |
| **T-A.1.3** Plus tap with no brand | Code-trace: `handleBuildEvent` at events.tsx:259-266 unchanged — `if (currentBrand === null)` branch shows toast + opens BrandSwitcherSheet | **PASS (code-level)** |
| **T-A.1.4** Plus tap with brand | Code-trace: same handler pushes `/event/create` route | **PASS (code-level)** |
| **T-A.1.5** Search tap | Code-trace: no onPress prop on search IconChrome at events.tsx:401 | **PASS (code-level)** — IconChrome with no onPress is render-only per kit pattern |
| **T-A.1.6** Bell tap | Code-trace: no onPress prop on bell IconChrome at events.tsx:402-406 | **PASS (code-level)** |
| **T-A.1.7** Visual parity home vs events | Code-trace: events.tsx renders same `IconChrome icon="search/bell" size={36}` shapes as TopBar.tsx DefaultRightSlot; styles `topBarRightCluster` (events.tsx:635-638) mirrors TopBar.tsx `rightCluster` (lines 221-225) — same `flexDirection: "row", alignItems: "center", gap: spacing.sm` | **PASS (code-level)** — pixel parity requires operator smoke on device. **Most-important manual test.** |
| **T-A.2.1** Toast z-order | Code-trace: events.tsx:733-741 — `toastWrap` has `position: "absolute"`, `zIndex: 100`, `elevation: 12`; will render above sheets/modals at runtime | **PASS (code-level)** |
| **T-B.5.2** Door sale payment label | Code-trace: byte-identical lift; consumers unchanged in usage | **PASS (code-level)** |
| **T-B.6.1** Home tab currency | No change; pre-existing import continues | **PASS (pre-existing)** |
| **T-B.6.2** __styleguide currency | No change; pre-existing import continues | **PASS (pre-existing)** |

---

## 5. Adjacent regression sweep results

| Surface | Method | Result |
|---|---|---|
| **brand_team_members permission flows** (BrandTeamView, useCurrentBrandRole) | brandMapping.ts only edited the mapper return (no schema change, no RLS change). useCurrentBrandRole hook is independent of mapBrandRowToUi. | **PASS (no regression)** |
| **DoorSaleNewSheet payment method picker** | DoorPaymentMethod type unchanged (still `"cash" \| "card_reader" \| "nfc" \| "manual"`). Picker doesn't import PAYMENT_METHOD_LABELS — uses the type directly. | **PASS (no regression)** |
| **GuestDetail door-sale section** | guests/[guestId].tsx imports PAYMENT_METHOD_LABELS from new util at line 43; usage at line 724 unchanged. | **PASS (no regression)** |
| **Recurrence rule expansion in event creator wizard** | Only file-header + docstring comments edited; no logic changes. CreatorStep2When + draftEventValidation continue to consume the same exports. | **PASS (no regression)** |
| **BrandProfileView Operations row "Finance reports"** | BrandProfileView.tsx:282-291 — comment updated to cite J-A12 onReports as live. Operations row JSX (operationsRows useMemo below this comment) unchanged. `onReports` callback wiring intact. | **PASS (no regression)** |

---

## 6. IMPL discovery acknowledgment

| ID | Description | Verification |
|---|---|---|
| **D-CYCLE17A-IMPL-1** | DEC-099 collision → DEC-100 used | **VERIFIED** — DEC-099 row at DECISION_LOG.md:9 is the ORCH-0713 architecture revision. DEC-100 at line 7 holds the marketing-drift content. Implementor's flag accurate. |
| **D-CYCLE17A-IMPL-2** | DEC-082 row absent | **VERIFIED** — Table jumps DEC-080 (line 24) → DEC-081 (line 23) → DEC-083 (line 22). No DEC-082 row exists. Implementor correctly skipped closure note per SPEC fallback. |
| **D-CYCLE17A-IMPL-3** | §B.6 already done; D-IMPL-A12-2 stale inventory | **VERIFIED** — currency.ts pre-exists with 3 exports; consumers home.tsx + __styleguide.tsx already import. No-op confirmed. Recommend orchestrator marks D-IMPL-A12-2 CLOSED-elsewhere in inventory. |
| **D-CYCLE17A-IMPL-4** | BrandProfileView TRANSITIONAL marker count | **VERIFIED** — informational only; pre-edit count was 5, post-edit count is 4 (line 286 J-A12 reference removed but Tax & VAT TRANSITIONAL preserved). No action needed. |
| **D-CYCLE17A-IMPL-5** | 36px touch target below WCAG 44pt | **VERIFIED** — kit-wide pre-existing pattern (TopBar.tsx DefaultRightSlot uses `size={36}`; AccessibilityIcon kit primitive defaults). Not introduced by 17a; deferred to 17c a11y audit. **P4 informational.** |
| **D-CYCLE17A-IMPL-6** | DoorPaymentMethod import potentially unused | **PARTIALLY VERIFIED** — implementor noted tsc passes. Independently re-ran tsc — passes. If imports are unused, tsc with default `noUnusedLocals: false` lets them through. Low-priority hygiene; not a defect. |
| **D-CYCLE17A-IMPL-7** | Effort under estimate | **OBSERVATION** — IMPL ~2.5 hrs vs SPEC's 6-hr estimate. Drivers are sound: (a) §B.6 already done, (b) §B.4 SKIPPED via fallback, (c) verbatim-accurate SPEC. **P4 positive — accurate forensics + binding SPEC pays off.** |

---

## 7. Constitutional compliance (14 rules)

| # | Rule | Result | Evidence |
|---|---|---|---|
| 1 | No dead taps | **PASS** | Search + bell are inert (no onPress) but have `accessibilityLabel`; matches existing TopBar.tsx default cluster TRANSITIONAL contract per Const #7. Not introduced by 17a. |
| 2 | One owner per truth | **PASS** | PAYMENT_METHOD_LABELS now has single owner in `paymentMethodLabels.ts`; 3 inline copies removed. |
| 3 | No silent failures | **N/A** | No error paths touched in 17a. |
| 4 | One query key per entity | **N/A** | No React Query keys touched. |
| 5 | Server state server-side | **N/A** | No state ownership changes. |
| 6 | Logout clears everything | **N/A** | No auth changes. |
| 7 | Label temporary fixes | **PASS** | TRANSITIONAL markers added on §A.1 inline cluster + §A.3 default fills, both with EXIT condition. |
| 8 | Subtract before adding | **PASS** | Duplicate `toastWrap` deleted (events.tsx) + 3 inline `PAYMENT_METHOD_LABELS` removed before adding util. |
| 9 | No fabricated data | **PASS** | DEC-082 closure SKIPPED rather than fabricated (no row exists; implementor honored fallback). DEC-099 collision honestly documented. |
| 10 | Currency-aware UI | **PASS** | currency.ts pre-existing util preserved; no inline currency formatters reintroduced. |
| 11 | One auth instance | **N/A** | No auth changes. |
| 12 | Validate at right time | **N/A** | No date validation logic touched. |
| 13 | Exclusion consistency | **N/A** | No filtering logic touched. |
| 14 | Persisted-state startup | **N/A** | No Zustand store hydration changes. |

**14/14 PASS or N/A. Zero violations.**

---

## 8. Operator action items (deploy-window)

These are NOT tester scope but flagged for orchestrator + operator awareness:

### §A.5 — Supabase email template (5-step dashboard verification)
1. Open Supabase Dashboard → **Authentication** → **Email Templates** → **Magic Link**
2. Confirm body contains `{{ .Token }}` (the 6-digit code) and does NOT contain `{{ .ConfirmationURL }}`
3. Confirm subject reads "Your Mingla Business sign-in code" (or similar)
4. Test sign-in via TestFlight/dev build — verify email arrives, body shows code, code verifies, no link
5. Save template if changes made

### §B.1 — Sentry env wiring (4-step env + EAS sync)
1. Add to `mingla-business/.env`:
   ```
   EXPO_PUBLIC_SENTRY_DSN=https://ba27572315b964df6edce0a4eb31a60a@o4511136062701568.ingest.us.sentry.io/4511334517243904
   ```
2. Sync to EAS Secrets:
   ```bash
   cd mingla-business
   eas secret:create --scope project --name EXPO_PUBLIC_SENTRY_DSN --value "https://ba27572315b964df6edce0a4eb31a60a@o4511136062701568.ingest.us.sentry.io/4511334517243904" --type string
   ```
3. Restart `npx expo start`; confirm Sentry init activates (debug log)
4. (Optional) Throw a deliberate error from a dev menu; confirm event appears in Sentry dashboard ≤30s

---

## 9. Discoveries for orchestrator

**D-CYCLE17A-QA-1 — Independent verification confirms IMPL claims.**
Re-ran tsc, re-grepped all SCs, re-read all touched files. Implementor's IMPL report verification matrix is accurate. No false-positive PASSes detected. Strong signal for forensics + SPEC + IMPL pipeline integrity.

**D-CYCLE17A-QA-2 — Operator runtime smoke is the only remaining gate.**
6 checks (T-A.1.1, T-A.1.7, T-A.2.1, T-B.5.2, T-B.6.1, T-B.6.2) are code-traced PASS but require visual confirmation on a device or web bundle. Operator should smoke on TestFlight or local `npx expo start` build before signing the 17a CLOSE.

**D-CYCLE17A-QA-3 — DEC-082 retroactive backfill (or accept the gap).**
Decision Log has a real numbering gap. Two options for orchestrator at CLOSE: (a) accept the gap as historical (the audit trail records that DEC-082 was skipped), OR (b) author a retroactive DEC-082 entry documenting whatever decision should have lived there. Tester recommends option (a) — historical artifacts have audit-trail value as-is. Implementor's IMPL report §F flagged this for orchestrator decision.

**D-CYCLE17A-QA-4 — D-CYCLE17A-IMPL-5 (touch target 36px) deserves explicit 17c entry.**
Pre-existing kit-wide pattern; tester confirms not a 17a regression. Recommend orchestrator registers as a separate ORCH-ID in PRIORITY_BOARD for 17c a11y audit consideration. WCAG AA target requires 44pt minimum touch targets; current kit pattern is 36pt, so the gap is real — just not introduced by 17a.

**D-CYCLE17A-QA-5 — Cycle 17 master inventory aggregate had a stale entry.**
D-IMPL-A12-2 (Cycle 2 currency formatter inline copies) was actually closed during a later cycle but appeared in the master inventory as still-open. IMPL report flagged this. Recommend orchestrator audits the `TEMP_CYCLE_17_BACKLOG_AGGREGATE.md` against current code state at 17a CLOSE — there may be other stale entries.

**D-CYCLE17A-QA-6 — `DoorPaymentMethod` type imports may be unused in 3 consumer files.**
After PAYMENT_METHOD_LABELS lift, the type may not be used in `door/[saleId].tsx`, `door/index.tsx`, `guests/[guestId].tsx`. tsc accepts this silently. Low-priority; recommend orchestrator considers an unused-import audit for 17d perf pass.

---

## 10. Cross-references

- IMPL report: `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_17A_QUICK_WINS_REPORT.md`
- SPEC: `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_17A_QUICK_WINS.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_17A_QUICK_WINS.md`
- Tester dispatch: `Mingla_Artifacts/prompts/TEST_BIZ_CYCLE_17A_QUICK_WINS.md`
- Master inventory: `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_17_REFINEMENT_PASS.md`
- DEC-100: `Mingla_Artifacts/DECISION_LOG.md` (line 7)
- FOUNDER_FEEDBACK.md: `Mingla_Artifacts/FOUNDER_FEEDBACK.md` (NEW — first canonical entry)

---

## 11. Conclusion

**CONDITIONAL PASS** — the 17a IMPL is structurally correct, type-safe, and constitutionally compliant. Operator smoke on device is required to elevate to unconditional PASS (visual cluster rendering + pixel parity), and operator must complete §A.5 + §B.1 dashboard work during deploy window.

**Recommended next steps (orchestrator):**
1. Operator runs smoke test on TestFlight or `npx expo start` to confirm T-A.1.1 + T-A.1.7
2. If smoke PASS → orchestrator runs 17a CLOSE protocol (7-artifact sync + commit + EAS dual-platform OTA + announce 17b forensics dispatch)
3. Operator schedules §A.5 + §B.1 dashboard work for deploy window
4. Orchestrator addresses D-CYCLE17A-QA-3 (DEC-082 gap decision) + D-CYCLE17A-QA-4 (register 17c WCAG entry) at CLOSE time

**END OF QA REPORT.** Hand back to operator for orchestrator REVIEW + CLOSE protocol.
