# SPEC — BIZ Cycle 17a (Quick Wins — Mechanical Cleanup)

**Cycle:** 17a (BIZ — Refinement Pass mini-cycle 1)
**Status:** BINDING — implementor contract
**Authored:** 2026-05-04 from `INVESTIGATION_BIZ_CYCLE_17A_QUICK_WINS.md` + `SPEC_BIZ_CYCLE_17A_QUICK_WINS.md` dispatch
**Estimated IMPL effort:** ~6 hrs

---

## 1. Layman summary

Cycle 17a ships 13 mechanical fixes that have been queuing across cycles 2–16a:

- **One real UI fix:** the events tab top bar regains its search + bell icons alongside the `+` (founder feedback)
- **One latent crash dodge:** `mapBrandRowToUi` gets safe defaults for 3 fields the DB schema doesn't carry yet (would crash when B-cycle wires real brand creation)
- **Stale stuff cleaned up:** 1 duplicate style block deleted, 3 stale TRANSITIONAL marker comments updated, 1 dict deduped across 3 files, 1 currency formatter consolidated
- **Paper trail caught up:** new `FOUNDER_FEEDBACK.md` file, DEC-099 authored, DEC-082 closed, Apple JWT D-IMPL-46 closed
- **Operator-side actions:** Sentry env var added to `.env` + EAS Secrets, Supabase email template verified

No DB migrations. No edge function changes. No native module changes. Pure frontend + docs cleanup.

---

## 2. Scope and non-goals

### In scope (13 items)

| ID | Item | Type | Owner |
|---|---|---|---|
| §A.1 | events.tsx TopBar right-slot composition | Code (UI) | Implementor |
| §A.2 | events.tsx duplicate `toastWrap` removal | Code (CSS) | Implementor |
| §A.3 | brandMapping default fills (`kind`, `address`, `coverHue`) | Code (Service) | Implementor |
| §A.4 | 3 TRANSITIONAL marker comment updates | Code (comments) | Implementor |
| §A.5 | Supabase email template verification | Operator (dashboard) | Operator |
| §A.6 | 5 `canManualCheckIn` allowlist comments | Code (comments) | Implementor |
| §B.1 | Sentry env wiring | Operator (env + EAS) | Operator |
| §B.2 | `FOUNDER_FEEDBACK.md` creation | Docs | Implementor |
| §B.3 | DEC-099 author for marketing drift | Docs | Implementor |
| §B.4 | DEC-082 closure note | Docs | Implementor |
| §B.5 | `PAYMENT_METHOD_LABELS` consolidation | Code (refactor) | Implementor |
| §B.6 | Currency formatter consolidation | Code (refactor) | Implementor |
| §B.7 | Apple JWT D-IMPL-46 CLOSE entry | Docs | Implementor |

**11 implementor items, 2 operator-only items.**

### Non-goals (explicit)

- **NO** TopBar.tsx changes — `extraRightSlot` prop is 17b's job
- **NO** wiring of search or bell `onPress` handlers — preserves TopBar TRANSITIONAL contract; 17b wires
- **NO** `brands` table column additions — B-cycle scope
- **NO** Stripe / Resend / Twilio / OneSignal wiring anywhere — every B-cycle marker stays
- **NO** `BrandProfileView` past-events stub-to-real refactor (BrandProfileView.tsx:62, :574 TRANSITIONALs stay)
- **NO** new strict-grep CI gate creation — Item F preventive only (see §SPEC-DISCOVERY-1 below)
- **NO** new invariants — I-37 (TopBar default cluster) deferred to 17b CLOSE
- **NO** changes outside `mingla-business/` and `Mingla_Artifacts/`

### Assumptions

- `mingla-business/tsconfig.json` is in strict mode (verifies §A.3 fix surfaces TS2741 absence after fix)
- The DSN provided in dispatch (`https://ba27572315b964df6edce0a4eb31a60a@o4511136062701568.ingest.us.sentry.io/4511334517243904`) is correct and operator-owned
- `eas` CLI is installed and operator is authenticated (for §B.1 EAS Secrets sync)
- Supabase Auth Magic Link template is currently using default body (operator hasn't customised) — §A.5 instructions assume this

---

## 3. Per-item layer specifications

### §A.1 — events.tsx TopBar right-slot composition

**Layer:** Component (mobile)
**File:** `mingla-business/app/(tabs)/events.tsx`
**Lines affected:** 393-403 (and 1 new import if `IconChrome` isn't already imported — verified: it IS imported at line 32)

**Pre-flight:** Implementor MUST invoke `/ui-ux-pro-max` BEFORE writing the JSX. Memory rule `feedback_implementor_uses_ui_ux_pro_max` is non-negotiable for visible UI changes.

**Current code (lines 390-403):**
```tsx
<TopBar
  leftKind="brand"
  onBrandTap={handleOpenSwitcher}
  rightSlot={
    canCreateEvent ? (
      <IconChrome
        icon="plus"
        size={36}
        onPress={handleBuildEvent}
        accessibilityLabel="Build a new event"
      />
    ) : null
  }
/>
```

**Target code (illustrative — implementor adapts to local style if needed):**
```tsx
<TopBar
  leftKind="brand"
  onBrandTap={handleOpenSwitcher}
  rightSlot={
    // [TRANSITIONAL] events.tsx renders search + bell + plus inline because TopBar's
    // rightSlot prop replaces (not composes) the default cluster. EXIT: 17b structural
    // rework adds `extraRightSlot` prop to TopBar; events.tsx switches to passing only
    // the `+` icon via the new prop. Per D-CYCLE17A-FOR-1 + proposed I-37.
    <View style={styles.topBarRightCluster}>
      <IconChrome icon="search" size={36} accessibilityLabel="Search" />
      <IconChrome
        icon="bell"
        size={36}
        accessibilityLabel="Notifications"
      />
      {canCreateEvent ? (
        <IconChrome
          icon="plus"
          size={36}
          onPress={handleBuildEvent}
          accessibilityLabel="Build a new event"
        />
      ) : null}
    </View>
  }
/>
```

**New StyleSheet entry (add to existing styles):**
```ts
topBarRightCluster: {
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.sm,
},
```

(Mirrors `TopBar.tsx` style block `rightCluster` at lines 221-225 — same pattern.)

**Behavioral contract:**
- Search and bell render but `onPress` MUST remain unwired (no handler prop) — preserves the existing TopBar TRANSITIONAL marker contract
- `+` retains existing `onPress={handleBuildEvent}` behavior unchanged
- Order in the cluster: `[search, bell, +]` (not `[+, search, bell]`) — matches TopBar default ordering for visual continuity

### §A.2 — events.tsx duplicate `toastWrap` removal

**Layer:** Component (CSS-in-JS)
**File:** `mingla-business/app/(tabs)/events.tsx`
**Lines affected:** 720-726 (DELETE)

**Action:** Pure subtraction. Delete the second `toastWrap` style block. Keep the first (lines 711-719) which has `zIndex: 100` and `elevation: 12`.

**Before (current):**
```ts
toastWrap: {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: spacing.xl,
  paddingHorizontal: spacing.md,
  zIndex: 100,
  elevation: 12,
},
toastWrap: {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: spacing.xl,
  paddingHorizontal: spacing.md,
},
```

**After:**
```ts
toastWrap: {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: spacing.xl,
  paddingHorizontal: spacing.md,
  zIndex: 100,
  elevation: 12,
},
```

### §A.3 — brandMapping default fills

**Layer:** Service
**File:** `mingla-business/src/services/brandMapping.ts`
**Lines affected:** 180-198 (modify return statement)

**Current return (lines 180-198):**
```ts
return {
  id: row.id,
  displayName: row.name,
  slug: row.slug,
  photo: row.profile_photo_url ?? undefined,
  role: options.role,
  stats: options.stats ?? { ...EMPTY_BRAND_STATS },
  currentLiveEvent: options.currentLiveEvent ?? null,
  bio: bio ?? undefined,
  tagline: tagline ?? undefined,
  contact: hasContact
    ? {
        email: row.contact_email?.trim() || undefined,
        phone: row.contact_phone?.trim() || undefined,
      }
    : undefined,
  links,
  displayAttendeeCount: row.display_attendee_count,
};
```

**Target return (insert 3 lines after `slug:` and before `photo:`):**
```ts
return {
  id: row.id,
  displayName: row.name,
  slug: row.slug,
  // [TRANSITIONAL] Cycle 7 FX2 added kind/address/coverHue to UI Brand type but
  // brands table doesn't carry these columns yet. Defaults: popup (safer — no fake
  // address shown), null address, hue 25 (warm-orange — matches accent.warm scheme).
  // EXIT: B-cycle adds the 3 columns to brands table → BrandRow interface + this
  // mapper read from `row` directly. Per Cycle 17a §A.3; closes D-CYCLE12-IMPL-2.
  kind: "popup" as const,
  address: null,
  coverHue: 25,
  photo: row.profile_photo_url ?? undefined,
  role: options.role,
  stats: options.stats ?? { ...EMPTY_BRAND_STATS },
  currentLiveEvent: options.currentLiveEvent ?? null,
  bio: bio ?? undefined,
  tagline: tagline ?? undefined,
  contact: hasContact
    ? {
        email: row.contact_email?.trim() || undefined,
        phone: row.contact_phone?.trim() || undefined,
      }
    : undefined,
  links,
  displayAttendeeCount: row.display_attendee_count,
};
```

**No changes to `BrandRow` interface (lines 26-46), `mapUiToBrandInsert` (line 209), or `mapUiToBrandUpdatePatch` (line 247).** These functions don't yet need to handle the 3 new fields because the DB doesn't have the columns. When B-cycle adds the columns, those mapping functions will need updates — but that's B-cycle scope.

### §A.4 — TRANSITIONAL marker comment updates (3 changes across 2 files)

#### §A.4.1 — `mingla-business/src/utils/recurrenceRule.ts:1-10`

**Current header:**
```ts
/**
 * Recurrence-rule helpers — preset → display label, expansion to dates,
 * RFC 5545 RRULE string emitter, weekday helpers.
 *
 * Per Cycle 4 spec §3.4.
 *
 * The RFC 5545 emit (`recurrenceRuleToRfc5545`) is unused in Cycle 4
 * (frontend-only — DEC-071) but exported so Cycle 9 backend integration
 * is one import away. [TRANSITIONAL] consumed by Cycle 9 publish edge fn.
 */
```

**Target header:**
```ts
/**
 * Recurrence-rule helpers — preset → display label, expansion to dates,
 * RFC 5545 RRULE string emitter, weekday helpers.
 *
 * Per Cycle 4 spec §3.4. Used by Cycle 4 wizard validators (CreatorStep2When,
 * draftEventValidation) AND Cycle 9 publish flow (liveEventStore conversion).
 */
```

#### §A.4.2 — `mingla-business/src/utils/recurrenceRule.ts:221-226`

**Current docstring above `recurrenceRuleToRfc5545`:**
```ts
/**
 * Convert RecurrenceRule to RFC 5545 RRULE string.
 *
 * [TRANSITIONAL] consumed by Cycle 9 publish edge function. Unused in
 * Cycle 4 — kept exported so Cycle 9 backend wires up cleanly.
 *
 * Format:
 *   daily       → "FREQ=DAILY;COUNT=N" or "FREQ=DAILY;UNTIL=YYYYMMDDT000000Z"
 *   weekly      → "FREQ=WEEKLY;BYDAY=MO;COUNT=N"
 *   biweekly    → "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=N"
 *   monthly_dom → "FREQ=MONTHLY;BYMONTHDAY=15;COUNT=N"
 *   monthly_dow → "FREQ=MONTHLY;BYDAY=1MO;COUNT=N" (with BYSETPOS prefix in BYDAY)
 */
```

**Target docstring:**
```ts
/**
 * Convert RecurrenceRule to RFC 5545 RRULE string.
 *
 * Used by Cycle 9 publish edge function consumption layer.
 *
 * Format:
 *   daily       → "FREQ=DAILY;COUNT=N" or "FREQ=DAILY;UNTIL=YYYYMMDDT000000Z"
 *   weekly      → "FREQ=WEEKLY;BYDAY=MO;COUNT=N"
 *   biweekly    → "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=N"
 *   monthly_dom → "FREQ=MONTHLY;BYMONTHDAY=15;COUNT=N"
 *   monthly_dow → "FREQ=MONTHLY;BYDAY=1MO;COUNT=N" (with BYSETPOS prefix in BYDAY)
 */
```

#### §A.4.3 — `mingla-business/src/components/brand/BrandProfileView.tsx:286-287`

**Current comment block (above `useCurrentBrandRole` call):**
```ts
// Hook-derived Operations rows. Per-row onPress closes over either
// fireToast (still-TRANSITIONAL rows) or the live navigation callback.
// Live wirings: J-A8 onEdit (sticky shelf — separate from this list) ·
// J-A9 onTeam (Team row) · J-A10 onPayments (Payments row).
// [TRANSITIONAL] remaining inert rows — exit when J-A12 (Finance reports)
// lands. Tax & VAT row stays TRANSITIONAL until §5.3.6 settings cycle.
// Cycle 13a (SPEC §4.14): Audit log row gated on brand_admin+ rank.
```

**Target comment block:**
```ts
// Hook-derived Operations rows. Per-row onPress closes over either
// fireToast (still-TRANSITIONAL rows) or the live navigation callback.
// Live wirings: J-A8 onEdit (sticky shelf — separate from this list) ·
// J-A9 onTeam (Team row) · J-A10 onPayments (Payments row) ·
// J-A12 onReports (Finance reports row).
// [TRANSITIONAL] Tax & VAT row stays TRANSITIONAL until §5.3.6 settings cycle.
// Cycle 13a (SPEC §4.14): Audit log row gated on brand_admin+ rank.
```

#### §A.4.4 — Markers explicitly NOT modified in 17a

`BrandProfileView.tsx:62` and `:574` (stub past-events list). Forensics flagged for 17b consideration. Out of 17a scope.

### §A.5 — Supabase email template verification (operator-side, no code)

This item produces NO code change. SPEC includes the operator-side checklist verbatim:

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
3. Confirm `{{ .ConfirmationURL }}` is **NOT** present anywhere in the body
4. Confirm subject line reads **"Your Mingla Business sign-in code"** (or similar)
5. **Test:** sign in via email-OTP from a TestFlight/dev build → verify email arrives, body shows 6-digit code, code verifies in-app, no link present

If template needs updating, save in dashboard. **No mobile code change required.**

### §A.6 — `canManualCheckIn` allowlist comments

**Layer:** Code (inline doc comments)

**Comment text (verbatim — paste exactly):**
```
// orch-strict-grep-allow canManualCheckIn — Cycle 13b migration removes this field; reference is part of the strip logic, not active usage.
```

**Insertion points (5 total):**

| File | Line | Placement |
|---|---|---|
| `mingla-business/src/store/scannerInvitationsStore.ts` | Above line 35 (which is inside the file-header JSDoc block) | Insert as a NEW LINE INSIDE the JSDoc, immediately above the `* Cycle 13b Q1` line. Format as `* // orch-strict-grep-allow ...` to fit JSDoc style — OR break the JSDoc, insert plain `// ...` comment, reopen JSDoc. **Preferred:** break the JSDoc cleanly, place plain `// ...` comment, then reopen with `/**` + the original `Cycle 13b Q1` content. |
| `mingla-business/src/store/scannerInvitationsStore.ts` | Above line 125 (inside a JSDoc-like comment block) | Insert immediately above the `// v1 → v2` line — plain `//` comment |
| `mingla-business/src/store/scannerInvitationsStore.ts` | Above line 134 | Insert immediately above the `canManualCheckIn?: boolean;` line inside the type definition — plain `//` comment |
| `mingla-business/src/store/scannerInvitationsStore.ts` | Above line 142 | Insert immediately above the `const { canManualCheckIn: _drop, ...restPerms } = e.permissions;` line — plain `//` comment |
| `mingla-business/src/components/scanners/InviteScannerSheet.tsx` | Above line 17 (inside file-header JSDoc) | Same JSDoc-handling preference as scannerInvitationsStore.ts:35 |

**Note:** Per SPEC discovery §SPEC-DISCOVERY-1 below, no strict-grep CI gate currently exists. These allowlist comments are **preventive** for a future gate. Implementor MUST NOT create the gate in 17a — that's a separate decision. Comments still go in so a future gate doesn't trip.

### §B.1 — Sentry env wiring (operator-side, no code)

This item produces NO mobile code change. SPEC includes the operator-side checklist verbatim:

1. Add to `mingla-business/.env`:
   ```
   EXPO_PUBLIC_SENTRY_DSN=https://ba27572315b964df6edce0a4eb31a60a@o4511136062701568.ingest.us.sentry.io/4511334517243904
   ```
2. Add same value to EAS Secrets (run from `mingla-business/`):
   ```bash
   eas secret:create --scope project --name EXPO_PUBLIC_SENTRY_DSN --value "https://ba27572315b964df6edce0a4eb31a60a@o4511136062701568.ingest.us.sentry.io/4511334517243904" --type string
   ```
3. Verify dev-server picks up the env var: restart `npx expo start` and confirm Sentry init logs (or check `app/_layout.tsx` `if (sentryDsn) { Sentry.init(...) }` branch is active)
4. (Optional smoke test) Throw a deliberate error from a dev menu and confirm it appears in Sentry dashboard within ~30 seconds

**TRANSITIONAL flips to ACTIVE** when steps 1-3 verified — operator records in 17a CLOSE notes.

### §B.2 — `FOUNDER_FEEDBACK.md` creation

**Layer:** Docs
**File:** `Mingla_Artifacts/FOUNDER_FEEDBACK.md` (NEW)

**Full file contents (verbatim — implementor creates this exact file):**

```markdown
# Founder Feedback Log

Append-only log. Most recent first. Each entry: date received → verbatim feedback → status (open / triaged-to-ORCH-XXXX / declined) → orchestrator notes.

<!-- TEMPLATE for new entries:

## YYYY-MM-DD — One-line topic

> "verbatim founder quote here"

**Triage:** [orchestrator's plain-English breakdown]
**Status:** [open / triaged-to-ORCH-XXXX / declined]

-->

---

## 2026-05-04 — Top bar IA + bottom nav real estate

> "the + button, when you navigate to the events page is missing. + for adding evemnts, and the notification, and search should be constant on the top bar at all times. I am thinking of moving the account from thr menu, to tyhe top bar. It is taking too much real estate for the bottom nav menu"

**Triage:** 3 sub-items.
- **Sub-item 1** — Missing `+` on events page: triaged-to-Cycle 17a §A.1 (tactical fix — events.tsx renders `[search, bell, +]` inline) + Cycle 17b structural rework (TopBar `extraRightSlot` prop + new I-37 invariant)
- **Sub-item 2** — Constant top bar (search + bell + `+`): triaged-to-Cycle 17b structural rework (D-17-12)
- **Sub-item 3** — Move Account to top bar: **declined** per operator decision 2026-05-04 ("leave the account in the bottom nav menu")

**Status:** sub-items 1+2 in active 17a/17b pipeline; sub-item 3 declined.
```

### §B.3 — DEC-099 author for `mingla-marketing/` doc drift

**Layer:** Docs
**File:** `Mingla_Artifacts/DECISION_LOG.md` (modify — append entry)

**Action:** Add a new row to the existing DEC table (matching whatever column shape DEC-097, DEC-098 already use). Implementor MUST read the existing DECISION_LOG to align column count + delimiters.

**Entry content (column values — implementor adapts to existing format):**

- **ID:** DEC-099
- **Date:** 2026-05-04
- **Decision:** `mingla-marketing/` (Next.js founder-owned repo) is the canonical realisation of DEC-081 (separate marketing surface); supersedes any Cycle 15-era ambiguity about marketing scope.
- **Why:** DEC-081 originally framed marketing as a future deliverable; reality is the founder-owned Next.js repo at `mingla-marketing/` shipped during Cycle 15 forensics. DEC-086 already locks founder ownership. This entry resolves the documentation drift surfaced in D-CYCLE15-FOR-2.
- **Alternative considered:** Defer indefinitely (rejected — drift compounds in future investigations and trips orchestrator re-discovery)
- **How to apply:** Treat `mingla-marketing/` as live + founder-owned across all future cycle planning. No BIZ-cycle work touches this repo unless explicitly handed off.
- **Cross-reference:** D-CYCLE15-FOR-2; DEC-081; DEC-086

### §B.4 — DEC-082 closure note

**Layer:** Docs
**File:** `Mingla_Artifacts/DECISION_LOG.md` (modify — append closure to existing DEC-082 row)

**Action:** Find the existing DEC-082 row. Append the following text to the row (in the appropriate column — likely the "Notes" or "Status" column, depending on the existing format):

```
**Closed Cycle 17a:** numbering gap retired; future DEC entries continue from DEC-099+ as authoritative.
```

**If DEC-082 doesn't exist or has been superseded with different content:** implementor MUST flag as a discovery in the IMPL report (do NOT fabricate a DEC-082 row).

### §B.5 — `PAYMENT_METHOD_LABELS` consolidation

**Layer:** Code (refactor)

**Current state (verified by SPEC author):**

3 separate definitions in:
- `mingla-business/app/event/[id]/door/[saleId].tsx:82` (consumed at :209)
- `mingla-business/app/event/[id]/door/index.tsx:135` (consumed at :565)
- `mingla-business/app/event/[id]/guests/[guestId].tsx:108` (consumed at :731)

**Target state:**

**NEW file:** `mingla-business/src/utils/paymentMethodLabels.ts` — single source of truth:

```ts
import type { DoorPaymentMethod } from "../store/doorSalesStore";

/**
 * Display labels for door-sale payment methods. Single source of truth —
 * used in door sale detail, door sale list rows, and guest detail screens.
 *
 * Per Cycle 17a §B.5 (consolidated 2026-05-04 from 3 inline copies).
 */
export const PAYMENT_METHOD_LABELS: Record<DoorPaymentMethod, string> = {
  // implementor copies the values from the existing 3 declarations
  // (verify all 3 are identical first; flag any divergence as a discovery)
};
```

**Update 3 consumer files:**
- Replace each inline `const PAYMENT_METHOD_LABELS = { ... }` with `import { PAYMENT_METHOD_LABELS } from "@/src/utils/paymentMethodLabels";` (or relative path matching the file's existing import style)
- Existing usages at lines 209, 565, 731 stay unchanged

**Verification step:**
1. Before consolidation: read all 3 declarations and confirm identical key/value pairs. If divergent → flag in IMPL report as discovery; pick the canonical one (probably the most recent / most complete).
2. After consolidation: `grep -n "const PAYMENT_METHOD_LABELS" mingla-business/` returns 1 hit (the new util file), down from 3.

### §B.6 — Currency formatter consolidation

**Layer:** Code (refactor)

**Current state (verified by SPEC author):**

No `mingla-business/src/utils/currency.ts` exists. Inline currency formatting lives in:
- `mingla-business/app/(tabs)/home.tsx`
- `mingla-business/app/__styleguide.tsx`

(D-IMPL-A12-2 originally flagged these. Implementor MUST grep both files for currency formatting patterns — likely `Intl.NumberFormat` or `.toFixed(2)` or `${value}` inline templates — to identify the exact formatters before refactoring.)

**Target state:**

**NEW file:** `mingla-business/src/utils/currency.ts`:

```ts
/**
 * Currency formatting for Mingla Business. Single source of truth.
 *
 * Per Cycle 17a §B.6 (consolidated 2026-05-04 from inline copies in
 * home.tsx + __styleguide.tsx). Per Const #10 (currency-aware UI):
 * future locale support comes through this util, not inline formatters.
 */

const GBP_FORMATTER = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const GBP_FORMATTER_PRECISE = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format minor units (pence) as £X (no decimals) — KPI display. */
export const formatGbp = (pennies: number): string =>
  GBP_FORMATTER.format(pennies / 100);

/** Format minor units (pence) as £X.YY (2 decimals) — finance display. */
export const formatGbpPrecise = (pennies: number): string =>
  GBP_FORMATTER_PRECISE.format(pennies / 100);
```

**Implementor adapts based on what the inline formatters actually do.** If both consumers use £X (no decimals), one export suffices. If one uses precise and one doesn't, both exports stay. **Read first, then consolidate.**

**Update consumers:**
- Replace inline currency-formatting with imports from `currency.ts`
- Verify visual output identical before/after (no rendering regression)

**Verification step:**
1. Before: identify the inline formatting expressions in both files
2. After: both consumers import from `currency.ts`; output strings match the original (e.g., `£24,180` stays `£24,180`)
3. (Per D-IMPL-A12-1 original report) the GMV KPI shift `£24,180 → £24,180.00` was a pre-existing visual bug; either format is acceptable as long as same is used consistently across home.tsx + finance reports

### §B.7 — Apple JWT D-IMPL-46 CLOSE entry

**Layer:** Docs (no file change required — this is a status update)

**Action:** Implementor adds a "Closed without code change" note to the IMPL report (`IMPLEMENTATION_BIZ_CYCLE_17A_QUICK_WINS_REPORT.md`). The note should state:

> **D-IMPL-46 (Apple JWT expiry tracker) — CLOSED in Cycle 17a as already-mitigated.**
>
> Belt + suspenders + auto already in place:
> - Autorotate spec: `Mingla_Artifacts/specs/SPEC_APPLE_JWT_AUTOROTATE.md`
> - Autorotate investigation: `Mingla_Artifacts/reports/INVESTIGATION_APPLE_JWT_AUTOROTATE.md`
> - One-shot scheduled remote agent fires 2026-10-12 (T-14 reminder)
> - GitHub Actions workflow: `.github/workflows/rotate-apple-jwt.yml`
>
> No 17a code work needed.

**No code change. No artifact change beyond the IMPL report mention.**

---

## 4. Success criteria

### §A.1 — events.tsx TopBar right-slot composition

- **SC-A.1.1** — On events tab, the TopBar right cluster renders 3 icons (search, bell, plus) in that order, with `gap: spacing.sm` between them, when the current operator's rank ≥ event_manager (40).
- **SC-A.1.2** — On events tab, the TopBar right cluster renders 2 icons (search, bell) in that order when the current operator's rank < event_manager.
- **SC-A.1.3** — Tapping the `+` icon on events tab fires `handleBuildEvent` (current behavior preserved): if no brand exists, shows "Create a brand first" toast and opens BrandSwitcherSheet; if brand exists, navigates to `/event/create`.
- **SC-A.1.4** — Tapping search or bell on events tab fires no action (no error, no toast, no navigation) — matches TopBar default `[TRANSITIONAL]` contract.
- **SC-A.1.5** — Visual: search + bell icons match the TopBar default cluster on home tab pixel-for-pixel (same icon, size 36, accessibility labels).
- **SC-A.1.6** — `[TRANSITIONAL]` marker comment is present immediately above the new inline `<View style={styles.topBarRightCluster}>` block.

### §A.2 — events.tsx duplicate `toastWrap` removal

- **SC-A.2.1** — `mingla-business/app/(tabs)/events.tsx` styles object contains exactly ONE `toastWrap` key.
- **SC-A.2.2** — The remaining `toastWrap` style block contains both `zIndex: 100` and `elevation: 12` properties.
- **SC-A.2.3** — Toast on events tab renders ABOVE all sheets/dialogs (no z-order regression).

### §A.3 — brandMapping default fills

- **SC-A.3.1** — `mapBrandRowToUi` return object includes `kind: "popup"`, `address: null`, `coverHue: 25` as literal defaults.
- **SC-A.3.2** — `tsc --noEmit` from `mingla-business/` shows 0 errors related to TS2741 missing-property errors on `Brand` type from `mapBrandRowToUi`.
- **SC-A.3.3** — `BrandRow` interface unchanged (no DB-column-shaped fields added prematurely).
- **SC-A.3.4** — `[TRANSITIONAL]` marker comment is present immediately above the 3 default lines, with EXIT condition stated.

### §A.4 — TRANSITIONAL marker updates

- **SC-A.4.1** — `grep "[TRANSITIONAL]" mingla-business/src/utils/recurrenceRule.ts` returns 0 hits (was 2).
- **SC-A.4.2** — `grep "J-A12" mingla-business/src/components/brand/BrandProfileView.tsx` returns 0 hits (was 1).
- **SC-A.4.3** — `BrandProfileView.tsx:62` and `:574` markers UNCHANGED (per non-goal).
- **SC-A.4.4** — `recurrenceRule.ts` file header comment correctly cites both Cycle 4 wizard validators AND Cycle 9 publish flow as consumers.

### §A.5 — Supabase email template

- **SC-A.5.1** — Email-OTP sign-in body shows the 6-digit `{{ .Token }}` value prominently.
- **SC-A.5.2** — Email-OTP sign-in body does NOT contain `{{ .ConfirmationURL }}` or any clickable link.
- **SC-A.5.3** — Operator confirms verification step in 17a CLOSE notes (signed in via TestFlight, code arrived, code verified successfully).

### §A.6 — `canManualCheckIn` allowlist

- **SC-A.6.1** — All 5 hits have an `// orch-strict-grep-allow canManualCheckIn` comment immediately above (or as the first line of the JSDoc block they sit in).
- **SC-A.6.2** — Comment text is verbatim the string in §A.6 above (no paraphrasing).
- **SC-A.6.3** — File-header JSDoc handling: comment placed correctly per the per-file note.

### §B.1 — Sentry env wiring

- **SC-B.1.1** — `mingla-business/.env` contains `EXPO_PUBLIC_SENTRY_DSN=...` line with the dispatch-provided DSN value.
- **SC-B.1.2** — EAS Secrets contains `EXPO_PUBLIC_SENTRY_DSN` with same value (verifiable via `eas secret:list`).
- **SC-B.1.3** — Operator confirms in 17a CLOSE notes that Sentry is receiving events from a dev/TestFlight build.

### §B.2 — FOUNDER_FEEDBACK.md

- **SC-B.2.1** — File `Mingla_Artifacts/FOUNDER_FEEDBACK.md` exists.
- **SC-B.2.2** — File contains the verbatim 2026-05-04 entry from §B.2 above.
- **SC-B.2.3** — File contains the comment-block template for future entries.

### §B.3 — DEC-099 author

- **SC-B.3.1** — `Mingla_Artifacts/DECISION_LOG.md` contains a row with ID `DEC-099` and content matching §B.3.
- **SC-B.3.2** — Row format aligns with surrounding DEC entries (column shape preserved).

### §B.4 — DEC-082 closure

- **SC-B.4.1** — Existing DEC-082 row contains the appended `**Closed Cycle 17a:**` text.
- **SC-B.4.2** — If DEC-082 doesn't exist, IMPL report flags this as a discovery (no fabrication).

### §B.5 — PAYMENT_METHOD_LABELS consolidation

- **SC-B.5.1** — `mingla-business/src/utils/paymentMethodLabels.ts` exists and exports `PAYMENT_METHOD_LABELS`.
- **SC-B.5.2** — `grep "const PAYMENT_METHOD_LABELS" mingla-business/` returns exactly 1 hit (the new util).
- **SC-B.5.3** — All 3 original consumer files import `PAYMENT_METHOD_LABELS` from the new util; existing usage call-sites unchanged.
- **SC-B.5.4** — Door sale detail, door sale list, and guest detail screens render identical labels to pre-refactor.

### §B.6 — Currency formatter consolidation

- **SC-B.6.1** — `mingla-business/src/utils/currency.ts` exists and exports at least `formatGbp` (other exports per implementor's read of inline formatters).
- **SC-B.6.2** — `home.tsx` and `__styleguide.tsx` import from `currency.ts` instead of inline formatting.
- **SC-B.6.3** — Visual output unchanged (e.g., `£24,180` still `£24,180`).

### §B.7 — Apple JWT D-IMPL-46 close

- **SC-B.7.1** — IMPL report contains the §B.7 verbatim closure note.
- **SC-B.7.2** — No code or artifact change beyond the IMPL report mention.

---

## 5. Invariants

### Preserved (must not break)

| ID | Description | How preserved in 17a |
|---|---|---|
| **I-32** (rank-mirror) | Mobile UI rank thresholds match RLS server-side enforcement | §A.1 doesn't change rank thresholds — only changes which icons render based on `canPerformAction(rank, "CREATE_EVENT")`. The gate is preserved. |
| **I-34** (canManualCheckIn dropped) | Field is dead, removed in Cycle 13b | §A.6 allowlists preserve migration code (removal logic), don't reintroduce active usage |
| **I-36** (ROOT-ERROR-BOUNDARY) | `app/_layout.tsx` MUST wrap Stack with ErrorBoundary | 17a doesn't touch `_layout.tsx` |

### NOT introduced (deferred)

- **I-37 (proposed)** — TopBar default cluster `[search, bell]` always visible; pages compose, never replace. Defer to **17b CLOSE** when the structural fix lands (`extraRightSlot` prop + CI grep gate).

---

## 6. Test cases

| Test | Scenario | Input / setup | Expected | Layer |
|---|---|---|---|---|
| T-A.1.1 | Operator opens events tab as account_owner | Logged-in account_owner with brand selected | TopBar shows [search, bell, +] (3 icons, gap=spacing.sm) | UI |
| T-A.1.2 | Operator opens events tab as scanner (rank=10) | Logged-in scanner role | TopBar shows [search, bell] (2 icons, no plus) | UI |
| T-A.1.3 | Operator with no brand taps + | currentBrand === null, canCreateEvent === false | + is hidden; even if it were, handleBuildEvent fires "Create a brand first" toast + opens BrandSwitcherSheet | UI |
| T-A.1.4 | Operator with brand taps + | currentBrand !== null, rank ≥ 40 | Navigates to `/event/create` | Navigation |
| T-A.1.5 | Operator taps search on events tab | Any state | No action, no error | UI |
| T-A.1.6 | Operator taps bell on events tab | Any state | No action, no error | UI |
| T-A.1.7 | Visual parity: home tab vs events tab right cluster | Side-by-side comparison | search + bell icons identical (size, color, gap, accessibility labels) | Visual |
| T-A.2.1 | Toast renders during action on events tab | Trigger any toast (e.g., "Draft deleted") | Toast appears ABOVE any open Sheet/Modal/ConfirmDialog | Visual |
| T-A.3.1 | mapBrandRowToUi(realRow) called | Pass a BrandRow object | Returns object satisfying Brand type (has kind, address, coverHue) | Type |
| T-A.3.2 | tsc --noEmit on brandMapping.ts | Run type check | No TS2741 errors on the function | Build |
| T-A.4.1 | Grep [TRANSITIONAL] in recurrenceRule.ts | Run grep | 0 hits | Static |
| T-A.4.2 | Grep J-A12 in BrandProfileView.tsx | Run grep | 0 hits | Static |
| T-A.5.1 | Operator email-OTP sign-in test | Sign in via TestFlight email | Email arrives ≤30s, body shows 6-digit code, no link, code verifies | E2E |
| T-A.6.1 | Future strict-grep gate run | When/if gate is created | Allowlist comments honored | CI (forward-compat) |
| T-B.1.1 | Sentry init log on dev-server start | Restart `npx expo start` | Sentry initialized log appears | Runtime |
| T-B.1.2 | Sentry receives test error | Throw deliberate error | Event appears in Sentry dashboard ≤30s | Runtime |
| T-B.2.1 | FOUNDER_FEEDBACK.md exists | File-system check | File present at `Mingla_Artifacts/FOUNDER_FEEDBACK.md` | Static |
| T-B.2.2 | FOUNDER_FEEDBACK.md contains 2026-05-04 entry | Read file | Verbatim entry present | Static |
| T-B.3.1 | DECISION_LOG.md contains DEC-099 row | Read file | Row present, matches §B.3 content | Static |
| T-B.4.1 | DEC-082 row contains closure note | Read file | "**Closed Cycle 17a:**" appended | Static |
| T-B.5.1 | Grep PAYMENT_METHOD_LABELS const | Run grep | Exactly 1 hit (in new util) | Static |
| T-B.5.2 | Door sale detail renders payment label | Open detail screen for cash sale | Label shown identical to pre-refactor | UI |
| T-B.6.1 | Currency renders on home tab | Open home tab | KPI shows GBP currency string identical to pre-refactor | UI |
| T-B.6.2 | Currency renders on __styleguide | Open dev styleguide route | Same currency display as pre-refactor | UI |
| T-B.7.1 | IMPL report contains D-IMPL-46 close note | Read IMPL report | §B.7 verbatim text present | Static |

---

## 7. Implementation order

Per dispatch §8 + sequential pace memory rule. Implementor proceeds top-to-bottom; each step verified before starting the next.

1. **Pre-flight** — Implementor reads investigation report + this SPEC + invokes `/ui-ux-pro-max` for §A.1 design tokens
2. **§B.5** — `PAYMENT_METHOD_LABELS` consolidation (3 files → 1 util + 3 imports). Verify visual unchanged.
3. **§B.6** — Currency formatter consolidation (2 files → 1 util + 2 imports). Verify visual unchanged.
4. **§A.3** — `brandMapping.ts` default fills (1 file, 3-line insert + comment). Run `tsc --noEmit` to verify.
5. **§A.2** — `events.tsx` duplicate `toastWrap` removal (delete 7 lines).
6. **§A.1** — `events.tsx` rightSlot composition (modify rightSlot prop + add 1 styles entry + add TRANSITIONAL marker comment).
7. **§A.4** — TRANSITIONAL marker updates (3 comment edits in 2 files).
8. **§A.6** — `canManualCheckIn` allowlist comments (5 inserts across 2 files).
9. **§B.2** — `FOUNDER_FEEDBACK.md` creation (new file).
10. **§B.3** — DEC-099 author (1 row append in DECISION_LOG.md).
11. **§B.4** — DEC-082 closure note (modify existing row).
12. **§B.7** — D-IMPL-46 close note in IMPL report.
13. **Final type-check** — `tsc --noEmit` across `mingla-business/`.
14. **Final static-grep verifications** — confirm SC-A.4.1, SC-A.4.2, SC-B.5.2 all hold.
15. **§A.5 + §B.1 — Operator-side dashboard work** — IMPL report flags these for operator action during deploy window.

---

## 8. Regression prevention

| Bug class | 17a action | 17b/future action |
|---|---|---|
| **Right-slot replacement** (Item A class) | TRANSITIONAL marker on the inline cluster anchors the regression to a known fix point | 17b: introduce `extraRightSlot` prop + I-37 invariant + CI grep gate (`grep -rn 'rightSlot=\\{[^|]*\\}' mingla-business/app/` flags single-icon replacement patterns) |
| **Duplicate object-literal keys** (Item B class) | Subtraction-only fix; no structural protection added in 17a | Verify `eslint` `no-dupe-keys` rule is enabled in next ESLint config review (out of 17a scope) |
| **Type-DB drift** (Item C class) | TRANSITIONAL marker anchors fix to B-cycle migration time | When B-cycle adds the 3 columns: simultaneously update BrandRow + mapper + delete the TRANSITIONAL marker. SPEC at that time MUST require a round-trip test (`mapUiToBrandInsert` → `mapBrandRowToUi` preserves all UI fields). |
| **Stale TRANSITIONAL markers** (Item D class) | Manual cleanup in 17a | Future Refinement Pass cycles should consider a CI check flagging markers older than X cycles |
| **Field-resurrection** (Item F class — preventive) | Allowlist comments in place ahead of any future strict-grep gate | If a strict-grep gate is created, allowlists are pre-positioned |

---

## 9. Discoveries for orchestrator

**SPEC-DISCOVERY-1 — No strict-grep CI gate exists.**
SPEC author verified via `Glob` on `.github/workflows/`: only `deploy-functions.yml` and `rotate-apple-jwt.yml` exist. The `canManualCheckIn` strict-grep gate referenced in D-CYCLE13B-IMPL-1 is **documentation-only / aspirational** — not currently active. §A.6 allowlist comments are **preventive** for a future gate, not curative for an active one. **Orchestrator may want to register this as a separate ORCH-ID for 17b/c consideration: "Implement strict-grep CI gate for I-34 enforcement."**

**SPEC-DISCOVERY-2 — `BrandRow` interface NOT updated in §A.3.**
SPEC explicitly leaves `BrandRow` (lines 26-46 of brandMapping.ts) unchanged, even though the Brand type expects 3 fields the DB doesn't have. The `mapUiToBrandInsert` function (line 209) and `mapUiToBrandUpdatePatch` (line 247) DO NOT yet handle the 3 new fields. **When B-cycle adds the columns, all three of these need simultaneous update + a round-trip test.** Recommend orchestrator pre-register a follow-up ORCH-ID for B-cycle: "B-cycle brand schema sync — add `kind`/`address`/`cover_hue` columns to brands table + update BrandRow + mapUiToBrandInsert + mapUiToBrandUpdatePatch + delete §A.3 TRANSITIONAL marker + add round-trip test."

**SPEC-DISCOVERY-3 — Currency formatter inline shape unverified.**
SPEC author did NOT read `home.tsx` or `__styleguide.tsx` to identify the EXACT inline currency expressions (out of forensics scope). Implementor MUST grep both files first to determine whether one or two formatter exports are needed, and whether the existing inline format is `£X` (no decimals) or `£X.YY` (precise). **§6 leaves this decision to implementor; if more than one formatter is needed, both go in `currency.ts`.**

**SPEC-DISCOVERY-4 — DEC-082 existence unverified.**
SPEC author did NOT confirm DEC-082 exists in DECISION_LOG.md (file too large for direct read). Implementor MUST verify before appending the closure note. If DEC-082 doesn't exist or has been superseded with different content, implementor flags as a discovery in IMPL report rather than fabricating.

**SPEC-DISCOVERY-5 — Item A's tactical fix introduces a new style entry that 17b will likely delete.**
The `topBarRightCluster` style block in §A.1 will become redundant when 17b refactors TopBar to expose `extraRightSlot`. SPEC notes this explicitly as expected churn — sequential mini-cycles trade some tactical-then-structural rework against shipping fixes immediately. **Orchestrator may want to log a 17b prep note: "remove 17a's `topBarRightCluster` style entry from events.tsx as part of TopBar refactor."**

**SPEC-DISCOVERY-6 — `IconChrome` import already present.**
SPEC author verified via direct read: events.tsx already imports `IconChrome` from `../../src/components/ui/IconChrome` at line 32 (used elsewhere in the file). **§A.1 does NOT need a new import.** No risk of import drift.

---

## 10. Cross-references

- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_17A_QUICK_WINS.md`
- **SPEC dispatch:** `Mingla_Artifacts/prompts/SPEC_BIZ_CYCLE_17A_QUICK_WINS.md`
- **Master inventory:** `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_17_REFINEMENT_PASS.md`
- **Apple JWT belt+suspenders:** `SPEC_APPLE_JWT_AUTOROTATE.md` + `INVESTIGATION_APPLE_JWT_AUTOROTATE.md` + scheduled remote agent (one-shot 2026-10-12) + `.github/workflows/rotate-apple-jwt.yml`
- **Operator-locked decisions:** D-17-1 (decomposition), D-17-2 (FOUNDER_FEEDBACK.md), D-17-3 (Cycle 12 tsc fixes in 17a), D-17-8 (Sentry env), D-17-9 (DEC-099), D-17-10 (Apple JWT close), D-17-11 (missing + tactical), D-17-12 (constant top-bar → 17b), D-17-13 (Account move declined)
- **Memory rules pre-loaded:**
  - `feedback_implementor_uses_ui_ux_pro_max` — mandatory at §A.1
  - `feedback_keyboard_never_blocks_input` — preserved (no input changes)
  - `feedback_rn_color_formats` — no oklch in any new code
  - `feedback_toast_needs_absolute_wrap` — preserved by §A.2 (first declaration kept with wrap)
  - `feedback_no_summary_paragraph` — IMPL report drops trailing prose
  - `feedback_orchestrator_never_executes` — implementor dispatches go through orchestrator
  - `feedback_sequential_one_step_at_a_time` — implementation order honors sequential pace

---

**END OF SPEC.** Implementor proceeds against this contract.
