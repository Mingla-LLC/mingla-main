# INVESTIGATION — BIZ Cycle 10 (Guest list + approval flow) scope-finding

**Mode:** INVESTIGATE
**Cycle:** 10 (Mingla Business mobile app — operator-facing)
**Dispatch:** [`prompts/FORENSICS_BIZ_CYCLE_10_GUEST_LIST.md`](../prompts/FORENSICS_BIZ_CYCLE_10_GUEST_LIST.md)
**Confidence:** HIGH (every classification cross-checked against actual code + PR #59 schema)
**Date:** 2026-05-02

---

## 1 — Layman summary

PRD §5.3 lists 10 guest-management features. Of those, **6 are buildable now** (pure mobile UI on top of `useOrderStore` + a small new store + 1 new event flag), **2 are gated on Cycle 11 scanner**, and **2 are gated on B4 Stripe payment-hold backend**. Recommended Cycle 10 slice = the 6 buildable ones, packaged as **6 operator journeys (J-G1..J-G6)**.

The **schema is ready and waiting** (PR #59 already models `tickets.attendee_name/email/phone` + full `approval_status` state machine + audit fields), but the consumer code (`mingla-business`) doesn't write to that schema yet — no edge functions, no Stripe integration. So Cycle 10 is **client-only state plus 1 new LiveEvent field**, with a clean B-cycle cutover later when the backend wiring happens.

Recommend: **buyer-as-attendee model** (1 order = 1 guest row, qty = ticket count) — simplest representation that matches the data we have today, degrades cleanly to per-ticket when backend lands.

Risks flagged: search (J-G3) is the most likely scope-creep vector (filters demand will rise fast). Activity feed integration recommended for manual-add + private-toggle only (skip search/export — no buyer impact).

---

## 2 — PRD §5.3 verbatim

From `Mingla_Artifacts/BUSINESS_PRD.md` §5.3 Guest Management:

> - Approve pending guests
> - Reject pending guests
> - Private guest list
> - Manually add guests
> - Manually check in guests
> - View attendee check-in status
> - Search guest list
> - Export guest list
> - View attendee purchase history
> - View attendee contact details

10 features. Numbered 1–10 in this report for cross-reference.

---

## 3 — Per-feature classification (Q-10-1 answer)

| # | Feature | Class | Source | Gate / Reason |
|---|---------|-------|--------|---------------|
| 1 | Approve pending guests | 🔴 RED | — | Gated on B4 (Stripe payment-hold backend). Today's checkout emits *"Approval flow lands Cycle 10 + B4"* toast at `PublicEventPage.tsx:266` — no pending tickets exist client-side. |
| 2 | Reject pending guests | 🔴 RED | — | Same gate as #1. Schema-side `tickets.approval_status='pending'` is ready but no edge function writes to it. |
| 3 | Private guest list | 🟡 YELLOW | New `LiveEvent.privateGuestList: boolean` field | Pure client-state flag; no backend dep. Operator toggles in EditPublishedScreen + ManageMenu. |
| 4 | Manually add guests | 🟡 YELLOW | New `useGuestStore.compEntries[]` (Zustand persisted) | Client-only comp guests; do NOT touch OrderRecord (I-19 immutability). |
| 5 | Manually check in guests | 🔴 RED | — | Gated on Cycle 11 scanner. `scan_events` table empty until scanner wires it. |
| 6 | View attendee check-in status | 🟡 YELLOW | Display-only placeholder | Render "Not checked in" until Cycle 11; UI structure won't change when data lands. |
| 7 | Search guest list | 🟢 GREEN | `useOrderStore.entries[].buyer.{name,email,phone}` + `compEntries[]` | Pure string match. |
| 8 | Export guest list | 🟢 GREEN | `useOrderStore.entries` (filtered by event) + `compEntries[]` → CSV | React Native Share API on iOS/Android/Web. |
| 9 | View attendee purchase history | 🟢 GREEN | `useOrderStore.entries.filter(o => o.buyer.email === X && o.brandId === Y)` | Cross-event lookup by buyer email scoped to brand. |
| 10 | View attendee contact details | 🟢 GREEN | `OrderRecord.buyer` (name/email/phone) | Already populated from Cycle 8 checkout flow. |

**Buildable in Cycle 10:** 6 features (#3, #4, #6, #7, #8, #9, #10 — counting #4 + #6 as YELLOW-but-still-Cycle-10, and #6 as a placeholder column). **Deferred:** 4 features (#1, #2, #5 — gated; plus the per-ticket-attendee model deferred to B-cycle).

---

## 4 — Recommended Cycle 10 slice + rationale

**Slice:** All 6 GREEN/YELLOW features ship in Cycle 10. RED features (#1, #2, #5) deferred to their respective gates (B4 for approval, Cycle 11 for scanner check-in).

**Rationale:**
- **Coherence:** Operator gets a complete read-only-plus-light-write guest experience in one cycle. Splitting search and export into separate cycles fragments the UX without engineering benefit.
- **Schema-vs-code gap is contained:** PR #59 has the per-attendee fields, but client doesn't write to them yet. Buyer-as-attendee model maps cleanly to today's `OrderRecord.buyer` + `lines[].quantity` — when B-cycle lands and per-ticket attendee data flows, the same UI surface degrades from "1 row per buyer" to "N rows per buyer's tickets."
- **No backend dep:** Cycle 10 ships entirely client-side. No edge function deploy, no migration, no Stripe Connect work.
- **Clean handoff to Cycle 11:** Check-in status column is structurally in place from day 1; Cycle 11 just plumbs `scan_events` data into the existing slot.

**Estimated implementor wall:** ~6–10 hours. Single significant new store (`useGuestStore`), 5–6 new screens/sheets, 1 LiveEvent field extension.

---

## 5 — Journey breakdown (Q-10-2 answer)

| Journey | Title | Surface | PRD §5.3 features covered |
|---------|-------|---------|---------------------------|
| **J-G1** | Guest list view | New screen `/event/[id]/guests` (operator route, inside `(tabs)` flow per existing pattern) | #6, #7 (display + search), #10 (contact summary inline) |
| **J-G2** | Guest detail | New screen `/event/[id]/guests/[guestId]` | #9, #10 (contact + purchase history); placeholder for #5 (check-in) |
| **J-G3** | Search/filter | Inline on J-G1 (search bar + future filter pills) | #7 |
| **J-G4** | Manually add comp guest | Sheet from J-G1 footer "+" CTA | #4 |
| **J-G5** | Private guest list toggle | Toggle in `EditPublishedScreen` settings + `EventManageMenu` action | #3 |
| **J-G6** | Export to CSV | Button in J-G1 chrome → Share API | #8 |

**Routing notes:**
- J-G1 / J-G2 follow Cycle 9c's anon-tolerance pattern — but Cycle 10 is **operator-only** (uses `useAuth` + sits inside operator route hierarchy, not under `(tabs)/`). PRD §5.3 entries are all operator-side; no buyer surface in this cycle.
- The "Guests" ActionTile in `app/event/[id]/index.tsx:551–557` (currently shows toast *"Guests + approval flow lands Cycle 10 + B4"*) wires to J-G1 entry.
- The `handleGuests` callback in `app/(tabs)/events.tsx` (similar toast stub) — operator might tap from list-card menu — also wires to J-G1.

---

## 6 — Data sourcing strategy per journey (Q-10-3 answer)

| Journey | Primary data source | New state | Existing state |
|---------|--------------------|-----------|----------------|
| **J-G1** (list) | `useOrderStore.entries.filter(o => o.eventId === id)` ⊕ `useGuestStore.compEntries.filter(c => c.eventId === id)` | `useGuestStore` (new) | `useOrderStore`, `useLiveEventStore` |
| **J-G2** (detail) | `useOrderStore.entries.find(...)` OR `useGuestStore.compEntries.find(...)` keyed by composite ID `{kind, id}` | — | Above |
| **J-G3** (search) | Filter J-G1 source via case-insensitive substring match on `buyer.name`, `buyer.email`, `buyer.phone` | — | Above |
| **J-G4** (add comp) | Mutation: `useGuestStore.recordCompEntry({eventId, brandId, name, email, phone, ticketTypeId?, addedAt})` | `useGuestStore.recordCompEntry` mutation | — |
| **J-G5** (private toggle) | Mutation: `useLiveEventStore.updateLiveEventFields(eventId, {privateGuestList})` (existing API; just extend `LiveEventEditableFieldKey` union) | New field on `LiveEvent` + `DraftEvent` | Existing edit-after-publish pipeline |
| **J-G6** (export) | Same source as J-G1; pipe through CSV serializer | — | React Native Share API (or Web Share fallback) |

**Stable-reference rule (memory rule from Cycle 9c v2 / v3):**
- All store reads MUST use raw-entries + `useMemo` selector pattern (mirrors `useLiveEventBySlug` + Cycle 9c v3 `recentActivity`)
- Selectors that return primitives (counts, single records via `find`) are safe to consume directly
- Selectors returning fresh arrays/objects each call are FORBIDDEN — use the raw-entries-plus-memo composition

**Buyer-as-attendee model (Q-10-3 sub-decision):**
- 1 OrderRecord = 1 "guest row" in the list view
- Display attendee count = `lines.reduce((s, l) => s + l.quantity, 0)`
- Sort: newest paidAt first (default); search-term match overrides sort
- comp entries appear inline with same row shape, distinguished by a subtle "comp" pill

When B-cycle wires backend (`tickets` table per-attendee identity), the buyer-as-attendee row expands into N child rows automatically — UI structure unchanged, just deeper render. **Document this as a transition path in the SPEC.**

---

## 7 — Q-10-4 — Manually add guests (Option B)

**Recommendation:** **Option B (separate `useGuestStore.compEntries[]`)** — distinct from orders.

**Rationale:**
- **I-19 immutable order financials** locks `OrderRecord.{lines, buyer, currency, paidAt, paymentMethod, totalGbpAtPurchase}` write-once. Adding phantom comp orders forces extensions that violate the spirit of the invariant (a comp guest didn't pay; calling it an "order" is a category error).
- `CheckoutPaymentMethod = "card" | "apple_pay" | "google_pay" | "free"` doesn't include `"comp"`. Extending it just to support manual-add cascades into checkout-flow type checks that don't make sense for a non-purchase.
- Comp entries are **operator-created**, not buyer-created. Different lifecycle, different audit semantics. Separate store keeps semantics clean.
- B-cycle migration is simpler: comp entries either get migrated to backend `tickets` (with `tickets.order_id IS NULL` carve-out OR a separate `comp_guests` table), but the migration is bounded to one client store, not entangled with the order store.

**Shape:**
```ts
interface CompGuestEntry {
  id: string;                  // cg_<ts36>_<rand4>
  eventId: string;
  brandId: string;              // denormalized
  name: string;
  email: string;
  phone: string;                // empty string if not provided
  ticketTypeId: string | null;  // optional; null = "general comp"
  ticketNameAtCreation: string | null; // snapshot if ticketTypeId set
  addedAt: string;              // ISO 8601
  addedBy: string;              // operator account_id (for audit)
  notes: string;                // operator-provided, optional
}
```

Mutations: `recordCompEntry`, `removeCompEntry` (allow removal — comp guests are operator-created and can be undone, unlike orders which are immutable). Selectors: `getCompEntriesForEvent`, `getCompEntryById`.

---

## 8 — Q-10-5 — Activity feed integration (Recommendation C — selective)

**Recommendation:** **C — selective integration.**

| Journey | Log to activity feed? | Severity | Why |
|---------|----------------------|----------|-----|
| J-G4 manual-add | ✅ YES | `material` | Changes attendee count → buyers may notice (SOLD OUT vs available) |
| J-G5 private-toggle | ✅ YES | `material` | Changes who can see the guest list → has buyer-side UX implication if/when buyer surface lands |
| J-G3 search | ❌ NO | — | Pure UI ergonomics, no buyer impact |
| J-G6 export | ❌ NO | — | Read-only side effect, no state change |
| Comp-entry removal | ✅ YES | `material` | Mirror of add — buyers may notice attendee-count drop |

**Implementation:** J-G4 / J-G5 / comp-removal call `useEventEditLogStore.recordEdit({eventId, brandId, severity: "material", reason: <operator-provided>, changedFieldKeys: ["compEntries"] | ["privateGuestList"], diffSummary: ["added comp guest: {name}"] | ["enabled private guest list"], affectedOrderIds: [], orderId: undefined})`.

The Cycle 9c-2 activity feed (just shipped) renders `event_edit` kinds — these new entries will surface there automatically with no Cycle 9c-2 changes needed. Severity `material` lights warm-orange; `additive` would be too quiet for "the operator just added someone to your sold-out event."

**Reason field:** prompt operator for a one-line reason on add (e.g., "VIP comp" / "Press list" / "Plus-one for performer"). 10–200 char trimmed per existing `useEventEditLogStore` contract. For private-list toggle, default reason = "Toggled private guest list off" / "...on" with operator override option.

---

## 9 — Q-10-6 — Anon route / I-21 implications

**Cycle 10 has zero buyer-facing surface.** All journeys are operator-only — they sit inside the operator route hierarchy, use `useAuth`, and read brand-scoped data.

**Forward-looking note (NOT Cycle 10 scope):** if a future cycle adds a "guest list preview" to the buyer's `/o/[orderId]` page (e.g., "you'll be among 47 attendees"), that surface MUST honor `event.privateGuestList` — when private, hide the count or show only "you're confirmed." Flag for Cycle B/C buyer-protection sweep but do NOT spec in Cycle 10.

---

## 10 — Q-10-7 — Approval flow gate (B4 dependency) — confirmed

**Status:** Approval flow is **definitively gated on B4**. Confirmed by tracing both schema and runtime:

**Schema layer (PR #59 — head `836ce108…`):**
- `tickets.approval_status` CHECK `IN ('auto', 'pending', 'approved', 'rejected')` — line 1104–1106. State machine ready.
- `tickets.approval_decided_by uuid REFERENCES auth.users (id)` + `tickets.approval_decided_at timestamptz` — full audit. Line 1107–1108.
- `ticket_types.requires_approval boolean NOT NULL DEFAULT false` — line 676. Per-ticket-type flag.

**Code layer (mingla-business):**
- `TicketStub.approvalRequired: boolean` — `draftEventStore.ts:91`. Comment verbatim: *"When true, buyers request access; organiser approves/rejects (Cycle 10/B4)."*
- `LiveEvent.requireApproval: boolean` — separate event-level flag. (Note: there are TWO levels — event + per-ticket. PRD §4.1 line 304 lists event-level only; PRD §4.2 line 322 lists ticket-level. Current consumer code uses both.)
- Buyer flow: `PublicEventPage.tsx:649–651` — when `ticket.approvalRequired`, `onBuyerAction("approval")` fires.
- Action handler: `PublicEventPage.tsx:265–267` — toast *"Approval flow lands Cycle 10 + B4."* — **no order is created**, no checkout proceeds.

**Verdict:** No silent silent-pending-orders bug. Today's checkout cleanly blocks at the buyer's "Request access" tap. No client-side pending-guest data exists. **Cycle 10 must NOT attempt to render pending-guest UI** — the source data for those features lives entirely in B4's future Stripe payment-hold integration.

**Forward path (B4 cutover, NOT Cycle 10):**
1. Buyer taps "Request access" → instead of toast, opens an info-collection sheet
2. Backend creates `tickets` row with `approval_status='pending'` (no payment captured)
3. Operator's J-G1 list gains a "Pending" filter + per-row Approve/Reject CTAs
4. Approval triggers payment capture; rejection refunds the held authorization
5. `useEventEditLogStore` logs as `severity: "destructive"` (since rejecting affects buyer)

That entire flow lives in B4 spec — Cycle 10 SPEC should not touch it.

---

## 11 — Q-10-8 — Check-in status placeholder

**Recommendation:** Render the column with **"Not checked in"** placeholder + grey indicator from day 1.

**Rationale:**
- UI structure stays identical when Cycle 11 scanner lands. Implementer just changes the cell renderer from `<NotCheckedInPill />` to `<CheckInStatusPill scanEvents={...} />` — zero layout/style/copy churn.
- Operator forms a mental model of "this column = check-in" before scanner ships, so when scans start landing the UI doesn't introduce new vocabulary.
- Avoids the "missing column → re-add later" UX seam (PRD lists it as a feature; absent column = the feature is missing).

**Style:** subtle grey pill with text "Not checked in" — same shape as the existing `OrderListCard` status pills (use `Pill variant="draft"`). Once Cycle 11 wires `scan_events`, swap to `variant="info"` with text "Checked in {time}" or similar.

**Display location:** column in J-G1 list view + dedicated section on J-G2 detail view.

---

## 12 — Q-10-9 — Export format

**Recommendation:** **CSV via React Native Share API** (Web fallback to Web Share API + Blob download).

**Columns** (in this order):
1. Name
2. Email
3. Phone
4. Ticket type
5. Quantity
6. Status (Paid / Comp / Pending — though Pending will always be empty in Cycle 10)
7. Order ID (or comp ID prefixed `cg_`)
8. Purchase date (ISO date, no time — sufficient for export consumers)
9. Comp note (empty for paid orders)

**Filename:** `{event-slug}-guest-list-{YYYY-MM-DD}.csv`

**No backend.** Pure client-side CSV serialization → temp file → Share sheet (iOS/Android) or Blob download trigger (Web). Use `expo-sharing` (already in mingla-business if Cycle 9b-1 share modal uses it) or fall back to `Linking.openURL("data:text/csv;base64,...")`.

**RFC 4180 compliance:** quote any field containing comma, quote, or newline; double-quote-escape internal quotes. Common gotcha — operator names with apostrophes ("O'Brien") + buyer notes with line breaks must roundtrip.

---

## 13 — Q-10-10 — Scope-creep risks

| Risk | Confidence | Mitigation |
|------|-----------|------------|
| **J-G3 search expansion** — search starts simple but operators want filters fast (status / ticket type / paid vs comp) | **HIGH** | Ship pure text search first. Filter pills explicitly OUT of scope; document as "Cycle 10.1 polish" if requested. SPEC must call this out as a hard line. |
| **J-G4 manual-add cascade** — could balloon into "send confirmation email" / "QR ticket generation for comp guest" / "Apple Wallet pass" | **MEDIUM** | All comp-side notification + ticket-generation work is gated on B-cycle (Resend wiring + Apple Wallet cert + .pkpass generation). SPEC must explicitly defer. Cycle 10 manual-add stops at "row in `useGuestStore.compEntries`" — no email, no ticket, no QR. |
| **J-G5 private-list spillover** — operator may expect the flag to also affect waitlist visibility, paired-attendee linking, etc. | **LOW** | Keep semantically narrow: flag only affects future buyer-side guest-list-preview (not in Cycle 10 anyway). SPEC can lock with a one-line "ONLY affects: nothing in Cycle 10. Future buyer-side guest preview will honor this flag." |
| **Buyer-as-attendee model breakage when B-cycle lands** | **LOW** | Document the transition path explicitly in SPEC §"Transition Items" — the row-shape evolves from "1 buyer × N qty pill" to "N attendee rows with names." UI structure unchanged. |
| **`useGuestStore` schema lock-in** — once shipped + persisted, schema changes require migration | **MEDIUM** | Use Zustand persist `version: 1` + clean migration story (same as `useOrderStore` pattern). Keep CompGuestEntry shape minimal in v1 — operators can always edit later in v2. |

---

## 14 — Schema check (Q-10-7 trace)

**PR #59 head `836ce108054800aba1573d8bc30684f5728a86ce` already provides:**

| Surface | Status | Cycle 10 use |
|---------|--------|--------------|
| `tickets` table with `attendee_name/email/phone` | ✅ Schema ready | NOT used in Cycle 10 (client-side OrderRecord.buyer is the source) |
| `tickets.approval_status` ('auto'/'pending'/'approved'/'rejected') + `approval_decided_by` + `approval_decided_at` | ✅ Schema ready | NOT used (B4 gate) |
| `ticket_types.requires_approval` | ✅ Schema ready | Mirrors client-side `TicketStub.approvalRequired` (B4 cutover folds them) |
| `orders` table with `buyer_email/buyer_name/buyer_phone` | ✅ Schema ready | Mirrors client-side `OrderRecord.buyer` (B4 cutover folds them) |
| `scan_events` table | ✅ Schema ready | NOT used (Cycle 11 gate; placeholder column rendered with no data) |
| `tickets.used_at` + `used_by_scanner_id` | ✅ Schema ready | NOT used (Cycle 11 scanner-write target) |

**What's missing from PR #59 schema (none — schema is sufficient for ALL of PRD §5.3 once edge functions land):**
- No `comp_guests` table — but Cycle 10 keeps comp guests client-side anyway. B-cycle decision: model comps as `tickets.order_id IS NULL` rows OR a dedicated `comp_guests` table. NOT a Cycle 10 question.
- No `guest_lists` private-flag column — but the flag is per-event (not per-guest-list as a separate entity), so it lives on `events.privateGuestList` (not yet added — Cycle 10 client-state for now, B-cycle migrates).

**No schema work needed in Cycle 10.** Client-only state extension only.

---

## 15 — Discoveries for orchestrator

**D-CYCLE10-1 (S3, observation)** — **Schema-vs-code per-attendee gap.** PR #59 schema models per-attendee identity (`tickets.attendee_name/email/phone`) but client-side `OrderRecord` carries only buyer-level identity. Cycle 10 ships buyer-as-attendee model; B-cycle backend cutover will reshape rows from "1 buyer × N qty" to "N tickets per buyer." Document the transition path in Cycle 10 SPEC §Transition Items so future spec writers know the upgrade route.

**D-CYCLE10-2 (S3, observation)** — **`tickets.approval_status` edge function gap.** Schema has full state machine but no edge function writes to it. B4 owns this; flag for B-cycle scope so it's not missed.

**D-CYCLE10-3 (S3, observation)** — **`CheckoutPaymentMethod` doesn't include `"comp"`.** If a future cycle decides to fold comp guests into orders (NOT Cycle 10's chosen path), the union extension cascades through checkout flow type checks. Cycle 10's separate-`compEntries` strategy avoids this, but document so future implementors know the trade.

**D-CYCLE10-4 (S2, hidden-flaw candidate)** — **Two parallel approval flags.** `LiveEvent.requireApproval: boolean` (event-level) AND `TicketStub.approvalRequired: boolean` (per-ticket-type). PRD lists both (§4.1 line 304 event, §4.2 line 322 ticket) but they're semantically overlapping. Today only the per-ticket flag drives the public-page button label (`PublicEventPage.tsx:649`). Recommend an ORCH for "approval-flag rationalization" (decide whether event-level is a derived rollup of ticket-level, or independent gate, or one is dead). Out of Cycle 10 scope but flag for backend cutover.

**D-CYCLE10-5 (S3, observation)** — **`useEventEditLogStore` already ratified for guest mutations.** Cycle 9c-2 just shipped event-edit + lifecycle into the activity feed. J-G4 / J-G5 will pipe through the same `recordEdit` API with `severity: "material"` — no edit-log infrastructure work needed.

---

## 16 — Open questions for operator steering

Before SPEC drafts, operator should confirm:

1. **Buyer-as-attendee model OK?** (vs per-ticket-attendee, which requires per-line attendee fields in OrderLineRecord and is a much bigger change — RECOMMEND yes, ship buyer-as-attendee, B-cycle migrates)
2. **6-journey breakdown OK?** (J-G1 list / J-G2 detail / J-G3 search / J-G4 manual-add / J-G5 private-toggle / J-G6 export — RECOMMEND yes)
3. **Selective activity-feed integration OK?** (manual-add + private-toggle log; search + export don't — RECOMMEND yes)
4. **CSV-only export OK?** (no JSON, no email send, no real-time link — RECOMMEND yes for v1)
5. **Hard line on filter pills out of scope?** (search-only in J-G3, filter pills explicitly punted to a future polish cycle — RECOMMEND yes; risk is HIGH otherwise)
6. **Comp-guest delete allowed?** (Operators should be able to remove comps they accidentally add — RECOMMEND yes, with `severity: "material"` audit log entry)
7. **Operator-only Cycle 10 confirmed?** (zero buyer-facing surface — RECOMMEND yes, defer buyer guest-list-preview to a later cycle)

If operator agrees with all 7 RECOMMEND defaults, spec writes can be a tight ~30 minute pass. Each "no" adds ~10–20 min of SPEC re-scope.

---

## 17 — Five-layer cross-check

| Layer | Question | Answer |
|-------|----------|--------|
| **Docs** | What does PRD §5.3 say should happen? | 10 features listed (§2 above). |
| **Schema** | What does PR #59 enforce? | Per-attendee + approval state machine + scan event tables READY but unwired. (§14) |
| **Code** | What does mingla-business do today? | Stub toasts at `events.tsx` `handleGuests` and `EventDetail handleGuests`. Approval-required ticket buttons emit *"Approval flow lands Cycle 10 + B4"* toast. (§10) |
| **Runtime** | What happens when buyer hits approval-required ticket today? | `PublicEventPage.tsx:265` shows toast, no checkout proceeds. Clean gate. |
| **Data** | What's persisted client-side? | Zero guest-related state. `useOrderStore` has buyer info reachable for read-only views. |

**No layer contradictions found.** All five layers tell the same story: schema is ready, code is stubbed, no silent data leakage, no in-flight pending-guest state to migrate.

---

## 18 — Investigation manifest (files read, in order)

1. `Mingla_Artifacts/BUSINESS_PRD.md` §5.3 + §5.2 + §6 + §4 (PRD reference)
2. `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md` §8 (D-9c-V3-4 backlog item)
3. PR #59 migration source `supabase/migrations/20260502100000_b1_business_schema_rls.sql` @ ref `836ce108054800aba1573d8bc30684f5728a86ce` (lines 650–740 ticket_types; 1080–1170 tickets + scan_events)
4. `mingla-business/app/event/[id]/index.tsx:269` (handleGuests stub) + `:551–557` (Guests ActionTile)
5. `mingla-business/app/(tabs)/events.tsx` handleGuests stub (verified via grep — ActionTile route)
6. `mingla-business/src/store/draftEventStore.ts:91` + `:235` (TicketStub.approvalRequired + DraftEvent.requireApproval shapes)
7. `mingla-business/src/store/liveEventStore.ts:90` + `:155` (LiveEventEditableFieldKey + LiveEvent.requireApproval)
8. `mingla-business/src/store/orderStore.ts:75–82` (BuyerSnapshot) + `:95–122` (OrderRecord)
9. `mingla-business/src/components/event/PublicEventPage.tsx:265–267` (approval action handler) + `:649` (approvalRequired button gate)
10. `mingla-business/src/components/checkout/CartContext.tsx:52` (CheckoutPaymentMethod union)
11. `mingla-business/app/checkout/[eventId]/` directory (verified no requireApproval usage)
12. `mingla-business/src/store/eventEditLogStore.ts` (entire file — for activity feed integration plan in §8)
13. Confirmed via grep: no existing `useGuestStore` / `guestStore` / `guest_list` references in `mingla-business/src/`

---

## 19 — Confidence statement

**Confidence: HIGH.**

- Schema: read live PR #59 source, not migration files alone. Verified per-feature classification cross-references actual schema columns.
- Code: read every stub callsite, every flag definition, every checkout entry point. No layer contradictions.
- Runtime: traced the buyer-side flow end-to-end on approval-required tickets. Cleanly blocked at toast.
- Data: confirmed no in-flight pending-guest state. Zustand stores have NOT silently leaked partial state.
- Recommendations are defensible — every Q-10-N answer cites the artifact it's based on.

The only remaining ambiguity is the 7 operator-steering questions in §16, all of which are **scope choices** (not unknowns). Operator confirms or tweaks; SPEC follows.

---

## 20 — Cross-references

- Dispatch: [`prompts/FORENSICS_BIZ_CYCLE_10_GUEST_LIST.md`](../prompts/FORENSICS_BIZ_CYCLE_10_GUEST_LIST.md)
- PRD source: `Mingla_Artifacts/BUSINESS_PRD.md` §5.3
- Cycle 9c v3 (closes order-side, opens Cycle 10 backlog): [`reports/IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md`](IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md) §8
- Cycle 9c-2 (activity feed extensions — relevant for J-G4 / J-G5 logging): commit `5e4b04d2`
- ORCH-0704 (edit-log infrastructure used here): [`reports/IMPLEMENTATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_REPORT.md`](IMPLEMENTATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_REPORT.md)
- PR #59: https://github.com/Mingla-LLC/mingla-main/pull/59 — head ref `836ce108054800aba1573d8bc30684f5728a86ce`
- I-19 immutable order financials: `mingla-business/src/store/orderStore.ts` header doc
- I-21 anon-tolerant buyer routes: memory rule `feedback_anon_buyer_routes`
- Memory rule for spec discipline: `feedback_implementor_uses_ui_ux_pro_max` — Cycle 10 SPEC must invoke `/ui-ux-pro-max` pre-flight (multiple new visual surfaces, not derivative of existing rows)
