# SPEC — ORCH-1038 [Business Home/Hub unified smart To-Do toggle]

Operator-directed redesign (2026-06-01). Replace every conditional "next-action /
empty-state / coaching" card on the Business **Home** and **Hub** with ONE shared,
collapsible **To-Do toggle** that sits flush under the top bar, full top-bar width,
on both surfaces. Free the main area for real analytics, which render only when they
hold actual numbers.

## Locked product decisions (operator)
1. **Smart priority order** — most-important next step on top; rows are derived from
   live state and **auto-vanish** the instant their condition is met (no manual ticking).
2. **Deck readiness = one routing row** ("Get your venue live") → existing
   `/venue/deck-readiness` screen (keeps the detailed blockers there). Do NOT explode.
3. **Hub** — toggle sits **above** the Events/Experiences/Trips sub-nav pills; the
   "Get started" fallback pill/route is removed.
4. **Empty = clean** — toggle hides entirely when zero pending to-dos; analytics tiles
   render only when they have real numbers (no zero/empty placeholders).
5. **Offering choice** — single "Create your first offering" row opens the existing
   compact `UniversalCreatorSheet` ("+" TopSheet). Remove the chunky `OfferingChooser`
   tiles from Home (Rung-2 `home-empty`) and Hub (`/getstarted`). PRESERVE
   `OfferingChooser` inside `BrandCreationFlow` (`brand-create-welcome`).

## Architecture

### A. Pure derivation — `mingla-business/src/utils/businessTodos.ts` (new)
`buildBusinessTodos(input): BusinessTodo[]` — pure, fully unit-tested. Emits ONLY
currently-unmet items, already ordered by priority. Each item:
```
interface BusinessTodo {
  id: string;
  label: string;
  sublabel?: string;
  action:
    | { kind: "open_brand_switcher" }
    | { kind: "open_universal_creator" }
    | { kind: "route"; route: string };
}
```
Input (all already available in home.tsx): `hasNoBrands`, `hasBrandsButNoSelection`,
`brandResolving`, `currentBrandId`, `pipelineFetched`, `pipelineState` (status enum:
draft|processing|needs_fix|deck_eligible|failed), `pipelineRoute` (deck-readiness route
or null), `venueDraftInProgress`, `counts` {total,live,draft}, `stripeStatus`
(not_connected|pending|active|restricted), `hasDraftPaidOffering`, `draftRoute` (route
to most-recent draft or null).

**Priority + conditions:**
1. `create_brand` — `hasNoBrands` → open_brand_switcher. (Sole item; nothing else applies.)
2. `select_brand` — `hasBrandsButNoSelection` → open_brand_switcher. (Sole item.)
   - If `brandResolving` or no brand → emit nothing (avoid flash).
3. `add_venue` / `finish_venue` — brand selected, `pipelineFetched && pipelineState == null`
   → route `/venue/create`. Label flips to "Finish adding your venue" when `venueDraftInProgress`.
4. `get_venue_live` — `pipelineState` present & status ∉ {draft, deck_eligible} → route
   = deck-readiness (`routeForPipelineStateFix(fix:"review_pipeline")`). Sublabel by status
   (processing → "We're reviewing your details"; needs_fix → "A few things need fixing"; failed → "Something went wrong — tap to retry").
5. `create_offering` — `counts.total === 0` → open_universal_creator.
6. `connect_stripe` — `stripeStatus !== "active" && hasDraftPaidOffering` → route `/brand/{id}/payments`.
7. `finish_draft` — `counts.live === 0 && counts.draft > 0 && draftRoute` → route draftRoute.

(3 emits venue OR get-live, never both. 5 and 7 are mutually exclusive via counts.)

### B. Component — `mingla-business/src/components/home/BusinessTodoToggle.tsx` (new)
- Props: `{ todos: BusinessTodo[]; onAction: (todo: BusinessTodo) => void; testID? }`.
- `todos.length === 0` → render `null` (toggle hides entirely).
- Collapsible header: "N to-do(s)" + chevron; `useState` open, defaults open when ≥1 todo.
- Body: ordered rows; each row label + optional sublabel + chevron; `onPress` → `onAction(todo)`.
- Full width; parent wraps with `paddingHorizontal: spacing.md` to align flush with TopBar.
- `LayoutAnimation.configureNext` on open/close + on todo-count change for the "vanish" feel.
- Tokens from `../../constants/designSystem`; GlassCard variant="elevated".
- a11y: header + each row `accessibilityRole="button"` + explicit `accessibilityLabel`.

### C. Home wiring — `app/(tabs)/home.tsx`
- Compute `todos = buildBusinessTodos(...)` + `handleTodoAction(todo)` (switch on action.kind →
  `setSheetVisible(true)` / `setIsUniversalCreatorOpen(true)` / `router.push(route)`).
- Render `<BusinessTodoToggle>` directly under the `barWrap`/TopBar (both desktop + mobile).
- REMOVE: the "No brands yet" / "Choose a brand" / "Loading brands" empty-branch cards,
  `<NoVenueDeckEntryCard>`, the mobile `<DeckReadinessCard>` entry branch, `<HomeNextActionCard>`
  (all rungs), and the `home-empty` `<OfferingChooser>`.
- Analytics gating (render only with real data):
  - Live hero — keep (`primaryLiveEvent !== null`).
  - Revenue KPI — only when `rev7d > 0`.
  - Active Events KPI — only when `counts.total > 0`.
  - Upcoming section header + list — only when `upcoming.items.length > 0` (drop "No upcoming events" card).
  - If nothing qualifies → just the toggle (and pull-to-refresh).
- DeckReadinessCard component itself stays (used by the deck-readiness screen / Hub if needed) but its Home entry branch is removed.

### D. Hub wiring — `app/(tabs)/hub/_layout.tsx`
- Render `<BusinessTodoToggle>` between TopBar and `<HubSubNav>` (above the pills).
- Remove the `getstarted` tab from `deriveHubVisibleTabs` + delete/redirect `/getstarted`
  route (the "Create your first offering" todo replaces it). When all counts 0 and no tabs,
  the sub-nav simply shows no pills; the toggle carries the action.

### E. Decommission
- `OfferingChooser` Home + Hub usages removed; component retained for `BrandCreationFlow`.
- `homeNextAction.ts` / `HomeNextActionCard.tsx` — logic folded into `buildBusinessTodos`;
  keep `pickHomeNextAction` only if still referenced elsewhere, else remove. (Check refs.)

## Tests
- `businessTodos.test.ts` — full priority/condition matrix (new, happy + adversarial).
- `BusinessTodoToggle.test.tsx`/`.ts` — empty→null, ordering, onAction dispatch, collapse.
- Rewrite `home.orch_0974.test.tsx` to lock the NEW structure (toggle present under top bar,
  analytics gated, single FlatList retained, empty-state cards gone). `[TEST-MOD-APPROVED ORCH-1038]`.
- Keep green: `homeNextAction.test.ts` (or migrate), `upcomingBuilder.test.ts`, hub tests,
  `NoVenueDeckEntryCard.sub_e`/`DeckReadinessCard.sub_e`/`deckReadinessRoutes.sub_e`.

## Out of scope
- No backend/edge/migration changes. Pure client UI.
- Deck-readiness screen internals unchanged (still the detail destination).
