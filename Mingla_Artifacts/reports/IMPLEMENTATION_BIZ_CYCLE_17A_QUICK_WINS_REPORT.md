# IMPLEMENTATION REPORT — BIZ Cycle 17a (Quick Wins — Mechanical Cleanup)

**Cycle:** 17a (BIZ — Refinement Pass mini-cycle 1)
**Status:** completed
**Verification:** passed (tsc clean + all SC grep checks green)
**Generated:** 2026-05-04
**Effort:** ~2.5 hrs (well under SPEC's 6-hr estimate due to §B.6 already-done discovery + 0 reworks)

---

## 1. Layman summary

Shipped 11 implementor items + 2 operator-side checklists. Events tab now shows `[search, bell, +]` (was `+`-only). Latent type drift in `mapBrandRowToUi` patched with safe defaults so future B-cycle real-brand creation won't crash. Duplicate `toastWrap` deleted. 3 stale TRANSITIONAL markers cleaned. 5 `canManualCheckIn` allowlist comments placed. `FOUNDER_FEEDBACK.md` created with the operator's first feedback entry pre-populated. DEC-100 authored (DEC-099 was taken).

**Two SPEC-vs-reality discoveries surfaced and handled per dispatch §7 instructions:**
- §B.6 (currency formatter consolidation) was **already done** — `src/utils/currency.ts` exists with 3 exports; both consumers already import. No-op confirmed.
- DEC-082 row **does not exist** in `DECISION_LOG.md` — table jumps DEC-080 → DEC-081 → DEC-083. Closure note skipped per SPEC §B.4 fallback. Flagged.
- DEC-099 ID was **already taken** by ORCH-0713 architecture revision. Used DEC-100 instead. Flagged.

**Test first:** open events tab on TestFlight/dev build → confirm right cluster shows `[search-icon, bell-icon, plus-icon]` for account_owner; `[search-icon, bell-icon]` for scanner role.

---

## 2. Section A — Code changes (per SPEC item)

### §A.1 — events.tsx TopBar right-slot composition

**File:** `mingla-business/app/(tabs)/events.tsx`
**What it did before:** `rightSlot={canCreateEvent ? <IconChrome icon="plus".../> : null}` — replaced the entire TopBar default cluster with a single `+` icon (or fell back to default search+bell when null).
**What it does now:** `rightSlot=` renders an inline `<View style={styles.topBarRightCluster}>` containing 3 IconChromes: search (inert) + bell (inert) + plus (gated on canCreateEvent, retains existing `handleBuildEvent` onPress).
**Why:** Satisfies SC-A.1.1 through SC-A.1.6. Operator-confirmed UX (events tab shows [search, bell, +] for event_manager+; [search, bell] for lower ranks). Closes D-17-11 + the §A.1 portion of founder feedback 2026-05-04.
**Lines changed:** ~+25 JSX lines + 7 new styles entry lines.
**TRANSITIONAL marker added:** above the inline cluster, citing 17b structural rework as EXIT.

### §A.2 — events.tsx duplicate toastWrap removal

**File:** `mingla-business/app/(tabs)/events.tsx`
**What it did before:** Two `toastWrap` keys in the styles object (lines 711-719 + 720-726); the second silently clobbered the first, stripping `zIndex: 100` and `elevation: 12` — toast risked rendering behind sheets/dialogs.
**What it does now:** Single `toastWrap` style block with `zIndex: 100` + `elevation: 12` intact.
**Why:** Satisfies SC-A.2.1, SC-A.2.2, SC-A.2.3. Closes D-CYCLE12-IMPL-1 (flagged 6 cycles).
**Lines changed:** −7 lines (pure subtraction).

### §A.3 — brandMapping default fills

**File:** `mingla-business/src/services/brandMapping.ts`
**What it did before:** `mapBrandRowToUi` returned an object missing 3 required Brand-type fields: `kind`, `address`, `coverHue`. Type-failed with TS2741 on strict tsc — masked because real-DB brand creation isn't wired yet (B-cycle).
**What it does now:** Returns `kind: "popup" as const`, `address: null`, `coverHue: 25` as defaults. Object satisfies the Brand type. TRANSITIONAL marker placed above the 3 lines documenting EXIT (B-cycle adds the 3 columns to brands table; mapper switches to row-derived values).
**Why:** Satisfies SC-A.3.1, SC-A.3.2, SC-A.3.3, SC-A.3.4. Closes D-CYCLE12-IMPL-2 (flagged 6 cycles). Crash dodge for first-real-DB-brand-creation in B-cycle.
**Lines changed:** +9 lines (3 default fields + 6 lines of TRANSITIONAL comment).

### §A.4 — TRANSITIONAL marker comment updates

**File 1:** `mingla-business/src/utils/recurrenceRule.ts`
- Lines 1-10 (file header): replaced JSDoc to drop `[TRANSITIONAL]` tag + claim "unused in Cycle 4". Now correctly cites Cycle 4 wizard validators + Cycle 9 publish flow as consumers.
- Lines 221-226 (recurrenceRuleToRfc5545 docstring): same treatment.
**Why:** Satisfies SC-A.4.1, SC-A.4.4. Markers were stale — Cycle 4 wizard + Cycle 9 publish both shipped.
**Lines changed:** ~−4 lines net (removed redundant claims).

**File 2:** `mingla-business/src/components/brand/BrandProfileView.tsx`
- Lines 286-287: removed J-A12 reference (J-A12 shipped Cycle 2 + onReports callback wired). Updated comment to add `J-A12 onReports (Finance reports row)` to the Live wirings list. Tax & VAT TRANSITIONAL note preserved.
**Why:** Satisfies SC-A.4.2, SC-A.4.3.
**Lines changed:** ~+1/−1 (comment refactor).

### §A.5 — Supabase email template (operator-side checklist)

**No code change.** Operator runs the 5-step verification in `mingla-business/Supabase Dashboard` during deploy window. Verbatim instructions in §C below.

### §A.6 — `canManualCheckIn` allowlist comments (5 sites)

**File 1:** `mingla-business/src/store/scannerInvitationsStore.ts` — 4 allowlist comments inserted:
- Above the file-header `Cycle 13b Q1 (SPEC §4.5 / DEC-093): canManualCheckIn field DROPPED` paragraph (inline JSDoc style)
- Above the `// v1 → v2 (Cycle 13b Q1 / SPEC §4.5): drop canManualCheckIn` block comment
- Above the `canManualCheckIn?: boolean;` v1 type field
- Above the `const { canManualCheckIn: _drop, ...restPerms } = e.permissions;` destructure

**File 2:** `mingla-business/src/components/scanners/InviteScannerSheet.tsx` — 1 allowlist comment inserted above the file-header `Cycle 13b Q1 (SPEC §4.6): canManualCheckIn toggle DROPPED` paragraph.

**Comment text (verbatim, all 5 sites):**
```
// orch-strict-grep-allow canManualCheckIn — Cycle 13b migration removes this field; reference is part of the strip logic, not active usage.
```

**Why:** Satisfies SC-A.6.1, SC-A.6.2, SC-A.6.3.
**Lines changed:** +5 (1 comment per site).
**Note:** No strict-grep CI gate currently exists (per SPEC-DISCOVERY-1) — comments are preventive for a future gate.

### §B.1 — Sentry env wiring (operator-side checklist)

**No code change.** Operator runs the 4-step verification in §C below.

### §B.2 — `FOUNDER_FEEDBACK.md` creation

**File:** `Mingla_Artifacts/FOUNDER_FEEDBACK.md` (NEW)
**What it does:** Append-only operator-feedback log. Pre-populated with the operator's 2026-05-04 top-bar IA feedback (3 sub-items: 1+2 routed to 17a/17b pipeline; sub-item 3 declined). Includes verbatim founder quote + orchestrator triage. Comment-block template at top for future entries.
**Why:** Satisfies SC-B.2.1, SC-B.2.2, SC-B.2.3. Closes D-17-2 + addresses J-Z1 baseline gap (no canonical founder-feedback log existed).

### §B.3 — DEC-100 author (renamed from §B.3 DEC-099 due to ID collision)

**File:** `Mingla_Artifacts/DECISION_LOG.md`
**What it does:** Inserted new DEC-100 row at chronological top of decision table. Documents `mingla-marketing/` as the canonical realisation of DEC-081 + locks treatment-as-live across future cycles. Closes D-CYCLE15-FOR-2 documentation drift.
**Why:** Satisfies SC-B.3.1, SC-B.3.2 (re-mapped to DEC-100).
**Lines changed:** +1 row.

**SPEC deviation:** SPEC §B.3 specified ID `DEC-099`, but `DEC-099` was already taken by the ORCH-0713 architecture revision (logged 2026-05-04 close++++++ at line 8 of DECISION_LOG.md). Used `DEC-100` instead. Documented in the DEC-100 row's "Numbering note" + flagged in §F discoveries below.

### §B.4 — DEC-082 closure note (SKIPPED — DEC-082 absent)

**File:** `Mingla_Artifacts/DECISION_LOG.md` (no change)
**What it does:** No edit. SPEC §B.4 fallback path triggered: "If DEC-082 doesn't exist, IMPL report flags this as a discovery — no fabrication."
**Verification:** Read DECISION_LOG.md table chronology; rows present at lines 22 (DEC-083), 23 (DEC-081), 24 (DEC-080). No DEC-082 row exists. Numbering gap retired in spirit (since DEC-100 just landed); explicit closure note unauthored to honor the no-fabrication rule.
**Flagged in §F.**

### §B.5 — `PAYMENT_METHOD_LABELS` consolidation

**File 1:** `mingla-business/src/utils/paymentMethodLabels.ts` (NEW)
**What it does:** Single source of truth for 4-key Record<DoorPaymentMethod, string> with values `{ cash: "Cash", card_reader: "Card reader", nfc: "NFC tap", manual: "Manual" }`. Verified all 3 prior copies were byte-identical before lift.

**File 2:** `mingla-business/app/event/[id]/door/[saleId].tsx`
**What it did before:** Inline `const PAYMENT_METHOD_LABELS` at lines 82-87 + import of `DoorPaymentMethod`.
**What it does now:** Import `PAYMENT_METHOD_LABELS` from the new util. Inline const removed.
**Lines changed:** −7 + +1 import.

**File 3:** `mingla-business/app/event/[id]/door/index.tsx`
**What it did before:** Inline `const PAYMENT_METHOD_LABELS` at lines 135-140.
**What it does now:** Import from new util.
**Lines changed:** −7 + +1 import.

**File 4:** `mingla-business/app/event/[id]/guests/[guestId].tsx`
**What it did before:** Inline `const PAYMENT_METHOD_LABELS` at lines 108-113.
**What it does now:** Import from new util.
**Lines changed:** −7 + +1 import.

**Why:** Satisfies SC-B.5.1, SC-B.5.2, SC-B.5.3, SC-B.5.4. Closes D-CYCLE12-IMPL-4. Net −18 lines + 1 new util file.

### §B.6 — Currency formatter consolidation (NO-OP — already done)

**No file changed.** Verified `mingla-business/src/utils/currency.ts` already exists with 3 exports (`formatGbp`, `formatGbpRound`, `formatCount`). Both consumers already import:
- `mingla-business/app/(tabs)/home.tsx:48` imports `formatGbpRound`
- `mingla-business/app/__styleguide.tsx:65` imports `formatGbpRound`

No inline currency formatters remained in either file. **§B.6 already-done discovery flagged in §E.** Closure on D-IMPL-A12-2 ratifies pre-existing state.

### §B.7 — Apple JWT D-IMPL-46 CLOSE entry

**No file changed beyond this IMPL report.** Per SPEC §B.7, closure note is included here for the audit trail:

> **D-IMPL-46 (Apple JWT expiry tracker) — CLOSED in Cycle 17a as already-mitigated.**
>
> Belt + suspenders + auto already in place:
> - Autorotate spec: `Mingla_Artifacts/specs/SPEC_APPLE_JWT_AUTOROTATE.md`
> - Autorotate investigation: `Mingla_Artifacts/reports/INVESTIGATION_APPLE_JWT_AUTOROTATE.md`
> - One-shot scheduled remote agent fires 2026-10-12 (T-14 reminder)
> - GitHub Actions workflow: `.github/workflows/rotate-apple-jwt.yml`
>
> No 17a code work needed.

---

## 3. Section B — Verification matrix

All success criteria verified via direct code inspection + tsc + grep checks. PASS unless noted.

### §A.1
- **SC-A.1.1** — Events tab right cluster renders 3 icons (search, bell, plus) when canCreateEvent: **PASS** (verified at events.tsx:400-414)
- **SC-A.1.2** — Renders 2 icons (no plus) when !canCreateEvent: **PASS** (conditional `{canCreateEvent ? ... : null}` at line 407)
- **SC-A.1.3** — `+` retains `handleBuildEvent` onPress: **PASS** (line 411)
- **SC-A.1.4** — Search/bell render but onPress unwired: **PASS** (no onPress prop on either)
- **SC-A.1.5** — Visual parity with home tab default cluster: **UNVERIFIED** (requires runtime device test — implementor cannot side-by-side without TestFlight)
- **SC-A.1.6** — TRANSITIONAL marker present above inline cluster: **PASS** (lines 394-399)

### §A.2
- **SC-A.2.1** — Single `toastWrap` key in styles object: **PASS** (grep `toastWrap:` returns 1)
- **SC-A.2.2** — Remaining `toastWrap` has `zIndex: 100` + `elevation: 12`: **PASS** (verified at events.tsx:711-719)
- **SC-A.2.3** — Toast renders above sheets/dialogs: **UNVERIFIED** (runtime test)

### §A.3
- **SC-A.3.1** — Return object includes 3 default fields: **PASS** (brandMapping.ts:184-188)
- **SC-A.3.2** — `tsc --noEmit` shows no TS2741 on mapBrandRowToUi: **PASS** (full tsc run completed with no output = clean compile)
- **SC-A.3.3** — BrandRow interface unchanged: **PASS** (no edits to lines 26-46)
- **SC-A.3.4** — TRANSITIONAL marker present: **PASS** (brandMapping.ts:184-188)

### §A.4
- **SC-A.4.1** — `[TRANSITIONAL]` in recurrenceRule.ts returns 0 hits: **PASS** (grep verified)
- **SC-A.4.2** — `J-A12` in BrandProfileView.tsx returns 0 hits: **PASS** (grep verified)
- **SC-A.4.3** — BrandProfileView.tsx:62 + :574 markers UNCHANGED: **PASS** (only line 286 edit; lines 62 + 574 untouched)
- **SC-A.4.4** — recurrenceRule.ts header cites both Cycle 4 + Cycle 9: **PASS** (lines 5-6)

### §A.5
- **SC-A.5.1, A.5.2, A.5.3** — operator-side dashboard verification: **UNVERIFIED — operator action required** (instructions in §C)

### §A.6
- **SC-A.6.1** — All 5 sites have allowlist comment: **PASS** (verified by direct read)
- **SC-A.6.2** — Verbatim comment text: **PASS**
- **SC-A.6.3** — File-header JSDoc handling correct: **PASS** (inline JSDoc style at scannerInvitationsStore.ts:35 + InviteScannerSheet.tsx:17)

### §B.1
- **SC-B.1.1, B.1.2, B.1.3** — operator-side env wiring: **UNVERIFIED — operator action required** (instructions in §C)

### §B.2
- **SC-B.2.1** — File exists at `Mingla_Artifacts/FOUNDER_FEEDBACK.md`: **PASS**
- **SC-B.2.2** — Contains verbatim 2026-05-04 entry: **PASS**
- **SC-B.2.3** — Template comment block present: **PASS**

### §B.3
- **SC-B.3.1** — DECISION_LOG.md contains row matching content: **PASS** (re-mapped to DEC-100; original DEC-099 ID was taken)
- **SC-B.3.2** — Row format matches surrounding entries: **PASS** (7 columns aligned)

### §B.4
- **SC-B.4.1, B.4.2** — DEC-082 closure: **N/A — DEC-082 absent**, flagged in §F per SPEC fallback

### §B.5
- **SC-B.5.1** — paymentMethodLabels.ts exists + exports PAYMENT_METHOD_LABELS: **PASS**
- **SC-B.5.2** — `const PAYMENT_METHOD_LABELS` returns exactly 1 hit: **PASS**
- **SC-B.5.3** — All 3 consumers import from new util: **PASS**
- **SC-B.5.4** — Visual output unchanged: **UNVERIFIED** (runtime test; static lift is byte-identical so risk is minimal)

### §B.6
- **SC-B.6.1, B.6.2, B.6.3** — Currency formatter exports + imports: **PASS — already in place pre-17a** (verified pre-existing state)

### §B.7
- **SC-B.7.1** — IMPL report contains close note: **PASS** (§2 §B.7 above)
- **SC-B.7.2** — No code change beyond this report: **PASS**

---

## 4. Section C — Operator-side checklist (deploy-window action)

### §A.5 — Supabase email template verification

1. Open Supabase Dashboard → **Authentication** → **Email Templates** → **Magic Link**
2. Confirm body text matches (or update to) the verbatim block:
   ```
   Hi,

   Your Mingla Business sign-in code:

   {{ .Token }}

   Enter this 6-digit code in the app to sign in. The code expires in 60 minutes.

   If you didn't request this, ignore this email.

   — Mingla Business
   ```
3. Confirm `{{ .ConfirmationURL }}` is **NOT** present anywhere in the body.
4. Confirm subject line reads **"Your Mingla Business sign-in code"** (or similar).
5. **Test:** sign in via email-OTP from a TestFlight/dev build → verify email arrives, body shows 6-digit code, code verifies in-app, no link present.

If template needs updating, save in dashboard. **No mobile code change required.**

### §B.1 — Sentry env wiring

1. Add to `mingla-business/.env`:
   ```
   EXPO_PUBLIC_SENTRY_DSN=https://ba27572315b964df6edce0a4eb31a60a@o4511136062701568.ingest.us.sentry.io/4511334517243904
   ```
2. Add same value to EAS Secrets (run from `mingla-business/`):
   ```bash
   eas secret:create --scope project --name EXPO_PUBLIC_SENTRY_DSN --value "https://ba27572315b964df6edce0a4eb31a60a@o4511136062701568.ingest.us.sentry.io/4511334517243904" --type string
   ```
3. Verify dev-server picks up the env var: restart `npx expo start` and confirm Sentry init logs (or check `app/_layout.tsx` `if (sentryDsn) { Sentry.init(...) }` branch is active).
4. (Optional smoke test) Throw a deliberate error from a dev menu and confirm it appears in Sentry dashboard within ~30 seconds.

**TRANSITIONAL flips to ACTIVE** when steps 1-3 verified — operator records in 17a CLOSE notes.

---

## 5. Section D — Test plan for tester

The 26 SPEC §6 test cases, organised for tester:

### Static checks (implementor-verified; tester should re-confirm)
- T-A.4.1: `grep "[TRANSITIONAL]" mingla-business/src/utils/recurrenceRule.ts` → 0 hits ✓
- T-A.4.2: `grep "J-A12" mingla-business/src/components/brand/BrandProfileView.tsx` → 0 hits ✓
- T-B.5.1: `grep "const PAYMENT_METHOD_LABELS" mingla-business/` → 1 hit ✓
- T-A.6.1: 5 allowlist comments verified per-site
- T-B.2.1: `Mingla_Artifacts/FOUNDER_FEEDBACK.md` exists ✓
- T-B.3.1: DECISION_LOG.md contains DEC-100 row ✓
- T-A.3.2: `tsc --noEmit` from `mingla-business/` clean ✓

### Runtime checks (tester-required — implementor cannot verify without device)
- **T-A.1.1** — Login as account_owner, open events tab → confirm right cluster shows `[search, bell, +]` (3 icons in order, gap=spacing.sm).
- **T-A.1.2** — Login as scanner role (rank=10), open events tab → confirm right cluster shows `[search, bell]` (no plus).
- **T-A.1.3** — As account_owner with no brand selected, tap `+` → confirm "Create a brand first" toast + brand switcher opens.
- **T-A.1.4** — As account_owner with brand selected, tap `+` → confirm navigation to `/event/create`.
- **T-A.1.5** — Tap search on events tab → confirm no action / no error.
- **T-A.1.6** — Tap bell on events tab → confirm no action / no error.
- **T-A.1.7** — Side-by-side: home tab vs events tab right cluster → confirm search + bell icons identical (size 36, gap, colour, accessibility labels).
- **T-A.2.1** — Trigger toast on events tab (e.g., delete a draft) → confirm toast appears ABOVE any open Sheet/Modal/ConfirmDialog.
- **T-B.5.2** — Open door sale detail → confirm payment label renders correctly (e.g., "Cash" for cash sales).
- **T-B.6.1** — Open home tab → confirm KPI currency string renders (e.g., `£24,180`).
- **T-B.6.2** — Open dev `__styleguide` route → confirm currency display matches home tab.
- **T-B.1.1, T-B.1.2** — Sentry init verification (gated on operator §B.1 wiring; tester after env wired).

### Operator-required (gated on dashboard work)
- **T-A.5.1** — Email-OTP sign-in test (operator after §A.5 dashboard check).

---

## 6. Section E — SPEC-discovery actions

### SPEC-DISCOVERY-1 (no strict-grep CI gate exists) — INFORMATIONAL acknowledged
Implementor confirmed no strict-grep CI gate in `.github/workflows/`. The 5 allowlist comments are preventive for a future gate. Did NOT create the gate per dispatch §5 constraints.

### SPEC-DISCOVERY-2 (BrandRow not updated in §A.3) — INFORMATIONAL acknowledged
Implementor left `BrandRow` interface (lines 26-46) + `mapUiToBrandInsert` + `mapUiToBrandUpdatePatch` UNCHANGED per SPEC. Only the mapper return statement was edited.

### SPEC-DISCOVERY-3 (currency formatter shape unverified) — RESOLVED with new finding
**Implementor read both files first as required.** Found that `currency.ts` ALREADY EXISTS with 3 exports (`formatGbp`, `formatGbpRound`, `formatCount`). Both consumers (home.tsx:48 + __styleguide.tsx:65) ALREADY import `formatGbpRound`. **There were no inline formatters left to consolidate.** §B.6 was already done. Decision: skip the planned new currency.ts creation; ratify the pre-existing state. Logged as no-op in §2 §B.6 above. **Outcome: better-than-expected — saved ~30 min.**

### SPEC-DISCOVERY-4 (DEC-082 existence unverified) — RESOLVED: ABSENT
**Implementor confirmed DEC-082 row does not exist.** Table chronology jumps DEC-080 (line 24) → DEC-081 (line 23) → DEC-083 (line 22). Per SPEC §B.4 fallback: closure note SKIPPED — flagged in §F.

### SPEC-DISCOVERY-5 (`topBarRightCluster` style entry will be deleted by 17b) — INFORMATIONAL acknowledged
Implementor included the style entry per SPEC + added the explicit code comment near it: `// Cycle 17a tactical — 17b TopBar refactor will delete this when extraRightSlot prop ships.` (See events.tsx styles block.)

### SPEC-DISCOVERY-6 (IconChrome import already present) — INFORMATIONAL acknowledged
No duplicate import added. Verified `IconChrome` import at events.tsx:32 was already present and reused.

---

## 7. Section F — Discoveries for orchestrator

**D-CYCLE17A-IMPL-1 — DEC-099 ID collision.**
SPEC §B.3 specified `DEC-099` for the `mingla-marketing/` doc-drift entry. At HEAD, `DEC-099` was already used by the ORCH-0713 architecture revision (logged 2026-05-04 close++++++ at DECISION_LOG.md line 8). Implementor used `DEC-100` instead and documented the collision inline + here. **Recommendation: orchestrator acknowledges the ID is now DEC-100 and updates any cross-references in WORLD_MAP / PRIORITY_BOARD when 17a CLOSE protocol fires.**

**D-CYCLE17A-IMPL-2 — DEC-082 row absent.**
DECISION_LOG.md table jumps DEC-080 → DEC-081 → DEC-083. No DEC-082 row exists. SPEC §B.4 closure note skipped per fallback (no fabrication). **Recommendation: orchestrator either (a) accepts the gap as the "DEC-082 numbering gap" itself (fitting — the closure note would have been describing its own absence), OR (b) authors a real DEC-082 entry retroactively documenting whatever decision should have lived there. Implementor cannot determine what DEC-082 should have contained.**

**D-CYCLE17A-IMPL-3 — §B.6 already done; D-IMPL-A12-2 was a stale discovery.**
The currency formatter consolidation was already shipped — `currency.ts` exists with 3 exports + both consumers already import. The Cycle 2 D-IMPL-A12-2 discovery that flagged inline currency formatters was correctly closed during a later cycle without being reflected in the master inventory aggregate. **Recommendation: orchestrator marks D-IMPL-A12-2 as CLOSED-elsewhere in the inventory; consider an inventory-aggregate audit gate that detects discoveries closed mid-flight.**

**D-CYCLE17A-IMPL-4 — Pre-existing TRANSITIONAL marker count on BrandProfileView.tsx.**
Pre-edit: 5 `[TRANSITIONAL]` markers across the file (lines 10 file-header reference, 62, 257, 286, 574). Post-edit: 4 markers remaining (62, 257, 286 Tax-VAT-only portion preserved, 574). The line-10 reference appears to be a documentation hit caught by the grep but NOT a TRANSITIONAL itself — it was a reference to the marker count in the file's own header. **Recommendation: low-priority — orchestrator may want to confirm line-10 reference is intentional documentation vs an editorial marker.**

**D-CYCLE17A-IMPL-5 — Touch target size below WCAG minimum (kit-wide pre-existing).**
The 36px IconChrome size used in §A.1 (mirroring TopBar.tsx default cluster) is below the WCAG 44x44pt minimum for touch targets. This is a kit-wide pre-existing pattern not introduced by 17a — every TopBar consumer uses size 36. **Recommendation: register as a separate ORCH-ID for 17c accessibility audit consideration; not a 17a regression.**

**D-CYCLE17A-IMPL-6 — `DoorPaymentMethod` import potentially unused after §B.5.**
After lifting `PAYMENT_METHOD_LABELS` out, the consumer files may no longer need `DoorPaymentMethod` imported (if it was only used to type the dict). Implementor did NOT remove the type imports per scope discipline. tsc passed cleanly so no error. **Recommendation: low-priority — future polish cycle could remove if unused.**

**D-CYCLE17A-IMPL-7 — IMPL effort came in under estimate.**
Estimated 6 hrs; actual ~2.5 hrs. Three drivers: (a) §B.6 already done (~30 min saved), (b) §B.4 SKIPPED via fallback (~15 min saved), (c) all SPEC code shapes verbatim and accurate (no investigation back-and-forth). **Observation only — accurate forensics + binding SPEC pays off.**

---

## 8. Section G — Files changed (consolidated)

| Path | Change |
|---|---|
| `mingla-business/app/(tabs)/events.tsx` | +27 / −7 (rightSlot composition + duplicate toastWrap removal + new style entry + TRANSITIONAL marker) |
| `mingla-business/src/services/brandMapping.ts` | +9 (3 default fields + TRANSITIONAL marker) |
| `mingla-business/src/utils/recurrenceRule.ts` | −4 net (2 marker comment refactors) |
| `mingla-business/src/components/brand/BrandProfileView.tsx` | ±1 (J-A12 reference removed; line wired to onReports referenced in updated comment) |
| `mingla-business/src/store/scannerInvitationsStore.ts` | +4 (4 allowlist comments) |
| `mingla-business/src/components/scanners/InviteScannerSheet.tsx` | +1 (1 allowlist comment) |
| `mingla-business/app/event/[id]/door/[saleId].tsx` | −7 / +1 (inline const removed, import added) |
| `mingla-business/app/event/[id]/door/index.tsx` | −7 / +1 (inline const removed, import added) |
| `mingla-business/app/event/[id]/guests/[guestId].tsx` | −7 / +1 (inline const removed, import added) |
| `mingla-business/src/utils/paymentMethodLabels.ts` | NEW (~20 lines) |
| `Mingla_Artifacts/FOUNDER_FEEDBACK.md` | NEW (~30 lines) |
| `Mingla_Artifacts/DECISION_LOG.md` | +1 row (DEC-100) |

**Net code delta:** ~+30 lines net across 11 files. No deps changed. No native modules touched. EAS OTA-able.

---

## 9. Section H — Test first / known limits

**Most-important manual test (T-A.1.1):**
Open events tab on TestFlight or `npx expo start` build, signed in as account_owner with at least one brand. **Expected:** TopBar right cluster shows 3 icons in order `[search, bell, +]` with even spacing. Tap each in turn — search and bell do nothing, `+` navigates to event creator.

**Second priority (T-A.1.7):**
Switch between home tab and events tab. Confirm search + bell icons look identical (same size, same colour, same gap).

**Known limits (UNVERIFIED — tester runtime required):**
- Visual parity of the 3-icon cluster vs default 2-icon cluster (T-A.1.5, T-A.1.7)
- Toast z-order above sheets/dialogs (T-A.2.1)
- Door sale + currency rendering visual outputs (T-B.5.2, T-B.6.1, T-B.6.2)
- Sentry init runtime verification (gated on operator §B.1 env wiring)
- Email-OTP runtime test (gated on operator §A.5 dashboard check)

**Pre-existing gap (NOT introduced by 17a):**
- IconChrome size 36 is below WCAG 44pt touch-target minimum across the kit. Surface for 17c accessibility audit (D-CYCLE17A-IMPL-5).

---

## 10. Cross-references

- SPEC: `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_17A_QUICK_WINS.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_17A_QUICK_WINS.md`
- Master inventory: `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_17_REFINEMENT_PASS.md`
- Implementor dispatch: `Mingla_Artifacts/prompts/IMPLEMENTATION_BIZ_CYCLE_17A_QUICK_WINS.md`
- DEC-100 entry: `Mingla_Artifacts/DECISION_LOG.md` (line 7)
- Operator-locked decisions: D-17-1 through D-17-13 (recorded in dispatch §10)

---

**END OF IMPLEMENTATION REPORT.** Hand back to operator for orchestrator REVIEW + tester dispatch.
