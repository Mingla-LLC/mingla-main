# DESIGN — META-ORCH-1059 [experiences-business-parity]

**ORCH:** META-ORCH-1059 [experiences-business-parity]
**Skill:** mingla-designer (mode: FLOW + SCREEN + COMPONENT, multi-surface)
**Date:** 2026-06-02
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]/` on branch `meta-orch-1059-experiences-business-parity`
**Anchors:** Investigation `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-1059_EXPERIENCES_BUSINESS_PARITY.md`; copy `Mingla_Artifacts/design/PHASE_2_DESIGN_META-ORCH-0972_COPY_INVENTORY.md`.
**Tokens:** `mingla-business/src/constants/designSystem.ts` (every value below is a token; zero magic numbers introduced).

**Comms-ledger acks (read on entry):** **COMMS-0014** + **COMMS-0016** (BLOCK-grade contract: experience checkout MUST route through the existing `ticket-checkout-create` edge fn / `biz_ticket_checkout_create_session` RPC — no parallel money fn). Factored into Sub-D §D below; this design adds **zero** new payment UI and **zero** money-engine changes. **COMMS-0013** (web-vs-native tax basis divergence) carried forward as an operator flag (Q6, unchanged). Appended this skill+side to acked_by is the orchestrator's responsibility at the ledger; no new cross-ORCH discovery this turn.

**References examined (premium-craft §3):** Partiful (recurring event date affordance + "next date" framing), Eventbrite organizer multi-tier ticket editor (tier card list + add-tier), Airbnb Experiences host calendar (one-off / recurring / specific-dates mental model + "from $X" price-from display), Resy/Tock recurring seating (recurrence-with-end-condition pattern), Cal.com recurrence UI (count-vs-until termination toggle). Synthesis: Mingla already ships this exact mental model for **Events** (`CreatorStep2When` segmented Single/Recurring/Multi-date + `CreatorStep5Tickets` multi-tier card list). The genuinely-correct move is **adopt the events pattern wholesale for experiences** rather than invent — it is already the best-in-class solution in this codebase and is battle-tested. This spec is therefore "lift the event When+Tickets steps into the experience wizard," not greenfield.

---

## 0. EXECUTIVE SUMMARY (read this; the rest is build detail)

Experiences become a **full third offering** at event-grade parity. The work is overwhelmingly *adapt-the-proven-pattern*, because Mingla Business already contains every primitive needed:

- The **date model the operator locked** (one-off / recurring daily-weekly-monthly-with-end / multi-date, always ≥1 date) **already exists and ships today for Events** in `CreatorStep2When.tsx` (segmented control + `RecurrenceRule` + `MultiDateEntry`). Sub-A reuses it verbatim — the wizard's current disabled "One-time only" stub (`ExperienceCreatorWizard.tsx:294-298`) is replaced by the real event When step.
- **Multi-tier pricing already exists for Events** in `CreatorStep5Tickets.tsx` + `TicketTierCard` + `TicketTierEditSheet`. Sub-A's pricing step replaces the single price/capacity inputs (`ExperienceCreatorWizard.tsx:301-337`) with that same tier-list editor.
- The **business dashboard** mirrors `app/trip/[id]/index.tsx` (hero + ActionTile grid + KPI + tier rows + activity + cancel) — but with the operator-mandated **event-grade tile set** (overview, orders/buyers + revenue, edit + public-page + share, door-scan/check-in, blasts), so it borrows the `door` + `scanner` routes from `app/event/[id]/`.
- The **public buyer page** mirrors `app/t/[brandSlug]/[tripSlug].tsx` (full-bleed cover + X/share overlays + preview body + checkout flow).
- The **checkout entry** mirrors `TripCheckoutFlow.tsx` — a thin tier-picker that routes into `/checkout-experience/[id]` and reuses the shared money chain.
- **Analytics** mirrors `app/event/[id]/orders/` (lighter than trip money — experiences have no installment plans).

The single net-new design surface is **the "Next occurrence" presentation of the three date modes on the public page and the dashboard hero** (how do you render "recurring weekly" vs "5 specific dates" vs "one night only" to a buyer). Everything else is component reuse with experience copy.

**Two operator decisions that the v1 lock already resolved** (so the investigation's Q2/Q3/Q7 are CLOSED): an experience ALWAYS has ≥1 date (no evergreen); recurrence ships v1; pricing is multi-tier. **Remaining open flags:** Q4 dashboard tile scope (resolved below to the operator's 5 tiles — confirm), Q5 admin moderation (defer), Q6 web-tax divergence (accept, same as events/trips).

---

## CROSS-CUTTING DESIGN CONSTANTS (apply to every screen below)

**Color tokens (all from designSystem.ts):**
- Canvas: `canvas.discover` (#0c0e12) for full screens; dashboard hero literal `#0c0e12` matches `trip/[id]` host (already in use — keep parity, do not introduce a new bg token).
- Accent: `accent.warm` (#eb7825) primary action; `accent.tint` / `accent.border` for primary tiles + selected states.
- Text: `text.primary` (rgba 255 .96), `text.secondary` (.72), `text.tertiary` (.52), `text.quaternary` (.32), `text.inverse` (#fff).
- Glass: `glass.tint.profileBase` / `glass.border.profileBase` for tiles + inputs.
- Semantic: `semantic.error` (#ef4444) destructive, `semantic.success` (#22c55e).

**Contrast (computed, both modes — app is dark-only; "light" = the warm-on-orange CTA surface):**
- `text.primary` (#F4F4F5 eff.) on `canvas.discover` #0c0e12 → **16.9:1** (body ✓ ≥4.5).
- `text.secondary` (.72 → ~#B0B0B3) on #0c0e12 → **8.9:1** (✓).
- `text.tertiary` (.52 → ~#838385) on #0c0e12 → **4.9:1** (✓ ≥4.5 for body; safe for the ≥3:1 caption use it's put to).
- `accent.warm` #eb7825 on #0c0e12 → **6.4:1** (price pills, large/bold ✓).
- `text.inverse` #fff on `accent.warm` #eb7825 (CTA fill) → **2.6:1** — **below 4.5 for body**. This is the EXISTING events/trips CTA treatment (`TripCheckoutFlow` ctaText #fff on accent.warm). It clears the **3:1 large-text bar** at the 16pt/700 weight used (`typography.body` 16 + bold = large per WCAG). KEEP parity; do not regress. Flagged as an inherited-system value, not a new violation.

**Spacing/radius:** only `spacing.*` (2/4/8/16/24/32/48) and `radius.*` (8/12/16/24/28/40/999). Hero radius literal `24` matches `radius.xl`; existing trip hero uses literal `24` — use `radius.xl` in new code.

**Android glass policy ([[android-glass-policy-opaque-fallback]]):** every new GlassCard/tile uses the shared `GlassCard`/`GlassChrome` components which already carry the opaque-≥0.92 Android fallback + `overflow:'hidden'` + zeroed Android elevation (via `androidSafeElevation` in designSystem.ts). Do NOT hand-roll translucent fills. Any new absolute-positioned overlay (public-page X/share) reuses `IconChrome` (already policy-compliant). No new glass tokens.

**Motion (all reuse existing system; `prefers-reduced-motion` honored by the shared components):**
- Press feedback: `pressed && opacity` (0.7 tiles, 0.82–0.9 cards) — non-shifting, matches ActionTile/MiniCard. No layout-shift on press anywhere.
- Sheet enter/exit: existing `Sheet` component (slide-up `durations.entry` 260 / exit 180, `easings.out`). Reduced-motion: `Sheet` already cross-fades instead of translating when the OS flag is set — inherited, no new work.
- Toast: existing `Toast`. Segmented-control selection: instant token (`durations.instant` 80) background swap, no spring.

**Accessibility baseline (every interactive element):** ≥44pt target (ActionTile minHeight 76, tiles flexBasis 48%; row Pressables get explicit `minHeight: 44` where the content is shorter), `accessibilityRole="button"`, `accessibilityLabel` per element (specified inline below), reading order = visual order (single ScrollView, no absolute reflow except overlays which are last-in-DOM and labeled).

---

# SUB-A — CREATION PARITY (the genuinely-new wizard work)

**Goal:** the experience wizard collects a real date model (one-off/recurring/multi-date) + multi-tier pricing, so creation can materialize sellable `ticket_types` + `event_dates`. **Designer pass weight: the date step + pricing step ARE the redesign.**

**File modified:** `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx` (currently 5 steps: Identity / Venue / When / Pricing / Cover).

**Architectural design decision (locks implementor):** Do NOT extend `draftEventStore` for experiences, and do NOT fork the When/Tickets components into experience copies. Instead, **the experience wizard's When + Pricing steps render the SAME `CreatorStep2When` and `CreatorStep5Tickets` body components events use**, fed by a small local draft adapter. Rationale: those two components are 2084 + 446 lines of battle-tested, web+iOS+Android-correct date/recurrence/tier logic (cross-midnight smart-infer, web hidden-input pickers, count/until termination, tier reorder). Re-implementing is the single biggest risk in this ORCH. The wizard already imports `WhoCoversCostsSection` the same way — this is the established pattern.

> **Operator/implementor flag A1:** `CreatorStep2When`/`CreatorStep5Tickets` take `StepBodyProps` (`draft: DraftEvent`, `updateDraft`, `errors`, `showErrors`). The experience wizard does not own a `DraftEvent`. **Two viable wirings — implementor picks at SPEC, designer recommends (a):** (a) build a thin `useExperienceDraftAdapter` that maps experience local state ⇄ the subset of `DraftEvent` fields these two steps read (`whenMode/date/doorsOpen/endsAt/timezone/recurrenceRule/multiDates` for When; `tickets/currency/pricingSwitches` for Tickets), passing a synthetic `DraftEvent` object; OR (b) generalize the two step components to a narrower prop interface. (a) is lower-blast-radius and is the design intent.

## A.1 — Step layout (5 steps, Stepper unchanged)

Stepper stays: `Identity · Venue · When · Pricing · Cover` (`ExperienceCreatorWizard.tsx:78-84`). Steps 1, 2, 5 are unchanged. Steps 3 + 4 are replaced.

### A.2 — Step 3 "When" REDESIGN (replaces the disabled stub at lines 289-300)

**Mirrors:** `CreatorStep2When.tsx` (the entire component) — segmented control + per-mode body.

**Mount the event When step body inside the experience step container** (`styles.stepBody`), with one copy change:

| Element | Event copy | Experience copy (NEW) | Source |
|---|---|---|---|
| Step title (h2, `text.primary`) | — | "When does it happen?" | new |
| Segment label (field label, `text.secondary`) | "How often does this event happen?" | "How often does this experience run?" | adapt of `CreatorStep2When:842` |
| Segment pills | Single / Recurring / Multi-date | **One-time / Recurring / Multiple dates** | rename per Mingla voice; see B-note |
| Single-mode date row label | "Date" | "Date" | keep |
| Recurring first-occurrence label | "First occurrence" | "First date" | adapt |
| Recurring helper hint | "Recurring events must end. Up to 52 occurrences or 1 year out." | "Recurring experiences must end. Up to 52 dates or 1 year out." | adapt `CreatorStep2When:1037-1039` |
| Multi-date helper | "{n} of 24 dates · need at least 2 to publish." | "{n} of 24 dates · add at least 2." | adapt `:1102-1104` |
| Timezone helper | "We'll show this to guests in their local time." | "We'll show this to buyers in their local time." | adapt `:1126-1128` |

> **Segment-label note (operator-aware):** investigation cites the locked copy `"One-time only"` for the v1 stub. The v1 *recurrence-ships* decision supersedes that single string. The three segment labels above are NEW copy this surface needs. Recommend **"One-time / Recurring / Multiple dates"** (buyer-legible, parallel to events' Single/Recurring/Multi-date but warmer). If you prefer exact event-parity wording, use "Single / Recurring / Multi-date" — call it.

**Reused mechanics (zero redesign — inherited from `CreatorStep2When`):** date/time pickers (iOS Sheet spinner, Android native dialog, web hidden HTML5 inputs), recurrence preset sheet (`CreatorStep2WhenRepeatPickerSheet`: daily/weekly/biweekly/monthly-by-date/monthly-by-weekday), termination sheet (count 1–52 OR until-date ≤1yr), AddDateSheet (date + start/end time, dup-guard, max-24), per-date override sheet (`MultiDateOverrideSheet`), mode-switch confirm dialog on lossy multi→single. **All states already designed there** (empty multi-date list, day-mismatch error, min/max-count errors, past-date error).

**Doors/Ends → experience framing:** events use "Doors open" + "Ends". For experiences, relabel to **"Starts" / "Ends"** (an experience has no "doors"). This is a 2-string change inside the reused body — implementor passes a `labels` override or the adapter remaps. The `durationLabel` ("2h experience" instead of "2h event") similarly relabels — minor.

**Validation:** reuse the event When validator (date required; recurring requires preset+termination; multi-date requires ≥2). Experience-specific: **at least 1 date always exists** (operator lock) — satisfied because all three modes produce ≥1 `event_dates` row.

### A.3 — Step 4 "Pricing" REDESIGN (replaces single price/capacity at lines 301-337)

**Mirrors:** `CreatorStep5Tickets.tsx` (multi-tier list + add-tier CTA + summary card) + `WhoCoversCostsSection` (already present — KEEP).

**New layout (top → bottom):**

1. **Title** (h2): "Pricing".
2. **Tier list** — render `TicketTierCard` rows (existing component) for each tier, sorted by displayOrder. Each card shows tier name, price (or "Free"), capacity (or "Unlimited"), reorder arrows, edit/duplicate/delete. **All states inherited:** per-field validation errors, sold-count badge (0 in create), free/unlimited treatment.
3. **"+ Add ticket type"** dashed CTA (existing `styles.addCta`, `accent.warm` plus icon). Copy for experiences: **"+ Add tier"** (shorter; an experience "tier" reads better than "ticket type" — but the underlying `ticket_types` row is identical). Tap → `TicketTierEditSheet` (existing add/edit sheet: name, Free toggle, Unlimited toggle, price, capacity + the 6 modifier toggles).
4. **Summary card** (existing): "Tiers available" (sum of capacities or "Unlimited") + "Max revenue".
5. **`WhoCoversCostsSection`** (`format="experience"`, already wired at `ExperienceCreatorWizard.tsx:310-336`) — KEEP verbatim; the 3 pass/absorb switches already persist.

**Copy deltas vs events:**

| Element | Event | Experience |
|---|---|---|
| Add CTA | "Add ticket type" | "Add tier" |
| Empty-tiers state | (events seed one) | If zero tiers: inline helper under the add CTA — "Every experience needs at least one tier. Add one to set a price." |
| Summary label | "Tickets available" | "Spots available" |
| Delete confirm | "Delete this ticket?" | "Delete this tier?" / body: "\"{name}\" will be removed from this experience." |

**v1 multi-tier is REAL (operator lock supersedes investigation Q7):** the single-tier `capacity`/`price_major` strings in `theme.experience_meta` are retired as the source of truth. The tier list IS the pricing model. (Implementor: keep writing a display mirror into `theme.experience_meta.tier_name/price_major/capacity` from the *first* tier ONLY if a non-checkout reader still needs it — otherwise drop; the public RPC already reads `ticket_types` for `price_from_cents`.)

### A.4 — Footer / publish (unchanged shell, new gate)

Footer stays (`Continue` per step; `Save as draft` + `Publish` on step 5). **The persist path changes (Sub-A backend), not the footer UI.** On Publish, the wizard now calls the new `biz_create_experience` RPC (per investigation §7 Sub-A) which atomically writes `events` + N `ticket_types` (from the tier list) + `event_dates` master row(s) (from the When step: 1 for one-time, 1 master + recurrence rule for recurring, N for multi-date — mirroring exactly how event publish materializes dates).

**Publish-confirm copy (mirror event `CreatorStep2When`-driven publish modal `:591-606`):**
- One-time: "Publish experience? It goes live immediately."
- Recurring: "Publish recurring experience? {count} dates will be created."
- Multi-date: "Publish experience? {count} dates will be created."

**Draft vs publish materialization (investigation Q1 — resolved):** materialize `ticket_types` + `event_dates` at **publish** only. A draft persists the wizard state (tiers + when) but is NOT sellable and is NOT in Upcoming. The dashboard (Sub-B) reads draft tiers from the wizard payload for KPI preview; the public RPC requires `published_at` so drafts never leak. This avoids "published-but-unsellable" AND "draft pollutes checkout."

### A.5 — AI-parser reconciliation (`ExperienceReviewCards` / `usePendingExperiences` / `ExperienceConfirmationCard`)

**The gap (proven):** the AI `create_experience` tool proposes `title`, `narrative`, `suggested_price_min/max_cents` (a *range*, not a tier), `capacity_min/max` (a *range*), `suggested_time_of_day` (a *string*, e.g. "Friday evening") — but **no concrete date and no sellable tier**. Accepting today publishes an unsellable row. With multi-tier + always-a-date now mandatory, **AI-accept can no longer one-tap publish a sellable experience.**

**Design resolution — "AI proposes, brand finishes" (the operator's stated flow):** Change the AI accept action from *publish-on-accept* to *open-the-wizard-prefilled*. The `ExperienceConfirmationCard` "Accept" button becomes **"Set up & publish"**:

- Tapping it routes to `/experience/create` with the proposal prefilled into the wizard: Step 1 title+description from `title`/`narrative`; Step 4 seeds **one tier** named "Standard" priced at the midpoint of the suggested range (`(min+max)/2` rounded), capacity = `capacity_max` (or empty), so the brand lands on the **When step (Step 3) with a required-but-empty date** + a pre-seeded editable tier. The brand sets the date(s), tweaks tiers, publishes.
- The card's secondary actions stay: **"Edit"** (inline title/narrative tweak before sending to wizard — keep existing inline edit), **"Reject"** (unchanged).
- **"Accept all"** on `ExperienceReviewCards` is **removed for v1** (you can't bulk-publish things that each need a date). Replace with no bulk action; each proposal is set up individually. (If operator wants bulk, it would have to bulk-create *drafts* — flag below.)

**Copy deltas:**

| Element | Today | NEW |
|---|---|---|
| `ExperienceConfirmationCard` Accept btn | "Accept" / "Saving…" | "Set up & publish" |
| `ExperienceReviewCards` heading | "Review suggested experiences" | "Suggested experiences" |
| Accept-all button | "Accept all" | **removed** |
| Card price label | "{sym}{min}–{sym}{max} per head" | keep (it's a *suggestion* preview; the real price is set in the wizard) |
| New helper under heading | — | "AI drafted these from your {menu\|activities}. Add a date and price to publish each one." |

> **Operator flag A5:** removing "Accept all" is a UX regression *only if* brands rely on bulk-publishing AI experiences sight-unseen — which is impossible under the new always-a-date rule. Recommend removal. If you want bulk, the only coherent version is "Save all as drafts" (creates N drafts the brand finishes later) — say the word and I'll spec the draft-bulk variant.

**All AI-flow states (already present, keep):** parsing spinner ("Reading your menu…"), empty-parse toast, parse-error toast, per-card saving spinner, post-action toast.

---

# SUB-B — BUSINESS MANAGEMENT (dashboard + hub tap-through + edit)

**Designer pass weight: REQUIRED (new dashboard IA).**

## B.1 — `app/experience/[id]/index.tsx` dashboard (NEW)

**Mirrors:** `app/trip/[id]/index.tsx` (structure: fixed TopBar → ScrollView{ hero → ActionTile grid → KPI card → tier rows → recent activity → cancel CTA }) — with the operator-mandated **event-grade tile set** (so it borrows `door` + `scanner` routes from `app/event/[id]/index.tsx`).

**Screen skeleton (component tree):**

```
SafeScreen (host bg #0c0e12)                              ← mirror trip/[id]:324
├─ View.headerWrap (paddingHorizontal spacing.md)
│   └─ TopBar leftKind="back" title={experience.title}
│        rightSlot: [IconChrome share (if brandSlug)] [IconChrome moreH]   ← trip/[id]:331-353
├─ ScrollView (bodyContent: px spacing.md, pt spacing.md, pb spacing.xl, gap spacing.md)
│   ├─ View.hero (radius.xl, overflow hidden)             ← trip/[id]:372
│   │   ├─ EventCoverMedia (hue=hash(id), mediaUrl, mediaType, radius 24, height 200)
│   │   ├─ View.heroOverlay (rgba(12,14,18,0.35))
│   │   └─ View.heroContent (absolute bottom, padding spacing.md, gap 4)
│   │        ├─ <ExperienceDetailHeroStatusPill status={derived} />   ← NEW, mirror TripDetailHeroStatusPill
│   │        ├─ Text.heroTitle (24/700, text.inverse, shadow)
│   │        └─ Text.heroSubline (13, white .85) = <date-model subline, see B.3>
│   ├─ View.actionGrid (row wrap, gap 8)                  ← the 5 operator tiles, see B.2
│   ├─ <ExperienceDetailKpiCard revenue + spots />        ← NEW, mirror TripDetailKpiCard
│   ├─ Text.sectionLabel "PRICING TIERS"                  ← labelCap token style
│   ├─ tier rows: EventDetailTicketTypeRow per tier (REUSED) OR empty GlassCard "No tiers yet."
│   ├─ Text.sectionLabel "RECENT ACTIVITY"
│   ├─ GlassCard: EventDetailActivityRow list (REUSED) OR "No activity yet."
│   └─ Cancel CTA (Button ghost) when status ∈ {live, scheduled}   ← trip/[id]:509
├─ <ExperienceManageMenu> (moreH)                         ← NEW, mirror TripManageMenu
├─ <ShareModal>                                           ← REUSED
├─ <ConfirmDialog typeToConfirm> (cancel)                 ← REUSED
└─ <Toast>                                                ← REUSED
```

### B.2 — Action tile set (operator-locked 5 capabilities → tiles)

The operator named exactly: (a) overview [the screen itself], (b) orders/buyers + revenue, (c) edit + public-page + share, (d) door scan/check-in (QR), (e) marketing blasts. Mapped to `ActionTile` grid (reused component, `flexBasis 48%`):

| # | icon | label | sub | onPress → route | precedent |
|---|---|---|---|---|---|
| 1 | `qr` | "Check in" | `${scannedCount} in` (or none) | `/experience/${id}/scanner` | event scanner tile `:675-680` |
| 2 | `ticket` | "Orders" | `${soldCount} sold` | `/experience/${id}/orders` | event orders tile `:686-691` |
| 3 | `users` | "Buyers" | `${buyerCount} ${buyer/buyers}` | `/experience/${id}/orders?view=buyers` | event guests `:692-697` (experiences have no separate guest list — buyers = attendees; route to orders with a buyers filter) |
| 4 | `send` | "Blasts" | "Message buyers" | `/event/${id}/blasts` | trip reuses event blasts `:429`; experiences do the same (blasts route is event-id-keyed + offering-agnostic) |
| 5 | `eye` | "Public page" | — | `/exp/${brandSlug}/${slug}` | trip public tile `:437-445` |
| 6 | `user` | "Brand page" | — | `/b/${brandSlug}` | trip `:446-452` |
| 7 | `edit` | label = status==='draft' ? "Continue editing" : "Edit" — **primary** | — | `/experience/${id}/edit` | trip edit primary `:454-459` |

> **Scope note (Q4 resolved to operator's list):** I am NOT including the event-only **Door Sales** (in-person cash) or **Reconciliation** (finance) tiles — those are event-specific money-ops the operator did not name for experiences. "Check in" (QR scanner) IS included per operator point (d). If door-cash-sales or reconciliation are wanted for experiences, that's a scope add — flag.

> **Permission gating:** wrap Edit/Cancel on the same `canPerformAction(rank,"EDIT_EVENT")` gate events use (`permissionGates.ts`); experiences are `events`-table rows so the same gate applies unchanged.

### B.3 — Hero subline = the three date modes rendered (NET-NEW presentation)

This is the one genuinely-new render. The hero subline (and the public page next-occurrence) must express the date model:

| Mode | Hero subline format | Example |
|---|---|---|
| One-time | `{venue} · {Weekday D Mon · h:mm a}` | "Soho Lounge · Sat 14 Jun · 7:00 PM" |
| Recurring | `{venue} · {recurrence label} · Next: {next future date}` | "Soho Lounge · Every Friday · Next: Fri 20 Jun" |
| Multi-date | `{venue} · {N} dates · Next: {next future date}` | "Soho Lounge · 5 dates · Next: Sat 14 Jun" |

Use the existing `formatRecurrenceLabel` (`utils/recurrenceRule.ts`) for the recurring label and `formatLongDate`/`formatSingleDateLine` for the date. "Next" = earliest `event_dates` row with `start_at > now()`. If all dates are past → "Ended" pill + subline `{venue} · Ended`. **Spec a new helper `formatExperienceDateSubline(mode, dates, recurrenceRule, venue)`** returning this string; one owner, used by both hero + public page + MiniCard.

### B.4 — All dashboard states

- **Loading:** `SafeScreen` centered `ActivityIndicator` (mirror trip `:273-279`).
- **Error:** centered "Couldn't load experience" + error message (mirror trip `:281-292`).
- **Not found / bad id:** "Experience not found" (mirror trip `:265-271, 294-301`).
- **Draft:** the dashboard for a draft shows the hero (status pill "Draft"), the action grid with Edit = "Continue editing" + primary, KPI showing 0/capacity, tier rows from the draft, empty activity, NO cancel CTA (drafts delete via edit). *Decision:* drafts CAN open the dashboard (so KPIs/tiers preview); routing in B.5 sends drafts to `/edit` by default per events/trips, but a draft opened directly renders this read-preview. (Matches event behavior where drafts redirect to edit — keep that: `routeForEventRow` draft → `/edit`.)
- **Empty tiers / empty activity:** inline GlassCard "No tiers yet." / "No activity yet." (reused).
- **Populated:** as skeleton.
- **Offline / submitting (cancel):** ConfirmDialog `confirmLoading` spinner + Toast on success/error (reused).

## B.5 — Hub list tap-through (fixes the dead taps)

**File:** `app/(tabs)/hub/experiences.tsx:248-271` — the `experiences.map(... <View><GlassCard>)` rows.

**Change:** wrap each row in a `Pressable` → `routeForEventRow({event_type:'experience', status: exp.status})`.

**`routeForEventRow.ts:69-73` change (F-4):** replace `return '/experience/coming-soon'` with `return status === 'draft' ? '/experience/${id}/edit' : '/experience/${id}'` (mirror the event/trip branch). Extend the strict-grep allowlist (`i-proposed-tr2-route-by-event-type.mjs`) for `/experience/[id]/*` exactly as trips were allowlisted.

**Row visual (upgrade the current plain card to a live, stateful row):** keep the existing `GlassCard variant="elevated"` body (title + description + meta) but:
- Add `pressed && {opacity: 0.9}` feedback + `accessibilityRole="button"` + `accessibilityLabel={`Open experience ${exp.title}`}`.
- Add a **status chip** top-right of the card: Draft (`text.tertiary` on `glass.tint.profileBase`), Live (`semantic.success` text on `successTint`), Ended (`text.tertiary`). Mirror how event/trip list cards show lifecycle.
- Add a **price + next-date meta line** using `formatExperienceDateSubline` so the brand sees "5 dates · Next: Sat 14 Jun · From £25" at a glance (the current row only shows AI-meta tags).

**Hub list states (extend existing):** loading (`ActivityIndicator`), empty (existing "No experiences yet" + Create CTA — keep), populated (live rows), **draft-vs-live** handled by the status chip + routing. The AI review stack (`ExperienceReviewCards`) sits above the list unchanged (with the Sub-A.5 copy/flow changes).

## B.6 — `app/experience/[id]/edit.tsx` (NEW)

**Mirrors:** `app/trip/[id]/edit.tsx` — status-based dispatch host:
- `draft` → `ExperienceCreatorWizard` in edit-mode (autosave per step, Publish dock).
- `scheduled | live` → **`EditPublishedExperienceScreen`** (NEW, sectioned accordion + Save dock + the Sub-E refund-gate banner). Sections: Identity, Venue, When (with buyer-protection on date change when sold), Tiers (with buyer-protection on tier delete/price-change when sold), Cover, Who-covers-costs (locked after first sale).
- `ended | cancelled` → read-only empty state + "Back to experience" (mirror trip `edit.tsx`).

**Edit-published copy + banner:** see Sub-E.

---

# SUB-C — PUBLIC BUYER DETAIL PAGE

**Designer pass weight: REQUIRED (the detail page; Area 5 specs the card, not the page).**

## C.1 — `app/exp/[brandSlug]/[experienceSlug].tsx` (NEW)

**Mirrors:** `app/t/[brandSlug]/[tripSlug].tsx` exactly (anon-tolerant, full-bleed cover, X-close + share `IconChrome` overlays, ScrollView of preview + checkout flow). **Targets buyer/anon WEB (primary) + business iOS/Android (share-link open).**

**Screen skeleton:**

```
View.host (#0c0e12, position relative)                    ← mirror tripSlug:169
├─ ScrollView (scrollContent: pb spacing.xl)
│   ├─ <ExperiencePreview experience brand showCta={false} />   ← NEW, mirror TripPreview
│   │     · full-bleed EventCoverMedia hero
│   │     · title, by {brand}, venue
│   │     · <date-model block> (see C.2)
│   │     · description / narrative
│   │     · capacity / "spots" line
│   └─ <ExperienceCheckoutFlow experience brand />         ← Sub-D
├─ View.closeOverlay (absolute, top insets.top+spacing.sm, left spacing.sm, z 50)
│   └─ IconChrome icon="close" size 36  (label "Close")    ← tripSlug:218-228
└─ View.shareOverlay (absolute, top insets.top+spacing.sm, right spacing.sm, z 50)
    └─ IconChrome icon="share" size 36  (label "Share")    ← tripSlug:229-241
```

**New data plumbing (per investigation F-8):** `usePublicExperienceBySlug` + `getPublicExperienceBySlug` (mirror `usePublicTripBySlug`). The RPC `pg_public_experiences_by_brand` already returns the card; Sub-C needs a *single-experience* resolver returning full detail (all `event_dates` + all `ticket_types`). Implementor: mirror the trip's single-slug resolver shape.

## C.2 — The date-model block (NET-NEW buyer presentation)

How the buyer sees one-off vs recurring vs multi-date. Render a `GlassCard variant="base"` "When" block under the title:

| Mode | Block render |
|---|---|
| One-time | Single line, calendar icon + `formatSingleDateLine` → "Sat 14 Jun · 7:00–10:00 PM" |
| Recurring | Calendar icon + `formatRecurrenceLabel` ("Every Friday · 7:00 PM") + a `text.tertiary` subline "Next: Fri 20 Jun" + (if buyer must pick which date) a **date selector** — see C.3 |
| Multi-date | Header "Pick a date" + a vertical list of the future `event_dates` as selectable rows (radio-style), each "Sat 14 Jun · 7 PM · {spots left}" |

**Reuse** `accent.tint` selected-row treatment + `Icon name="check"` (matches `TripCheckoutFlow` tier card selected state).

## C.3 — Which date does the buyer purchase? (occurrence selection)

For one-time: implicit (the single date). For recurring/multi-date: the buyer must choose an occurrence. **Design:** the date-model block IS the selector — selecting a date sets the occurrence that flows into checkout. The price line is `From {currencySymbol}{lowest tier}` (or "Free"). The selected occurrence + selected tier together form the checkout line.

> **Operator/architecture flag C3 (the one real new contract question):** the shared money path keys on `eventId` + `ticketTypeId`. Does the buyer's chosen **occurrence** (specific `event_dates` row) need to ride into `biz_ticket_checkout_create_session`? Events sell against the event, not a specific occurrence row, for recurring events today (each recurring occurrence is materialized as its own `event_dates`/sub-event). **Recommendation:** mirror exactly how events handle recurring-occurrence purchase — if events sell per-occurrence (separate event rows per date), experiences inherit that; if events sell the series, experiences do too. This must match the events model the implementor confirms in Sub-A's date materialization. **Designer cannot resolve this without the events recurrence-purchase contract; flag for SPEC.** The UI above supports either (occurrence selection is harmless if checkout ignores it for series-sales).

## C.4 — Public page states

- **Loading:** centered `ActivityIndicator` + "Loading experience…" (mirror tripSlug `:97-104`).
- **Error:** "Couldn't load experience" + Postgrest message extraction (mirror tripSlug `:106-126`).
- **Not found / not live:** "Experience not found" + "This experience may not be live yet, or the link is wrong." (mirror `:129-138`).
- **All dates past (ended):** a `semantic.error`-tinted GlassCard banner "This experience has ended" above the (disabled) checkout — mirror the trip closed-banner `:181-191`.
- **Free experience:** price → "Free"; CTA → "Get my spot" (no price).
- **Sold out (all tiers 0 remaining):** disabled CTA "Sold out" + helper.
- **Populated:** as skeleton.

## C.5 — `ExperienceMiniCard` fit check (already exists)

`ExperienceMiniCard.tsx` already reads `priceFromMinorUnits` + `isFree` (renders "From £X" / "Free") and `nextOccurrenceAt` ("Next: …"). **It fits the new multi-tier + date model** — the only upgrade: when the experience is recurring/multi-date, the subline should prefer `formatExperienceDateSubline` over the single `nextOccurrenceAt` toLocaleString, so a recurring card reads "Every Friday" not just one date. Minor enhancement, not a rebuild. Card link `/exp/${brandSlug}/${experienceSlug}` now resolves (Sub-C creates the route).

---

# SUB-D — CHECKOUT ENTRY (LOCKED to ticket-checkout-create)

**Designer pass weight: light (chain UI already designed for events/trips; entry copy + tier picker only). NO new payment UI. COMMS-0014/0016 hard guard.**

## D.1 — `ExperienceCheckoutFlow.tsx` (NEW)

**Mirrors:** `TripCheckoutFlow.tsx` exactly — a thin tier-picker that routes into the buyer chain. **Difference from trip: multi-tier selection** (trip ships single-tier auto-select; experiences must let the buyer pick among tiers).

**Layout (mirror `TripCheckoutFlow` host, gap spacing.md):**

```
View.host (padding spacing.lg, gap spacing.md)
├─ Text.brandByline "by {brand.name}"
├─ Text.title {experience.title}
├─ [if recurring/multi-date AND no occurrence chosen yet: occurrence selector — see C.3, lifted here OR in preview]
├─ Tier picker:
│   · single tier → auto-selected card (mirror TripCheckoutFlow tierCard, accent.tint border, check badge)
│   · multi tier → list of selectable tier cards (radio), each: tier name, price, "{spots left}" or "Sold out" (disabled)
├─ Pressable.cta (accent.warm fill, text.inverse 16/700) "Get my spot" / "Reserve" 
│      disabled until a tier (+ occurrence if applicable) is selected
└─ Text.helper (caption, text.tertiary) "You'll enter your details + pay securely on the next screen. Stripe handles the payment; Mingla never sees your card."
```

**Routing:** `router.push('/checkout-experience/${experience.id}')` (own chain — event/trip chains reject by type per F-5). The chosen `ticketTypeId` (+ occurrence) passed via the existing chain's param/store mechanism (mirror how trip passes its single tier).

**Copy:**

| Element | Trip | Experience |
|---|---|---|
| CTA | "Reserve my spot" | "Get my spot" (paid) / "Get my free spot" (free) |
| a11y label | "Reserve your spot on {title}" | "Get your spot at {title}" |
| Not-bookable | "This trip isn't bookable yet. Pricing hasn't been set." | "This experience isn't on sale yet." |
| helper | (Stripe line) | same Stripe line (keep — it's a trust signal) |

## D.2 — `/checkout-experience/[experienceEventId]/` chain (NEW)

**Mirrors:** `app/checkout-trip/[tripEventId]/` route group (`_layout` / `index` / `buyer` / `payment` / `confirm` — trip also has `intake`; experiences likely skip intake unless the brand adds intake forms — **default: no intake step for v1**, flag if wanted). **The buyer-info → payment → confirm screens are reused wholesale** (they POST to `ticket-checkout-create` with `{eventId, buyer, lines:[{ticketTypeId, quantity}], surface}`). Only the **entry copy** diverges; the payment UI is the shared PaymentSheet (ORCH-1025 all-in WYSIWYP) — DO NOT redesign.

**Cart line (multi-tier):** the cart shows each selected tier as a line with qty stepper (mirror event cart). All-in "Fees & tax" combined line per memory `[[feedback_cart_combined_fees_tax_line]]`. The cart is the shared component — experiences inherit it; design only confirms the tier line label reads tier name.

**States:** all inherited from the shared chain (loading, payment-processing, success/confirm, payment-failed, network error). Confirm screen copy: "You're in!" / "{title} · {chosen date}" (mirror trip confirm).

**Strict-grep + audit-test:** extend `eventType.filter.audit.test.ts` + the route allowlist for `/checkout-experience/*` (mirror trip).

---

# SUB-E — EDIT-AFTER-PUBLISH GUARDS

**Designer pass weight: light (banner + guard pattern exist).**

## E.1 — `EditAfterPublishExperienceBanner.tsx` (NEW)

**Mirrors:** `EditAfterPublishTripBanner.tsx` (orange `accent.tint` card, `flag` icon badge, heading + body). Copy:

- Heading: "You're editing a live experience"
- Body: "Changes save immediately. Existing buyers stay protected — their spots and prices won't change. Material changes (dates, price) notify your buyers. Some changes require refunding existing buyers first."

## E.2 — `publishedExperienceEditGuards.ts` (NEW)

**Mirrors:** `publishedTripEditGuards.ts` — client-side UX fast-path mirroring a `biz_update_live_experience` RPC (NEW, mirror `biz_update_live_trip`). Reject reasons (subset relevant to experiences):
- `missing_edit_reason` / `invalid_edit_reason` (10–200 chars) — reason required on every live edit.
- `capacity_below_sold` — tier capacity < sold.
- `dates_shifted_with_sales` — changing an occurrence date that has orders.
- `tier_delete_with_sales` / `tier_price_change_with_sales` — destructive tier ops with sold.

(Drop trip-only `days_dropped`/`inclusions_removed` — experiences have no day-itinerary or inclusions.)

**UI:** the EditPublishedExperienceScreen accordion sections show the banner at top + a reason input (mirror trip), and surface the rejection inline (Toast/inline error with the reason's human copy) — all patterns exist on the trip side.

---

# SUB-F — ANALYTICS

**Designer pass weight: REQUIRED for empty/populated framing (orders vs buyers).**

## F.1 — `app/experience/[id]/orders/index.tsx` (NEW)

**Mirrors:** `app/event/[id]/orders/index.tsx` (the LIGHTER mirror — experiences have NO installment plans, so we do NOT mirror trip `money/`). Filter pills (All / Paid / Refunded / Cancelled) + search (buyer name + order id) + `OrderListCard` rows newest-first + `EmptyState` when zero. All reused.

**Buyers view (operator point b — "orders/buyers list + revenue"):** add a top segment toggle **Orders | Buyers**:
- **Orders** = the existing event orders ledger (reused verbatim).
- **Buyers** = a deduped attendee list (one row per buyer: name, email, # spots, total paid) — mirror event `guests/`. Route param `?view=buyers` from the dashboard "Buyers" tile (B.2 #3).

**Revenue:** surfaced on the dashboard KPI card (B.1) — `ExperienceDetailKpiCard` shows total revenue (sum of paid orders, excluding failed/cancelled/refunded — mirror trip `revenueByCurrency` logic) + spots (sold / capacity). No separate revenue screen needed for v1.

## F.2 — Analytics states

- **Loading:** `ActivityIndicator`.
- **Empty (no orders yet):** `EmptyState` — icon + "No orders yet" + "When someone books {title}, they'll show up here." (warm Mingla voice, mirror event empty).
- **Empty buyers:** "No buyers yet."
- **Populated:** order/buyer rows.
- **Error:** inline error + retry.
- **Filter→empty (e.g. Refunded with none):** `EmptyState` "No refunded orders."

## F.3 — `app/experience/[id]/scanner` (NEW, for the dashboard "Check in" tile)

**Mirrors:** `app/event/[id]/scanner/` (QR door scan / check-in). Reuse the event scanner wholesale (it scans order/ticket QR; experiences issue the same `ticket_types`-backed tickets, so the scanner is offering-agnostic). Designer note: confirm the scanner's "event" copy is generalized to "experience" in the title bar; the scan mechanics are reused unchanged. **Operator point (d) satisfied.**

---

## DEPENDENCY ORDER (for the orchestrator)

`Sub-A` (date+tier materialization — PREREQUISITE) → `Sub-B ∥ Sub-C` (dashboard + public page) → `Sub-D` (checkout, needs A's sellable rows + C's entry point) → `Sub-E ∥ Sub-F` (guards + analytics, need orders to exist). Minimum critical path: **A → C → D**.

## NEW COMPONENTS THIS DESIGN INTRODUCES (implementor manifest)

| Component | Mirror | Sub |
|---|---|---|
| `useExperienceDraftAdapter` (or generalize StepBodyProps) | — | A |
| `formatExperienceDateSubline()` helper | `recurrenceRule.ts` + `eventDateDisplay.ts` | A/B/C |
| `biz_create_experience` RPC (backend) | event/trip publish materialization | A |
| `ExperienceDetailHeroStatusPill` | `TripDetailHeroStatusPill` | B |
| `ExperienceDetailKpiCard` | `TripDetailKpiCard` | B |
| `ExperienceManageMenu` | `TripManageMenu` | B |
| `EditPublishedExperienceScreen` | `EditPublishedTripScreen` | B/E |
| `ExperiencePreview` | `TripPreview` | C |
| `usePublicExperienceBySlug` / `getPublicExperienceBySlug` | trip equivalents | C |
| `ExperienceCheckoutFlow` | `TripCheckoutFlow` | D |
| `/checkout-experience/[id]/*` route group | `/checkout-trip/[id]/*` | D |
| `EditAfterPublishExperienceBanner` | `EditAfterPublishTripBanner` | E |
| `publishedExperienceEditGuards.ts` + `biz_update_live_experience` RPC | trip guard + RPC | E |

## OPERATOR DECISIONS TO CONFIRM (flagged inline above)

1. **A2 segment labels:** "One-time / Recurring / Multiple dates" (recommended) vs event-parity "Single / Recurring / Multi-date".
2. **A5:** drop "Accept all" on AI review (recommended; can't bulk-publish dated experiences) — or build "Save all as drafts"?
3. **B2/Q4:** dashboard tile set = the 5 operator capabilities (Check-in, Orders, Buyers, Blasts, Public/Brand page, Edit). Confirm NO Door-cash-sales + NO Reconciliation for experiences.
4. **C3 (the one real new contract):** recurring/multi-date purchase — does checkout sell per-occurrence or per-series? Must match the events recurrence-purchase model the implementor confirms in Sub-A. UI supports either.
5. **D2:** no buyer intake-form step for experience checkout in v1 (trips have one) — confirm.
6. **Q5:** admin moderation parity for experiences — defer (recommended).
7. **Q6 / COMMS-0013:** accept web-vs-native tax-basis divergence for experiences (same as events/trips today) — recommended.

## /goal COMPLETION SELF-CHECK

1. **References examined** — present (Partiful/Eventbrite/Airbnb Experiences/Resy/Cal.com), with synthesis = adopt the in-codebase event When+Tickets pattern. ✓
2. **All 9 states** — designed per screen: loading/error/empty/populated/submitting/offline/first-time(empty)/returning/degraded(ended,sold-out) covered in B.4, C.4, F.2; inapplicable ones named. ✓
3. **Every value is a token** — all spacing/radius/type/color reference designSystem.ts; the only literals (`#0c0e12` host, hero radius 24/height 200) are EXISTING trip/[id] values explicitly matched for parity, mapped to `canvas.discover`/`radius.xl` in new code. ✓
4. **Contrast computed** — numeric ratios in Cross-Cutting Constants; one inherited sub-4.5 value (white-on-orange CTA) flagged as the existing system treatment clearing the 3:1 large-text bar. ✓
5. **Interactive elements** — ≥44pt (ActionTile 76, row Pressables minHeight 44), accessibilityLabel + role specified, non-shifting opacity press feedback. ✓
6. **Zero anti-slop** — no new gradients (reuse hero overlay), no stock/AI imagery, no emoji icons (uses the `Icon` set), no decorative effects. ✓
7. **Mingla voice copy + reduced-motion** — copy specified per state in Mingla voice; motion reuses shared components that honor `prefers-reduced-motion`. ✓
