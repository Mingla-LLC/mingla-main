# Spec — ORCH-BIZ-CYCLE-5-TICKET-TYPES

**ORCH-ID:** ORCH-BIZ-CYCLE-5-TICKET-TYPES
**Cycle:** 5 — refine the wedge (Step 5 ticket sheet expansion)
**Pairs with:** [`reports/INVESTIGATION_ORCH-BIZ-CYCLE-5-TICKET-TYPES.md`](../reports/INVESTIGATION_ORCH-BIZ-CYCLE-5-TICKET-TYPES.md)
**Mode:** Frontend-only (DEC-071). No backend, no real Stripe gating, no real waitlist emails.
**Pace:** Sequential. Implementor confirms scope before writing the first line.

---

## 1. Layman summary

Step 5 of the wizard expands the existing ticket sheet to support 7 ticket-type modifiers as **layered toggles** (NOT a segmented type picker — see Q-1):

- Existing: name + free + unlimited + price + capacity (Cycle 3)
- NEW: visibility (public/hidden/disabled) + approval-required + password-protected + waitlist-enabled + min/max purchase qty + allow-transfers

Plus per-ticket reorder via **up/down arrow buttons** (web-safe, accessible, no new deps), display badges in Step 7 mini card and PreviewEventView, and validation extensions.

Schema migrates v3→v4 additively. Cycle 3 single-mode tickets continue to work unchanged.

---

## 2. Scope (locked) and non-goals

### In scope

| Area | Deliverable |
|------|-------------|
| **Persistence** | TicketStub schema v3→v4 (9 new fields). DraftEvent schema bumps from 3 → 4. |
| **Validation** | Extended `validateTickets` with 5 new rules + error keys |
| **Helper** | New `mingla-business/src/utils/ticketDisplay.ts` consolidating `formatTicketSubline` + `formatTicketBadges` (Constitution #2 lift) |
| **TicketStubSheet (sheet body)** | New visibility row + 4 new toggles + 2 new number inputs + password input (conditional) |
| **TicketCard (list row)** | Left-edge reorder column (up/down arrows) + extended cardSub via helper + extended badges row |
| **CreatorStep7Preview mini card** | Modifier badges row below price line |
| **PreviewEventView PublicTicketRow** | "Request access" / "Enter password" buyer copy + waitlist suffix + visibility variants |
| **Reorder logic** | `displayOrder` field + sort by it + up/down arrows mutate it + auto-renormalize |
| **TicketCard layout** | Two-column actions: left = reorder arrows, right = duplicate/edit/delete |

### Out of scope (deferred to Cycle 5b)

- ❌ PRD §4.1 deferred fields: ticket description, sale period (sale_start_at, sale_end_at), validity period (validity_start_at, validity_end_at), online/in-person availability toggle, info tooltips, collapsible sections
- ❌ PRD §4.2 deferred types: Early Bird, VIP, Group, Donation, Pay-What-You-Want, Add-on, Other
- ❌ Real Stripe gating (still UI signal only — B2 wires live)
- ❌ Real waitlist email invites (B5)
- ❌ Real approval notifications (B5 + push)
- ❌ Drag-and-drop reorder (Q-3 → arrow buttons; D&D = Cycle 17 polish if user pressure)
- ❌ Backend (DEC-071)
- ❌ Per-date tickets (Cycle 4 lock)
- ❌ Type segmented preset selector (Q-1 deviation; founder may opt in later as a +2hr addition)
- ❌ New external libs (no draggable-flatlist, no rrule, etc.)
- ❌ New design tokens or kit primitives

### Assumptions

- Cycle 4 baseline at commit `7d3d61ba` is the working tree
- DEC-079/084/085 + I-11/I-12/I-13/I-14 still hold
- `Pill` primitive has at least one variant suitable for inline modifier badges (verify or fall back to inline View + Text)
- `Icon` primitive has icons for: chevron-up, chevron-down, lock (or shield) — verify; if missing, use `chevU`/`chevD` (already exist) and lock falls back to text-only "Password"

---

## 3. Layer-by-layer specification

### 3.1 Persistence layer — `mingla-business/src/store/draftEventStore.ts`

#### 3.1.1 New types

```ts
export type TicketVisibility = "public" | "hidden" | "disabled";

export interface TicketStub {
  // EXISTING (v3) — unchanged
  id: string;
  name: string;
  priceGbp: number | null;
  capacity: number | null;
  isFree: boolean;
  isUnlimited: boolean;
  // NEW (v4)
  visibility: TicketVisibility;
  /** Sort order within an event. Auto-managed by reorder UI; integers, no duplicates. */
  displayOrder: number;
  /** When true, buyer must request access; organiser approves/rejects (Cycle 10/B4). */
  approvalRequired: boolean;
  /** When true, buyer must enter `password` on the public page to unlock checkout. */
  passwordProtected: boolean;
  /** Local-only in Cycle 5; backend hashes at B4. Required when passwordProtected; min 4 chars. */
  password: string | null;
  /** When true, buyer can join a waitlist when capacity is reached (Cycle 10 + B5). */
  waitlistEnabled: boolean;
  /** Minimum tickets per buyer transaction. Default 1. */
  minPurchaseQty: number;
  /** Maximum tickets per buyer transaction. null = no cap. */
  maxPurchaseQty: number | null;
  /** When true, buyer can transfer ticket to another email/identity. Default true. */
  allowTransfers: boolean;
}
```

#### 3.1.2 Migration v3 → v4

```ts
type V3TicketStub = Omit<
  TicketStub,
  | "visibility"
  | "displayOrder"
  | "approvalRequired"
  | "passwordProtected"
  | "password"
  | "waitlistEnabled"
  | "minPurchaseQty"
  | "maxPurchaseQty"
  | "allowTransfers"
>;
type V3DraftEvent = Omit<DraftEvent, "tickets"> & { tickets: V3TicketStub[] };

const upgradeV3TicketToV4 = (t: V3TicketStub, idx: number): TicketStub => ({
  ...t,
  visibility: "public",
  displayOrder: idx,
  approvalRequired: false,
  passwordProtected: false,
  password: null,
  waitlistEnabled: false,
  minPurchaseQty: 1,
  maxPurchaseQty: null,
  allowTransfers: true,
});

const upgradeV3DraftToV4 = (d: V3DraftEvent): DraftEvent => ({
  ...d,
  tickets: d.tickets.map(upgradeV3TicketToV4),
});

// In persistOptions:
//   version: 4 (was 3)
//   migrate: extends with case for version === 3 → upgrade tickets
```

**DEFAULT_DRAFT_FIELDS:** unchanged (DraftEvent's tickets array stays empty by default).

#### 3.1.3 No new selectors

`useDraftsForBrand`, `useDraftById` work unchanged.

---

### 3.2 Validation layer — `mingla-business/src/utils/draftEventValidation.ts`

#### 3.2.1 Extended `validateTickets`

```ts
const validateTickets = (d: DraftEvent): ValidationError[] => {
  const errs: ValidationError[] = [];
  if (d.tickets.length === 0) {
    errs.push({ fieldKey: "tickets.empty", step: 4, message: "Add at least one ticket type." });
    return errs;
  }
  d.tickets.forEach((t, i) => {
    // Existing rules (unchanged)
    if (t.name.trim().length === 0) errs.push({ fieldKey: `tickets[${i}].name`, step: 4, message: `Ticket ${i + 1} needs a name.` });
    if (!t.isFree && (t.priceGbp === null || t.priceGbp <= 0))
      errs.push({ fieldKey: `tickets[${i}].price`, step: 4, message: `Set a price for ${t.name || `ticket ${i + 1}`}, or mark it free.` });
    if (!t.isUnlimited && (t.capacity === null || t.capacity <= 0))
      errs.push({ fieldKey: `tickets[${i}].capacity`, step: 4, message: `Set a capacity for ${t.name || `ticket ${i + 1}`}, or mark it unlimited.` });

    // NEW Cycle 5 rules
    if (t.passwordProtected && (t.password === null || t.password.length < 4))
      errs.push({ fieldKey: `tickets[${i}].password`, step: 4, message: "Password must be at least 4 characters." });
    if (t.waitlistEnabled && t.isUnlimited)
      errs.push({ fieldKey: `tickets[${i}].waitlistConflict`, step: 4, message: "Unlimited tickets don't need a waitlist — turn one off." });
    if (t.minPurchaseQty < 1)
      errs.push({ fieldKey: `tickets[${i}].minPurchaseQty`, step: 4, message: "Minimum purchase must be at least 1." });
    if (t.maxPurchaseQty !== null && t.maxPurchaseQty < t.minPurchaseQty)
      errs.push({ fieldKey: `tickets[${i}].maxPurchaseQty`, step: 4, message: "Maximum can't be less than minimum." });
  });
  return errs;
};
```

`validatePublish` and `computePublishability` unchanged — they delegate to `validateTickets` which now covers the new rules.

---

### 3.3 Display helper — NEW `mingla-business/src/utils/ticketDisplay.ts`

Consolidates ticket-display logic. Establishes invariant **I-15 (ticket-display single source)**.

```ts
/**
 * Centralised ticket display helpers (I-15 — single source).
 *
 * NEVER implement local ticket-modifier formatters in components.
 * Reuse the helpers below or extend this file.
 *
 * Per Cycle 5 spec §3.3.
 */

import type { TicketStub } from "../store/draftEventStore";
import { formatGbpRound, formatCount } from "./currency";

export interface TicketBadge {
  label: string;
  variant: "info" | "warning" | "muted";
}

/** "Free · max 4 / buyer" or "£25 · approval required" — sub-line under ticket name. */
export const formatTicketSubline = (t: TicketStub): string => {
  const parts: string[] = [];

  // Price
  parts.push(t.isFree ? "Free" : t.priceGbp !== null ? formatGbpRound(t.priceGbp) : "—");

  // Purchase qty (only if non-default)
  if (t.maxPurchaseQty !== null && t.maxPurchaseQty < 10) {
    parts.push(`max ${t.maxPurchaseQty} / buyer`);
  }

  // Modifiers
  if (t.approvalRequired) parts.push("approval");
  if (t.passwordProtected) parts.push("password");
  if (t.waitlistEnabled) parts.push("waitlist");
  if (!t.allowTransfers) parts.push("non-transferable");

  return parts.join(" · ");
};

/** Capacity display for ticket card stats row. */
export const formatTicketCapacity = (t: TicketStub): string => {
  if (t.isUnlimited) return "Unlimited";
  if (t.capacity !== null) return formatCount(t.capacity);
  return "—";
};

/** Returns badges to display next to a ticket card. */
export const formatTicketBadges = (t: TicketStub): TicketBadge[] => {
  const badges: TicketBadge[] = [];
  if (t.visibility === "hidden") badges.push({ label: "Hidden", variant: "muted" });
  if (t.visibility === "disabled") badges.push({ label: "Sales paused", variant: "warning" });
  if (t.approvalRequired) badges.push({ label: "Approval required", variant: "info" });
  if (t.passwordProtected) badges.push({ label: "Password required", variant: "info" });
  if (t.waitlistEnabled) badges.push({ label: "+ Waitlist", variant: "info" });
  return badges;
};

/** Buyer-side button copy (PreviewEventView). */
export const formatTicketButtonLabel = (t: TicketStub): string => {
  if (t.visibility === "disabled") return "Sales paused";
  if (t.approvalRequired) return "Request access";
  if (t.passwordProtected) return "Enter password to unlock";
  if (t.waitlistEnabled && /* future: capacity reached */ false) return "Join waitlist";
  if (t.isFree) return "Get free ticket";
  return "Buy ticket";
};

/** Helper: sort tickets by displayOrder ascending; ties broken by id. */
export const sortTicketsByDisplayOrder = (tickets: TicketStub[]): TicketStub[] => {
  return [...tickets].sort((a, b) => {
    if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
    return a.id.localeCompare(b.id);
  });
};

/** Renormalize displayOrder values to 0..N-1 after a reorder operation. */
export const renormalizeDisplayOrder = (tickets: TicketStub[]): TicketStub[] => {
  const sorted = sortTicketsByDisplayOrder(tickets);
  return sorted.map((t, i) => ({ ...t, displayOrder: i }));
};

/** Move a ticket up by 1 position. Returns new array (renormalized). */
export const moveTicketUp = (tickets: TicketStub[], ticketId: string): TicketStub[] => {
  const sorted = sortTicketsByDisplayOrder(tickets);
  const idx = sorted.findIndex((t) => t.id === ticketId);
  if (idx <= 0) return tickets; // already at top, no-op
  const swapped = [...sorted];
  [swapped[idx - 1], swapped[idx]] = [swapped[idx], swapped[idx - 1]];
  return renormalizeDisplayOrder(swapped);
};

/** Move a ticket down by 1 position. Returns new array (renormalized). */
export const moveTicketDown = (tickets: TicketStub[], ticketId: string): TicketStub[] => {
  const sorted = sortTicketsByDisplayOrder(tickets);
  const idx = sorted.findIndex((t) => t.id === ticketId);
  if (idx === -1 || idx >= sorted.length - 1) return tickets; // already at bottom or missing
  const swapped = [...sorted];
  [swapped[idx], swapped[idx + 1]] = [swapped[idx + 1], swapped[idx]];
  return renormalizeDisplayOrder(swapped);
};
```

---

### 3.4 TicketStubSheet expansion — `CreatorStep5Tickets.tsx`

The existing `TicketStubSheet` component (lines 156–414) extends with new rows. Order:

```
[ Sheet body — keyboardShouldPersistTaps + ScrollView wrapper ]

  Title: "Add ticket type" / "Edit ticket"

  Field: Name  [TextInput]
  
  Toggle: Free ticket  (existing — unchanged)
  Field: Price (£)  [TextInput, conditional !isFree]  (existing — unchanged)
  
  Toggle: Unlimited capacity  (existing — unchanged)
  Field: Capacity  [TextInput, conditional !isUnlimited]  (existing — unchanged)

  ─── New section: Visibility ───
  Field: Visibility  [Pressable → opens VisibilitySheet with 3 options]
    Display: "Public" / "Hidden — direct link only" / "Disabled — sales paused"

  ─── New section: Access controls ───
  Toggle: Approval required
    Sub: "Buyers will request access. You approve or reject before they pay."
  
  Toggle: Password protected
    Sub: "Only buyers with the password can purchase."
  Field: Password  [TextInput, secure, conditional passwordProtected]
    Helper: "Min 4 characters" or error "Password must be at least 4 characters."

  Toggle: Enable waitlist
    Sub: "When this ticket sells out, buyers can join a waitlist."
    Conflict warning: when isUnlimited + waitlistEnabled both true → red helper

  ─── New section: Purchase quantity ───
  Field: Min per buyer  [TextInput, number-pad, default 1]
  Field: Max per buyer  [TextInput, number-pad, optional, helper "Leave blank for no cap"]

  ─── New section: Transfer ───
  Toggle: Allow transfers  (default ON)
    Sub: "Buyers can transfer this ticket to someone else."

  [ Sheet action dock — sticky to bottom of body, NOT inside ScrollView ]
    [ Cancel ghost ] [ Save / Save changes primary ]
```

**Visibility sub-sheet:** opens via Pressable from main sheet. 3 rows, single-select, closes on tap. Same pattern as Cycle 4's RecurrencePresetSheet.

**Keyboard awareness (memory rule):** every TextInput's `onFocus` calls `requestScrollToEnd` (matches Cycle 4 MultiDateOverrideSheet pattern). Sheet snap = "full" when keyboard up.

**Field collapsing:** PRD §4.1 mentions "collapsible ticket option sections" — DEFERRED to Cycle 5b. For Cycle 5, sections are stacked vertically with section headers; user scrolls.

#### 3.4.1 Save handler shape

```ts
const handleSave = useCallback((): void => {
  const ticket: TicketStub = {
    id: initial?.id ?? generateTicketId(),
    name: name.trim(),
    isFree,
    isUnlimited,
    priceGbp: isFree ? null : Number.isFinite(parsedPrice) ? parsedPrice : null,
    capacity: isUnlimited ? null : Number.isFinite(parsedCapacity) ? parsedCapacity : null,
    // NEW Cycle 5 fields
    visibility,
    displayOrder: initial?.displayOrder ?? draft.tickets.length, // appended at end
    approvalRequired,
    passwordProtected,
    password: passwordProtected ? password : null,
    waitlistEnabled,
    minPurchaseQty: parsedMinQty || 1,
    maxPurchaseQty: parsedMaxQty,
    allowTransfers,
  };
  onSave(ticket);
}, [...]);
```

---

### 3.5 TicketCard layout extension — `CreatorStep5Tickets.tsx`

```
┌───────────────────────────────────────────────────────────┐
│  ┌──┐                                              ┌─┐┌─┐┌─┐
│  │↑ │  Ticket name                                 │+││✏││🗑│
│  └──┘  Free · max 4 / buyer · approval             └─┘└─┘└─┘
│  ┌──┐  ┌────────────┐ ┌────────────┐
│  │↓ │  │ Price  £25 │ │ Capacity 200│
│  └──┘  └────────────┘ └────────────┘
│        [ Approval required ] [ + Waitlist ]
└───────────────────────────────────────────────────────────┘
```

**Reorder column (left edge):**
- Up arrow: disabled when `displayOrder === 0`
- Down arrow: disabled when ticket is last in sorted list
- Each tap fires `onMoveUp` / `onMoveDown` callback that calls `moveTicketUp` / `moveTicketDown` from `ticketDisplay.ts`
- 28×28 buttons stacked vertically; gap = `spacing.xs`

**Action column (right edge):** unchanged — duplicate, edit, delete in horizontal row.

**Card body:** name + sub-line (via `formatTicketSubline`) + stats row. Below stats: badge row (via `formatTicketBadges`) IF non-empty.

**Helper consolidation:** the existing hardcoded `cardSub` ("Free · 1 per buyer" / "Paid · 1 per buyer") — DELETE and replace with `formatTicketSubline(ticket)` call (Constitution #8 — subtract before adding).

---

### 3.6 CreatorStep7Preview mini card — modifier badges

Below the existing `miniVenue` line (which has `{venue} · {priceLine}`), append a row of badges from `formatTicketBadges(ticket)` if non-empty. Render via `Pill` primitive variant `info` (or fallback inline View+Text).

For the Step 7 mini-card *event-level* preview (not ticket-level), the badges aggregate across tickets:
- If ANY ticket has `approvalRequired` → "Some tickets require approval"
- If ANY ticket has `passwordProtected` → "Some tickets are password-protected"
- If ANY ticket has `waitlistEnabled` → "Waitlist available"

These appear as small inline pills below the price line. Spec the visual as "max 1 line — wrap to next if multiple."

---

### 3.7 PreviewEventView — `PublicTicketRow` variants

```
For each ticket in sortedTickets (by displayOrder):
  if visibility === 'hidden': render with "Hidden — direct link only" badge (preview-only; real public page skips)
  if visibility === 'disabled': render greyed + "Sales paused" pill + button disabled

  Always render:
    name
    price + sub-line (formatTicketSubline)
    badges row (formatTicketBadges)
    button (formatTicketButtonLabel) — varies: "Buy ticket" / "Request access" / "Enter password to unlock" / "Join waitlist" / "Sales paused"
```

Cycle 5 only changes the rendering — no buyer flow logic (that's Cycle 8 checkout).

---

### 3.8 Validation surfacing in TicketStubSheet

Inline error rendering for new fields:

| Field key | Inline render |
|-----------|--------------|
| `tickets[i].password` | red border on password input + helper text below |
| `tickets[i].waitlistConflict` | red helper text below the unlimited toggle (since the conflict involves both) |
| `tickets[i].minPurchaseQty` | red border on min input + helper |
| `tickets[i].maxPurchaseQty` | red border on max input + helper |

Errors appear in the J-E12 publish errors sheet too (existing flow — `PublishErrorsSheet` is field-key-driven, no code change needed).

---

## 4. Success criteria (numbered, observable, testable)

1. **AC-1** TicketStubSheet renders new sections in order: Visibility / Access controls / Purchase quantity / Transfer
2. **AC-2** Visibility row opens a sub-sheet with 3 options (Public / Hidden / Disabled); selection updates draft
3. **AC-3** Approval-required toggle persists; sub-copy "Buyers will request access..." renders
4. **AC-4** Password-protected toggle reveals/hides the password input; password input is `secureTextEntry` style
5. **AC-5** Waitlist toggle persists; conflict with isUnlimited surfaces inline error
6. **AC-6** Min purchase qty defaults to 1; max purchase qty default null (input shows empty + placeholder "no cap")
7. **AC-7** Allow transfers defaults ON (true)
8. **AC-8** All new fields persist via TicketStub schema v4
9. **AC-9** Saving a ticket appends to `draft.tickets` with `displayOrder = previousLength`
10. **AC-10** Up arrow on TicketCard moves ticket up by 1 in displayOrder; disabled at top
11. **AC-11** Down arrow on TicketCard moves ticket down by 1; disabled at bottom
12. **AC-12** TicketCard sub-line uses `formatTicketSubline` (no hardcoded "1 per buyer")
13. **AC-13** TicketCard badges row renders `formatTicketBadges` output; empty array = no row
14. **AC-14** Step 7 mini card shows event-level aggregated badges (e.g., "Some tickets require approval")
15. **AC-15** PreviewEventView renders ticket rows in displayOrder
16. **AC-16** PreviewEventView "Hidden" tickets show in preview with badge (real public page would skip)
17. **AC-17** PreviewEventView "Disabled" tickets render greyed + button disabled + "Sales paused" pill
18. **AC-18** PreviewEventView button label varies per modifier: "Buy ticket" / "Request access" / "Enter password to unlock" / "Get free ticket" / "Sales paused"
19. **AC-19** Validation: password protected without password (or < 4 chars) blocks publish
20. **AC-20** Validation: waitlist + unlimited blocks publish with helpful copy
21. **AC-21** Validation: minPurchaseQty < 1 blocks publish
22. **AC-22** Validation: maxPurchaseQty < minPurchaseQty blocks publish
23. **AC-23** Schema v3 → v4 migration: existing tickets get sensible defaults (visibility="public", displayOrder=index, others false/null/1/null/true)
24. **AC-24** Cycle 4 multi-date drafts continue to load + edit unchanged
25. **AC-25** Cycle 3 single-mode drafts continue to load + edit unchanged
26. **AC-26** No new external libs added (verify package.json delta = 0)
27. **AC-27** TypeScript strict compiles clean
28. **AC-28** Hardcoded `cardSub = "Free · 1 per buyer" / "Paid · 1 per buyer"` is removed (grep verifies 0 hits)
29. **AC-29** Reorder operations preserve all other ticket fields (id, name, modifiers — only displayOrder changes)
30. **AC-30** Logout via `clearAllStores` wipes drafts including new ticket fields
31. **AC-31** Keyboard never blocks any new TextInput in the sheet (per memory rule)
32. **AC-32** `/ui-ux-pro-max` consulted on TicketStubSheet expansion + TicketCard 5-button layout + reorder arrows

---

## 5. Test matrix

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Existing v3 ticket loads | Cycle 4 build → v4 build with v3 ticket in storage | Loads with visibility=public, displayOrder=0, all new modifiers default | Migration |
| T-02 | Visibility public default | Add new ticket | visibility = "public" | Component + Store |
| T-03 | Visibility change to hidden | Open ticket → tap visibility row → tap Hidden | TicketCard shows "Hidden" badge | Component |
| T-04 | Visibility change to disabled | Same flow | TicketCard shows "Sales paused" badge; greyed style | Component |
| T-05 | Approval toggle on | Edit ticket → toggle Approval ON → save | TicketCard cardSub includes "approval"; badge "Approval required" appears | Component + Helper |
| T-06 | Password toggle on without password | Toggle Password ON → leave field blank → tap Save | Inline error "Password must be at least 4 characters." | Component + Validator |
| T-07 | Password toggle on with valid password | Toggle Password ON + type "test1234" → save | Saves; ticket has passwordProtected=true, password="test1234" | Component + Store |
| T-08 | Password input is secure | Visually inspect password input | Renders as dots (secureTextEntry) | Component |
| T-09 | Waitlist + unlimited conflict | Toggle Waitlist ON + Unlimited ON | Inline error "Unlimited tickets don't need a waitlist" | Component + Validator |
| T-10 | Max qty < min qty | Min=3 + Max=2 | Inline error "Maximum can't be less than minimum." | Component + Validator |
| T-11 | Max qty empty | Min=1 + Max blank | Saves with maxPurchaseQty=null; helper "no cap" shown | Component |
| T-12 | Allow transfers default | Add new ticket | allowTransfers=true; toggle ON in sheet | Component + Store |
| T-13 | Reorder up arrow | Tickets [A, B, C], tap up arrow on B | Order becomes [B, A, C]; displayOrders renumbered 0,1,2 | Component + Helper |
| T-14 | Reorder down arrow | Tickets [A, B, C], tap down arrow on B | Order becomes [A, C, B]; displayOrders 0,1,2 | Component + Helper |
| T-15 | Up arrow disabled at top | Tickets [A, B], inspect A's up arrow | Disabled (greyed, no onPress) | Component |
| T-16 | Down arrow disabled at bottom | Tickets [A, B], inspect B's down arrow | Disabled | Component |
| T-17 | Reorder preserves other fields | Reorder twice | name/price/modifiers all preserved; only displayOrder changes | Helper |
| T-18 | Step 7 mini-card aggregated badges | Event has 1 approval ticket + 1 password ticket | Shows "Some tickets require approval" + "Some tickets are password-protected" | Component |
| T-19 | PreviewEventView ticket rows sorted | 3 tickets with displayOrder 2,0,1 | Renders in order corresponding to displayOrder 0,1,2 | Component + Helper |
| T-20 | PreviewEventView Hidden ticket | visibility=hidden | Shows in preview with "Hidden — direct link only" badge | Component |
| T-21 | PreviewEventView Disabled ticket | visibility=disabled | Greyed + "Sales paused" pill + button disabled | Component |
| T-22 | PreviewEventView button label variants | Multiple modifier combos | Each renders correct button copy per `formatTicketButtonLabel` | Component + Helper |
| T-23 | TS strict compile | `tsc --noEmit` | Exit 0, no errors | Build |
| T-24 | No new external libs | git diff package.json | 0 lines added | Build |
| T-25 | Hardcoded cardSub removed | grep "1 per buyer" mingla-business/src | 0 hits | Code review |
| T-26 | Cycle 3 single-mode resume | Open existing single-mode draft from Cycle 3 | Wizard works identically; tickets section uses new helper but identical default behavior | Regression |
| T-27 | Cycle 4 multi-date resume | Open existing multi-date draft from Cycle 4 | Wizard works identically | Regression |
| T-28 | Logout clears | Create draft with full Cycle-5 ticket → logout | drafts=[] after auth wipe | Constitution #6 |
| T-29 | Keyboard awareness — password input | Focus password input | Field stays above keyboard (scrollToEnd fires) | Component |
| T-30 | Keyboard awareness — min/max qty inputs | Focus each input | Each stays above keyboard | Component |

---

## 6. Invariants

### Preserved

| ID | Description | Verification |
|----|-------------|--------------|
| I-11 Format-agnostic ID | TicketStub.id remains opaque string | T-01, T-26, T-27 |
| I-12 Host-bg cascade | Sheet inherits canvas | Visual check |
| I-13 Overlay-portal | TicketStubSheet + VisibilitySheet use Sheet primitive | Code review |
| I-14 Date-display single source | Cycle 5 doesn't touch date display | Grep `formatDate*` in Cycle 5 files: 0 hits |
| Constitution #1 No dead taps | Every new toggle/arrow/row has onPress + a11y label | T-13/T-14/T-15/T-16/T-22 |
| Constitution #2 One owner per truth | `formatTicketSubline` consolidates display | T-25 |
| Constitution #6 Logout clears | unchanged | T-28 |
| Constitution #7 TRANSITIONAL labels | Cycle 5b deferred items labelled | Code review |
| Constitution #8 Subtract before adding | Hardcoded cardSub removed before helper adopted | T-25 |
| Constitution #10 Currency-aware | Reuse formatGbp* | Existing pattern |

### NEW invariant established

| ID | Description | Why |
|----|-------------|-----|
| **I-15 (proposed)** | **Ticket-display single source** — All ticket modifier display flows through `mingla-business/src/utils/ticketDisplay.ts`. No component implements its own modifier formatter. | Mirrors I-14 (date-display). Prevents the same Hidden-2 pattern from recurring. Add to INVARIANT_REGISTRY post-Cycle-5 close. |

---

## 7. Implementation order (numbered, sequential)

1. **Schema v4 + migrator** (`draftEventStore.ts`)
   - Add `TicketVisibility` type
   - Extend TicketStub with 9 new fields
   - V3DraftEvent / V3TicketStub migration types
   - `upgradeV3TicketToV4`, `upgradeV3DraftToV4`
   - Bump persistOptions version 3 → 4
   - Update v1→v2→v3→v4 migrate chain
   - **Verify:** `tsc --noEmit` passes; existing Cycle 4 tests still pass

2. **Display helper** (`ticketDisplay.ts` NEW)
   - `formatTicketSubline`, `formatTicketCapacity`, `formatTicketBadges`, `formatTicketButtonLabel`, `sortTicketsByDisplayOrder`, `renormalizeDisplayOrder`, `moveTicketUp`, `moveTicketDown`
   - Protective comment block at file head per I-15

3. **Validation extension** (`draftEventValidation.ts`)
   - 4 new rules per Cycle 5 spec
   - **Verify:** existing T-CYCLE-3-* and T-CYCLE-4-* tests still pass

4. **TicketStubSheet body expansion** (`CreatorStep5Tickets.tsx`)
   - Wrap content in ScrollView (per memory keyboard rule)
   - Add visibility row + sub-sheet
   - Add 3 new toggles (approval / password / waitlist)
   - Add password input (conditional)
   - Add min/max qty inputs
   - Add allow-transfers toggle
   - Wire validation error rendering inline

5. **TicketCard layout — reorder column + helper consumption** (same file)
   - Add left-edge column with up/down arrows
   - Replace hardcoded cardSub with `formatTicketSubline(ticket)` call
   - Add badges row using `formatTicketBadges`
   - Disable arrows at boundaries

6. **Reorder handlers** (same file)
   - `handleMoveUp(id)` → `updateDraft({ tickets: moveTicketUp(draft.tickets, id) })`
   - `handleMoveDown(id)` → `updateDraft({ tickets: moveTicketDown(draft.tickets, id) })`
   - **Verify:** T-13/T-14 pass

7. **Step 7 mini card aggregated badges** (`CreatorStep7Preview.tsx`)
   - Compute event-level badges (any approval / any password / any waitlist across draft.tickets)
   - Render below price line

8. **PreviewEventView ticket variants** (`PreviewEventView.tsx`)
   - Sort tickets by displayOrder
   - Render hidden/disabled variants per spec §3.7
   - Use `formatTicketSubline` + `formatTicketBadges` + `formatTicketButtonLabel`

9. **Final scan**
   - grep `1 per buyer` in mingla-business/src → 0 hits
   - grep `formatTicketSubline\|formatTicketBadges` outside ticketDisplay.ts → only call sites
   - `tsc --noEmit` exit 0
   - `package.json` git diff → 0 lines added
   - **`/ui-ux-pro-max`** consultation on TicketStubSheet expansion + TicketCard layout + reorder arrows

10. **Implementation report**
    - Write `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_5_TICKET_TYPES.md`
    - 32 ACs mapped + 30 tests mapped + invariants verified + discoveries

---

## 8. Regression prevention

### Cycle 4 invariants preserved
- I-13 portal contract → all sheets in Cycle 5 use Sheet primitive
- I-14 date-display → Cycle 5 doesn't touch date display surfaces

### NEW invariant I-15 (post-cycle-close)
**Ticket-display single source** — all ticket modifier display flows through `ticketDisplay.ts`. Future authors must reuse helpers, not implement local formatters. Protective comment in file head:

```ts
/**
 * Centralised ticket display helpers (I-15 — single source).
 * NEVER implement local ticket-modifier formatters in components.
 * Reuse the helpers below or extend this file with new ones.
 */
```

### Failure-pattern guard
**Most likely regression:** displayOrder gets corrupted by edits/duplications/saves that bypass `renormalizeDisplayOrder`. Mitigation: every TicketStub mutation in CreatorStep5Tickets.tsx must use the `move*` / `renormalize*` helpers; no inline mutation of displayOrder allowed. Add comment guardrail at the helper file head + at the top of each handler (e.g., `handleAdd`, `handleDuplicate`, `handleDelete`).

---

## 9. Open Questions — orchestrator must confirm before implementor dispatch

| Q | Question | Spec assumption |
|---|----------|-----------------|
| Q-1 | Type picker UX shape — segmented control OR pure modifier toggles? | **Pure modifier toggles** (deviates from user-stories' wording — see investigation HIDDEN-1) |
| Q-2 | Single enum vs layered modifiers? | **Layered booleans** (matches Cycle 3) |
| Q-3 | Reorder mechanism? | **Up/down arrow buttons** (web-safe, no new deps) |
| Q-4 | Schema v3→v4 shape with camelCase? | **Confirmed — camelCase 9 new fields** |
| Q-5 | Preview badges position? | **Inline pills below price line, wrap to next line if multiple** |
| Q-6 | Validation rules + error keys? | **Confirmed — 5 new rules per spec §3.2.1** |

**Q-1 is the user-facing decision** — the 7 user stories say "type segmented control"; investigation says modifier toggles are cleaner. Founder confirmation needed.

---

## 10. Discoveries for orchestrator

(Repeated from investigation §8 for spec self-containment)

- **D-FOR-CYCLE5-1** (Medium UX): User stories' "type segmented control" wording deviates from spec recommendation. Orchestrator confirms with founder; if founder agrees, update us-01..us-07 to reflect modifier-toggle approach.
- **D-FOR-CYCLE5-2** (Low): I-15 (ticket-display single source) candidate. Promote on cycle close.
- **D-FOR-CYCLE5-3** (Low): PRD §4.1 deferred fields → Cycle 5b epic in GitHub Project. Track in PRIORITY_BOARD.
- **D-FOR-CYCLE5-4** (Low): PRD §4.2 deferred types (Early Bird, VIP, Group, Donation, PWYW, Add-on, Other) → Cycle 5b. Each maps to existing modifiers + a small additional flag.
- **D-FOR-CYCLE5-5** (Low): TicketCard 5-button density → left-edge reorder column, right-edge actions column. `/ui-ux-pro-max` mandatory.
- **D-FOR-CYCLE5-6** (Note): `formatTicketSubline` pattern recommended for Cycle 9 surfaces showing live sale state.

---

## 11. End conditions

A passing Cycle 5 implementation:
- ✅ All 32 ACs verified (manually or via TypeScript)
- ✅ All 30 Ts pass (manual smoke or unit-equivalent)
- ✅ Zero new TypeScript errors
- ✅ Zero new external libs
- ✅ Hardcoded `cardSub` removed
- ✅ Cycle 3 + Cycle 4 single/recurring/multi-date drafts all resume cleanly
- ✅ `/ui-ux-pro-max` consulted on TicketStubSheet + TicketCard layout
- ✅ Implementation report written
- ✅ Discoveries logged

---

**End of spec.**
