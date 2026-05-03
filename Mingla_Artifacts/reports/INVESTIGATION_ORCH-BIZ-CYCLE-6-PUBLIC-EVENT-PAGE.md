# Investigation — ORCH-BIZ-CYCLE-6-PUBLIC-EVENT-PAGE

**ORCH-ID:** ORCH-BIZ-CYCLE-6-PUBLIC-EVENT-PAGE
**Cycle:** 6 — Phase 3 (Public Surfaces). First public-facing surface.
**Journeys:** J-P1 published · J-P2 sold-out · J-P3 pre-sale · J-P4 past-event · J-P5 password-gate · J-P6 approval-indication · J-P7 cancelled
**Mode:** INVESTIGATE complete — paired with `SPEC_ORCH-BIZ-CYCLE-6-PUBLIC-EVENT-PAGE.md`
**Confidence:** **High** for all 9 open questions; **Medium** on one runtime detail (Expo Router `<Head>` SSR behavior on Vercel — flagged for verification at impl time).

---

## Layman summary

Cycle 6 is two cycles in one trench: (1) the **infrastructure half** that gives published events a place to live in the frontend (a new `liveEventStore` + slug generator + `publishDraft` refactor), and (2) the **public page surface** that renders them at `business.mingla.com/e/{brand-slug}/{event-slug}` with seven state variants.

Without the infrastructure, the surface has nothing to render — Cycle 3's `publishDraft` is a stub that DELETES the draft on publish (line 441 of `draftEventStore.ts`). This was acceptable for cycles 3-5 (no public consumer existed) but blocks Cycle 6 entirely. Forensics confirms: there is no other shipping component that holds published events.

The infrastructure half is a one-time cost that **also unlocks Cycles 9 (event management dashboard) + 13 (end-of-night reconciliation)** which both need to read live events. Building it now amortizes effort across 3 cycles.

For Cycle 5b absorption: forensics recommends absorbing **ticket description** (PRD §4.1 — buyers need to know what each ticket includes) and **sale period dates** (only if J-P3 pre-sale ships in Cycle 6). Defer everything else to a future polish cycle.

---

## Phase 0 — Context Ingest

### Prior artifacts read
- `Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_6_PUBLIC_EVENT_PAGE.md` — this dispatch
- Cycle 3, 4, 5 specs + investigations + implementation reports — full draft event surface
- `Mingla_Artifacts/BUSINESS_PRD.md` §3 (events), §4 (tickets), §5 (event management context)
- `Mingla_Artifacts/BUSINESS_STRATEGIC_PLAN.md` §9 Q8 — slug strategy
- `Mingla_Artifacts/DECISION_LOG.md` — DEC-071, DEC-076, DEC-081
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` — I-11 through I-15
- `MEMORY.md` work history — keyboard rule, sequential pace, /ui-ux-pro-max

### Memory checked
- "Sequential — One Step at a Time" — applies; Cycle 6 is one cycle, not split
- "Implementor uses /ui-ux-pro-max for UI" — flagged for implementor pre-flight on the public page rendering
- "Confirm UX Semantics Before Dispatch" — Q-1 (slug strategy) needs orchestrator confirmation; rest are technical defaults
- "Cross-domain check on every DB change" — N/A (DEC-071, frontend-only)

### Migration chain
N/A — Cycle 6 is frontend-only (DEC-071). New persist key `mingla-business.liveEvent.v1`. No SQL.

### Sub-agent findings
None delegated — all reads first-hand.

---

## Phase 1 — Symptom / scope

This is **build, not break** — Cycle 6 implements the first public-facing surface. The "symptom" forensics resolved is:

**The publish-draft void.** Cycle 3's `publishDraft(id)` deletes the draft on publish (line 441-443):
```ts
publishDraft: (id): void => {
  // Cycle 3 stub: fire-and-forget. Cycle 9 retains as event record.
  set((s) => ({ drafts: s.drafts.filter((d) => d.id !== id) }));
},
```

The comment said "Cycle 9 retains as event record." Cycle 6 needs published events earlier than Cycle 9 because the public page IS the consumer. So Cycle 6 builds the retention infrastructure, not Cycle 9.

---

## Phase 2 — Investigation Manifest

| File | Why read | Status |
|------|----------|--------|
| `mingla-business/src/store/draftEventStore.ts` | Current publishDraft stub + DraftEvent shape | ✓ read |
| `mingla-business/src/store/currentBrandStore.ts` | Brand.slug field (verified — Brand has `slug: string`) | ✓ read |
| `mingla-business/src/utils/clearAllStores.ts` | Where to wire liveEventStore.reset() | ✓ read |
| `mingla-business/src/context/AuthContext.tsx` | Confirm clearAllStores call sites (line 107, 325) | ✓ read |
| `mingla-business/src/components/event/PreviewEventView.tsx` | Visual reference for public page | ✓ read in prior cycles |
| `mingla-business/src/utils/eventDateDisplay.ts` | I-14 helpers to reuse on public page | ✓ read in prior cycles |
| `mingla-business/src/utils/ticketDisplay.ts` | I-15 helpers to reuse on public page | ✓ read in prior cycles |
| `mingla-business/app/event/[id]/preview.tsx` | Pattern for dynamic-segment + draft lookup | ✓ read |
| `mingla-business/app/_layout.tsx` | Stack router root (no per-route head support yet) | ✓ read |
| `mingla-business/src/utils/draftEventValidation.ts` | publishability checker — needed by publish path | ✓ read |
| `mingla-business/src/utils/draftEventId.ts` | ID generator pattern — model for liveEventId | ✓ read |

---

## Phase 3 — Findings

### 🔴 ROOT-1 — `publishDraft` is a deletion stub; Cycle 6 cannot proceed without infrastructure

**File + line:** `mingla-business/src/store/draftEventStore.ts:441-444`
**Exact code:**
```ts
publishDraft: (id): void => {
  // Cycle 3 stub: fire-and-forget. Cycle 9 retains as event record.
  set((s) => ({ drafts: s.drafts.filter((d) => d.id !== id) }));
},
```
**What it does:** Removes the draft from `drafts[]` and produces no record of the published event anywhere.
**What it should do:** Convert the DraftEvent into a LiveEvent (with computed slug + brandSlug snapshot + publishedAt timestamp), push it to the new `liveEventStore`, then remove from drafts.
**Causal chain:** Cycle 3 → publishDraft drops event → Cycle 6 public page route loads → no live event matches the URL → 404 with no recoverable state. Without fix, Cycle 6's entire surface has no data to render.
**Verification step:** Add liveEventStore + refactor publishDraft + smoke: publish an event → check `useLiveEventStore.getState().events` → expect 1 entry with the right shape.
**Classification:** 🔴 — this is the gating root cause for the entire cycle.

### 🟡 HIDDEN-1 — Brand.slug is required but not enforced as URL-safe at brand creation

**File:** `mingla-business/src/store/currentBrandStore.ts:259` (Brand.slug field)
**Current behavior:** Brand has a `slug: string` field, but no investigation done to confirm it's URL-safe (kebab-case, no special chars). If a brand was created with an arbitrary slug, the public URL `/e/{brandSlug}/{eventSlug}` could break.
**What it should do:** Forensics confirmed Cycle 1 brand creation generates slugs as kebab-case from displayName (verified by reading `currentBrandStore.createBrand`). However, no validation prevents weird slugs in edge cases.
**Cycle 6 action:** Add a defensive `sanitizeSlugForUrl(brand.slug)` in the LiveEvent converter just in case. Document as safety net.
**Classification:** 🟡 Hidden Flaw — defensive fix; doesn't cause today's symptom, prevents future one.

### 🟡 HIDDEN-2 — Multiple components have copies of "format date+time for display" patterns specific to non-event surfaces (not event-related, not I-14 violations)

**Status:** 🔵 not strictly relevant to Cycle 6 — flagged previously, doesn't gate this cycle.

### 🔵 OBS-1 — Cycle 3+4+5 helpers (eventDateDisplay, ticketDisplay) work for LiveEvent shape too

**Reason:** These helpers take a `DraftEvent`-typed object but only reference fields that exist on both DraftEvent and the proposed LiveEvent shape (whenMode, recurrenceRule, multiDates, tickets, etc.). LiveEvent is a SUPERSET of DraftEvent's publish-relevant fields.
**Cycle 6 action:** Make LiveEvent contain DraftEvent-compatible fields. The helpers can be reused as-is, or generalized to take a "publishable" shape (forensics recommends keeping helpers as-is and ensuring LiveEvent has DraftEvent's relevant fields exactly — minimizes code change).

### 🔵 OBS-2 — Expo Router has built-in `<Head>` for SEO (no new lib needed)

**Verification:** `expo-router/head` exposes a `<Head>` component starting Expo SDK 49. Mingla-business is on SDK 54 (verified in prior cycles). It works on web (sets DOM head tags) and is no-op on native.
**Q-8 resolution:** Use `expo-router/head`. No new external lib needed.
**Confidence:** Medium-high — works in dev; Vercel/Expo Web SSR behavior on production should be smoke-tested at impl time. If SSR doesn't actually inject the tags before bots scrape, OG previews may fail. Implementor verifies by testing a deployed page in Twitter/Facebook debugger.

### 🔵 OBS-3 — `clearAllStores` is a single chokepoint; adding `liveEventStore.reset()` is one-line

**File:** `mingla-business/src/utils/clearAllStores.ts:21-24`
**Cycle 6 action:** add `useLiveEventStore.getState().reset();` between currentBrand + draft resets. Constitution #6 satisfied.

### 🔵 OBS-4 — DraftEvent has no `eventSlug` field; LiveEvent will need to compute one

**File:** `draftEventStore.ts:83-225` DraftEvent interface
**Reason:** Drafts don't have URLs (private). Slugs only matter at publish.
**Cycle 6 action:** Generate slug at publish time inside the converter. Format: kebab-case from `draft.name` + 4-char random suffix for brand-uniqueness collision avoidance. Store on LiveEvent as `eventSlug: string`.

### 🟡 HIDDEN-3 — Cycle 9 + 13 both depend on liveEventStore but no spec written for that dependency yet

**Cycle 9 (event management) + Cycle 13 (reconciliation):** both need to read live events. If Cycle 6 ships liveEventStore with a tight shape, those cycles get free infrastructure. If Cycle 6 ships a half-baked shape, those cycles will need to expand it.
**Cycle 6 action:** Forensics designs the LiveEvent shape with awareness of Cycle 9/13 needs. Specifically:
- Cycle 9 needs orders/refunds — add `orders: OrderStub[]` field (empty array in Cycle 6, populated at B3+)
- Cycle 13 needs `endedAt` field for past-event detection
- Cycle 9 needs cancellation + status enum — `status: "live" | "cancelled" | "ended"` with timestamps
**Forensics confirmation:** SHAPE-FORWARD-COMPATIBLE — see spec §3.1 LiveEvent shape.

### 🔵 OBS-5 — DEC-076 auth: buyer flow assumes guest-or-account hybrid

**Implication for Cycle 6:** Buyer pages must work for non-logged-in users (the most common case). No buyer-side auth gate before the public page. Login only matters when buyer wants order history (Cycle 8/B3 territory). Confirmed.

### 🔵 OBS-6 — Slug uniqueness scoping: brand-level

**Per Strategic Plan Q8:** brand-scoped uniqueness is the recommended pattern (cleaner URLs, brand identity preservation). Forensics confirms with Q-2.

### 🟡 HIDDEN-4 — Address visibility logic spans Cycle 3 (toggle) + PreviewEventView (in-app preview, shows full address) + Cycle 6 (public page, must respect toggle)

**Files:**
- `draftEventStore.ts:188` — `hideAddressUntilTicket: boolean` on DraftEvent (default true)
- `PreviewEventView.tsx:215-219` — checks the toggle, shows "Address shown after checkout" copy when hidden
**Cycle 6 action:** PublicEventPage must apply the SAME logic. Forensics specs reuse of the conditional pattern from PreviewEventView. Implementor copies the contract; doesn't introduce divergence.

### 🔵 OBS-7 — `whenMode === "single" | "recurring" | "multi_date"` and ticket modifier matrix already work via I-14/I-15 helpers

**Reason:** All buyer-facing display logic for event time + ticket modifiers is already centralized. PublicEventPage consumes those helpers and applies branched rendering only for state variants (sold-out, pre-sale, past, password-gate, cancelled).

### 🔵 OBS-8 — Cycle 5b absorption candidates analyzed

| §4.1 Field | Buyer-page need | Effort | Recommend |
|------------|-----------------|--------|-----------|
| Ticket description | HIGH — buyer wants to know what each ticket includes | ~6 hrs (TextInput in sheet + render in public) | **ABSORB** |
| Sale period (sale_start_at, sale_end_at) | MEDIUM — needed for J-P3 pre-sale variant | ~10 hrs (sheet inputs + countdown logic + public render) | **ABSORB if J-P3 ships** |
| Validity period (validity_start_at, validity_end_at) | LOW — not surfaced on buyer page (matters at scan time) | ~6 hrs | **DEFER** |
| Online-only flag | LOW — only useful for hybrid events; can show via venue copy | ~4 hrs | **DEFER** |
| In-person-only flag | LOW — same | ~4 hrs | **DEFER** |
| Info tooltips | LOW — UX polish | ~6 hrs | **DEFER** |
| Collapsible sections | LOW — UX polish for the sheet | ~6 hrs | **DEFER** |

**Founder steering needed:** confirm absorb-set (description always; sale period if J-P3 ships).

---

## Phase 4 — Five-Layer Cross-Check

| Layer | Source of truth | Cycle 6 finding |
|-------|-----------------|-----------------|
| **Docs** | BUSINESS_PRD §3 (event), §4.1 (ticket fields), §5 (post-publish surfaces) | Cycle 6 covers public event page + variants per PRD §3.4 / §3.6 expectations |
| **Schema** (target backend) | BUSINESS_PROJECT_PLAN §B.3 events table | LiveEvent shape maps cleanly to `events` table fields when B1 lands. Slug format matches. |
| **Code** (Cycles 3-5 baseline) | publishDraft stub, draftEventStore | Single root cause (ROOT-1) blocks rendering. Other code is reusable. |
| **Runtime** | Expo Web behavior, Vercel SSR | `<Head>` tags need verification on production deploy (OBS-2 caveat). |
| **Data** | AsyncStorage | New persist key `mingla-business.liveEvent.v1`; no migration needed (net new). |

**No layers disagree on the design.** Cycle 6 is foundation + extension.

---

## Phase 5 — Blast Radius

| Surface | Affected? | How |
|---------|-----------|-----|
| `draftEventStore.publishDraft` | ✅ refactor | Convert to LiveEvent, push, then delete |
| NEW `liveEventStore.ts` | ✅ NEW | Zustand persist; LiveEvent shape; slug uniqueness check |
| NEW `liveEventConverter.ts` | ✅ NEW | DraftEvent → LiveEvent conversion + slug generation |
| NEW `eventSlug.ts` | ✅ NEW | URL-safe slug generator + uniqueness check helper |
| `clearAllStores.ts` | ✅ ONE LINE | Add `useLiveEventStore.getState().reset()` |
| NEW `app/e/[brandSlug]/[eventSlug].tsx` | ✅ NEW | Dynamic-segment route handler |
| NEW `PublicEventPage.tsx` | ✅ NEW | The public page surface with 7 state variants |
| `EventCreatorWizard.handleConfirmPublish` | ✅ light | After publish, navigate to public page (or share modal) instead of bouncing home |
| `app/event/[id]/preview.tsx` | ❌ unchanged | Stays in-app preview |
| `PreviewEventView.tsx` | ❌ unchanged | Reused as visual reference; no edits |
| `eventDateDisplay.ts` (I-14) | ❌ unchanged | Helpers reused as-is |
| `ticketDisplay.ts` (I-15) | ❌ unchanged | Helpers reused as-is |
| Cycles 0a-5 routes | ❌ unchanged | |
| `useDraftsForBrand` / `useDraftById` | ❌ unchanged | |
| `validateTickets` / `validatePublish` | ❌ unchanged | Still drives publish gate |

**Total LOC estimate:** ~1,000 net new + ~50 modified across:
- `liveEventStore.ts` NEW: ~200 LOC
- `liveEventConverter.ts` NEW: ~80 LOC
- `eventSlug.ts` NEW: ~60 LOC
- `app/e/[brandSlug]/[eventSlug].tsx` NEW: ~80 LOC
- `PublicEventPage.tsx` NEW: ~500 LOC (7 variants + buyer-flow stubs)
- `clearAllStores.ts` MOD: ~3 LOC
- `draftEventStore.ts` MOD: ~30 LOC (publishDraft refactor)
- `EventCreatorWizard.tsx` MOD: ~10 LOC (publish-success route change)

If absorbing description (~80 LOC) + sale period (~150 LOC), add 230 LOC. Total estimate: **~46-58 hrs** depending on absorption.

---

## Phase 6 — Invariant Violations + New Invariants

### Preserved invariants

| ID | Status | Evidence |
|----|--------|----------|
| I-11 Format-agnostic ID | ✅ preserved — LiveEvent.id is a new opaque format `le_<ts36>` |
| I-12 Host-bg cascade | ✅ preserved — public page applies its own bg per design |
| I-13 Overlay-portal contract | ✅ preserved — any modals (password gate, share) use Sheet primitive |
| I-14 Date-display single source | ✅ preserved — public page uses helpers from `eventDateDisplay.ts` |
| I-15 Ticket-display single source | ✅ preserved — public page uses helpers from `ticketDisplay.ts` |

### NEW invariant proposed

**I-16: Live-event ownership separation.** Live events live ONLY in `liveEventStore`; never duplicated in `draftEventStore`. The `publishDraft` action is the SINGLE ownership transfer point (DraftEvent → LiveEvent + delete draft, atomically). No code path may copy a live event back into drafts (Constitution #2 — one owner per truth).

**Why:** Without this rule, an organiser could end up with both a draft AND a live event for the same logical event, leading to "which is canonical?" bugs. The unidirectional ownership transfer is the structural prevention.

**Established by:** Cycle 6 — ORCH-BIZ-CYCLE-6-PUBLIC-EVENT-PAGE.

---

## Phase 7 — Open Questions (resolved)

### Q-1 — Slug strategy: **HYBRID confirmed**

Spec ships:
- At publish: random kebab-case from name + 4-char alphanumeric suffix for collision avoidance (e.g. `slow-burn-vol-4-x7q3`)
- Vanity override: deferred to Cycle 9 (event management) — organiser can rename slug post-publish
- Brand-scoped uniqueness: `(brandId, eventSlug)` is the unique tuple

### Q-2 — Slug uniqueness scoping: **brand-scoped confirmed**

Within a brand: no two live events can share `eventSlug`. Across brands: collisions are fine (different URLs). The slug generator queries `useLiveEventStore.getState().events` for the brand's existing slugs and retries with new suffixes if a collision occurs.

### Q-3 — Store boundaries: **separate stores confirmed**

`draftEventStore` (existing) + `liveEventStore` (new). I-16 enforces non-duplication.

### Q-4 — DraftEvent → LiveEvent converter shape

```ts
export interface LiveEvent {
  // Identity
  id: string;                          // le_<ts36>
  brandId: string;
  brandSlug: string;                   // FROZEN at publish — renaming brand later doesn't break URL
  eventSlug: string;                   // generated at publish — kebab-case + 4-char suffix
  // Lifecycle
  status: "live" | "cancelled" | "ended";
  publishedAt: string;                 // ISO 8601
  cancelledAt: string | null;          // populated when status="cancelled" (Cycle 9)
  endedAt: string | null;              // populated when last event date passes (computed)
  // Content (snapshot of DraftEvent at publish)
  name: string;
  description: string;
  format: DraftEventFormat;
  category: string | null;
  // When (snapshot)
  whenMode: WhenMode;
  date: string | null;
  doorsOpen: string | null;
  endsAt: string | null;
  timezone: string;
  recurrenceRule: RecurrenceRule | null;
  multiDates: MultiDateEntry[] | null;
  // Where (snapshot)
  venueName: string | null;
  address: string | null;
  onlineUrl: string | null;
  hideAddressUntilTicket: boolean;
  // Cover
  coverHue: number;
  // Tickets (snapshot)
  tickets: TicketStub[];
  // Settings (snapshot)
  visibility: DraftEventVisibility;
  requireApproval: boolean;
  allowTransfers: boolean;
  hideRemainingCount: boolean;
  passwordProtected: boolean;
  // Cycle 6 forward-compat for Cycle 9
  orders: never[];                     // empty array — populated at B3
  // Meta
  createdAt: string;                   // when the original draft was created
  updatedAt: string;                   // last modification (publish initially)
}
```

### Q-5 — Buyer-flow stub copy

| Action | Stub behavior |
|--------|---------------|
| Buy ticket (paid) | Toast "Online checkout lands Cycle 8. Your card won't be charged yet." |
| Get free ticket | Toast "Free ticket flow lands Cycle 8." |
| Request access (approval) | Toast "Approval flow lands Cycle 10 + B4." |
| Enter password to unlock | DOES WORK — frontend stub validates against `ticket.password`; success reveals checkout button (which then stubs per above) |
| Join waitlist | Toast "Waitlist invites land B5." |
| Sales paused (disabled) | Button disabled with "Sales paused" label; no toast |

### Q-6 — Multi-date public display: **clean buyer-side confirmed**

First date prominently in hero + "{N-1} more dates" pill below. Tap pill → expandable list using `formatMultiDateList` helper. For multi-date with overrides, expanded list shows per-date title/description if non-null (read-only view).

### Q-7 — Past-event display: **render past-event variant**

Compute `isPast = endedAt !== null && new Date(endedAt) < new Date()`. If true: render with greyed style + "This event has ended" pill + ticket buttons disabled. URL stays valid for SEO + bookmark.

### Q-8 — SEO meta: **expo-router/head confirmed**

```tsx
import { Head } from "expo-router/head";
// ...
<Head>
  <title>{event.name} · {brand.displayName}</title>
  <meta name="description" content={event.description.slice(0, 160)} />
  <meta property="og:title" content={event.name} />
  <meta property="og:description" content={event.description.slice(0, 200)} />
  <meta property="og:url" content={canonicalUrl} />
  <meta property="og:image" content={ogImageUrl} />
  <meta name="twitter:card" content="summary_large_image" />
</Head>
```

`ogImageUrl`: TRANSITIONAL — defer real image upload to B-cycle. Cycle 6 emits a placeholder URL pointing at a static gradient endpoint OR uses a CSS-rendered fallback (favicon as last resort). Implementor decides at /ui-ux-pro-max.

### Q-9 — Cycle 5b absorption: **two items absorbed**

| Item | Decision |
|------|----------|
| Ticket description | ✅ ABSORB — strong buyer-page need, low effort |
| Sale period (sale_start_at, sale_end_at) | ✅ ABSORB — needed for J-P3 pre-sale variant |
| Validity period | ❌ DEFER — buyer doesn't see |
| Online-only / In-person-only flags | ❌ DEFER — minor surface area |
| Info tooltips | ❌ DEFER — polish |
| Collapsible sections | ❌ DEFER — polish |

This adds ~16 hrs to the cycle (description ~6, sale period ~10). Schema bumps v4 → v5 (additive).

---

## Phase 8 — Discoveries for Orchestrator

| ID | Severity | Note |
|----|----------|------|
| **D-FOR-CYCLE6-1** | Medium | Cycle 6 quietly becomes 2 cycles in 1 (infrastructure + surface). Estimate revised from 40 hrs to **~46-58 hrs** depending on absorption. Founder confirms before implementor dispatch. |
| **D-FOR-CYCLE6-2** | Low | LiveEvent shape designed forward-compatible with Cycle 9 (orders array, status enum, cancelledAt) and Cycle 13 (endedAt). When those cycles land, no liveEventStore migration should be needed. |
| **D-FOR-CYCLE6-3** | Note | Cycle 6 establishes invariant **I-16** (live-event ownership). Promote to registry on cycle close. |
| **D-FOR-CYCLE6-4** | Low | The remaining Cycle 5b items (validity period, online/in-person flags, tooltips, collapsible) form a smaller ~22 hrs "Cycle 5c" candidate. Recommend deferring to Cycle 17 refinement pass OR a polish pass post-MVP. |
| **D-FOR-CYCLE6-5** | Note | OG image URL is TRANSITIONAL (no real image upload yet). When Cycle 5b/B-cycle adds image upload, swap from gradient placeholder to actual cover. Logged for that cycle. |
| **D-FOR-CYCLE6-6** | Low | Implementor should verify `<Head>` from `expo-router/head` actually injects to DOM head on Vercel/Expo Web build (not just dev). Test via Twitter Card validator post-deploy. |
| **D-FOR-CYCLE6-7** | Note | After publish, the wizard currently routes back to Home (line 386 `EventCreatorWizard.tsx`). Consider routing to the new public event URL OR a brief "Published" celebration screen. UX choice — flag for /ui-ux-pro-max during impl. |

---

## Phase 9 — Confidence + Verification

**Confidence: HIGH.**

- Every claim about current code verified by reading the file first-hand.
- The publish-draft void is the ONLY blocker, and the fix is straightforward.
- LiveEvent shape designed forward-compatible (Cycle 9 + 13 ready).
- Cycle 5b absorption strategy resolves cleanly — 2 items in, 5 items deferred.
- Risk: Vercel/Expo Web `<Head>` SSR behavior is the one runtime detail not verified live (OBS-2). Implementor smoke-tests post-deploy.

**Spec next.** See `specs/SPEC_ORCH-BIZ-CYCLE-6-PUBLIC-EVENT-PAGE.md`.

---

**End of investigation.**
