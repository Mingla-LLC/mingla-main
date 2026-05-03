# INVESTIGATION — ORCH-BIZ-CYCLE-3 Event Creator (7-step wizard)

**Investigator:** mingla-forensics (INVESTIGATE-THEN-SPEC)
**Dispatch:** [`prompts/FORENSICS_BIZ_CYCLE_3_EVENT_CREATOR.md`](../prompts/FORENSICS_BIZ_CYCLE_3_EVENT_CREATOR.md)
**Spec output:** [`specs/SPEC_ORCH-BIZ-CYCLE-3-EVENT-CREATOR.md`](../specs/SPEC_ORCH-BIZ-CYCLE-3-EVENT-CREATOR.md)
**Cycle:** 3 — the wedge cycle
**Codebase:** `mingla-business/`
**Date:** 2026-04-30
**Confidence:** HIGH for 14 of 15 architectural decisions; MEDIUM for Q-8 (Preview composition fidelity — judgment call on stub depth)

---

## §1 Layman summary

Cycle 3 turns the brand-side scaffolding into a working organiser app. Today the founder can sign in, create a brand, edit it, manage teammates, set up Stripe, see live payments, and pull finance reports — but cannot create a single event. After Cycle 3 ships, the founder runs through a 7-step wizard (Basics → When → Where → Cover → Tickets → Settings → Preview) and produces a "live" event in stub data. Five user journeys bundle here because they all share that wizard:

- **J-E1** — start a new event from Home's "Build a new event" CTA
- **J-E2** — publish when Stripe is connected → success Toast
- **J-E3** — try to publish when Stripe is missing → "Connect Stripe" gate routes to existing onboarding screen (J-A10)
- **J-E4** — resume an in-progress draft from Home's Upcoming list → wizard reopens at the last step the user reached
- **J-E12** — try to publish with missing required fields → modal lists each missing field with "Fix" links that jump back to the right step

No backend lands. No real Stripe call. No mingla-web public page (Cycle 6). No standalone ticket editor (Cycle 5). No recurring events (Cycle 4). No event-detail screen / cancel / management (Cycle 9). Cycle 3 is intentionally the tightest possible spine: one wizard surface + one publish gate state machine + one draft persistence layer, glued to the existing home / account / payments scaffolding.

After Cycle 3, every founder demo and every "is this real?" investor question gets a 4-minute answer: build an event start to finish, see it preview, hit Publish.

---

## §2 Scope confirmation (cross-checked against 4 sources)

| Source | Confirms | Cite |
|---|---|---|
| Roadmap §3.1 row 272 | Cycle 3 = J-E1, J-E2, J-E3, J-E4, J-E12 · 48 hrs · ships in `mingla-business` | `SPEC_BIZ_FRONTEND_JOURNEY_BUILD_ROADMAP.md:272` |
| Roadmap §3.2 lines 98-115 | Each journey's entry → step → result trio | same file `:98-115` |
| Roadmap §4 line 241 | Source: `screens-creator.jsx` (EventCreatorScreen + steps 1-7) — adopt-with-refine per Q-A10 | same file `:241` |
| Roadmap §6 line 441-451 | Cycle 3 detail: 7-step wizard · target routes · DraftEvent state shape per design package U.1 · refinement focus on labels | same file `:441-451` |
| BUSINESS_PRD §3.1 line 210 | Event creation is a 7-step wizard with locked labels (DEC-065): Basics / When / Where / Cover / Tickets / Settings / Preview | `BUSINESS_PRD.md:210` |
| BUSINESS_PRD §U.1 line 706-732 | Event data model: id · brandId · title · description · location · startDateTime · endDateTime · timezone · isRecurring · recurrenceRules · visibility · coverMedia · theme · organiserContact · tickets[] · marketingSettings · trackingSettings · scannerSettings · paymentSettings · status | `BUSINESS_PRD.md:706-732` |
| BUSINESS_PRD §U.5.1 line 831-843 | Required-to-publish fields: Brand · title · description · date · start time · location-or-online · ≥1 ticket · price-or-free · quantity-or-unlimited · payment-if-paid · visibility | `BUSINESS_PRD.md:831-843` |
| Designer source `screens-creator.jsx` 1-307 | Verbatim wizard layout: chrome (back/close + 7-segment progress + step counter + Continue/Publish footer) + each step's form fields | `Mingla_Artifacts/design-package/.../screens-creator.jsx` |
| Designer source `screens-extra.jsx` 7-262 | PublicEventScreen for in-app preview port (Cycle 3 ships MID-fidelity; Cycle 6 ships full) | `Mingla_Artifacts/design-package/.../screens-extra.jsx` |
| DEC-070 Q-A10 | Wizard step labels = ADOPT-WITH-REFINE (founder iterates after smoke) | `DECISION_LOG.md:19` |
| DEC-071 | Frontend-first; backend deferred entirely; no API/edge-fn work | `DECISION_LOG.md` |
| DEC-072 | Producer model: business creates events, mobile consumes them via Discover/deck. Cycle 3 doesn't write to consumer-side; that's Cycle 5+ data path | `DECISION_LOG.md` |
| DEC-079 / DEC-080 / DEC-082 / DEC-083 | Kit closure rule + 3 carve-outs (TopSheet, Icon-set, Avatar) — Cycle 3 must NOT add new primitives without orchestrator-ratified DEC | `DECISION_LOG.md:6-12` |

**Verdict:** scope is fully grounded. No source contradicts another. PRD U.5.1 is the canonical required-fields list (drives validation rules in spec). Designer source is the canonical layout (drives step content in spec). Roadmap is the canonical journey set (drives publish-gate state machine in spec).

---

## §3 Investigation manifest

Files read in trace order. Every read flagged for layer + finding category.

| # | File | Lines | Layer | Finding |
|---|---|---|---|---|
| 1 | `Mingla_Artifacts/specs/SPEC_BIZ_FRONTEND_JOURNEY_BUILD_ROADMAP.md` | 28, 94-115, 241-247, 271-272, 441-451 | Docs | Cycle scope confirmed (5 journeys / 7 steps / 48 hrs) |
| 2 | `Mingla_Artifacts/BUSINESS_PRD.md` | 201-264 (§3 event creation) + 706-861 (§U.0–U.5 data model + required fields) | Docs | DraftEvent shape grounded; required-to-publish list grounded |
| 3 | `Mingla_Artifacts/DECISION_LOG.md` | DEC-065/066/067 (referenced via DEC-070), DEC-070 (audit resolution), DEC-071, DEC-072, DEC-079 / DEC-080 / DEC-082 / DEC-083 (kit carve-outs) | Docs | Adopt-with-refine + frontend-first + producer model + kit-closure constraints all confirmed |
| 4 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` | full | Docs | I-PHOTO-FILTER-EXPLICIT + I-DB-ENUM-CODE-PARITY are app-mobile/supabase invariants. **The Cycle 2 invariants I-11/I-12/I-13 are NOT in the global registry** — they live in the Cycle 2 spec/impl chain. **Discovery D-INV-CYCLE-3-1 below.** |
| 5 | `Mingla_Artifacts/design-package/.../screens-creator.jsx` | 1-307 (full) | Docs | All 7 step layouts, sub-components (Field, TicketEditCard, ToggleRow), wizard chrome contract |
| 6 | `Mingla_Artifacts/design-package/.../screens-extra.jsx` | 1-80 (PublicEventScreen) | Docs | Source for `/event/[id]/preview` port; PREVIEW ribbon styling; share button on hero |
| 7 | `mingla-business/src/components/ui/Sheet.tsx` | 1-90 | Code (kit) | Native Modal portal (I-13) confirmed; pan-gesture v2; 3 snap points (peek/half/full) |
| 8 | `mingla-business/src/components/ui/ConfirmDialog.tsx` | 1-30 | Code (kit) | 3 variants; simple for publish-confirm; destructive flag for discard |
| 9 | `mingla-business/src/components/ui/Stepper.tsx` | 1-30 | Code (kit) | Wizard step indicator EXISTS — perfect for 7-segment progress dots (no inline composition needed) |
| 10 | `mingla-business/src/components/ui/Button.tsx` | 1-30 | Code (kit) | Loading state + 4 variants + 3 sizes — no extension needed |
| 11 | `mingla-business/src/components/ui/Input.tsx` | 1-30 | Code (kit) | Single-line input — covers Steps 1, 3, 5 text fields |
| 12 | `mingla-business/src/components/ui/Pill.tsx` | 1-30 | Code (kit) | `draft` variant exists — perfect for Home Upcoming list draft rows + events tab |
| 13 | `mingla-business/src/components/ui/Toast.tsx` | 1-30 | Code (kit) | 4 kinds + auto-dismiss timing per kind |
| 14 | `mingla-business/src/components/ui/EventCover.tsx` | 1-30 | Code (kit) | Hue-driven SVG striped placeholder — perfect for cover stub |
| 15 | `mingla-business/src/components/ui/TopBar.tsx` | 1-30 | Code (kit) | Brand chip + back kind variants. **Wizard does NOT use TopBar** — has its own custom chrome. **No TopBar contract change in Cycle 3.** |
| 16 | `mingla-business/src/components/ui/GlassCard.tsx` | 1-30 | Code (kit) | base + elevated variants — used inside step bodies + bottom CTA dock |
| 17 | `mingla-business/src/components/ui/Modal.tsx` | 1-30 | Code (kit) | Centered overlay — backs ConfirmDialog |
| 18 | `mingla-business/src/components/ui/IconChrome.tsx` | 1-30 | Code (kit) | 36×36 circular glass icon button — used for back/close in wizard chrome |
| 19 | `mingla-business/src/components/ui/Spinner.tsx` | 1-30 | Code (kit) | Sizes 24/36/48 — used in ConfirmDialog confirm Button during publish |
| 20 | `mingla-business/src/store/currentBrandStore.ts` | 1-427 (full) | Code (state) | v9 schema · zustand+persist+migrate pattern · `events?: BrandEventStub[]` already added (J-A12). **Comment line 167-171 explicitly says "Real per-event records ship Cycle 3 in a separate table" — confirms sibling store recommendation (Q-4).** |
| 21 | `mingla-business/src/store/brandList.ts` | 1-40 (header) + 70-110 (sample) | Code (data) | Stub-data convention; passes through migrations |
| 22 | `mingla-business/app/(tabs)/home.tsx` | 1-316 (full) | Code (route) | **Two TRANSITIONAL Toasts retire in Cycle 3:** line 110-112 `handleBuildEvent` ("Event creation lands in Cycle 3.") · line 220-225 "See all" link ("Events list lands in Cycle 3."). Build CTA visual at line 282-295 preserved. |
| 23 | `mingla-business/app/(tabs)/events.tsx` | 1-117 (full) | Code (route) | Existing placeholder ("Cycle 9 lands content here.") **Cycle 3 minimally lights it up with a Drafts section only — Live/Upcoming/Past stay deferred.** |
| 24 | `mingla-business/app/brand/[id]/index.tsx` | 1-30 | Code (route) | Established route pattern: ID resolver (I-11) + canvas.discover (I-12) — wizard route follows same pattern |
| 25 | `mingla-business/app/brand/[id]/payments/onboard.tsx` | 1-35 | Code (route) | J-A10 onboarding screen target for J-E3 Stripe-missing path |
| 26 | `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_2_J_A12_FINANCE_REPORTS.md` | 179-200 (invariant table) + 341-345 (invariant glossary) | Docs | I-11/I-12/I-13 definitions confirmed (in cycle-2 chain only) |

26 files read. Zero contradictions. One discovery (D-INV-CYCLE-3-1 below).

---

## §4 Findings

### 🟡 Hidden Flaw H-CYCLE3-1 — `app/(tabs)/events.tsx` placeholder owns header text "Cycle 9 lands content here" but Home `See all` Toast says "Events list lands in Cycle 3"

| Field | Detail |
|---|---|
| **File + line** | `mingla-business/app/(tabs)/events.tsx:59` ("Cycle 9 lands content here.") vs `mingla-business/app/(tabs)/home.tsx:221` ("Events list lands in Cycle 3.") |
| **Exact code** | events.tsx:59 `<Text style={styles.body}>Cycle 9 lands content here.</Text>` · home.tsx:221 `setToast({ visible: true, message: "Events list lands in Cycle 3." })` |
| **What it does today** | Inconsistent messaging — home Toast promises Cycle 3 will deliver an events list; events tab promises Cycle 9. Either could be right depending on scope. |
| **What it should do** | Cycle 3 retires home.tsx Toast (route to `/(tabs)/events`) AND minimally lights events.tsx with a Drafts section so the destination is non-empty. The Cycle-9 message moves under a "More views land Cycle 9" footer (not the entire screen). |
| **Causal chain** | Cycle 1 dispatch wrote home.tsx Toast referencing Cycle 3 → Cycle 0a/1 wrote events.tsx placeholder referencing Cycle 9 → no later cycle reconciled → drift accumulated → Cycle 3 must reconcile when retiring the home Toast. |
| **Verification** | grep `Cycle 9 lands` in events.tsx (1 hit) + grep `Cycle 3` in home.tsx (1 hit) — both confirmed. |

### 🟡 Hidden Flaw H-CYCLE3-2 — No global INVARIANT_REGISTRY entry for I-11 / I-12 / I-13

| Field | Detail |
|---|---|
| **File + line** | `Mingla_Artifacts/INVARIANT_REGISTRY.md` (no business-side entries) |
| **Exact code** | Registry contains `I-PHOTO-FILTER-EXPLICIT` + `I-DB-ENUM-CODE-PARITY` only (both app-mobile/supabase scoped) |
| **What it does today** | Cycle 2 invariants I-11 (format-agnostic ID resolver), I-12 (host-bg cascade), I-13 (overlay-portal contract) live ONLY in the cycle-2 spec/impl chain — they're informally enforced but not registry-tracked. New cycles re-discover them by reading prior reports. |
| **What it should do** | Promote I-11/I-12/I-13 to global registry entries during Cycle 3 closure (or sooner) so future cycles inherit them via single-source registry. |
| **Causal chain** | Cycle 2 created the invariants in spec text but no later step promoted them to registry → registry stayed photo-pipeline-only → drift risk per ORCH-0686 lessons. |
| **Verification** | grep `I-11\|I-12\|I-13` in INVARIANT_REGISTRY.md (0 hits) vs grep in cycle-2 specs (12+ hits). |

**Discovery D-INV-CYCLE-3-1** — Promote I-11/I-12/I-13 to global INVARIANT_REGISTRY before more cycles ship. Recommend orchestrator schedule a small registry-promotion task post-Cycle-3 close. NOT IN CYCLE-3 SCOPE.

### 🟡 Hidden Flaw H-CYCLE3-3 — Wizard's custom chrome bypasses TopBar contract; brand-context display becomes wizard-internal

| Field | Detail |
|---|---|
| **File + line** | Designer `screens-creator.jsx:26-41` (custom progress bar + back/close button + step counter — no TopBar) |
| **Exact code** | Designer chrome composes raw `<button>` (back/close) + dot row + mono `step+1/total` text — does NOT use TopBar primitive |
| **What it does today** | Existing brand-side routes (`(tabs)/home`, `(tabs)/events`, `(tabs)/account`, `/brand/[id]/payments`, etc.) ALL use TopBar (with brand chip on tabs, back kind elsewhere). The wizard breaks this convention. |
| **What it should do** | Honour designer's custom chrome BUT document the TopBar absence as a deliberate exception in the wizard route's docstring. Brand context displayed via subtitle "BrandName · Step N of 7" inside the wizard body, not via TopBar chip. **No mid-wizard brand switching is possible** — confirmed safe. |
| **Causal chain** | Designer mock has its own chrome (UX choice for wizard immersion) → consistent with Cycle 6 public preview pattern → not a violation but a deliberate variant pattern |
| **Verification** | Read every file in `mingla-business/app/` and confirm TopBar is on every other route; the wizard's `event/create.tsx` and `event/[id]/edit.tsx` are the only TopBar-less routes shipped in Cycle 3. |

**Resolution:** documented in spec §3 (chrome contract) — implementor explicitly cites this hidden flaw in route docstrings. NO behaviour change.

### 🔵 Observation O-CYCLE3-1 — Stepper primitive perfectly matches designer's progress dots

The kit's `Stepper` (compact mobile variant — 8×8 dots in horizontal row, completed/current/future colour states) maps 1:1 to designer line 32-40 (Array.from({length: total}).map dots). **No new primitive needed.** Implementor uses Stepper directly with `current={step}` + `total={7}`.

### 🔵 Observation O-CYCLE3-2 — Pill primitive's `draft` variant is purpose-built for Home Upcoming list + events tab Drafts section

Already in use at home.tsx:263-265 for stub draft rows. When Cycle 3 wires real drafts, the visual contract is preserved — drafts appear as `<Pill variant="draft">Draft</Pill>` chips above row title.

### 🔵 Observation O-CYCLE3-3 — currentBrandStore docstring at line 167-171 explicitly anticipated this cycle

> "Real event records ship in Cycle 3 (event creator) and live in a separate table; this Brand-level stub field exists ONLY to drive the J-A12 finance reports' Top events list..."

This validates the sibling-store decision (Q-4 Option c). Cycle 3 follows the anticipation.

### 🔵 Observation O-CYCLE3-4 — PRD U.1 Event shape vs DraftEvent stub: schema simplification justified for Cycle 3

PRD U.1 includes 18 top-level fields. Cycle 3 stub omits: `marketingSettings`, `trackingSettings`, `scannerSettings`, `paymentSettings`, `theme`, `organiserContact` — all out of scope per cycle bounds (B-cycle / Cycle 5+ / Cycle 9 / Cycle 7). Stub captures the 12 fields the wizard's 7 steps actually populate. Recommend `// [TRANSITIONAL] Cycle 3 schema; expands in Cycle 5+B-cycle` comment on the type.

---

## §5 Five-layer cross-check

| Layer | Question | Answer | Contradiction? |
|---|---|---|---|
| **Docs** | What should Cycle 3 build? | 5 journeys / 7-step wizard / mobile-only / no backend (Roadmap row 272 + PRD §3.1 + DEC-065/070/071/072) | None |
| **Schema** | What persists where? | `currentBrandStore` v9 (already-existing brand+events stub) UNCHANGED. New sibling `draftEventStore` v1 (drafts[] only). AsyncStorage keys: `mingla-business.currentBrand.v9` + `mingla-business.draftEvent.v1`. | None |
| **Code** | What's missing today? | All 5 routes (`/event/create`, `/event/[id]/edit`, `/event/[id]/preview`, no publish route — handled in-wizard) · `EventCreatorWizard.tsx` + 7 step components · `draftEventStore.ts` · validation utilities · publish-gate state machine | None |
| **Runtime** | What happens at runtime? | Wizard mounts → reads currentBrand → checks for `?step=N` query → loads/creates draft → renders Step N → user fills fields → state machine advances → publish gate runs validation → success Toast OR errors Sheet OR Stripe-missing banner. NO API calls. NO Stripe live calls. | None |
| **Data** | What's in storage? | `mingla-business.draftEvent.v1` AsyncStorage key holds `{ drafts: DraftEvent[] }`. Logout clears via `reset()`. | None |

All 5 layers consistent. No bugs uncovered (Cycle 3 is forward-looking — no symptom to root-cause).

---

## §6 Architectural decisions resolved (15 questions)

Each decision: code-grounded recommendation + confidence + rejected alternatives.

### Q-1 — Route architecture

**Decision:** Single file `mingla-business/app/event/create.tsx` with internal step state via `draftEventStore`. Query param `?step=N` for J-E12 fix-jump deep-linking. Edit mode at `mingla-business/app/event/[id]/edit.tsx` with same internal state machine. **Confidence: H.**

Rejected:
- Per-step route files (`/event/create/[step].tsx`) — back-stack confusion (back from Step 5 lands at Step 4 stack frame, not the wizard's prev-step transition); duplicated chrome.
- Hybrid query-param-only — equivalent to (a) once query is allowed; no real distinction.

### Q-2 — Events list landing in Cycle 3 vs Cycle 9

**Decision:** Cycle 3 minimally lights `(tabs)/events.tsx` with a **Drafts section only**. Live / Upcoming / Past stay deferred to Cycle 9. Empty drafts state shows "No drafts yet" + "Build a new event" CTA. Header docstring updated to explain partial-light. Home `See all` retires its Toast → `router.push("/(tabs)/events")`. **Confidence: H.**

Rejected:
- Defer fully — leaves home.tsx "See all" Toast misleading; J-E4 has no entry point unless Drafts surface elsewhere.
- Surface drafts on Home only — works but loses the "events tab is the hub" mental model that Cycle 9 will reinforce. Half-now is better than full-rewire-later.

### Q-3 — DraftEvent state shape

**Decision:** Cycle 3 stub of PRD U.1 (12 of 18 top-level fields). Out-of-scope fields commented as transitional. **Confidence: H.**

```ts
interface DraftEvent {
  id: string;                          // d_<ts36>
  brandId: string;
  // Step 1
  name: string;
  description: string;
  format: "in_person" | "online" | "hybrid";
  category: string | null;
  // Step 2
  repeats: "once";                     // Cycle 3 lock
  date: string | null;                 // ISO YYYY-MM-DD
  doorsOpen: string | null;            // HH:mm
  endsAt: string | null;               // HH:mm
  timezone: string;                    // default "Europe/London"
  // Step 3
  venueName: string | null;
  address: string | null;
  onlineUrl: string | null;            // when format ∈ {online, hybrid}
  // Step 4
  coverHue: number;                    // default 25
  // Step 5
  tickets: TicketStub[];
  // Step 6
  visibility: "public" | "unlisted" | "private";
  requireApproval: boolean;
  allowTransfers: boolean;
  hideRemainingCount: boolean;
  passwordProtected: boolean;
  // Meta
  lastStepReached: number;             // 0-6
  status: "draft" | "publishing" | "live";
  createdAt: string;                   // ISO
  updatedAt: string;                   // ISO
}

interface TicketStub {
  id: string;                          // t_<ts36>
  name: string;
  priceGbp: number | null;             // null = free
  capacity: number | null;             // null = unlimited (post-Cycle-3)
  isFree: boolean;
}
```

Defaults: name="" · description="" · format="in_person" · category=null · repeats="once" · date=null · doorsOpen=null · endsAt=null · timezone="Europe/London" · venueName=null · address=null · onlineUrl=null · coverHue=25 · tickets=[] · visibility="public" · requireApproval=false · allowTransfers=true · hideRemainingCount=false · passwordProtected=false · lastStepReached=0 · status="draft".

### Q-4 — Persistence ownership

**Decision:** New sibling Zustand store `mingla-business/src/store/draftEventStore.ts` v1. Drafts list keyed by id; per-brand filtering at read sites. **Confidence: H.**

Rejected:
- `Brand.drafts: DraftEvent[]` — pollutes a stable schema (would force v9→v10 bump for a different domain); explicitly anticipated as separate per currentBrandStore docstring line 167-171.
- Single global draft slot — loses partial work if user starts a second draft mid-flow.

### Q-5 — Validation strategy

**Decision:** Per-step Continue checks + publish-gate full validation. Inline errors (red border + helper text) appear ONLY after first Continue tap on an invalid step (avoid pre-edit scolding). Publish gate runs cross-step validation; missing items list with Fix-jumps per J-E12. **Confidence: H.**

Per-step rules grounded in PRD U.5.1:
- **Step 1:** name length ≥ 1 · format set · category set
- **Step 2:** date set · doorsOpen set · endsAt set · date >= today (server time)
- **Step 3:** if format ∈ {in_person, hybrid} → venueName + address; if format ∈ {online, hybrid} → onlineUrl
- **Step 4:** coverHue set (always passes; default 25)
- **Step 5:** tickets.length ≥ 1 · each ticket has name + (priceGbp set OR isFree=true) + capacity set
- **Step 6:** visibility set
- **Step 7:** no per-step validation (preview only)

Publish gate cross-step:
- All step rules above PLUS
- If any ticket has priceGbp > 0 → brand.stripeStatus must be "active" (else J-E3 path)
- If any rule fails → J-E12 errors path

### Q-6 — Publish gate UX

**Decision:**
- **Confirm-publish:** ConfirmDialog variant=`simple`, isDestructive=false, title="Publish event?", body="Public sale starts immediately. You can edit details after publishing." Buttons: Cancel · Publish (Spinner during 1.2s simulated submit)
- **J-E3 Stripe-missing:** in-page banner above publish CTA on Step 7. Copy: "Connect Stripe to publish paid events." Button: "Connect Stripe" → `router.push("/brand/[brandId]/payments/onboard")`
- **J-E12 validation errors:** Sheet snap=`half`, scrollable error list. Each row: error message + Fix link → `setStep(N)` closes sheet + jumps to step
- **Post-publish:** wizard removes draft from drafts[], shows success Toast "[draft.name] is live.", routes to `/(tabs)/home`. Live event listing in Home/Events deferred to Cycle 9 (TRANSITIONAL Toast secondary message: "Find this event in Events tab — Cycle 9.")

**Confidence: H.**

Rejected:
- Sheet for confirm — heavier than needed for a 2-button decision.
- Full-screen route `/event/[id]/publish` — out of scope for Cycle 3 (B-cycle when real publish lands).

### Q-7 — Brand context binding

**Decision:** Wizard reads `useCurrentBrand()` at mount. If `currentBrand === null` → bounces to `/(tabs)/home` with Toast "Pick a brand first." Brand context displayed as subtitle "BrandName · Step N of 7" inside wizard body. **Wizard chrome does NOT include TopBar** (designer choice; documented as H-CYCLE3-3) — so mid-wizard brand switching from inside the wizard is impossible. Resume-from-elsewhere safety: if user navigates back to Home, switches brand via TopBar, then returns to a draft via /event/[id]/edit → wizard renders the draft's original brandId regardless of currentBrand (resolved by id, not currentBrand). **Confidence: H.**

Rejected:
- Render TopBar with brand chip — breaks designer chrome contract; no use case justifies the extra surface.
- Force-bind to currentBrand on resume — would silently re-parent the draft to a different brand; data integrity violation.

### Q-8 — Step 7 Preview composition

**Decision:** Step 7 shows the designer mini-card from line 279-294 (small EventCover hero + accent label + title + venue · From £price). Mini-card is tappable → routes to `/event/[id]/preview`. The preview route renders **MID-fidelity port** of `screens-extra.jsx` PublicEventScreen: hero EventCover + title + brand chip + venue card + about + tickets list + PREVIEW ribbon + back button. Skips: organiser block, share button (Cycle 7), full address-after-checkout flow. ~150-200 LOC component. **Confidence: M** (judgment call on stub depth — could be smaller or larger; 150-200 LOC chosen because founder will smoke this and full mingla-web parity isn't possible until Cycle 6).

Rejected:
- Mini-card-only preview (~80 LOC) — doesn't answer "what would my customers see?" — fails the smoke purpose.
- Full PublicEventScreen port (~280 LOC) — Cycle 6 territory; over-invests in soon-to-be-replaced surface.

### Q-9 — Step 2 Recurrence stub

**Decision:** Sheet picker with one row "Once" (selected, only option) + footer caption "More repeat options coming Cycle 4." User picks "Once" (only choice) → sheet dismisses → field shows "Once". Preserves muscle memory; honest about scope. **Confidence: H.**

Rejected:
- Disabled row with Toast "Recurrence lands Cycle 4" — breaks the form rhythm; user expects a sheet.

### Q-10 — Step 4 Cover

**Decision:** Cover renders `<EventCover hue={draft.coverHue} />`. **Replace** Button → TRANSITIONAL Toast "Custom image upload lands B-cycle." **Crop** Button → TRANSITIONAL Toast "Crop tool lands B-cycle." GIF library 6-tile grid: each tile is `<EventCover hue={X} />` (hardcoded hues 25/100/180/220/290/320 covering warm-to-cool spectrum); tap → updates `draft.coverHue` via store. Provides UI affordance even without real image work. **Confidence: H.**

### Q-11 — Step labels (DEC-065 / Q-A10 adopt-with-refine)

**Decision:** Adopt designer labels verbatim: Basics / When / Where / Cover / Tickets / Settings / Preview. Sub-titles per designer (e.g., "Name, format, and category" for Basics — designer line 10). NO refinements in Cycle 3 implementation. **Confidence: H.**

Watch-points logged for founder feedback (orchestrator surfaces post-smoke):
- W-A11-1: "Basics" label feels generic — alternatives "Identity" / "Setup" / "Details"
- W-A11-2: "When" — short and neutral; could be "Schedule" / "Date & time"
- W-A11-3: "Where" — same — could be "Location"
- W-A11-4: "Cover" — clear — no concern
- W-A11-5: "Tickets" — clear — no concern
- W-A11-6: "Settings" — broad — "Visibility & rules" might be more specific
- W-A11-7: "Preview" — clear — no concern

### Q-12 — TRANSITIONAL Toasts inventory

**Decision:** 8 projected new TRANSITIONAL Toasts in Cycle 3, all exit-conditioned. **Confidence: H.**

| # | Trigger | Copy | Exit cycle |
|---|---|---|---|
| 1 | Step 4 "Replace" Button | "Custom image upload lands B-cycle." | B-cycle (image storage) |
| 2 | Step 4 "Crop" Button | "Crop tool lands B-cycle." | B-cycle (image storage) |
| 3 | Step 5 "Add ticket type" CTA | "Full ticket editor lands Cycle 5." | Cycle 5 (J-T1..J-T8) |
| 4 | Step 5 ticket card edit pencil | "Edit ticket details — Cycle 5." | Cycle 5 |
| 5 | Step 2 "Repeats" sheet "Once" only | (sheet footer caption, not Toast) "More repeat options coming Cycle 4." | Cycle 4 (J-E5..J-E8) |
| 6 | Step 1 "Category" sheet stub list | (sheet footer caption, not Toast) "Real categories taxonomy lands B-cycle." | B-cycle |
| 7 | Post-publish success Toast secondary | "Find this event in Events tab — Cycle 9." | Cycle 9 (J-E13/J-E14) |
| 8 | Step 7 "Preview public page" Button → preview route | (route renders PREVIEW ribbon: "PREVIEW · NOT YET PUBLISHED") + footer "Full public page lands Cycle 6." | Cycle 6 (J-P1..J-P6) |

**Retired in this cycle (2):**
- home.tsx:110-112 `handleBuildEvent` Toast → routes to `/event/create`
- home.tsx:220-225 "See all" Toast → routes to `/(tabs)/events`

**Net delta:** +8 new − 2 retired = +6.

### Q-13 — ID convention

**Decision:** `d_<ts36>` for drafts, `t_<ts36>` for tickets-within-drafts. **No persistent live event ID in Cycle 3** (publish disposes draft; Cycle 9 creates persistent event records with `e_<ts36>`). **Confidence: H.**

Rationale: Cycle 3's publish action is symbolic — moves draft from `drafts[]` to nowhere (visible state change is just "live" Toast). Cycle 9 ships actual published-event persistence.

### Q-14 — Discard-changes flow

**Decision:**
- Step 1 close button (X icon) → if draft has zero edits beyond defaults → navigate back to /(tabs)/home; if edits exist → ConfirmDialog destructive "Discard this event? You'll lose your changes." Cancel | Discard.
- Step 2-7 back arrow → in-wizard `setStep(currentStep - 1)`. NO discard prompt (in-wizard navigation only).
- OS back button (Android) / iOS swipe-back from any step → triggers Step-1-close behaviour (full wizard exit attempt with discard prompt if edits exist).
- Edit mode (J-E4): close button is "X" not "← cancel"; discard prompt copy reads "Discard your changes? Original draft remains."

Edit-mode "discard" semantics: in resume-mode, discard means "abandon edits to this draft" — the draft itself is not deleted (user can resume again). In create-mode, discard means "delete this draft entirely."

**Confidence: H.**

### Q-15 — Home CTA wiring

**Decision:**
- home.tsx:282-295 Build CTA `onPress` → if `currentBrand !== null` → `router.push("/event/create")` (creates new draft id + opens wizard at Step 1); else Toast "Pick a brand first." + bounces to brand creation flow (existing BrandSwitcherSheet).
- home.tsx:220-225 "See all" → `router.push("/(tabs)/events")`.
- Home Upcoming list (line 256-279): when `drafts.filter(d => d.brandId === currentBrand.id).length > 0` → render those drafts as additional rows in the Upcoming list (above STUB_UPCOMING_ROWS for now; STUB rows still TRANSITIONAL until Cycle 9 ships real events). Tap on draft row → `router.push("/event/{draftId}/edit")`.

**Confidence: H.**

---

## §7 Blast radius

| Surface | Impact | Action |
|---|---|---|
| `(tabs)/home.tsx` | 2 TRANSITIONAL Toasts retire; Build CTA wires to wizard; Upcoming list adds draft rows | MOD |
| `(tabs)/events.tsx` | Placeholder lights up Drafts section | MOD |
| `(tabs)/account.tsx` | UNCHANGED in Cycle 3 (drafts surface on Home + Events tab; no Account row needed) | NONE |
| `app/event/create.tsx` | NEW route — wizard create entry | NEW |
| `app/event/[id]/edit.tsx` | NEW route — wizard resume entry | NEW |
| `app/event/[id]/preview.tsx` | NEW route — in-app preview | NEW |
| `src/components/event/EventCreatorWizard.tsx` | NEW — wizard root + 7 step bodies | NEW |
| `src/components/event/PreviewEventView.tsx` | NEW — preview render (MID-fidelity port of PublicEventScreen) | NEW |
| `src/store/draftEventStore.ts` | NEW — drafts persistence | NEW |
| `src/utils/draftEventValidation.ts` | NEW — per-step + publish-gate rules | NEW |
| `src/utils/draftEventId.ts` | NEW — `d_<ts36>` + `t_<ts36>` generators | NEW (could go inline or in existing utils) |
| `src/store/currentBrandStore.ts` | UNCHANGED (v9 stays) | NONE |
| `src/components/ui/*` | UNCHANGED (no kit additions; DEC-079 closure honoured) | NONE |
| Existing routes outside event creator | UNCHANGED | NONE |

**Total NEW files:** 7 · **Total MOD files:** 2 · **Total UNCHANGED:** all kit primitives, all stores except draftEventStore, all other routes.

**Constitutional impact:**
- #1 no dead taps — wizard wires every interactive control to either real navigation or TRANSITIONAL Toast with exit cycle
- #2 one owner per truth — drafts owned solely by draftEventStore
- #6 logout clears — draftEventStore.reset() must be called from auth signout (cross-check existing flow)
- #7 TRANSITIONAL labelled — 8 new markers; all exit-conditioned
- #8 subtract before adding — 2 home.tsx Toasts removed BEFORE adding nav handlers + 1 events.tsx placeholder text removed BEFORE adding Drafts section
- #10 currency-aware — TicketStub.priceGbp uses formatGbp from `src/utils/currency.ts` (already established cycle-2 utility)

---

## §8 Invariant preservation

| Invariant | Source | Cycle 3 risk | Mitigation |
|---|---|---|---|
| **I-11** Format-agnostic ID resolver | Cycle 2 chain | `[id]/edit.tsx` and `[id]/preview.tsx` need same pattern | Spec §3.5 explicit: copy resolver from `brand/[id]/index.tsx:27-33` verbatim |
| **I-12** Host-bg cascade | Cycle 2 chain | All 3 new routes need `canvas.discover` paddingTop cascade | Spec §3.5 explicit per route |
| **I-13** Overlay-portal contract | Cycle 2 J-A8 polish RC-1 | Wizard mounts Sheets (Repeats/Category/Timezone/Errors) and ConfirmDialogs (Discard/Publish) — all overlays MUST mount at View root, not inside ScrollView | Spec §3.4 explicit: Sheet/ConfirmDialog placement at wizard root, not inside step body ScrollView |
| **Constitution #2** One owner per truth | Foundational | Drafts could be tempted into Brand.drafts[] — must NOT | Q-4 decision lockdown |
| **Constitution #6** Logout clears | Foundational | New store added — clear() handler must propagate | Spec §3.6 explicit: `draftEventStore.reset()` added to signout cleanup chain |
| **Constitution #10** Currency-aware UI | Cycle 2 J-A12 enforcement | Ticket prices rendered as £NN — must use `formatGbp` not inline `Intl.NumberFormat` | Spec §3.7 explicit: import from `src/utils/currency.ts` |

---

## §9 Discoveries for orchestrator

| ID | Discovery | Cycle 3 in-scope? | Action |
|---|---|---|---|
| **D-INV-CYCLE-3-1** | I-11/I-12/I-13 not in global INVARIANT_REGISTRY.md (live only in cycle-2 spec/impl chain) | NO | Schedule registry-promotion task post-Cycle-3 close |
| **D-CYCLE-3-1** | home.tsx STUB_UPCOMING_ROWS (line 60-77) needs eventual retire — currently TRANSITIONAL but no exit cycle marked | NO | Cycle 9 retires when real events list exists |
| **D-CYCLE-3-2** | events.tsx Drafts-section-only landing leaves an awkward partial-light surface for Cycle 3 to ship and Cycle 9 to expand. Recommend Cycle 9 spec explicitly cite this as the upgrade target | NO | Cycle 9 forensics dispatch reads this discovery |
| **D-CYCLE-3-3** | Step 1 Category stub list — recommend founder confirm the 8 categories before implementor lands (Nightlife / Brunch / Concert / Festival / Workshop / Pop-up / Private / Other). Founder may want a different starter set (e.g., add "Comedy", "Talks", "Social"). Currently spec proposes 8 placeholder categories | YES (in scope but founder-flag) | Spec §10 surfaces for founder decision — implementor uses placeholder if no answer |
| **D-CYCLE-3-4** | Step 7 Preview MID-fidelity port LOC estimate ~150-200 — judgment call. If founder feels it's underbaked at smoke, increase to full PublicEventScreen port (Cycle 6 target anyway). If overkilled, dial back to mini-card-only. Both options spec'd | YES (smoke-driven decision) | Founder decides post-smoke; spec offers MID as default |
| **D-CYCLE-3-5** | Persistence migration story for drafts — when B-cycle backend lands, drafts must migrate from local AsyncStorage to server. Spec explicitly comments draftEventStore as TRANSITIONAL with B-cycle exit | YES (label, not action) | Spec §3.6 adds TRANSITIONAL header comment |

---

## §10 Confidence summary

| Decision | Confidence | Rationale |
|---|---|---|
| Q-1 Route arch (single file + ?step) | HIGH | Expo Router 6 patterns + back-stack semantics + designer chrome contract all align |
| Q-2 Events tab Drafts-only landing | HIGH | Resolves H-CYCLE3-1 messaging drift; supports J-E4 entry; minimal LOC |
| Q-3 DraftEvent shape | HIGH | PRD U.1 + U.5.1 grounded; 12-of-18 fields with explicit out-of-scope comments |
| Q-4 Sibling draftEventStore | HIGH | currentBrandStore line 167-171 explicitly anticipated this split |
| Q-5 Validation strategy | HIGH | PRD U.5.1 grounds rules; per-step + publish-gate dual matches J-E12 fix-jump UX |
| Q-6 Publish gate UX | HIGH | ConfirmDialog + Sheet primitives both available; Stripe-onboard route already exists |
| Q-7 Brand context binding | HIGH | Designer wizard chrome bypasses TopBar (H-CYCLE3-3) — confirmed safe |
| Q-8 Step 7 Preview MID-fidelity | MEDIUM | Judgment call on stub depth; founder feedback at smoke may pivot |
| Q-9 Step 2 Recurrence stub | HIGH | Sheet pattern preserves muscle memory |
| Q-10 Step 4 Cover hue stub | HIGH | EventCover primitive purpose-built |
| Q-11 Step labels adopt-verbatim | HIGH | DEC-065 / Q-A10 explicitly authorise "adopt-with-refine starting point" |
| Q-12 TRANSITIONAL inventory | HIGH | All 8 markers exit-conditioned; +6 net delta |
| Q-13 ID convention | HIGH | Matches established `b_<ts36>` pattern |
| Q-14 Discard flow | HIGH | ConfirmDialog destructive variant + 2-mode (create/edit) copy |
| Q-15 Home CTA wiring | HIGH | Visual preserved; only onPress handler changes |

**Overall confidence: HIGH** for the cycle. One MEDIUM (Q-8) is a stub-depth judgment call, not an architectural risk.

---

## §11 Fix strategy (direction only — not code)

Cycle 3 is **green-field architecture**. No symptom to root-cause. The "fix" is a 7-phase implementation in dependency order:

1. **Persistence + types layer** — `DraftEvent` + `TicketStub` types; `draftEventStore` Zustand+persist; `draftEventId` generator; `draftEventValidation` per-step + publish-gate rules
2. **Wizard chrome + state machine** — `EventCreatorWizard.tsx` root; routing logic for `?step=N` query param; back/close handlers; in-wizard step transitions; brand-context binding
3. **Step 1-7 bodies** — one `CreatorStep[N].tsx` component per step (or 7 inline components in EventCreatorWizard.tsx — implementor decides; spec §3.3 recommends 7 separate files for testability)
4. **Publish gate state machine** — `PublishGateController.tsx` (or inline) — runs validation, branches into J-E2/J-E3/J-E12 paths; manages ConfirmDialog + Sheet + Stripe-banner state
5. **Preview route** — `PreviewEventView.tsx` MID-fidelity port + `event/[id]/preview.tsx` route handler
6. **Home + Events tab wiring** — retire 2 TRANSITIONAL Toasts on home.tsx; light Drafts section on events.tsx; add draft rows to Home Upcoming list
7. **Verification** — tsc strict + manual smoke on all 5 journeys + invariant checks (I-11/I-12/I-13)

Spec §7 contains the exact 16-step implementation order with file paths.

---

## §12 Regression prevention

| Risk class | Prevention |
|---|---|
| Brand-context drift (user switches brand mid-wizard, draft re-parents) | Wizard chrome has NO TopBar (no in-wizard brand switch surface). Resume-from-elsewhere path resolves draft by id (not currentBrand). Documented in spec §3 + EventCreatorWizard docstring. |
| Draft persistence orphan (logout fails to clear) | Constitution #6 — `draftEventStore.reset()` added to logout chain in spec §3.6. Test case T-CYCLE-3-30 verifies. |
| TRANSITIONAL marker drift (markers added without exit cycles) | All 8 markers in spec §3.8 enumerate exit cycles. Implementor report must include an updated TRANSITIONAL inventory section. |
| Step transitions skip validation | Per-step Continue check enforced in spec validation rules table (§4). Test cases T-CYCLE-3-09..18 cover invalid-input paths. |
| Publish gate ships paid event without Stripe | Cross-step publish-gate rule enforced in spec §4. Test case T-CYCLE-3-25 verifies J-E3 path. |
| Wizard rendering breaks Sheet portal (I-13) | All overlays mount at wizard root, not inside step ScrollView. Spec §3.4 explicit. Cycle 2 J-A8 polish RC-1 lessons applied. |

---

## §13 What this investigation does NOT cover (out of scope)

- Real publish backend (B-cycle)
- Real geocoding / Places autocomplete (B-cycle)
- Real image/GIF upload + storage (B-cycle)
- Recurring events (Cycle 4)
- Standalone ticket-type editor with all 27 PRD §4.1 fields (Cycle 5)
- mingla-web public event page (Cycle 6)
- Share modal post-publish (Cycle 7)
- Event detail / cancel-event / change-summary / orders / refunds (Cycle 9)
- Live event listing UI on Home + Events tab Live/Upcoming/Past sections (Cycle 9)
- Analytics events (B5 — Mixpanel/AppsFlyer)
- AI agent chat surfaces (M19+)
- Web parity (DEC-071 mobile-only Cycle 3)
- Per-event detail screen accessed from Events tab (Cycle 9)

The spec spells out each of these as explicit non-goals with cycle-of-record.

---

## §14 Spec handoff

The companion spec at [`specs/SPEC_ORCH-BIZ-CYCLE-3-EVENT-CREATOR.md`](../specs/SPEC_ORCH-BIZ-CYCLE-3-EVENT-CREATOR.md) translates every decision in this report into a contract:

- Every type defined
- Every validation rule tabulated per step
- Every route documented with parameters + back-stack behaviour
- Every step body's layout + form fields + sheet behaviour spelled out
- 2 state machines (step transitions + publish gate)
- 8 TRANSITIONAL markers with exit cycles
- 47 numbered acceptance criteria
- 35 test cases (happy + edge + error paths)
- 16-step implementation order
- Invariant preservation table
- Regression prevention table
- Discovery callouts

Implementor reads the spec verbatim. Tester verifies against the ACs. Orchestrator reviews against the 10-gate protocol.

**End of investigation.**
