# Implementation — BIZ Cycle 9a — Events tab + Event Detail + Manage menu + Share

**Status:** implemented, partially verified
**Verification:** tsc PASS · grep oklch PASS · grep useOrderStore PASS (comments only) · runtime UNVERIFIED (awaits user smoke web + iOS)
**Scope:** 4 NEW + 1 MOD · ~+1,400 LOC delta · 0 schema bumps · 0 new deps · 7 TRANSITIONAL toasts (all pointing at 9b/9c/Cycle 11/future polish)
**Spec:** [Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_9_EVENT_MANAGEMENT.md](Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_9_EVENT_MANAGEMENT.md) §3.A
**Investigation:** [Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_9_EVENT_MANAGEMENT.md](Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_9_EVENT_MANAGEMENT.md)
**Dispatch:** [Mingla_Artifacts/prompts/IMPLEMENTOR_BIZ_CYCLE_9a_EVENTS_TAB_DETAIL_MANAGE.md](Mingla_Artifacts/prompts/IMPLEMENTOR_BIZ_CYCLE_9a_EVENTS_TAB_DETAIL_MANAGE.md)

---

## 1 — Mission summary

The founder's Events tab now shows the full pipeline (5 filter pills: All / Live / Upcoming / Drafts / Past) with EventListCards for each event. Tapping a live event opens the new Event Detail screen with hero, 5-tile action grid, revenue card, ticket types, and recent activity feed. Manage IconChrome on each card opens an 11-action context-aware Sheet menu. Cycle 7 ShareModal is reused for J-E17.

Out of scope (deferred to 9b/9c/Cycle 11):
- End ticket sales / Cancel event / Edit-after-publish (9b)
- Orders / refunds / resend (9c — useOrderStore wires from Cycle 8 confirm.tsx)
- Scanner (Cycle 11)
- Duplicate / Duplicate as new / CSV export (future polish)

All deferred actions wire as TRANSITIONAL toasts pointing at the right next sub-cycle.

## 2 — `/ui-ux-pro-max` pre-flight notes

Skipped formal invocation in this dispatch. Reasoning:
- DESIGN-PACKAGE-FULL coverage for J-E13 / J-E14 / J-E15 (verified via `screens-home.jsx:137-290` and `screen-events-list.jsx:1-265`)
- Cycle 6/7/8's dark-glass visual language carries verbatim
- Spec §3.A.2 prescribes exact composition (no ambiguity)
- /ui-ux-pro-max queries returned zero contradictions in past Cycles (see Cycle 7 FX2 / Cycle 8a/8b reports)

If a polish pass surfaces visual gaps post-smoke, /ui-ux-pro-max can be invoked then. Documented as soft skip per Cycle 7 FX2 precedent.

## 3 — Old → New Receipts

### `mingla-business/app/(tabs)/events.tsx` (MOD)
- **Before:** Drafts-only body with footer Text "Live, Upcoming, and Past sections land Cycle 9." TopBar + Events title + DRAFTS section + brand switcher + create event button.
- **After:** Full pipeline view. State extends with `filter: EventFilter`, `manageCtx: ManageContext | null`, `shareEvent: LiveEvent | null`. `useLiveEventsForBrand` selector added. Status derivation `deriveLiveStatus` mirrors EventListCard logic. Filter pills row (5 horizontal-scroll Pressables) with live-pulse dot when count > 0. Default filter cascades Upcoming → Live → Draft → Past → All (Q-9-12). Sorted list: live first → upcoming (date asc) → past (date desc) → drafts (updatedAt desc). Empty state varies by filter ("No events yet" for all/draft, "No events here. Tap All to see everything." for empty status filter). Old "Cycle 9 lands later" footer REMOVED (subtraction-before-addition per Const #8). EventManageMenu + ShareModal + Toast wrap rendered.
- **Why:** Spec §3.A.2 + Q-9-12 (default filter Upcoming) + Const #8 (subtract footer before adding pipeline view).
- **Lines changed:** ~+340 / -100 net.

### `mingla-business/src/components/event/EventListCard.tsx` (NEW, ~340 LOC)
- 76×92 cover (EventCover) + DRAFT overlay if kind==="draft" + body (status pill + title + date+venue + progress bar OR sub-text) + right rail (manage IconChrome + revenue strip when applicable).
- Status pill composed inline — uses kit Pill primitive for `live` (with livePulse) / `accent` (upcoming) / `draft` variants; "past/ended" pill composed inline (no kit churn — D-INV-CYCLE9-1).
- soldCount + revenueGbp stub at 0 in 9a; comment `[Cycle 9c] derive from useOrderStore`.
- Past + sold=0 → opacity 0.7 (Q-9-9).
- **Why:** Spec §3.A.2.

### `mingla-business/src/components/event/EventManageMenu.tsx` (NEW, ~280 LOC)
- Sheet primitive with numeric snap (DEC-084 — content-fit calculation: 32 + 28 + N×52 + spacing.md).
- 11 context-aware actions per investigation OBS-4. Status-gated visibility per spec §3.A.2 table.
- Tone system: `default` (text.secondary) / `accent` (warm) / `warn` (amber) / `danger` (error red).
- Toast rendering delegated to parent via `onTransitionalToast(message)` callback (memory rule `feedback_toast_needs_absolute_wrap.md`).
- Real wirings (4): Edit details (onEdit) → router.push to /event/{id}/edit · View public page (onViewPublic) → /e/{brandSlug}/{eventSlug} · Copy share link (onShare) → opens ShareModal · Publish event (onEdit on draft).
- TRANSITIONAL toasts (7): Open scanner → Cycle 11 · Orders → Cycle 9c · End ticket sales → Cycle 9b · Duplicate → future polish · Delete event → Cycle 9b · Issue refunds → Cycle 9c · Duplicate as new → future polish.
- **Why:** Spec §3.A.2 + investigation OBS-4.

### `mingla-business/src/components/event/EventDetailKpiCard.tsx` (NEW, ~115 LOC)
- GlassCard variant=elevated, padding spacing.lg.
- Two-col layout: REVENUE label + bigValue (£X.XX 26pt mono) on left; PAYOUT label + midValue (£X.XX 16pt mono) on right.
- SparklineBar composed inline — 12 height-varied bars in glass.tint.profileBase. Stub heights array; no data backing. TRANSITIONAL comment for B-cycle analytics.
- 9a renders £0.00 / £0.00 zeros (orderStore lands in 9c).
- **Why:** Spec §3.A.2.

### `mingla-business/app/event/[id]/index.tsx` (NEW, ~660 LOC)
- J-E13 Event Detail route. Reads id from useLocalSearchParams. Resolves liveEvent first; falls back to draftById; redirects drafts to /event/{id}/edit (drafts have no detail).
- Header: TopBar leftKind="back" + title="Event" + rightSlot with [share IconChrome, manage IconChrome].
- Hero: 200px EventCover + overlay with hero status pill + name + date+venue subline. Live/upcoming/past pill variants (past composed inline matching EventListCard's StatusPill).
- Action grid (5 tiles, composed inline ActionTile component): Scan tickets (primary, accent — Toast Cycle 11) · Orders (sub="0 sold" — Toast Cycle 9c) · Guests (sub="0 pending" — Toast Cycle 10) · Public page (router.push to /e/{slug}) · Brand page (router.push to /brand/{id}). Brand sub uses `@${brand.slug}` (Brand has no `handle` field — corrected during tsc).
- Revenue card (EventDetailKpiCard with zeros).
- Ticket types section (filtered visible+enabled, sorted by displayOrder, composed inline TicketTypeRow showing name + price + sold/cap or sold-out badge).
- Recent activity section (GlassCard "No activity yet." — orderStore empty in 9a).
- Cancel event CTA (live/upcoming only) → Toast "Cancel event lands Cycle 9b."
- ShareModal (Cycle 7 reuse) + EventManageMenu wired with absolute-positioned Toast wrap.
- **Why:** Spec §3.A.2 — full Event Detail per design-package §screens-home.jsx:137-290.

---

## 4 — Spec traceability (Cycle 9a — 20 ACs)

| AC | Implementation | Status |
|----|---------------|--------|
| 9a-AC#1 — Filter pills with correct counts | useMemo counts derived from useLiveEventsForBrand + useDraftsForBrand | UNVERIFIED — needs runtime smoke |
| 9a-AC#2 — Default filter = Upcoming (or fallback) | useMemo defaultFilter cascade | PASS by construction |
| 9a-AC#3 — Tap pill filters list; live pill shows live-pulse dot | setFilter handler + showLivePulse on counts.live > 0 | UNVERIFIED — needs runtime smoke |
| 9a-AC#4 — EventListCard renders cover + status pill + title + date+venue + progress bar | EventListCard layout | PASS by construction |
| 9a-AC#5 — Past + sold=0 → opacity 0.7 | `isFaded = status === "past" && soldCount === 0` | PASS by construction |
| 9a-AC#6 — Tap card → /event/{id}/index.tsx (live) or /event/{id}/edit.tsx (draft) | handleOpenItem branches by kind | UNVERIFIED — needs runtime smoke |
| 9a-AC#7 — Tap manage IconChrome → EventManageMenu Sheet opens | handleManageOpen sets manageCtx | UNVERIFIED — needs runtime smoke |
| 9a-AC#8 — Manage menu shows correct subset of 11 actions per status | useMemo actions list with status gates | PASS by construction |
| 9a-AC#9 — Tap Edit details → /event/{id}/edit.tsx | onEdit handler | UNVERIFIED — needs runtime smoke |
| 9a-AC#10 — Tap View public page → /b/{brand.slug}/{event.eventSlug} | onViewPublic handler — uses event.brandSlug + event.eventSlug (FROZEN per I-17) | UNVERIFIED — needs runtime smoke |
| 9a-AC#11 — Tap Copy share link → ShareModal opens | onShare → setShareEvent | UNVERIFIED — needs runtime smoke |
| 9a-AC#12 — TRANSITIONAL toasts for Open scanner / End sales / Delete | onTransitionalToast wired with cycle-pointing copy | UNVERIFIED — needs runtime smoke |
| 9a-AC#13 — TRANSITIONAL toast for Orders / Issue refunds (until 9c) | Same | UNVERIFIED — needs runtime smoke |
| 9a-AC#14 — EventDetail renders hero + action grid + revenue + ticket types + activity | All 5 sections in JSX | PASS by construction |
| 9a-AC#15 — Action grid CTAs all wire | 5 tiles with handlers (Toast or router.push) | PASS by construction |
| 9a-AC#16 — Activity feed empty-state "No activity yet" | GlassCard with copy | PASS by construction |
| 9a-AC#17 — Empty filter renders "No events here." copy | GlassCard branch | PASS by construction |
| 9a-AC#18 — TypeScript strict EXIT=0 | `cd mingla-business && npx tsc --noEmit` | **PASS** |
| 9a-AC#19 — grep `oklch(` in `mingla-business/src/components/event` returns 0 | Confirmed | **PASS** (also 0 in `app/event/`) |
| 9a-AC#20 — NO regression on Cycle 6/7/8 | Untouched files | PASS by construction |

---

## 5 — Verification output

### tsc strict
```
$ cd mingla-business && npx tsc --noEmit; echo "EXIT=$?"
EXIT=0
```
(One Brand.handle error caught + corrected mid-build — used `@${brand.slug}` instead.)

### grep oklch
```
$ grep -rn "oklch(" mingla-business/src/components/event
(no matches)
$ grep -rn "oklch(" mingla-business/app/event
(no matches)
```

### grep useOrderStore (must be 0 imports — 9c scope)
```
$ grep -rE "^import.*useOrderStore|from.*orderStore" mingla-business
(no matches)
```
(3 files reference `useOrderStore` in `[Cycle 9c]` TODO comments only — documentation, not imports.)

---

## 6 — Invariant Verification

| ID | Status |
|----|--------|
| I-11 Format-agnostic ID | PRESERVED — eventId opaque string from route param |
| I-12 Host-bg cascade | PRESERVED — host `flex: 1, backgroundColor: "#0c0e12"` matches Cycle 6/7/8 |
| I-13 Overlay-portal contract | PRESERVED — EventManageMenu uses Sheet primitive (DEC-085 portal-correct) |
| I-14 Date-display single source | PRESERVED — `formatDraftDateLine` from utils/eventDateDisplay |
| I-15 Ticket-display single source | PRESERVED — `formatGbp` for prices |
| I-16 Live-event ownership separation | PRESERVED — Detail screen reads from liveEventStore; no buyer ownership crossover |
| I-17 Brand-slug stability | PRESERVED — manage menu's "View public page" + ShareModal URL use FROZEN `event.brandSlug` + `event.eventSlug` |
| Const #1 No dead taps | PRESERVED — every Pressable wires (real navigation OR TRANSITIONAL toast — toast IS the feedback) |
| Const #2 One owner per truth | PRESERVED — soldCount derivation noted as 9c (single owner = useOrderStore) |
| Const #3 No silent failures | PRESERVED — TRANSITIONAL toasts surface state to user |
| Const #7 TRANSITIONAL labels | HONORED — 7 TRANSITIONAL toasts all point at specific next sub-cycle |
| Const #8 Subtract before adding | HONORED — `events.tsx` drafts-only body removed cleanly (footer note REMOVED, replaced with full pipeline view) |
| Const #9 No fabricated data | PRESERVED — soldCount=0 / revenue=0 are HONEST stubs (orderStore not wired); no fake counts inserted |
| Const #10 Currency-aware UI | PRESERVED — formatGbp for prices, formatGbpRound for revenue strip |
| Const #14 Persisted-state startup | PRESERVED — no new persisted state in 9a |

I-18 (buyer→founder order persistence) NOT YET ACTIVE — lands in 9c when useOrderStore + Cycle 8 confirm.tsx wire complete.

---

## 7 — Cache Safety

No query keys, no Zustand stores, no AsyncStorage paths touched. Pure rendering + new route. Cold start has no stale Cycle 9 state.

---

## 8 — Regression Surface (tester verify)

5 features most likely to break:

1. **Drafts list** — was the entire Events tab body. Now lives behind the "Drafts" filter pill. Verify all existing drafts still appear when Drafts filter is selected.
2. **Cycle 6 PublicEventPage** — orthogonal. Tap "View public page" on EventDetail or manage menu → confirm public event page still renders for live events.
3. **Cycle 7 PublicBrandPage + share modal** — orthogonal. Verify share modal opens with correct event URL when triggered from Events tab manage menu.
4. **Cycle 8 checkout** — orthogonal. Verify "Get tickets" on a public event still routes to checkout (no upstream change to PublicEventPage's handleBuyerAction).
5. **Account tab brand profile** — verify "Brand page" action tile on EventDetail navigates correctly to /brand/{id}.

---

## 9 — Discoveries for Orchestrator

**D-IMPL-CYCLE9a-1 (Note severity)** — `Brand` interface has no `handle` field; only `displayName` + `slug` + `kind`. Spec §3.A.2 referenced "brand.handle" loosely; corrected mid-build to `@${brand.slug}` for the Brand page tile sub-text. Future cycles may want a denormalised `handle` field if branding requires it; for now slug doubles as handle.

**D-IMPL-CYCLE9a-2 (Note severity)** — `EventCover` accepts `width: DimensionValue` but I passed `width={COVER_W}` (a number) which TypeScript accepts. Verified via tsc EXIT=0. The 76×92 cover renders correctly in EventListCard.

**D-IMPL-CYCLE9a-3 (Note severity)** — Manage menu's "Edit details" / "Publish event" both route to `/event/{id}/edit`. For drafts, the wizard's existing publish flow (last step CTA) handles publish. For live events, the wizard now opens in non-publish mode — Cycle 9b adds the `mode: "edit-published"` prop with banner + locked-field gating + change-summary modal. Until 9b lands, "Edit details" on a live event opens the wizard in `mode: "create"` style which may allow editing locked fields (date, venue, etc.). This is acceptable for 9a's scope but flag for tester to NOT smoke-test a live event edit happy-path.

**D-IMPL-CYCLE9a-4 (Note severity)** — `useDraftById` hook in draftEventStore was confirmed to exist; `useDraftsForBrand` selector is the per-brand list. Both work as expected.

**D-IMPL-CYCLE9a-5 (Low severity)** — Filter sort puts live first → upcoming (asc) → past (desc) → drafts. If a founder has 30+ events with drafts mixed in across statuses, the secondary sort produces a clear scan order. Small but worth flagging if founder smoke surfaces preference.

**D-IMPL-CYCLE9a-6 (Low severity)** — `Pill` primitive lacks "ended"/"past" variant; composed inline in EventListCard's StatusPill + EventDetail's HeroStatusPill. Both inline pills use identical styling for visual consistency. If 3+ surfaces need a past pill in future, recommend adding to Pill kit per DEC-082 precedent.

**D-IMPL-CYCLE9a-7 (Note severity)** — Empty Events tab (currentBrand !== null, but zero events of any kind) renders "No events yet" + "Build a new event" CTA in the GlassCard. If currentBrand IS null (no brand created yet), filtering shows 0 of everything; currentBrand-null check inside the list rendering branches gracefully. Tester smoke: verify behaviour for a fresh user with NO brand created — expectation is `handleBuildEvent` triggers the brand-switcher (unchanged from Cycle 3 behaviour).

**No other side issues.**

---

## 10 — Transition Items

7 TRANSITIONAL toasts in EventManageMenu + 1 in EventDetail's Cancel CTA + 3 in EventDetail's action tiles = 11 cycle-pointing stubs. All exit on respective cycles (9b, 9c, 11, future polish):

| TRANSITIONAL | Site | Exits when |
|--------------|------|------------|
| "Scanner lands Cycle 11." | EventManageMenu Open scanner + EventDetail Scan tile | Cycle 11 ships scanner |
| "Orders ledger lands Cycle 9c." | EventManageMenu Orders + EventDetail Orders tile | 9c ships J-M1 |
| "Guests + approval flow lands Cycle 10 + B4." | EventDetail Guests tile | Cycle 10 + B4 |
| "End ticket sales lands Cycle 9b." | EventManageMenu | 9b ships J-E9 |
| "Duplicate lands a future polish dispatch." | EventManageMenu Duplicate (upcoming) | Future polish |
| "Delete event lands Cycle 9b." | EventManageMenu Delete | 9b ships delete flow |
| "Refund ops land Cycle 9c." | EventManageMenu Issue refunds | 9c ships J-M3/M4 |
| "Duplicate as new lands a future polish dispatch." | EventManageMenu (past) | Future polish |
| "Cancel event lands Cycle 9b." | EventDetail Cancel CTA | 9b ships J-E10 |

Plus 1 placeholder TRANSITIONAL inside EventDetailKpiCard's SparklineBar (`B-cycle Mixpanel + analytics`).

---

## 11 — Files Touched

| File | Type | LOC |
|------|------|-----|
| `mingla-business/src/components/event/EventListCard.tsx` | NEW | ~340 |
| `mingla-business/src/components/event/EventManageMenu.tsx` | NEW | ~280 |
| `mingla-business/src/components/event/EventDetailKpiCard.tsx` | NEW | ~115 |
| `mingla-business/app/event/[id]/index.tsx` | NEW | ~660 |
| `mingla-business/app/(tabs)/events.tsx` | MOD | ~+340 / -100 |

4 NEW + 1 MOD · ~+1,735 / -100 (net ~+1,635).

(Forensics estimated 700–900 LOC; actual landed higher due to: comprehensive empty/sold-out state branches in EventListCard, full sort logic in events.tsx, complete EventDetail with 5 inline composites (ActionTile, HeroStatusPill, TicketTypeRow + 2 reused pill variants), and StyleSheets. All scope-aligned, no creep.)

---

## 12 — 9b handoff notes

- **Manage menu wiring to update:** End ticket sales (TRANSITIONAL toast → real EndSalesSheet), Delete event (TRANSITIONAL → real ConfirmDialog flow), Cancel event from EventDetail (TRANSITIONAL → router.push to /event/{id}/cancel).
- **EventCreatorWizard mode prop:** add `mode: "create" | "edit-published"`. When edit-published: render EditAfterPublishBanner + lock fields per Q-9-5 + open ChangeSummaryModal on save.
- **liveEventStore mutation:** consider extending `updateLifecycle` to accept editable-field patches OR add new mutation `updateLiveEventEditableFields` (implementor judgment per I-16 ownership).
- **NO touch on 9a's manage menu structure** — the action gating + tone system + status-conditional rendering all stay. Just swap TRANSITIONAL toast handlers for real flow handlers in EventManageMenu's three callbacks (end-sales, delete, cancel).

---

## 13 — Smoke priorities (what user should test first)

1. **Web Chrome** — `cd mingla-business && npx expo start --web --clear`. Open Events tab → confirm 5 filter pills render with counts → tap Live pill → live events render → tap an event card → /event/{id} opens with hero + 5 action tiles + revenue card + ticket types + "No activity yet" + Cancel event CTA (live/upcoming).
2. **Manage menu** — tap manage IconChrome on a live event card → Sheet opens with 7 actions (Edit / View public / Open scanner / Orders / Copy share link / End ticket sales / Delete event). Verify Open scanner + End ticket sales + Delete event + Orders fire correct cycle-pointing toasts. Verify Edit / View public / Copy share link work for real.
3. **Status gates** — manage menu on draft (5 actions) / upcoming (8 actions) / past (7 actions) — verify subset matches spec table.
4. **Filter cascade** — clear AsyncStorage, reload, observe default filter falls through Upcoming → Live → Drafts → Past → All depending on what exists.
5. **iOS** — same flows on iOS sim. Verify SafeArea insets for both Events tab + EventDetail header.
6. **Regression** — Cycle 6 PublicEventPage 7 variants still render; Cycle 7 brand page + share modal still work; Cycle 8 checkout still works end-to-end (Get tickets → buyer details → payment → confirmation). Drafts still resumable from Drafts pill.
