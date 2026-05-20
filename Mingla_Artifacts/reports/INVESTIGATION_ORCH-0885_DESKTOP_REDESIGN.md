# INVESTIGATION — ORCH-0885 [Mingla Business Desktop Redesign — Seamless Navigation + Blast/Composer Framework Upgrade]

**Mode:** INVESTIGATE (no spec, no fix code, no diffs)
**Branch:** `Seth` · **Working tree:** `/Users/sethogieva/Desktop/mingla-main`
**Surfaces in scope:** business-web-preview (primary), business-iOS (guarded), business-Android (guarded)
**Surfaces explicitly NOT in scope:** consumer-iOS, consumer-Android, buyer-web, admin-web

---

## Section 0 — Mandatory ingestion checklist

Every file below was opened and read end-to-end (or to the relevant range) before any analysis was produced. Citations are absolute paths.

Design brainstorm (HTML mocks):
- `/Users/sethogieva/Desktop/mingla-main/Mingla_Artifacts/design/desktop-redesign/00-today-baseline.html` — confirms today's state on a 1600px browser: 440px content column, ~480px of empty canvas on each side, bottom-tab capsule floating mid-air, bottom sheets travelling 800px. Three "problem" cards enumerated: stranded column, wasted real estate, mobile-only interaction model.
- `/Users/sethogieva/Desktop/mingla-main/Mingla_Artifacts/design/desktop-redesign/01-tier1-container-rail.html` — Tier 1 proposal: max-width 640px content column + brand-ambient gradient canvas + left icon rail at >=1024px + (later) bottom-sheet -> centred floating card. The proposal explicitly names its guard: `Platform.OS === 'web' && width >= 1024`. Cost claimed: ~1–2 days, 1 ORCH, 1 PR.
- `/Users/sethogieva/Desktop/mingla-main/Mingla_Artifacts/design/desktop-redesign/02-tier2-desktop-shell.html` — Tier 2 proposal: persistent left sidebar with expandable sub-routes, top header (brand chip + global search + ⌘K hint + persistent CTA), two-pane master-detail (380px list + flex detail), tabs (Overview / Orders / Guests / Tickets / Comp & refund / Analytics) inside the detail pane. Shown on the URL `/hub/events`. Cost claimed: ~1–2 weeks.
- `/Users/sethogieva/Desktop/mingla-main/Mingla_Artifacts/design/desktop-redesign/03-tier3-power-features.html` — Tier 3 proposal: ⌘K command palette, multi-select with bulk actions (refund / message / export CSV), keyboard navigation (J/K/X/⏎ shortcut hints visible in the filter bar), persistent right rail (today's pulse / tasks / live Ari thread). Each of these is positioned as a separately shippable sub-sub-ORCH after Tier 2.

Code:
- `/Users/sethogieva/Desktop/mingla-main/mingla-business/app/_layout.tsx` — Root layout: GestureHandlerRootView -> SafeAreaProvider -> QueryClientProvider -> AuthProvider -> StripeProviderWrapper -> `<Stack screenOptions={{ headerShown: false }} />` inside an ErrorBoundary. Splash management gated on AuthContext + useBrand readiness. No web-specific branching at the root.
- `/Users/sethogieva/Desktop/mingla-main/mingla-business/app/(tabs)/_layout.tsx` — Renders `<Slot />` and an absolute-positioned `<BottomNav />` capsule. Tabs: home / hub / ari / marketing / account. `hideBottomNav` is the existing precedent for hiding chrome on focused-authoring routes (currently only `/campaigns/compose`). The capsule is positioned `absolute / bottom: 0` with `useSafeAreaInsets()` padding — no width gate, no Platform check.
- `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/components/ui/BottomNav.tsx` — GlassChrome capsule, animated Reanimated spotlight, 64px height, accepts arbitrary number of tabs. Pure RN primitives. No web-specific behaviour today.
- `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/constants/designSystem.ts` — Tokens: spacing (xxs..xxl), radius (sm..display + full), shadows (sm..glassModal with `androidSafeElevation` Platform.select shim). Confirmed canvas / glass / accent / text token clusters exist (Cycle 0a) — these are the source of truth for any new desktop primitive.
- `/Users/sethogieva/Desktop/mingla-main/mingla-business/app/(tabs)/hub/_layout.tsx` — Hub shell: TopBar + HubSubNav + VenueClaimStatusBanner + `<Slot />` + brand sheets + UniversalCreatorSheet. Pattern repeated by Marketing.
- `/Users/sethogieva/Desktop/mingla-main/mingla-business/app/(tabs)/hub/events.tsx` (read header) — Five filter pills (All/Live/Upcoming/Drafts/Past) drive a unified `EventListCard` feed. Manage Sheet exposes 11 context-aware actions. No URL-driven selection state — all selection is local React state inside the page.
- `/Users/sethogieva/Desktop/mingla-main/mingla-business/app/(tabs)/marketing/_layout.tsx` — Marketing shell: TopBar + MarketingSubNav + `<Slot />`. Hides the "+" CTA on `/campaigns/compose` (the only existing precedent for route-aware chrome hiding besides BottomNav's same hide).
- `/Users/sethogieva/Desktop/mingla-main/mingla-business/app/(tabs)/marketing/campaigns/compose.tsx` (read top 120 lines) — Composer route: Header / Toast / ComposerStepWho / draft caption / ComposerV2Editor / ComposerFooter. Header comment claims "TenTap-backed" but the actual import (line 48 of ComposerV2Editor) is `react-native-pell-rich-editor`. Stage F.5 in the file headers documents the pivot: "Stage F.5 (pell pivot)" — the TenTap shape was kept as an *intermediate AST* (`tenTapTokenBridge.ts` ProseMirror-shaped doc) but the live editor is pell (WebView-rich-editor). This is critical context for the framework decision in Section D.
- `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/components/marketing/` — 21 marketing components + ComposerV2 sub-folder. Composer surface consists of: ComposerHeader, ComposerStepWho, ComposerStepWhen, ComposerStepCompliance, ComposerFooter, ComposerReviewSheet, ComposerSentConfirmation, EmailPreviewPane, plus ComposerV2 (ComposerV2Editor, InsertionBar, SelectionFormattingTooltip, TemplatePreviewDrawer, SchedulePickerSheet, composerChipHtml.ts, tenTapTokenBridge.ts).
- `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx` (read first 80 lines + grep) — Uses `react-native-pell-rich-editor` (WebView wrapper) with a TenTap-shaped intermediate AST (`tenTapTokenBridge.ts`). Already imports `useWindowDimensions` (line 43) and `TemplatePreviewDrawer` already conditional on window dimensions — there is precedent for width-driven rendering inside the composer.
- `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/components/event/EditPublishedScreen.tsx` (read first 60 lines) — 6-section accordion (Basics / When / Where / Cover / Tickets / Settings) re-using wizard step bodies. Long-form vertical scroll surface — the canonical master-detail beneficiary.
- `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/components/trip/EditPublishedTripScreen.tsx` (header skim) — Same 6-section accordion pattern for trips; same beneficiary.
- `/Users/sethogieva/Desktop/mingla-main/mingla-business/package.json` — Already installed: Expo SDK 54, React 19.1, RN 0.81, react-native-web ~0.21, react-native-reanimated ~4.1, react-native-pell-rich-editor 1.10, react-native-webview, react-native-svg, expo-router 6.0, react-native-gesture-handler 2.28. **NOT installed:** Tamagui, shadcn/ui, Radix, cmdk, Floating UI, Tiptap, Lexical, react-aria, react-email, Maily. Every framework candidate in Section D would be a new dependency.

Operator-memory non-negotiable invariants (Section 8 of brief):
- `feedback_rn_sub_sheet_must_render_inside_parent.md` — Sub-sheet JSX MUST be inside the parent `<Sheet>` children, not a Fragment sibling. Native Modal sibling-mounts compete at OS root layer; the second-mounted gets blocked. Cycle 12 `CreatorStep5Tickets.tsx` is the verbatim pattern.
- `feedback_keyboard_never_blocks_input.md` — Every TextInput must remain visible above the keyboard. Reference Cycle 3 wizard root pattern (Keyboard listener + dynamic paddingBottom + deferred `scrollToEnd` via `requestAnimationFrame`).
- `feedback_rn_color_formats.md` — Inline colors must be hex/rgb/hsl/hwb only; oklch/lab/lch/color-mix silently rejected by `@react-native/normalize-colors`, transparent on native, invisible under dark overlays on web.
- `feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md` — Two `<ScrollView>` siblings in a flex parent both default to `flexGrow:1` and split leftover space; all-but-one must set `flexGrow:0` (typically `flexShrink:0` too).

---

## Section A — Screen-by-screen audit

Enumeration source: `find mingla-business/app -name "*.tsx"` (88 files; tests excluded for audit). Routes consolidated by feature. Classification:
- **L** = Layout-only (max-width wrap + side-rail nav switch, no logic change)
- **R** = Routing (URL-driven master-detail or new nested route)
- **F** = Framework swap (desktop-only component, e.g., side-panel vs bottom-sheet, desktop rich editor)
- **N** = No change

| Route | Screen purpose | Current mobile layout | Tier 1 | Tier 2 | Tier 3 | Framework-swap candidate |
|---|---|---|---|---|---|---|
| `app/index.tsx` | Cold-launch router (decides where to send user) | Splash + redirect | N | N | N | none |
| `app/_layout.tsx` | Root providers + Stack | RN providers | L (mount responsive context) | N | N | none |
| `app/(tabs)/_layout.tsx` | Tab shell + BottomNav capsule | Absolute-positioned BottomNav | **L** (swap to left rail when wide-desktop) | **L** (swap to expanded sidebar; sub-routes inline) | L (rail collapses to 68px on bulk-action surfaces) | none |
| `app/(tabs)/home.tsx` | Home — KPI hero + upcoming events | Single ScrollView column | **L** (max-w wrap, 12-col grid for KPI on desktop) | R (link from KPI tiles to nested orders/events detail) | F (persistent right rail w/ today's pulse) | none |
| `app/(tabs)/hub/_layout.tsx` | Hub TopBar + HubSubNav + Slot | TopBar + sub-nav pills | L (top-bar collapses into desktop topbar inside Tier 2) | **L** (sub-nav moves to sidebar inline children, header becomes desktop top bar) | N | none |
| `app/(tabs)/hub/index.tsx` | Hub root redirect to /events | Slot redirect | N | N | N | none |
| `app/(tabs)/hub/events.tsx` | Events pipeline (5 filter pills + EventListCard feed + Manage sheet) | One ScrollView | **L** | **R** (split into list pane + URL-driven detail at `/hub/events/[id]`) | **F** (multi-select rows + bulk refund/message/export; ⌘K + J/K nav) | none |
| `app/(tabs)/hub/experiences.tsx` | Experiences list (Ve5+) | One ScrollView (placeholder + populated) | L | R (master-detail mirroring events) | F (same bulk-actions story) | none |
| `app/(tabs)/hub/trips.tsx` | Trips list (Tr2+) | One ScrollView | L | R (master-detail mirroring events) | F | none |
| `app/(tabs)/ari.tsx` | Renders `<AriChatScreen />` | Full-screen chat | L (max-w wrap on web; chat thread benefits from desktop column) | **F** (persistent right rail can host the active Ari thread on every other screen — the brainstorm Tier 3 calls this out explicitly) | F (keyboard-driven send / cmd+enter) | none |
| `app/(tabs)/marketing/_layout.tsx` | TopBar + MarketingSubNav + Slot | TopBar + pills | L | L (sub-nav into sidebar) | N | none |
| `app/(tabs)/marketing/index.tsx` | Overview (headline + 4 funnel metric cards + 3 recent campaigns + FAB) | ScrollView | **L** | **L** (4 metric tiles -> 8 tiles + trend chart, recent-campaigns table) | F (multi-select campaigns for bulk archive/duplicate) | none |
| `app/(tabs)/marketing/audiences/index.tsx` | Audiences list | ScrollView | L | **R** (master-detail: audience list + member preview pane) | F (CSV import drop-zone; bulk segment from selection) | none |
| `app/(tabs)/marketing/campaigns/index.tsx` | Campaigns list | ScrollView | L | **R** (list + detail; status pills become column filters) | F (multi-select duplicate/archive; ⌘K route to compose) | none |
| `app/(tabs)/marketing/campaigns/[id].tsx` | Campaign detail (sent stats) | ScrollView | L | L (lives inside the detail pane of campaigns/index) | F (recipients table with sortable headers + filters) | none |
| `app/(tabs)/marketing/campaigns/compose.tsx` | Email composer (pell rich-editor + InsertionBar + TemplatePreviewDrawer + AudiencePickerSheet + ScheduleSheet + ReviewSheet) | KeyboardAvoidingView column | L (already hides BottomNav; needs max-w canvas) | **F** (move from full-screen takeover to a centred modal-style panel on desktop with side-rail for templates) | F (cmd+enter send; ⌘K insert event/personalization) | **YES — primary candidate for framework swap (see Section D)** |
| `app/(tabs)/marketing/templates/index.tsx` | Template list | ScrollView | L | R (list + preview pane) | F | possible (rich-editor parity) |
| `app/(tabs)/marketing/templates/[id].tsx` | Template editor | TemplateEditor | L | L (lives in the detail pane of templates/index) | N | **YES — same framework swap as compose.tsx** |
| `app/(tabs)/account.tsx` | Account hub | ScrollView | **L** | R (link to nested account/* routes inline rather than push) | N | none |
| `app/account/edit-profile.tsx` | Edit profile | Form ScrollView | L | L (could live as a side-sheet from /account on desktop) | N | none |
| `app/account/notifications.tsx` | Notification preferences | Form ScrollView | L | L | N | none |
| `app/account/delete.tsx` | Delete account flow | ScrollView + confirm | L | L | N | none |
| `app/ari/settings.tsx` | Ari settings | Form ScrollView | L | L (side-sheet from chat on desktop) | N | none |
| `app/auth/_layout.tsx` + `auth/index.tsx` + `auth/callback.tsx` | Sign-in / OAuth callback | Centred card | **L** (max-w 420px card centred — already close; just needs ambient canvas) | N | N | none |
| `app/brand/[id]/index.tsx` | Brand profile hub | ScrollView | L | **R** (sidebar nav into brand sections; current child routes become panes) | N | none |
| `app/brand/[id]/edit.tsx` | Brand edit | Form | L | L | N | none |
| `app/brand/[id]/team.tsx` | Team members | List | L | **R** (list + member-detail pane) | F (multi-select role change / remove) | none |
| `app/brand/[id]/blasts.tsx` | Per-brand blast history | ScrollView | L | R (collapses into marketing/campaigns filtered by brand on desktop) | F | none |
| `app/brand/[id]/audit-log.tsx` | Audit log feed | ScrollView | L | L (table on desktop, cards on mobile) | F (filter/search/multi-select export) | none |
| `app/brand/[id]/payments/index.tsx` + `payments/onboard.tsx` + `payments/reports.tsx` | Stripe Connect onboarding + reports | ScrollView | L | R (reports could be a sidebar-inline route) | N | none |
| `app/event/create.tsx` | Event creator wizard (7 steps) | Step-by-step | L (max-w wrap) | **F** (the steps could become a left sidebar wizard with the canvas in the middle on desktop — *but defer; mobile pattern is well-trodden and a desktop redesign here is high blast-radius*) | N | possible (long-term) |
| `app/event/[id]/index.tsx` | Event detail hub | ScrollView w/ tabs | L | **R** (tabbed detail; this IS the right pane of the Tier 2 events master-detail) | F (live KPI right rail) | none |
| `app/event/[id]/edit.tsx` | EditPublishedScreen (6-section accordion) | Accordion ScrollView | L | **R** (accordion becomes a left-side step-nav; right pane shows the active section's content; URL is `…/edit#section=tickets`) | N | none |
| `app/event/[id]/orders/index.tsx` | Per-event orders list | ScrollView | L | **R** (list + order-detail pane; *the canonical Tier 3 multi-select target*) | **F** (multi-select refund/message/export; sortable table headers; ⌘K) | none |
| `app/event/[id]/orders/[oid]/index.tsx` | Order detail | ScrollView | L | L (lives in detail pane of orders/index) | N | none |
| `app/event/[id]/guests/index.tsx` | Guest list | ScrollView | L | **R** (list + guest-detail pane) | F (multi-select message/refund/CSV) | none |
| `app/event/[id]/guests/[guestId].tsx` | Guest detail | ScrollView | L | L (lives in guest-detail pane) | N | none |
| `app/event/[id]/door/index.tsx` + `door/[saleId].tsx` | Door check-in / sale-by-sale | ScrollView | N (door is operationally mobile-only) | N | N | none — **explicit "no desktop" carve-out** |
| `app/event/[id]/scanner/index.tsx` + `scanners/index.tsx` | NFC + scanner mgmt | Scanner UI | N | N (scanner mgmt could go desktop, but NFC requires a physical device) | F (scanner mgmt list could go master-detail) | none |
| `app/event/[id]/blasts/index.tsx` | Per-event blast composer entry | ScrollView | L | R (links into marketing/campaigns/compose pre-filtered) | F | inherits composer swap |
| `app/event/[id]/preview.tsx` | Public event preview | Public page | L | N | N | none |
| `app/event/[id]/reconciliation.tsx` | Reconciliation report | ScrollView | L | L (table on desktop) | F (export, filters) | none |
| `app/trip/create.tsx` | Trip creator wizard | Step-by-step | L | F (long-term — same as event wizard) | N | possible (long-term) |
| `app/trip/[id]/index.tsx` | Trip detail hub | ScrollView | L | **R** (master-detail trip; right pane of trip list) | F | none |
| `app/trip/[id]/edit.tsx` | EditPublishedTripScreen | 6-section accordion | L | **R** (same step-nav-left / content-right as event edit) | N | none |
| `app/trip/coming-soon.tsx` + `experience/coming-soon.tsx` | Empty-state placeholders | Centred card | L | N | N | none |
| `app/venue/create.tsx` | Venue creation flow | Wizard | L | L (could go side-panel from brand profile) | N | none |
| `app/checkout/[eventId]/*` (4 routes incl. _layout, index, buyer, confirm, payment) | **Anon-buyer routes** (per `feedback_anon_buyer_routes.md`) | Centred card / form | **L (different rules)** — buyer pages have their own desktop story already partly handled (web vs native Stripe); they live OUTSIDE `(tabs)` | N | N | none — **OUT OF SCOPE: buyer-web is a separate workstream per brief surfaces list** |
| `app/checkout-trip/[tripEventId]/*` (5 routes) | Anon trip checkout | Centred card / form | OUT OF SCOPE (buyer-web) | N | N | none — out of scope |
| `app/b/[brandSlug]/index.tsx` | Public brand page | Public site | OUT OF SCOPE (buyer-web) | N | N | none |
| `app/e/[brandSlug]/[eventSlug].tsx` | Public event page | Public site | OUT OF SCOPE (buyer-web) | N | N | none |
| `app/t/[brandSlug]/[tripSlug].tsx` | Public trip page | Public site | OUT OF SCOPE (buyer-web) | N | N | none |
| `app/o/[orderId].tsx` | Public order page | Public page | OUT OF SCOPE (buyer-web) | N | N | none |
| `app/booking/[orderId]/cancel.tsx` | Cancel-by-buyer flow | Public form | OUT OF SCOPE (buyer-web) | N | N | none |
| `app/stripe-onboarding-return.tsx` + `connect-onboarding.tsx` | Stripe return URLs | Status screens | L | N | N | none |
| `app/__styleguide.tsx` | Dev styleguide route | N/A | N (dev tool) | N | N | none |
| `app/+not-found.tsx` | 404 | Centred card | L | N | N | none |

### Audit signals worth surfacing

1. **The biggest Tier-2 wins are all the same pattern.** Hub/events, Hub/experiences, Hub/trips, marketing/campaigns, marketing/audiences, marketing/templates, event/[id]/orders, event/[id]/guests, brand/[id]/team — **9 list-detail pairs in the same codebase**. Building master-detail correctly ONCE pays back 9 surfaces. That is the single highest impact-per-effort signal in this audit.

2. **EditPublishedScreen + EditPublishedTripScreen are unusual.** They are accordion-flat-on-mobile but they map perfectly to a left-step-nav + right-pane on desktop. They are not list-detail; they are sectioned-form-detail. They warrant a distinct Tier 2 sub-pattern.

3. **Composer is the only true Framework-swap candidate inside the (tabs) tree.** Everything else can move to desktop with layout work alone. The composer is the place where the *user's expectations* (Mailchimp / Beehiiv / Mailerlite / Maily) cannot be matched by pell-rich-editor on RN-web.

4. **Buyer-web routes are explicitly excluded** by the brief's surfaces list (buyer-web is a separate workstream). They are listed in the table only for completeness — no Tier work belongs to them inside ORCH-0885.

5. **Door + scanner = explicit "no desktop" carve-outs.** NFC check-in requires a physical reader; treating them as N is intentional, not an oversight.

6. **Two screens that don't cleanly fit (architectural friction):**
   - `event/create.tsx` and `trip/create.tsx` — the wizards. They're full-screen takeovers with their own step-stack. On desktop they look phone-shaped and tiny, but redesigning them is high blast-radius (every business in production uses these). Recommend deferring to a post-Tier-2 mini-ORCH; Tier 1 max-width wrap is the minimum viable.
   - `app/(tabs)/_layout.tsx` itself — it is the *only* surface where the change must touch a globally rendered component (`BottomNav`). Every other change can be local to a route. This makes Tier 1's `BottomNav -> SideRail` swap the gating change for everything downstream.

---

## Section B — Five-truth-layer cross-check for the load-bearing flow (Tier 2 master-detail in Hub/Events)

**Docs**
- `mingla-business/README.md` is a stock Expo scaffold; nothing useful about the tab model or creator flows. **Contradiction:** the in-app docs don't describe the actual tab model. The authoritative description is in the file-header comments of `(tabs)/_layout.tsx` (lines 1–11) and `(tabs)/hub/_layout.tsx` (lines 1–17). For Tier 2 we will need to write the master-detail contract — there is no doc to inherit.
- Memory entries cite the hub change history: ORCH-0826 renamed tab `events` to `hub` with three sub-routes (events / experiences / trips). Tier 2 will add a fourth axis (detail pane), URL becoming `/hub/events/[eventId]`.

**Schema**
- The schema is already keyed correctly. Looking at the audit shapes: `events.id`, `orders.event_id`, `orders.id`, `guests.event_id`. There is no schema obstacle to URL-driven master-detail — the list query is by brand+filters, the detail query is by id. Both are existing queries today. **No RLS gymnastics required.** Same brand owner reads both; nothing privileges the parent over the child.

**Code**
- `(tabs)/hub/events.tsx` (line 26 of header) imports `useRouter` and `ScrollView`; today it filters and renders cards locally with no URL state. The Tier 2 change is: add a child route `(tabs)/hub/events/[eventId]/_layout.tsx` that, on `Platform.OS === 'web' && width >= 1024`, renders the parent list AND the detail in a flex-row, with selection mirroring the URL. On mobile, the same nested route stack-pushes (today's behaviour).
- Expo Router 6.x supports nested layouts well; the existing pattern at `app/(tabs)/marketing/campaigns/[id].tsx` already proves a `[id]` child route works under a tab.

**Runtime**
- Expo Router's web target supports nested layouts with stable URLs. Precedent in this repo: `app/(tabs)/marketing/campaigns/[id].tsx` already pushes to a child route with a URL of the form `/marketing/campaigns/<id>`. The browser back button works. So master-detail on web is feasible — the question is whether to render BOTH panes simultaneously (web>=1024) or to keep the current stack push (the mobile pattern). The cleanest answer: keep the URL pattern identical on both surfaces; on web>=1024, the parent `_layout.tsx` simply renders both `<EventsList />` (filtered) and `<Slot />` (the active detail) side-by-side. On mobile, only the active screen renders — Expo Router's default.

**Data (React Query)**
- The list query is keyed on brand + filter; the detail query is keyed on event id. There is no overlap and no risk of a list-query invalidating a detail query or vice versa. Both can coexist. The single point of caution is: when the user picks an event from the list, we should *not* re-fetch the detail if the list already has the row inlined — use the existing `placeholderData` pattern (TanStack Query v5) seeded from the list query's cache. This is a Tier-2 SPEC detail, not an obstacle.

**Cross-layer contradictions found:** None blocking. The only friction is the doc layer (README out of date) — to be addressed by the Tier-2 spec output.

---

## Section C — Architecture path decision (load-bearing)

### Path A — Stay RN-web everywhere

Every change happens inside the existing React Native tree. Wide-desktop branches use `useWindowDimensions() + Platform.OS === 'web'`. New frameworks must be RN-web-compatible (Tamagui, Reanimated, etc.).

- **Pro:** one codebase, automatic mobile parity, no routing fork, zero new build complexity.
- **Pro:** every invariant in §8 of the brief is preserved naturally (sub-sheet child-of-parent rule, keyboard-aware inputs, hex/rgb/hsl colours, ScrollView flexGrow gotcha) — they are all RN rules, and we are still in RN.
- **Con:** framework ceiling. No shadcn/ui, no cmdk, no Maily, no react-email. We get RN component primitives (Tamagui is the only meaningful cross-tree alternative).
- **Con:** the Blast composer ceiling is the binding one. Pell-rich-editor is a WebView wrapper — on RN-web it renders an `<iframe>` in a `<View>`. That's a 2024-era mobile rich-editor, not a 2026-era email composer. Mailchimp/Beehiiv-class users will feel the gap.
- **Verdict on candidate libs:** Tamagui is RN-web compatible and would unlock more web-native styling; Reanimated is already installed and already used by `BottomNav`. There is no RN-web equivalent of cmdk (command palette), no RN-web equivalent of Maily (block-based email builder). The web-native libs Seth's referring to are *web-only*; that is the gap Path A cannot close.

### Path B1 — Selective desktop carve-outs **(RECOMMENDED)**

Most screens stay RN-web. Specific high-leverage desktop surfaces (Blast composer, master-detail dashboards, command palette) get web-only React components mounted at the same route via `Platform.OS === 'web' && isWideDesktop` branching. Web-native libs (shadcn, Radix, cmdk, Tiptap/Maily, react-email) are imported only into those carve-outs via dynamic import OR via Metro's `.web.tsx` file-extension swap (the same pattern `StripeProviderWrapper.tsx` vs `StripeProviderWrapper.native.tsx` already uses, proven in `app/_layout.tsx:40`).

- **Pro:** framework freedom where it matters, mobile untouched, gradual rollout. The proven precedent for `.web.tsx` / `.native.tsx` Metro routing is already in production (Stripe wrapper).
- **Pro:** every Section-8 invariant remains *enforceable on mobile* (which is where they apply); the desktop carve-out runs under web DOM rules where the invariants don't bite (Modal sibling-mounting, ScrollView flexGrow, keyboard avoidance are RN problems that don't exist on web).
- **Pro:** bundle size is gated by route — the iOS/Android bundle never pulls a shadcn or Tiptap dep because Metro picks the `.native.tsx` sibling.
- **Con:** two component trees for the same route (testing burden). Each carve-out screen needs explicit parity checks: the data layer is shared, the visual contract diverges.
- **Con:** designer must hold visual parity by hand — there is no shared style language between Tamagui-on-RN and shadcn-on-web. Mitigation: the design tokens in `designSystem.ts` are values (#hex, numeric spacing) that translate trivially to a Tailwind config + CSS-vars file.
- **Trigger to escalate:** if the carve-out tree exceeds **8 screens** OR if the shared visual debt exceeds 2 weeks of designer time per cycle (whichever first), escalate to Path B2.
- **Verdict on candidate libs:** Tiptap / Maily / Lexical / cmdk / shadcn / Radix / Floating UI all available; the only constraint is they live under `*.web.tsx` so Metro doesn't try to native-bundle them.

### Path B2 — Full web-only desktop shell fork

A new `mingla-business/web-desktop/` tree with its own routing, sharing only services/types/queries with the RN mobile tree.

- **Pro:** maximum framework freedom, cleanest separation, true desktop-native UX.
- **Con:** doubles code surface; requires a parallel build pipeline (Vite or Next.js or pure RN-web-on-webpack); two QA passes; harder to keep brand consistent; biggest blast radius. **The mobile tree gets no benefit from this work** — every shared improvement still has to be implemented twice.
- **Con:** Mingla is in launch hardening. Doubling the desktop surface this far from launch is a bet against the small-team thesis.
- **Trigger to enter:** when desktop user share exceeds **15–20% of weekly active brands** AND the carve-out tree has already exceeded 8 screens AND the operator has explicit budget for a desktop-only PM/designer/engineer triad.

### Recommendation: **Path B1**

Path A is correct for Tier 1 (max-width + side-rail are pure layout). Path B1 is correct for Tier 2 (master-detail can be done in RN, but the *composer* and *command palette* cannot be done credibly without web-native libs). The `.web.tsx` Metro pattern is already proven in this repo (Stripe wrapper, line 40 of `_layout.tsx`) — we are extending an existing pattern, not introducing a new one. Path B2 is over-investment until weekly-active-brand counts and operator headcount justify a parallel tree.

**Escalation trigger codified:** **if any of (a) the count of `*.web.tsx` carve-out files exceeds 8, OR (b) the bundle split debt requires a second build target, OR (c) operator/designer time on visual parity exceeds 2 weeks per cycle — escalate to Path B2.**

**How the gate is enforced.** A new shared hook (proposed name `useResponsiveLayout()`, to be specced in ORCH-0885-A, not authored here) returns `{ isWideDesktop: Platform.OS === 'web' && width >= 1024 }`. Every desktop-only branch reads from this hook — never inlines the boolean. A strict-grep CI gate (following the established pattern in `feedback_strict_grep_registry_pattern.md`) rejects any file that gates on `Platform.OS === 'web'` without also reading from `useResponsiveLayout` OR being one of the allow-listed root files (the hook itself, Metro `.web.tsx` siblings).

---

## Section D — Framework shortlists

### D.1 — Blast composer + email builder

Constraint set:
- Output must be email-safe HTML (Resend → Gmail / iOS Mail / Outlook / Apple Mail). Today the pell editor stores HTML in `campaigns.channel_payload` and the existing render layer (`marketingRenderingService`) handles personalization tokens.
- Mobile parity: today's pell editor works fine on iPhone/Android (it's a WebView). Desktop carve-out only — mobile keeps pell.
- Existing intermediate AST (`tenTapTokenBridge.ts`) is ProseMirror-shaped. **Tiptap and Lexical are both ProseMirror-compatible** at the document level — the AST already exists and is unit-tested (`tenTapTokenBridge.test.ts`).
- Must support: bold/italic/link (B/I/Link), event-card chips (custom node), personalization tokens (custom inline node), images, headings.

| Candidate | RN-web compat | Mobile parity story | Accessibility | Bundle size | License | Maintenance health |
|---|---|---|---|---|---|---|
| **Tiptap** (ProseMirror, headless) | Web-only (no RN); fine inside `.web.tsx` | Mobile keeps existing pell; AST already matches | Excellent — headless; ARIA driven by caller | ~70–110 KB gz core + plugins | MIT | Excellent — active weekly releases |
| **Lexical** (Meta) | Web-only; fine inside `.web.tsx` | Mobile keeps pell; AST is Lexical-native, would need new bridge | Excellent — accessibility was a stated design goal | ~30–60 KB gz core | MIT | Excellent — funded by Meta |
| **Maily.to** | Web-only; built on Tiptap | Mobile keeps pell; AST inherits Tiptap | Good (inherits Tiptap) | Larger — opinionated UI bundle | MIT | Smaller maintainer base; healthy but riskier than Tiptap raw |
| **react-email** | Web-only; React-component templating | Server-side rendering preferred; not a live editor | n/a (renders to email HTML) | Build-time; runtime small | MIT | Good — backed by Resend (their email vendor) |
| **Editor.js** | Web-only | New AST; no Mingla bridge | Decent; less ARIA polish | Medium | Apache-2.0 | Active but slower release cadence |
| **Mantine RTE / TinyMCE** | Web-only; TinyMCE is heavy and GPL-with-commercial | Mobile keeps pell | Decent | Heavy (TinyMCE 300KB+) | TinyMCE is GPLv2 + commercial — license friction | TinyMCE mature; Mantine RTE in maintenance mode |

**Primary recommendation: Tiptap.** Reasons: (1) the intermediate AST in `tenTapTokenBridge.ts` is already ProseMirror-shaped, which is Tiptap-native — the bridge ports with minimal change; (2) Tiptap's extension model is the closest match to the existing custom-node use cases (event-card chip, personalization-token chip); (3) MIT license, healthy maintenance; (4) the team can adopt **Maily** *on top of* Tiptap later if a block-based / drag-and-drop email builder becomes the goal — Tiptap is the foundation either way. Email-safe HTML output strategy: keep `marketingRenderingService` as the rendering boundary. Tiptap produces ProseMirror JSON + canonical HTML; a small server-side normalizer (or build-time `react-email` for templated emails) converts to Gmail/Outlook-safe markup. This preserves the Constitution-#2 single-owner principle for HTML output.

**Secondary candidate to keep on radar: react-email** — not as the editor, but as the render layer for *templated* campaigns (welcome email, receipt, reminder). It complements Tiptap; it doesn't compete with it. Out of scope for ORCH-0885-C, but worth flagging.

### D.2 — Desktop shell primitives

Constraint set:
- Sidebar, dialog, dropdown, tooltip, command palette, popover positioning, focus management.
- Must support keyboard navigation and ARIA out of the box (WCAG AA, per §8).
- Must respect Mingla's design tokens (colors are hex; the existing dark canvas is `#0c0e12`; accent `#eb7825`).

| Candidate | RN-web compat | Mobile parity story | Accessibility | Bundle size | License | Maintenance |
|---|---|---|---|---|---|---|
| **Radix UI** (primitives) | Web-only | Mobile uses today's RN Sheet/Modal | Excellent — gold standard | ~3–15 KB gz per primitive | MIT | Excellent |
| **shadcn/ui** | Web-only; copy-paste over Radix | Mobile unchanged | Inherits Radix | Source-copied; size pay-as-you-go | MIT | Excellent |
| **cmdk** (Vercel) | Web-only | Mobile gets no palette (Tier 3 is desktop-only) | Excellent — built ARIA-first | ~6 KB gz | MIT | Excellent |
| **Floating UI** | Web-only | Mobile uses RN absolute-position patterns | Excellent | ~8 KB gz core | MIT | Excellent |
| **react-aria / react-aria-components** | Web-only | Mobile unchanged | Excellent — Adobe's primitive set | Larger than Radix; bigger API surface | Apache-2.0 | Excellent |
| **Tamagui** | **YES — cross-platform** | Mobile gets Tamagui too OR opts out per-component | Good but mobile-styled | Larger native bundle; tree-shaken | MIT | Excellent |

**Primary recommendation: Radix UI primitives + shadcn/ui copy-paste components + cmdk (command palette) + Floating UI (where Radix doesn't ship a popover, e.g., custom tooltips and inline menus).** All four are web-only and live under `*.web.tsx` carve-outs per Path B1. Together they cover sidebar / dialog / sheet / dropdown / tooltip / popover / command palette / focus management at the gold-standard accessibility tier.

**Rationale tied to Path B1:** Tamagui *is* the Path-A choice. Under Path B1 we explicitly want web-native primitives where they buy us the most, and Radix is the canonical pick. shadcn's value is the copy-paste pattern (no runtime dependency on the design library), which means we can theme each component against Mingla's tokens (`designSystem.ts` -> Tailwind config) without fighting a library's defaults. **react-aria** is a viable alternative to Radix; recommendation goes to Radix on the strength of shadcn's pre-built React Native-token-compatible component patterns and broader ecosystem familiarity. If accessibility-first parity becomes the binding constraint, swap Radix for react-aria — same Path-B1 fit.

**Color/token bridge.** `designSystem.ts` exports hex/rgb tokens. A new `mingla-business/web-desktop-theme.css` (loaded only inside `.web.tsx` carve-outs) exposes those same tokens as CSS custom properties, and a Tailwind config consumes them. The four-invariant rule on RN colors (`feedback_rn_color_formats.md`) is satisfied because no RN inline style is touched by the web-only branch.

---

## Section E — Sub-ORCH decomposition

### ORCH-0885-A [Desktop Tier 1 — Container + Side Rail]

- **Scope:** add `useResponsiveLayout()` hook returning `{ isWideDesktop }`. Replace `BottomNav` with a left icon rail when `isWideDesktop === true`. Add a max-width content wrapper inside `(tabs)/_layout.tsx`'s Slot host. Replace the empty-margin black with the brand-ambient gradient (Tier 1 mock §canvas-bg). Bottom-sheet → centred floating card via a new `<Sheet>` web-variant (path: `Sheet.web.tsx`).
- **Surfaces touched:** business-web-preview (visual + interaction). business-iOS + business-Android: **byte-identical** (every branch gated by `isWideDesktop`).
- **Effort estimate:** ~2–3 engineer-days + ~1 designer-day for the side-rail icon-rail polish.
- **Designer input needed:** colour values for the brand-ambient gradient; final icon weights for the rail; rail width (target 80px per mock 01).
- **Single new CI invariant:** strict-grep registry pattern (per `feedback_strict_grep_registry_pattern.md`) — a new gate `orch-0885-a-no-bottomnav-on-wide-desktop.mjs` asserts that no file mounts `<BottomNav>` outside a branch reading `isWideDesktop === false`. Same pattern as the existing 20+ strict-grep gates.
- **Why this order:** unlocks every other tier — Tier 2's left sidebar reuses the rail; Tier 3's right rail mounts in the same shell. Cannot ship Tier 2 without this.

### ORCH-0885-B [Desktop Tier 2 — Master-Detail Pilot in Hub/Events]

- **Scope:** introduce nested route `(tabs)/hub/events/[eventId]/` (Expo Router parallel pane on web>=1024; stack-push on mobile). Refactor `(tabs)/hub/events.tsx` to expose a `<EventsList />` component reusable inside the new layout. Build a `MasterDetailLayout` web primitive (CSS-grid; 380px list + 1fr detail). Convert at least three sheets (Manage menu, Filters, Confirm-cancel) to web-side-panels via `*.web.tsx` siblings.
- **Surfaces touched:** business-web-preview. iOS + Android: bit-identical for the events flow (the nested route stack-pushes on native — today's behaviour).
- **Effort estimate:** ~5–8 engineer-days + ~2 designer-days. Includes building a reusable `MasterDetailLayout` that 8 future surfaces will adopt.
- **Designer input needed:** detail-pane tab order (Overview/Orders/Guests/Tickets/Comp & refund/Analytics — confirmed by Tier 2 mock); sheet → side-panel mapping for all sub-sheets in events; list-pane row design at desktop density.
- **Single new CI invariant:** `orch-0885-b-master-detail-url-driven.mjs` — strict-grep gate that the list-pane selection state always mirrors the URL (no orphan local state inside `MasterDetailLayout` consumers). Prevents the bookmarkability regression.
- **Why this order:** the highest impact-per-effort signal in Section A (one pattern, 9 surfaces benefit). Ship it on events first, then dispatch separate follow-up ORCHs for the 8 other list-detail pairs (those become routine after the primitive lands).

### ORCH-0885-C [Blast Composer Framework Swap — Tiptap on web carve-out]

- **Scope:** add `react-native-pell-rich-editor` `.web.tsx` sibling that renders Tiptap when `Platform.OS === 'web' && isWideDesktop`. Port `tenTapTokenBridge.ts`'s ProseMirror AST to Tiptap's `JSONContent` (the types overlap heavily — this is plumbing, not invention). Replace `InsertionBar` + `SelectionFormattingTooltip` + `TemplatePreviewDrawer` with Radix/shadcn equivalents inside the web carve-out. Preserve the existing AudiencePickerSheet / ScheduleSheet / ReviewSheet — they remain RN-mobile sheets on mobile and become Radix dialogs on desktop. Email-safe HTML output stays inside `marketingRenderingService` (unchanged Resend pipeline).
- **Surfaces touched:** business-web-preview. iOS + Android: pell editor unchanged.
- **Effort estimate:** ~6–10 engineer-days (Tiptap setup + AST port + custom node parity for event chip and personalization token + visual parity for InsertionBar/Drawer + parity test against existing `tenTapTokenBridge.test.ts`) + ~2 designer-days.
- **Designer input needed:** desktop composer canvas layout (mock 02 shows a centred layout; we need final dimensions); template-drawer side-panel design; insertion-bar floating position; toolbar grouping.
- **Single new CI invariant:** `orch-0885-c-no-tiptap-in-native-bundle.mjs` — strict-grep that no file outside `*.web.tsx` imports any `@tiptap/*` package. Parallels the existing ORCH-0778 `web-stripe-native-import-gate` pattern.
- **Why this order:** Tier 2 master-detail unlocks the *navigation* model the composer needs (templates list → template detail → "Edit template" → composer with template hydrated). Without Tier 2 the composer is an island; with Tier 2 it slots into the new shell.

### ORCH-0885-D [Tier 3 Power Features — Command Palette, Multi-select, Right Rail, Keyboard Nav]

This umbrella is **explicitly four independent sub-sub-ORCHs**, each shippable separately after Tier 2 lands:

- **ORCH-0885-D1 [Command Palette ⌘K]** — mount `cmdk` inside `*.web.tsx`; index events, orders, guests, campaigns, templates; expose actions (New event / New campaign / Go to brand / Switch brand). Effort: ~3 days. Designer: palette row design + action grouping.
- **ORCH-0885-D2 [Multi-select + Bulk Actions on Orders]** — add row checkboxes + bulk action bar (refund / message / export CSV) inside the new master-detail list pane for `event/[id]/orders`. Effort: ~3 days. Designer: bulk-bar design + confirm-dialog patterns.
- **ORCH-0885-D3 [Persistent Right Rail]** — third pane (today's pulse / pending tasks / live Ari thread) gated by isWideDesktop on Home and Hub. Effort: ~4 days. Designer: right-rail content prioritization + Ari-thread mini-shell.
- **ORCH-0885-D4 [Keyboard Navigation Layer]** — `J/K/X/⏎` shortcuts for the master-detail list pane; document escape rules; focus traps inside dialogs. Effort: ~2 days. Designer: minimal — keyboard hint chips already drawn into Tier 3 mock.

Each D-sub gets its own strict-grep gate as needed (D2: "no bulk action without confirm dialog"; D4: "every dialog has a focus trap"). All D-subs share the Path-B1 carve-out rule — none of them ship to mobile.

**Why this order (D after C):** the composer is the highest-leverage *user-facing* upgrade per operator brainstorm ("blasts and composers can be much better"). Tier 3 features are amplifiers, not foundations — they make the desktop shell faster for power users, but they don't unlock new capability. Ship them last, parallel-friendly.

---

## Section F — Risks + open questions for operator

1. **Path-B1 fork tax — accept the carve-out, or push toward Tamagui-only Path A?** Path B1 has a real testing tax: every carve-out screen needs two snapshots. The trade is desktop ceiling vs maintenance burden. **Question:** at what user-share does desktop become a true second platform (vs a secondary view of mobile)? If it's already >10%, Path B1 is right; if it's <2%, Path A may be sufficient and the composer can wait. *Operator judgement needed.*

2. **Composer pivot — Tiptap, or upgrade pell?** Pell is a 2024 WebView wrapper. Tiptap is the de facto 2026 ProseMirror editor. The ProseMirror-shaped intermediate AST (`tenTapTokenBridge.ts`) suggests the team already explored TenTap and pivoted away (Stage F.5 file headers confirm). **Question:** was the pivot away from TenTap a *temporary mobile compromise* or a strategic decision? If strategic, Tiptap on web restores the original direction; if temporary, the pivot rationale must be re-read before we restart the migration. *Operator judgement needed.*

3. **Event/Trip creator wizard — desktop redesign now, or defer?** These are the highest-traffic authoring surfaces; on desktop they look tiny. But they are also the most-tested surfaces in production. **Question:** does the desktop creator wizard get a Tier-2 left-step-nav + right-canvas treatment under ORCH-0885, or is it deferred to a separate ORCH-0886? Recommendation: defer. *Operator confirmation needed.*

4. **Door + scanner — confirm the "no desktop" carve-out.** NFC requires a physical reader, but the *scanner management list* (`event/[id]/scanners/index.tsx`) could plausibly run on desktop. **Question:** is scanner-management explicitly mobile-only, or only the NFC scanning act itself? *Operator judgement needed.*

5. **Sub-sheet → side-panel mapping in Tier 2 (invariant compliance).** The §8 invariant `feedback_rn_sub_sheet_must_render_inside_parent.md` says sub-sheets must render inside their parent's `<Sheet>` children. On the web carve-out, sub-sheets become Radix dialogs and the invariant *doesn't apply* (no Modal sibling problem on the DOM). **Risk:** an implementor could mistakenly think they can lift the rule on mobile too. Mitigation: the invariant remains a hard CI gate against the `.tsx` (non-`.web.tsx`) files. **Question:** confirm the invariant applies per-file (i.e., it's about RN Modal, not about the logical concept), so the web variant is genuinely exempt.

6. **WCAG AA on the dark canvas at desktop scale.** Mocks use `#0c0e12` canvas with off-white text. Most pairings clear 4.5:1 trivially. **Risk:** the accent-tint hover/selected states (`rgba(235,120,37,0.18)`) plus accent text in the sidebar mock could fall under 4.5:1 against the dark canvas. *Designer confirmation needed before SPEC.*

7. **Right-rail data freshness.** Tier 3 persistent right rail (today's pulse / live Ari thread) implies real-time updates. Today's React Query stack uses staleTime + window focus refetch. **Question:** does the right rail get a websocket / Supabase realtime channel, or polling? Polling is simpler but glassy. *Path-fork decision.*

8. **Bundle-size budget on the web build.** Adding Tiptap + Radix + shadcn + cmdk + Floating UI to the web bundle could push initial-load bundle above 1MB compressed. **Question:** is there an operator-set budget on web initial-load JS? Recommendation: route-level code-splitting via dynamic `import()`. *Operator confirmation that this is acceptable engineering complexity.*

9. **Designer bandwidth.** Each sub-ORCH (A/B/C/D1-4) has a designer-input row. The combined designer ask is ~5–7 days of designer work concurrent with engineering. **Question:** is that headroom available, or do we need to compress (e.g., Tier 1 + Tier 2 share one designer pass)? *Operator scheduling decision.*

10. **Biggest single risk:** **Tier-2 master-detail correctness across 9 surfaces.** Building the primitive once on Hub/Events is the right pilot; but if the primitive's URL-state-mirroring contract is even slightly wrong, all 9 surfaces inherit the bug. Mitigation: Tier-2 spec must define the primitive's contract before any surface beyond events adopts it; tester must verify URL bookmarkability on web AND back-button correctness on native. This is the question on which the whole desktop story rises or falls.

---

*End of investigation report. No fix code. No spec code. No file diffs.*
