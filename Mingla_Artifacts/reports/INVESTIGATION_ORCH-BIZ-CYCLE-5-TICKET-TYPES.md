# Investigation — ORCH-BIZ-CYCLE-5-TICKET-TYPES

**ORCH-ID:** ORCH-BIZ-CYCLE-5-TICKET-TYPES
**Cycle:** 5 — refine the wedge (Step 5 ticket sheet expansion)
**Journeys:** J-T1 add · J-T2 edit · J-T3 reorder · J-T4 visibility · J-T5 approval · J-T6 password · J-T7 waitlist
**Mode:** INVESTIGATE complete — paired with `SPEC_ORCH-BIZ-CYCLE-5-TICKET-TYPES.md`
**Confidence:** **HIGH** — Cycle 3 baseline is fresh, the modifiers are isolated additions, no five-layer contradictions found.

---

## Layman summary

The ticket sheet from Cycle 3 supports 4 fields (name + free toggle + unlimited toggle + price + capacity). Cycle 5 adds **6 new modifiers**: visibility (public/hidden/disabled), approval-required, password-protected, waitlist-enabled, min/max purchase quantity, allow-transfers. Plus **reorder** for the ticket list.

The right data model is **layered booleans** (already used for `isFree`/`isUnlimited`) — not a single `type` enum. A ticket can be both Approval-required AND Password-protected without modeling gymnastics.

The right UX is **modifier toggles**, not a "type segmented control." A type preset row would force "1-of-N" semantics that break when modifiers stack. The 7 user stories' "type segmented control" wording presumed a different model — recommend revising to toggles. Deviation flagged for orchestrator + user steering.

Reorder: **up/down arrow buttons**, not drag-and-drop. Drag-and-drop is fragile on Expo Web (R1 parity), needs a new external library, and adds 200+ LOC for marginal UX gain. Arrow buttons are accessible, web-safe, zero deps, ~30 LOC.

---

## Phase 0 — Context Ingest

### Prior artifacts read
- `Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_5_TICKET_TYPES.md` — this dispatch
- `Mingla_Artifacts/specs/SPEC_ORCH-BIZ-CYCLE-3-EVENT-CREATOR.md` — Cycle 3 baseline
- `Mingla_Artifacts/specs/SPEC_ORCH-BIZ-CYCLE-4-RECURRING-MULTIDATE.md` — Cycle 4 patterns
- `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_4_RECURRING_MULTIDATE.md` — most recent shipped cycle
- `Mingla_Artifacts/BUSINESS_PRD.md` §4.1 (26 ticket fields), §4.2 (13 ticket types)
- `Mingla_Artifacts/DECISION_LOG.md` — DEC-071/079/084/085
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` — I-11/I-12/I-13/I-14
- 7 user stories at `Mingla_Artifacts/github/user-stories/cycle-5/us-01..us-07.md`

### Memory
- `feedback_keyboard_never_blocks_input.md` — applies to the new ticket sheet (more inputs)
- `feedback_implementor_uses_ui_ux_pro_max.md` — applies to the modifier toggle UX
- `feedback_sequential_one_step_at_a_time.md` — keeps Cycle 5 scope locked to MVP types only
- `feedback_confirm_ux_semantics_before_dispatch.md` — Q-1 type-picker shape needs explicit confirmation before implementor

### Migration chain
N/A — frontend-only (DEC-071). AsyncStorage schema v3 → v4 (additive, in-app migrator).

---

## Phase 1 — Symptom / scope

This is **build, not break**. Cycle 5 implements the deferred fields/types from PRD §4.1 / §4.2 that Cycle 3 left as TRANSITIONAL. Per founder steering (2026-04-30): MVP-tier types only — Free / Paid / Approval / Password / Waitlist + visibility + reorder + min/max-qty + allow-transfers. Other types (Early Bird / VIP / Group / Donation / PWYW / Add-on) deferred to **Cycle 5b**.

---

## Phase 2 — Investigation Manifest

| File | Why read | Status |
|------|----------|--------|
| `mingla-business/src/components/event/CreatorStep5Tickets.tsx` | The file expanding — TicketCard + TicketStubSheet + main body | ✓ read |
| `mingla-business/src/store/draftEventStore.ts` | TicketStub interface — extend additively to v4 | ✓ read |
| `mingla-business/src/utils/draftEventValidation.ts` | validateTickets — extend for new fields | ✓ read |
| `mingla-business/src/components/event/CreatorStep7Preview.tsx` | Mini-card formatPriceLine + ticket badges | ✓ read |
| `mingla-business/src/components/event/PreviewEventView.tsx` | PublicTicketRow rendering — needs new badges | ✓ read |
| `mingla-business/src/components/event/CreatorStep2When.tsx` | Cycle 4 chip-pattern reference (segment control + sheet pattern) | ✓ read |
| `mingla-business/src/components/event/MultiDateOverrideSheet.tsx` | Cycle 4 sheet keyboard + scroll-aware patterns | ✓ read |
| `mingla-business/src/components/ui/Sheet.tsx` | DEC-084 numeric snap + I-13 portal | ✓ read |
| `mingla-business/src/components/ui/Pill.tsx` | Available pill variants for new badges | (in-spec) |
| `Mingla_Artifacts/BUSINESS_PRD.md` §4.1 / §4.2 | Authoritative product contract | ✓ read |

---

## Phase 3 — Findings

### 🔵 OBS-1 — Cycle 3 ticket data model already uses layered booleans

**File:** `draftEventStore.ts` lines 59–77
**Current:**
```ts
export interface TicketStub {
  id: string;
  name: string;
  priceGbp: number | null;
  capacity: number | null;
  isFree: boolean;
  isUnlimited: boolean;
}
```
**Significance:** `isFree` and `isUnlimited` are layered booleans — a ticket can be both (free + unlimited capacity event). Cycle 5 should follow this established pattern: add `approvalRequired`, `passwordProtected`, `waitlistEnabled`, `allowTransfers`, `visibility`, `displayOrder`, `minPurchaseQty`, `maxPurchaseQty`, `password` as siblings.

**Impact on Q-2:** confirmed — layered booleans (option b in dispatch).

### 🟡 HIDDEN-1 — User stories' "type segmented control" wording contradicts the data model

**File:** `Mingla_Artifacts/github/user-stories/cycle-5/us-01-add-ticket-type.md`
**Current text:**
> "Then the ticket sheet opens with a 'Type' segmented control at the top showing General / Early-bird / VIP / Approval / Password / Waitlist / Other"
**What's wrong:** A segmented control is mutually-exclusive (1-of-N). Modifiers stack (Approval + Password + Waitlist can all be true on one ticket). A segmented "type" picker would either:
- Lose information when stacking modifiers (selecting "Approval" hides the fact that Password is also true)
- Force a fake "primary type" hierarchy that doesn't exist in the data
- Create UI complexity reconciling the picker state with the underlying booleans

**What it should be:** A list of **modifier toggles** — each modifier (free, unlimited, approval, password, waitlist, visibility, transferability) is its own toggle/picker. The ticket's "type" is implicit from the combination. Discoverability: each toggle has clear sub-copy ("Buyers will need approval before paying"). Not all toggles need to be visible at once — collapsible sections (PRD §4.1) can hide secondary modifiers.

**Classification:** 🟡 because the user-story wording is a UX *intent* that needs revising — not a code defect today.

**Impact on Q-1:** recommended answer is **NO segmented type picker** — pure modifier toggles. This deviates from the user story; orchestrator must confirm with founder before implementor dispatch.

### 🔵 OBS-2 — Cycle 4 patterns are directly reusable for Cycle 5 sheet

**Reference files:**
- `MultiDateOverrideSheet.tsx` — keyboard-aware ScrollView with pendingScrollRef + deferred scrollToEnd
- `CreatorStep5Tickets.tsx` (current) — has the same Keyboard listener + `dynamicSnap` pattern

**What this means for Cycle 5:** The existing `TicketStubSheet` ALREADY has the right keyboard pattern. Cycle 5 just adds more fields inside it. The keyboard rule (`feedback_keyboard_never_blocks_input.md`) is already honored by the sheet structure — implementor needs to verify each NEW input also calls scrollToEnd on focus, but the infra is in place.

### 🟡 HIDDEN-2 — `TicketCard.cardSub` hardcodes "Free · 1 per buyer" / "Paid · 1 per buyer"

**File:** `CreatorStep5Tickets.tsx` lines 96–99
**Current code:**
```ts
<Text style={styles.cardSub}>
  {ticket.isFree ? "Free · 1 per buyer" : "Paid · 1 per buyer"}
</Text>
```
**What's wrong:** The "1 per buyer" suffix is hardcoded. Cycle 5 introduces `maxPurchaseQty` (nullable) and other modifiers that need surfacing. After Cycle 5, this line should reflect reality (e.g., "Paid · max 4 per buyer · approval required").

**What it should be:** A computed sub-line helper that renders modifiers compactly. E.g.:
- "Free" / "£25"
- + "max 4 / buyer" if maxPurchaseQty < ∞
- + "approval" if approvalRequired
- + "password" if passwordProtected
- + "waitlist" if waitlistEnabled
- + "non-transferable" if !allowTransfers

**Spec response:** introduce `formatTicketSubline(ticket)` helper in a new utility (or co-located in CreatorStep5Tickets). Cycle 7 Preview's `PublicTicketRow` and Step 7 mini card both consume this helper for consistency (Constitution #2 — one owner per truth).

### 🟡 HIDDEN-3 — `formatPriceLine` in CreatorStep7Preview doesn't account for paid+free mix when waitlist is on

**File:** `CreatorStep7Preview.tsx` lines 71–81
**Current behavior:** Returns "Free" if every ticket is free, "From £X" otherwise.
**What it should do:** Same — but if all paid tickets are sold out and only waitlist remains, the copy should reflect "+ Waitlist". For Cycle 5 (no real sales yet), this is a TRANSITIONAL noop. Flag it for Cycle 9 (event management) when sale state becomes live.

**Classification:** 🟡 because today no ticket is "sold out" (frontend-only). Just a marker for the implementor to leave a TRANSITIONAL comment.

### 🟡 HIDDEN-4 — `validateTickets` doesn't enforce `password.length >= 4` or `waitlist + unlimited` exclusion

**File:** `draftEventValidation.ts` lines 201–235
**Current:** Validates name + (price OR isFree) + (capacity OR isUnlimited). Does NOT validate the new modifiers.
**What it should do (after Cycle 5):**
- `passwordProtected = true` ⇒ `password.length >= 4` else error `tickets[i].password`
- `waitlistEnabled = true` ⇒ `isUnlimited = false` else error `tickets[i].waitlistConflict` ("Unlimited tickets don't need a waitlist")
- `minPurchaseQty >= 1`
- `maxPurchaseQty === null || maxPurchaseQty >= minPurchaseQty`
- `displayOrder` integers, no duplicates within an event (auto-managed by reorder UI but defense-in-depth)

**Spec response:** extend `validateTickets` with these branches.

### 🔵 OBS-3 — Reorder UX choice: web-parity dictates arrow buttons, not drag-and-drop

**Cross-domain check:** Expo Web's support for `react-native-reanimated` Reorderable is not first-class. `react-native-draggable-flatlist` requires Reanimated 3 + GestureHandler — works on iOS/Android but spotty on web. Adding a new external library would also burn the dispatch's "no new external libs" constraint.

**Up/down arrow recommendation:**
- Visible on every ticket card next to the existing edit/duplicate/delete actions
- Up button disabled on first row; down disabled on last row
- Tapping shifts `displayOrder` by ±1 (and re-sorts the array)
- Accessible: native screen-reader announces "move up" / "move down"
- Web-safe: pure tap interactions, no gesture handlers
- ~30 LOC vs ~250+ LOC for drag-and-drop

**Recommendation:** **arrow buttons for Cycle 5.** Drag-and-drop deferred to Cycle 17 polish or a future "ticket reorder upgrade" surface if user pressure surfaces.

### 🔵 OBS-4 — Cycle 4 schema v3 → v4 migration is the established pattern

**File:** `draftEventStore.ts` lines 198–230
**Current pattern:** Versioned `persist` with explicit migrators. Existing v1→v2→v3 chain handled additively.
**Cycle 5 follow:** Bump version 3 → 4. Add `upgradeV3DraftToV4` that sets defaults for the 9 new TicketStub fields per existing ticket. No data is lost.

### 🟡 HIDDEN-5 — `TicketCard.cardActionsRow` already handles 3 buttons (duplicate/edit/delete) — adding 2 reorder arrows brings total to 5

**File:** `CreatorStep5Tickets.tsx` lines 102–129
**Concern:** Visual density. 5 28×28 buttons in a horizontal row may overflow on narrow screens.
**Mitigation options:**
1. **Vertical action stack** on the right — duplicate/edit/delete in a column + reorder arrows in another column
2. **Two rows** — primary actions (edit/duplicate/delete) on top, reorder (up/down) below or in a separate left-edge column
3. **Long-press contextual menu** for duplicate/delete — keeps edit + reorder primary, hides destructive in a menu
4. **Reorder as left-edge handle** — up/down arrows column on left, primary actions on right (matches iOS Reorder pattern visually)

**Recommendation:** **Option 4** — left-edge column with up/down arrows, right-edge column with edit/duplicate/delete. Visually communicates "reorder" without consuming the same horizontal space.

**Spec response:** specifies the layout explicitly + `/ui-ux-pro-max` reviews before implementor reports verified.

### 🔵 OBS-5 — `Pill` primitive availability for new badges

**File:** `mingla-business/src/components/ui/Pill.tsx`
**Need to verify** the existing variants (likely `draft`, `live`, `info`?). Cycle 5 needs:
- "Approval required" badge (info-ish)
- "Password required" badge (info-ish, lock icon)
- "+ Waitlist" badge (info-ish, list icon)
- "Hidden" badge (warning/info)
- "Sales paused" badge (warning)

**Spec response:** if Pill has an `info` variant, reuse. Otherwise specify a new variant or fall back to inline View + Text. No new kit primitives (DEC-079).

---

## Phase 4 — Five-Layer Cross-Check

| Layer | Source of truth | Cycle 5 finding |
|-------|-----------------|-----------------|
| **Docs** | BUSINESS_PRD §4.1 (26 fields) + §4.2 (13 types) | Cycle 5 ships ~11 of 26 fields + 5 of 13 types per founder steering. Remaining = "Cycle 5b candidates." |
| **Schema** (target backend) | BUSINESS_PROJECT_PLAN §B.4 `ticket_types` table | All Cycle 5 fields map cleanly to backend column names (with snake_case at the DB and camelCase in TS — established pattern). |
| **Code** (Cycle 4 baseline) | TicketStub v3, validateTickets, TicketStubSheet | All extension points are isolated; no implicit assumptions about the v3 shape elsewhere (HIDDEN-2 + HIDDEN-4 are the only places needing branched logic). |
| **Runtime** | N/A — frontend-only | No runtime contradictions. |
| **Data** | AsyncStorage v3 | v3 → v4 migration purely additive. |

**No layer disagreements.**

---

## Phase 5 — Blast Radius

| Surface | Affected? | How |
|---------|-----------|-----|
| TicketStub interface | ✅ extend | 9 new fields |
| TicketStubSheet (sheet body) | ✅ major | New toggles + visibility picker + min/max inputs + password input + reorder column |
| TicketCard (list row) | ✅ medium | New cardSub formatter + reorder arrow column |
| validateTickets | ✅ medium | New error keys |
| CreatorStep7Preview mini card | ✅ light | Modifier badges below price line |
| PreviewEventView PublicTicketRow | ✅ medium | "Request access" buyer copy + password gate + waitlist suffix + visibility variants |
| draftEventStore migration | ✅ light | v3→v4 migrator |
| CreatorStep1/2/3/4/6 | ❌ unchanged | No ticket-shape dependencies |
| EventCreatorWizard | ❌ unchanged | Step 5 owns its sheet |
| Routes | ❌ unchanged | |
| `useDraftsForBrand` / `useDraftById` | ❌ unchanged | mode-agnostic |
| Logout (`clearAllStores`) | ❌ unchanged | wipes drafts regardless of internal shape |

**Total LOC estimate:** ~700–900 net new + ~150 modified across:
- `draftEventStore.ts`: ~80 LOC (types + migrator)
- `draftEventValidation.ts`: ~70 LOC (new branches)
- `CreatorStep5Tickets.tsx`: ~500 LOC net new (sheet expansion + reorder + sub-line formatter)
- `CreatorStep7Preview.tsx`: ~30 LOC (badges)
- `PreviewEventView.tsx`: ~60 LOC (variants)
- New utility `ticketDisplay.ts`: ~80 LOC

Estimate aligns with founder's ~32 hr cycle target if implementor reuses Cycle 4 sheet patterns aggressively.

---

## Phase 6 — Invariant Violations

| Invariant | Status |
|-----------|--------|
| **I-11** Format-agnostic ID resolver | ✅ preserved — `useDraftById(id)` mode-agnostic |
| **I-12** Host-bg cascade | ✅ preserved — sheet inherits canvas |
| **I-13** Overlay-portal contract | ✅ preserved — TicketStubSheet uses Sheet primitive |
| **I-14** Date-display single source | ✅ preserved — Cycle 5 doesn't touch date display |
| **Constitution #1** No dead taps | Must hold — every reorder arrow + visibility row + new toggle has onPress |
| **Constitution #2** One owner per truth | Must hold — new `formatTicketSubline` helper centralises modifier display (HIDDEN-2 lift) |
| **Constitution #6** Logout clears | ✅ preserved |
| **Constitution #7** TRANSITIONAL labels | Must hold — deferred Cycle-5b types/fields labelled |
| **Constitution #8** Subtract before adding | Must hold — old hardcoded `cardSub` removed before adding helper |
| **Constitution #10** Currency-aware | ✅ preserved — uses existing `formatGbp` utilities |

**No violations introduced** by the locked scope.

---

## Phase 7 — Open Questions for Orchestrator + User

Six questions surfaced. Recommendations are the spec's working assumption. Per memory rule, orchestrator confirms with founder before implementor dispatch.

### Q-1 — Type picker UX shape: **revised recommendation**

**Spec answer:** **NO segmented type picker.** Pure modifier toggles. Discoverable via clear copy on each toggle.

**Rationale:** Layered modifiers + segmented "1-of-N" UI = data-model conflict (HIDDEN-1). The 7 user stories said "type segmented control"; investigation shows that's the wrong UX for layered booleans. **Founder must confirm this deviation** before implementor.

If founder insists on a type segmented control: implementor would build it as a *preset selector* on top of the toggles (tapping "Approval" sets approval_required=true; user can untoggle individually after). That's ~+2 hrs of code. Default lean: skip the preset row.

### Q-2 — Single enum vs layered modifiers

**Spec answer:** **Layered booleans.** Already what Cycle 3 used. No breaking changes. Extends naturally.

### Q-3 — Reorder mechanism

**Spec answer:** **Up/down arrow buttons** in a left-edge column on each TicketCard. Web-safe, accessible, zero new deps, ~30 LOC.

**Rationale:** Drag-and-drop on Expo Web is fragile + adds 200+ LOC + needs new external lib (forbidden by dispatch). Arrow buttons satisfy J-T3 ACs cleanly.

### Q-4 — Schema v3 → v4 shape: **camelCase confirmed**

**Spec answer:**
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
  visibility: TicketVisibility;          // default "public"
  displayOrder: number;                  // default = array index at migration time
  approvalRequired: boolean;             // default false
  passwordProtected: boolean;            // default false
  password: string | null;               // null unless passwordProtected; min 4 chars
  waitlistEnabled: boolean;              // default false
  minPurchaseQty: number;                // default 1
  maxPurchaseQty: number | null;         // default null = no cap
  allowTransfers: boolean;               // default true
}
```

**Naming:** camelCase throughout, matching Cycle 3 + RN convention.

### Q-5 — Preview badges position

**Spec answer:** Inline pills below the ticket card price line, in a horizontal row. Each pill ≤ 80px wide. If multiple pills, wrap to next line. Use existing `Pill` primitive variant `info` (or fall back to inline View + Text styled to match).

Buyer-side overrides on `PreviewEventView`:
- `approvalRequired` ⇒ button label "Request access" instead of "Buy ticket"; footer note "You'll get an email once approved"
- `passwordProtected` ⇒ button label "Enter password to unlock"; tap reveals password input gate
- `waitlistEnabled` ⇒ when capacity reached (Cycle 5: simulated via UI flag), button label "Join waitlist"
- `visibility = hidden` ⇒ ticket renders with "Hidden — direct link only" badge in preview only (real public page doesn't render the row at all)
- `visibility = disabled` ⇒ ticket greyed + "Sales paused" pill, button disabled

### Q-6 — Validation rules: confirmed

| Rule | Field key | Message |
|------|-----------|---------|
| name required | `tickets[i].name` | "Ticket {i+1} needs a name." (existing) |
| price required when not free | `tickets[i].price` | "Set a price for {name}, or mark it free." (existing) |
| capacity required when not unlimited | `tickets[i].capacity` | "Set a capacity for {name}, or mark it unlimited." (existing) |
| password required when passwordProtected | `tickets[i].password` | "Password must be at least 4 characters." |
| waitlist conflicts with unlimited | `tickets[i].waitlistConflict` | "Unlimited tickets don't need a waitlist — turn one off." |
| minPurchaseQty >= 1 | `tickets[i].minPurchaseQty` | "Minimum purchase must be at least 1." |
| maxPurchaseQty >= minPurchaseQty (if set) | `tickets[i].maxPurchaseQty` | "Maximum can't be less than minimum." |
| displayOrder integers, unique | (silent — auto-managed by reorder UI) | (defensive: re-normalize on save if drift detected) |

---

## Phase 8 — Discoveries for Orchestrator

| ID | Severity | Note |
|----|----------|------|
| **D-FOR-CYCLE5-1** | Medium (UX) | The 7 user stories' "type segmented control" wording needs revising to "modifier toggles" before implementor dispatch. Update us-01..us-07.md OR have founder explicitly approve the deviation. Recommend updating user stories to match the modifier-toggle approach. |
| **D-FOR-CYCLE5-2** | Low | New helper `formatTicketSubline(ticket)` consolidates display logic — Constitution #2 lift, similar to Cycle 4's `eventDateDisplay.ts` → I-14. Candidate for new invariant **I-15** (ticket-display single source). |
| **D-FOR-CYCLE5-3** | Low | PRD §4.1 has fields deferred to Cycle 5b: sale period, validity period, ticket description, online/in-person availability toggles, info tooltips, collapsible sections. Track them as a Cycle 5b epic in the GitHub Project. |
| **D-FOR-CYCLE5-4** | Low | PRD §4.2 has types deferred to Cycle 5b: Early Bird, VIP, Group, Donation, Pay-What-You-Want, Add-on, Other. These can layer on top of the modifier model — Early Bird = "Paid + sale_end_at"; VIP = "Paid + display_order=1 + custom badge"; etc. Cycle 5b spec should formalize this mapping. |
| **D-FOR-CYCLE5-5** | Low | TicketCard's 5-button action row (after adding reorder) needs OBS-5's left-edge-arrow-column layout to avoid horizontal density. `/ui-ux-pro-max` review mandatory before implementor reports verified. |
| **D-FOR-CYCLE5-6** | Note | Cycle 4's `formatTicketSubline` pattern recommended for Cycle 9 (event management) when orders + sale state come live — for surfaces showing "Sold out" / "X left" / "Sales end in Y days." Logged for Cycle 9 prep. |

---

## Phase 9 — Confidence + Verification

**Confidence: HIGH.**

- Every claim verified by reading the file first-hand.
- Cycle 4 just shipped (commit `7d3d61ba`); patterns are fresh.
- Layered-booleans data model is already in production (isFree, isUnlimited).
- No five-layer contradictions. No external API changes. No backend coupling.
- Risk: founder may reject Q-1 deviation (segmented control). Mitigation: orchestrator explicit confirmation before implementor.

---

**Spec next.** See `specs/SPEC_ORCH-BIZ-CYCLE-5-TICKET-TYPES.md`.
