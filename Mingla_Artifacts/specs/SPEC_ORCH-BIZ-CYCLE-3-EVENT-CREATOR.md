# SPEC — ORCH-BIZ-CYCLE-3 Event Creator (7-step wizard)

**Spec author:** mingla-forensics (SPEC mode following INVESTIGATE)
**Investigation:** [`reports/INVESTIGATION_ORCH-BIZ-CYCLE-3-EVENT-CREATOR.md`](../reports/INVESTIGATION_ORCH-BIZ-CYCLE-3-EVENT-CREATOR.md)
**Dispatch:** [`prompts/FORENSICS_BIZ_CYCLE_3_EVENT_CREATOR.md`](../prompts/FORENSICS_BIZ_CYCLE_3_EVENT_CREATOR.md)
**Cycle:** 3 — wedge cycle (5 journeys, 1 wizard surface)
**Codebase:** `mingla-business/`
**Date:** 2026-04-30
**Status:** READY FOR ORCHESTRATOR REVIEW

---

## §1 Layman summary

This spec defines exactly what to build for Cycle 3 — a 7-step event creator wizard plus draft persistence plus publish gate plus minimal events-tab Drafts landing. After implementation, a founder can run end-to-end:

1. Tap "Build a new event" on Home
2. Walk through 7 steps (Basics → When → Where → Cover → Tickets → Settings → Preview)
3. Hit Publish — depending on state, either succeeds, prompts to connect Stripe, or surfaces missing fields
4. Resume any draft from Home Upcoming list or Events tab Drafts section
5. Preview their event in-app before publishing

The implementation produces 7 NEW files + 2 MOD files. Zero new kit primitives (DEC-079 closure honoured). Zero new design tokens. 8 new TRANSITIONAL Toasts (all exit-conditioned to specific future cycles). 2 retired TRANSITIONAL Toasts.

---

## §2 Scope + non-goals

### In scope (5 journeys, 7 steps, 3 routes, 2 wires)

**Journeys:**
- **J-E1** — Build first event from Home empty state (Roadmap §3.2 line 98)
- **J-E2** — Publish event with paid tickets (Stripe live) (line 99)
- **J-E3** — Publish event when Stripe missing (line 100)
- **J-E4** — Edit draft event (line 101)
- **J-E12** — Publish-with-validation-errors (line 109)

**7 wizard steps** per BUSINESS_PRD §3.1 + DEC-065 (adopt-with-refine):
- Step 1 — Basics
- Step 2 — When
- Step 3 — Where
- Step 4 — Cover
- Step 5 — Tickets
- Step 6 — Settings
- Step 7 — Preview

**3 new routes:**
- `mingla-business/app/event/create.tsx` — wizard create entry (also handles `?step=N` deep-link; redirects to `/event/[id]/edit?step=N` after first save)
- `mingla-business/app/event/[id]/edit.tsx` — wizard resume entry (`?step=N` query supported)
- `mingla-business/app/event/[id]/preview.tsx` — in-app preview (PREVIEW ribbon)

**2 wire-ups (TRANSITIONAL retires):**
- `mingla-business/app/(tabs)/home.tsx:110-112` Build CTA Toast → `router.push("/event/create")`
- `mingla-business/app/(tabs)/home.tsx:220-225` "See all" Toast → `router.push("/(tabs)/events")`

**1 partial-light:**
- `mingla-business/app/(tabs)/events.tsx` — Drafts section only (Cycle 9 expands to full Live/Upcoming/Past)

### Non-goals (hard limits)

| Feature | Reason | Cycle of record |
|---|---|---|
| Real publish backend | DEC-071 frontend-first | B-cycle |
| Real geocoding / Places autocomplete | Scope | B-cycle |
| Real image/GIF upload + storage | Scope | B-cycle |
| Recurring events | Scope | Cycle 4 (J-E5..J-E8) |
| Standalone ticket editor (27 PRD §4.1 fields) | Scope | Cycle 5 (J-T1..J-T8) |
| Public event page on mingla-web | Scope | Cycle 6 |
| Share modal post-publish | Scope | Cycle 7 |
| Event detail / cancel / change-summary / orders / refunds | Scope | Cycle 9 |
| Live/Upcoming/Past sections on events tab | Scope | Cycle 9 |
| Analytics events (Mixpanel/AppsFlyer) | B5 ships analytics | B5 |
| AI agent / chat surfaces | M19+ | Post-MVP |
| Web parity | DEC-071 mobile-only | Cycle 6 (web public page) + later |
| New kit primitives | DEC-079 kit closure | none — orchestrator-ratified DEC required for any future addition |
| New design tokens | Scope | none |
| External libs (react-hook-form, zod, formik) | Scope (inline validation) | B-cycle if validation tax > 200 LOC |

### Assumptions

1. **Expo Router 6** patterns: `useLocalSearchParams` reads dynamic-segment `id` and query params; `useRouter` has `push/replace/back/canGoBack`. Confirmed via `app/brand/[id]/index.tsx`.
2. **GestureHandlerRootView** wraps app root for Sheet pan gestures. Confirmed via cycle-2 J-A8 polish RC-1 fix.
3. **AsyncStorage** is available via `@react-native-async-storage/async-storage`. Confirmed via existing currentBrandStore.
4. **Logout cleanup chain** exists somewhere (likely `app/_layout.tsx` or auth provider). Implementor confirms during pre-flight; if not present, spec requires creation of a `clearAllStores()` utility. **D-IMPL-CYCLE-3-LOGOUT-CHAIN** below flags as discovery.

---

## §3 Layer specifications

### 3.1 Persistence layer — `draftEventStore`

**File:** `mingla-business/src/store/draftEventStore.ts` (NEW)

**Schema v1.** AsyncStorage key: `mingla-business.draftEvent.v1`.

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
} from "zustand/middleware";

import { generateDraftId, generateTicketId } from "../utils/draftEventId";

/**
 * Draft event state — Cycle 3 sibling store to currentBrandStore.
 *
 * [TRANSITIONAL] Zustand persist holds all drafts client-side. B-cycle
 * migrates drafts to server-side storage; this store contracts to a
 * cache + ID-only when backend lands.
 *
 * Per Cycle 3 spec §3.1.
 */

export interface TicketStub {
  id: string;
  name: string;
  /** Null when isFree=true; otherwise positive number in GBP whole-units. */
  priceGbp: number | null;
  /** Null currently treated as "post-Cycle-3 unlimited"; required to set a positive integer in Cycle 3. */
  capacity: number | null;
  isFree: boolean;
}

export type DraftEventFormat = "in_person" | "online" | "hybrid";
export type DraftEventVisibility = "public" | "unlisted" | "private";
export type DraftEventStatus = "draft" | "publishing" | "live";

export interface DraftEvent {
  id: string;                          // d_<ts36>
  brandId: string;
  // Step 1
  name: string;
  description: string;
  format: DraftEventFormat;
  category: string | null;
  // Step 2
  repeats: "once";                     // Cycle 3 lock; Cycle 4 expands union
  date: string | null;                 // ISO YYYY-MM-DD
  doorsOpen: string | null;            // HH:mm
  endsAt: string | null;               // HH:mm
  timezone: string;                    // default "Europe/London"
  // Step 3
  venueName: string | null;
  address: string | null;
  onlineUrl: string | null;
  // Step 4
  coverHue: number;                    // default 25
  // Step 5
  tickets: TicketStub[];
  // Step 6
  visibility: DraftEventVisibility;
  requireApproval: boolean;
  allowTransfers: boolean;
  hideRemainingCount: boolean;
  passwordProtected: boolean;
  // Meta
  lastStepReached: number;             // 0..6
  status: DraftEventStatus;
  createdAt: string;                   // ISO
  updatedAt: string;                   // ISO
}

export interface DraftEventState {
  drafts: DraftEvent[];
  createDraft: (brandId: string) => DraftEvent;
  getDraft: (id: string) => DraftEvent | null;
  updateDraft: (id: string, patch: Partial<Omit<DraftEvent, "id" | "brandId" | "createdAt">>) => void;
  setLastStep: (id: string, step: number) => void;
  deleteDraft: (id: string) => void;
  publishDraft: (id: string) => void;  // sets status: "live" then deletes (Cycle 3 fire-and-forget)
  reset: () => void;
}

type PersistedState = Pick<DraftEventState, "drafts">;

const DEFAULT_DRAFT_FIELDS: Omit<DraftEvent, "id" | "brandId" | "createdAt" | "updatedAt"> = {
  name: "",
  description: "",
  format: "in_person",
  category: null,
  repeats: "once",
  date: null,
  doorsOpen: null,
  endsAt: null,
  timezone: "Europe/London",
  venueName: null,
  address: null,
  onlineUrl: null,
  coverHue: 25,
  tickets: [],
  visibility: "public",
  requireApproval: false,
  allowTransfers: true,
  hideRemainingCount: false,
  passwordProtected: false,
  lastStepReached: 0,
  status: "draft",
};

const persistOptions: PersistOptions<DraftEventState, PersistedState> = {
  name: "mingla-business.draftEvent.v1",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (state) => ({ drafts: state.drafts }),
  version: 1,
};

export const useDraftEventStore = create<DraftEventState>()(
  persist(
    (set, get) => ({
      drafts: [],

      createDraft: (brandId) => {
        const now = new Date().toISOString();
        const draft: DraftEvent = {
          ...DEFAULT_DRAFT_FIELDS,
          id: generateDraftId(),
          brandId,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ drafts: [...s.drafts, draft] }));
        return draft;
      },

      getDraft: (id) => get().drafts.find((d) => d.id === id) ?? null,

      updateDraft: (id, patch) => {
        const now = new Date().toISOString();
        set((s) => ({
          drafts: s.drafts.map((d) =>
            d.id === id ? { ...d, ...patch, updatedAt: now } : d,
          ),
        }));
      },

      setLastStep: (id, step) => {
        set((s) => ({
          drafts: s.drafts.map((d) =>
            d.id === id
              ? { ...d, lastStepReached: Math.max(d.lastStepReached, step) }
              : d,
          ),
        }));
      },

      deleteDraft: (id) => {
        set((s) => ({ drafts: s.drafts.filter((d) => d.id !== id) }));
      },

      publishDraft: (id) => {
        // Cycle 3 stub: mark live then dispose. Cycle 9 retains as event record.
        set((s) => ({ drafts: s.drafts.filter((d) => d.id !== id) }));
      },

      reset: () => set({ drafts: [] }),
    }),
    persistOptions,
  ),
);

export const useDraftsForBrand = (brandId: string | null): DraftEvent[] =>
  useDraftEventStore((s) =>
    brandId === null ? [] : s.drafts.filter((d) => d.brandId === brandId),
  );

export const useDraftById = (id: string | null): DraftEvent | null =>
  useDraftEventStore((s) =>
    id === null ? null : s.drafts.find((d) => d.id === id) ?? null,
  );
```

**Constitution #6 wiring:** `draftEventStore.reset()` MUST be called from the auth signout cleanup chain. Implementor pre-flight task: locate the existing logout chain (likely in `mingla-business/src/auth/` or `mingla-business/app/_layout.tsx`); add `useDraftEventStore.getState().reset()` alongside existing `useCurrentBrandStore.getState().reset()`. If no chain exists, file as **D-IMPL-CYCLE-3-LOGOUT-CHAIN** in implementation report and propose a new utility.

### 3.2 Validation layer

**File:** `mingla-business/src/utils/draftEventValidation.ts` (NEW)

```ts
import type {
  DraftEvent,
  DraftEventFormat,
  TicketStub,
} from "../store/draftEventStore";

/**
 * Per-step + publish-gate validation rules for the event creator wizard.
 *
 * Rules grounded in BUSINESS_PRD §U.5.1 required-to-publish list +
 * Cycle 3 spec §4 validation table.
 *
 * NEVER use this util to bypass user-visible field errors — it returns
 * structured error keys for inline rendering. Calling site (step body)
 * maps error keys to copy.
 */

export type ValidationError = {
  /** Identifier for the field — drives inline rendering + Fix-jump logic. */
  fieldKey: string;
  /** Step index (0-based) where this field lives. */
  step: number;
  /** Human-readable message for J-E12 errors sheet. */
  message: string;
};

export const validateStep = (
  step: number,
  draft: DraftEvent,
): ValidationError[] => {
  switch (step) {
    case 0:
      return validateBasics(draft);
    case 1:
      return validateWhen(draft);
    case 2:
      return validateWhere(draft);
    case 3:
      return validateCover(draft);
    case 4:
      return validateTickets(draft);
    case 5:
      return validateSettings(draft);
    case 6:
      return [];                       // preview step has no validation
    default:
      return [];
  }
};

export const validatePublish = (
  draft: DraftEvent,
  brandStripeStatus: "not_connected" | "onboarding" | "active" | "restricted",
): ValidationError[] => {
  const errors: ValidationError[] = [];
  for (let step = 0; step < 7; step++) {
    errors.push(...validateStep(step, draft));
  }
  // Cross-step: any paid ticket → Stripe must be active
  const hasPaidTicket = draft.tickets.some(
    (t) => !t.isFree && (t.priceGbp ?? 0) > 0,
  );
  if (hasPaidTicket && brandStripeStatus !== "active") {
    errors.push({
      fieldKey: "stripeNotConnected",
      step: 4, // Tickets step (where the paid pricing was set)
      message: "Connect Stripe to publish paid tickets.",
    });
  }
  return errors;
};

const validateBasics = (d: DraftEvent): ValidationError[] => {
  const errs: ValidationError[] = [];
  if (d.name.trim().length === 0) {
    errs.push({ fieldKey: "name", step: 0, message: "Event name is required." });
  }
  if (d.description.trim().length === 0) {
    errs.push({ fieldKey: "description", step: 0, message: "Add a short description." });
  }
  if (d.category === null) {
    errs.push({ fieldKey: "category", step: 0, message: "Pick a category." });
  }
  // format always set (default in_person), no rule
  return errs;
};

const validateWhen = (d: DraftEvent): ValidationError[] => {
  const errs: ValidationError[] = [];
  if (d.date === null) {
    errs.push({ fieldKey: "date", step: 1, message: "Set the event date." });
  } else if (new Date(d.date) < startOfToday()) {
    errs.push({ fieldKey: "date", step: 1, message: "Date can't be in the past." });
  }
  if (d.doorsOpen === null) {
    errs.push({ fieldKey: "doorsOpen", step: 1, message: "Set the door-open time." });
  }
  if (d.endsAt === null) {
    errs.push({ fieldKey: "endsAt", step: 1, message: "Set the end time." });
  }
  return errs;
};

const validateWhere = (d: DraftEvent): ValidationError[] => {
  const errs: ValidationError[] = [];
  if (d.format === "in_person" || d.format === "hybrid") {
    if (d.venueName === null || d.venueName.trim().length === 0) {
      errs.push({ fieldKey: "venueName", step: 2, message: "Add a venue name." });
    }
    if (d.address === null || d.address.trim().length === 0) {
      errs.push({ fieldKey: "address", step: 2, message: "Add the venue address." });
    }
  }
  if (d.format === "online" || d.format === "hybrid") {
    if (d.onlineUrl === null || d.onlineUrl.trim().length === 0) {
      errs.push({ fieldKey: "onlineUrl", step: 2, message: "Add the online conferencing link." });
    }
  }
  return errs;
};

const validateCover = (_d: DraftEvent): ValidationError[] => {
  // coverHue always set (default 25); always passes
  return [];
};

const validateTickets = (d: DraftEvent): ValidationError[] => {
  const errs: ValidationError[] = [];
  if (d.tickets.length === 0) {
    errs.push({ fieldKey: "tickets.empty", step: 4, message: "Add at least one ticket type." });
    return errs;
  }
  d.tickets.forEach((t, i) => {
    if (t.name.trim().length === 0) {
      errs.push({
        fieldKey: `tickets[${i}].name`,
        step: 4,
        message: `Ticket ${i + 1} needs a name.`,
      });
    }
    if (!t.isFree && (t.priceGbp === null || t.priceGbp <= 0)) {
      errs.push({
        fieldKey: `tickets[${i}].price`,
        step: 4,
        message: `Set a price for ${t.name || `ticket ${i + 1}`}, or mark it free.`,
      });
    }
    if (t.capacity === null || t.capacity <= 0) {
      errs.push({
        fieldKey: `tickets[${i}].capacity`,
        step: 4,
        message: `Set a capacity for ${t.name || `ticket ${i + 1}`}.`,
      });
    }
  });
  return errs;
};

const validateSettings = (d: DraftEvent): ValidationError[] => {
  // visibility always set (default public); always passes
  return [];
};

const startOfToday = (): Date => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
```

### 3.3 ID generator utility

**File:** `mingla-business/src/utils/draftEventId.ts` (NEW)

```ts
/**
 * ID generators for draft events + tickets.
 *
 * Format-agnostic per Cycle 2 invariant I-11. Matches the established
 * `b_<ts36>` pattern from currentBrandStore — same generator approach,
 * different prefix.
 */

export const generateDraftId = (): string =>
  `d_${Date.now().toString(36)}${randomSuffix()}`;

export const generateTicketId = (): string =>
  `t_${Date.now().toString(36)}${randomSuffix()}`;

const randomSuffix = (): string =>
  Math.random().toString(36).slice(2, 8);
```

### 3.4 Wizard component layer

**File:** `mingla-business/src/components/event/EventCreatorWizard.tsx` (NEW)

**Component signature:**

```ts
export interface EventCreatorWizardProps {
  /** When provided, opens in resume mode for that draft. When null, treats as fresh-create (caller passes the new draft id). */
  draftId: string;
  /** Called when wizard exits successfully (publish complete OR fully-discarded draft). */
  onExit: (mode: "published" | "discarded" | "abandoned") => void;
  /** Initial step from `?step=N` query param. Defaults to draft.lastStepReached. */
  initialStep?: number;
  /** When true, wizard chrome shows close-X icon (create mode); when false, back-arrow (edit mode). */
  isCreateMode: boolean;
}
```

**State machine (internal):**

```
States:
  IDLE                 — rendering current step
  ADVANCING            — Continue tapped; running per-step validation
  RETREATING           — back/close tapped; running discard-check
  DISCARD_CONFIRMING   — ConfirmDialog open
  PUBLISH_VALIDATING   — Publish tapped; running publish-gate validation
  PUBLISH_SHOW_ERRORS  — J-E12 errors Sheet open
  PUBLISH_SHOW_STRIPE  — J-E3 banner shown above CTA
  PUBLISH_CONFIRMING   — ConfirmDialog open
  PUBLISHING           — submitting (Spinner)
  EXITING              — onExit callback fired

Transitions:
  IDLE → ADVANCING        (onContinue)
  ADVANCING → IDLE+inline (validation fails)
  ADVANCING → IDLE+next   (validation passes; setStep+1; setLastStep)
  IDLE → RETREATING       (onBack/onClose)
  RETREATING → IDLE       (no edits → just decrement step OR go to /(tabs)/home)
  RETREATING → DISCARD_CONFIRMING (edits exist on full-exit attempt)
  DISCARD_CONFIRMING → IDLE (cancel)
  DISCARD_CONFIRMING → EXITING("discarded") (confirm → deleteDraft + onExit)
  IDLE(step=6) → PUBLISH_VALIDATING (onPublish)
  PUBLISH_VALIDATING → PUBLISH_SHOW_ERRORS  (validation fails)
  PUBLISH_VALIDATING → PUBLISH_SHOW_STRIPE  (only Stripe error)
  PUBLISH_VALIDATING → PUBLISH_CONFIRMING   (all clean)
  PUBLISH_SHOW_ERRORS → IDLE+setStep(N)     (Fix tap)
  PUBLISH_SHOW_ERRORS → IDLE                (Sheet close)
  PUBLISH_SHOW_STRIPE → /payments/onboard   (Connect Stripe Button)
  PUBLISH_CONFIRMING → IDLE                 (cancel)
  PUBLISH_CONFIRMING → PUBLISHING           (confirm)
  PUBLISHING → EXITING("published")         (1.2s Spinner → publishDraft + onExit)
```

**Layout (per designer screens-creator.jsx:21-72):**

Wizard root structure:
```
<View flex=1 paddingTop=insets.top backgroundColor=canvas.discover>
  <View phoneBg style={{position: "absolute", inset: 0}} />  {/* designer line 23 */}
  <StatusBar />                                              {/* designer line 24 */}
  
  {/* CHROME — back/close + progress dots + counter */}
  <View row paddingHorizontal=spacing.md gap=spacing.sm>
    <IconChrome icon={isFirstStep ? "close" : "chevL"} size={36} onPress={handleBack} />
    <View flex=1>
      <Stepper current={currentStep} total={7} variant="compact" />
    </View>
    <Text styles.counter>{currentStep + 1}/7</Text>
  </View>
  
  {/* BRAND CONTEXT (subtitle row) */}
  <View paddingHorizontal=spacing.md paddingTop=spacing.xs>
    <Text styles.brandSubtitle>{currentBrand.displayName}</Text>
  </View>
  
  {/* BODY — scrollable step content */}
  <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
    <Text styles.eyebrow>Step {currentStep + 1} of 7</Text>
    <Text styles.stepTitle>{stepDef.title}</Text>
    <Text styles.stepSub>{stepDef.subtitle}</Text>
    {renderStepBody(currentStep)}
  </ScrollView>
  
  {/* DOCK — Continue / Publish buttons */}
  <GlassCard padding={spacing.md} style={styles.dock}>
    {isLastStep ? (
      <>
        <Button variant="primary" size="lg" onPress={handlePublish} loading={isPublishing}>Publish event</Button>
        <Button variant="ghost" size="md" onPress={handlePreview}>Preview public page</Button>
      </>
    ) : (
      <Button variant="primary" size="lg" onPress={handleContinue}>Continue</Button>
    )}
  </GlassCard>
  
  {/* OVERLAYS — mounted at root for I-13 portal contract */}
  <ConfirmDialog
    visible={discardDialogVisible}
    variant="simple"
    isDestructive
    title={isCreateMode ? "Discard this event?" : "Discard your changes?"}
    description={isCreateMode ? "You'll lose your changes." : "Original draft remains."}
    confirmLabel="Discard"
    onConfirm={handleConfirmDiscard}
    onCancel={() => setDiscardDialogVisible(false)}
  />
  <ConfirmDialog
    visible={publishConfirmVisible}
    variant="simple"
    title="Publish event?"
    description="Public sale starts immediately. You can edit details after publishing."
    confirmLabel="Publish"
    onConfirm={handleConfirmPublish}
    onCancel={() => setPublishConfirmVisible(false)}
  />
  <Sheet
    visible={errorsSheetVisible}
    snap="half"
    onClose={() => setErrorsSheetVisible(false)}
  >
    {/* Renders error list with Fix links */}
  </Sheet>
</View>
```

**Sub-component decomposition:**
- `EventCreatorWizard.tsx` — root + state machine + chrome + dock + overlays
- `CreatorStep1Basics.tsx` — Step 1 body
- `CreatorStep2When.tsx` — Step 2 body
- `CreatorStep3Where.tsx` — Step 3 body
- `CreatorStep4Cover.tsx` — Step 4 body
- `CreatorStep5Tickets.tsx` — Step 5 body
- `CreatorStep6Settings.tsx` — Step 6 body
- `CreatorStep7Preview.tsx` — Step 7 body
- `PublishErrorsSheet.tsx` — J-E12 errors Sheet content
- `PreviewEventView.tsx` — `/event/[id]/preview` route's view component (MID-fidelity port)

**Total NEW component files:** 10 (wizard root + 7 step bodies + errors sheet + preview view).

### 3.5 Route layer

#### Route 1 — `mingla-business/app/event/create.tsx` (NEW)

```ts
/**
 * /event/create — wizard entry from Home "Build a new event" CTA (J-E1).
 *
 * Reads currentBrand at mount. If null → bounces to /(tabs)/home with
 * Toast "Pick a brand first." Otherwise creates a new draft via
 * draftEventStore.createDraft(brandId), then immediately replaces to
 * /event/{newId}/edit?step=0. The replace (not push) avoids a /create
 * stack frame — back from Step 1 returns to /(tabs)/home directly.
 *
 * Format-agnostic ID resolver per I-11. Host-bg cascade per I-12 — but
 * this route never renders chrome; it redirects in useEffect.
 *
 * Per spec §3.5 route 1.
 */
```

Logic:
1. `useEffect`: if `currentBrand === null` → `router.replace("/(tabs)/home")`; show Toast "Pick a brand first." (via global Toast — sets store flag or fires immediately)
2. Else: `const draft = useDraftEventStore.getState().createDraft(currentBrand.id)`; `router.replace("/event/" + draft.id + "/edit?step=0")`
3. While effect runs, render a Spinner centered + canvas.discover background

#### Route 2 — `mingla-business/app/event/[id]/edit.tsx` (NEW)

```ts
/**
 * /event/[id]/edit — wizard resume entry (J-E4).
 *
 * Reads dynamic `id` segment + optional `?step=N` query. Resolves draft
 * via useDraftEventStore.getDraft(id). When draft exists → renders
 * EventCreatorWizard at requested step (or draft.lastStepReached if no
 * step query). When draft NOT found → bounces to /(tabs)/home with
 * Toast "Draft not found."
 *
 * Format-agnostic ID resolver per I-11. Host-bg cascade per I-12.
 *
 * Per spec §3.5 route 2.
 */
```

Logic:
1. Read `id` from `useLocalSearchParams<{ id: string | string[]; step?: string }>()`
2. Resolve draft via `useDraftById(id)`
3. If draft === null → `router.replace("/(tabs)/home")` + Toast
4. Else: render `<EventCreatorWizard draftId={draft.id} initialStep={parsedStep} isCreateMode={false} onExit={handleExit} />`
5. `handleExit("published")` → Toast "[name] is live." + secondary "Find this event in Events tab — Cycle 9." + `router.replace("/(tabs)/home")`
6. `handleExit("discarded")` → Toast "Draft discarded." + `router.replace("/(tabs)/home")`
7. `handleExit("abandoned")` → just `router.back()` (back-stack handles it)

Same pattern as `app/brand/[id]/index.tsx`:25-33 — copy verbatim.

#### Route 3 — `mingla-business/app/event/[id]/preview.tsx` (NEW)

```ts
/**
 * /event/[id]/preview — in-app preview of a draft event.
 *
 * Reads dynamic `id` segment, resolves draft via useDraftEventStore.
 * Renders PreviewEventView (MID-fidelity port of designer's
 * PublicEventScreen) with PREVIEW ribbon and back button.
 *
 * Format-agnostic ID resolver per I-11. Host-bg cascade per I-12.
 *
 * Per spec §3.5 route 3.
 */
```

Logic:
1. Read `id` from params
2. Resolve via `useDraftById(id)`
3. If null → `router.replace("/(tabs)/home")` + Toast "Draft not found."
4. Else: render `<PreviewEventView draft={draft} onBack={() => router.back()} />`

### 3.6 Wire-ups (existing file MODs)

#### MOD `mingla-business/app/(tabs)/home.tsx`

| Line(s) | Before | After |
|---|---|---|
| 110-112 `handleBuildEvent` | `setToast({ visible: true, message: "Event creation lands in Cycle 3." });` | If `currentBrand !== null`: `router.push("/event/create")`. Else: existing `setSheetVisible(true)` (opens BrandSwitcherSheet to create a brand first) + Toast "Create a brand first." |
| 220-225 "See all" Pressable | `setToast({ visible: true, message: "Events list lands in Cycle 3." })` | `router.push("/(tabs)/events")` |
| 256-279 STUB_UPCOMING_ROWS .map | Renders 2 hardcoded rows | INSERT before stub rows: render `useDraftsForBrand(currentBrand.id)` rows. Each draft row: `<Pill variant="draft">Draft</Pill>` chip + `draft.name || "Untitled draft"` + relative-time (e.g., "Started 2h ago") + tap `router.push("/event/" + draft.id + "/edit")`. Stub rows continue to render after draft rows. |
| Header docstring | "Stub event-list rows are [TRANSITIONAL] hardcoded — replaced by real event fetch in B1+ when event endpoints land." | UNCHANGED (stub rows still TRANSITIONAL until Cycle 9). Add new line: "Cycle 3 wires draft rows from draftEventStore — those rows are real (not stub). Stub rows below remain until Cycle 9." |
| Imports | (existing) | Add `useRouter` from `expo-router`; add `useDraftsForBrand` from `../../src/store/draftEventStore`; add `formatRelativeTime` from `../../src/utils/relativeTime` |

#### MOD `mingla-business/app/(tabs)/events.tsx`

Replace placeholder body with Drafts-only section:

```tsx
{drafts.length === 0 ? (
  <GlassCard variant="elevated" padding={spacing.lg}>
    <Text style={styles.emptyTitle}>No drafts yet</Text>
    <Text style={styles.emptyBody}>
      Tap "Build a new event" on Home to start your first draft.
    </Text>
  </GlassCard>
) : (
  <View style={styles.draftsCol}>
    <Text style={styles.sectionLabel}>DRAFTS</Text>
    {drafts.map((draft) => (
      <Pressable
        key={draft.id}
        onPress={() => router.push(`/event/${draft.id}/edit`)}
        style={styles.draftRow}
      >
        <View style={styles.draftCoverWrap}>
          <EventCover hue={draft.coverHue} radius={12} label="" height={56} width={56} />
        </View>
        <View style={styles.draftTextCol}>
          <View style={styles.draftPillRow}>
            <Pill variant="draft">Draft</Pill>
          </View>
          <Text style={styles.draftTitle} numberOfLines={1}>
            {draft.name || "Untitled draft"}
          </Text>
          <Text style={styles.draftSub} numberOfLines={1}>
            {`Step ${draft.lastStepReached + 1} of 7 · ${formatRelativeTime(draft.updatedAt)}`}
          </Text>
        </View>
      </Pressable>
    ))}
  </View>
)}
<Text style={styles.footerNote}>
  Live, Upcoming, and Past sections land in Cycle 9.
</Text>
```

Header docstring update: replace "Cycle 9 lands content here" → "Cycle 3 lights up the Drafts section. Live / Upcoming / Past sections land Cycle 9."

### 3.7 Currency-aware rendering (Constitution #10)

Ticket prices in Step 5 + preview render via `formatGbp(priceGbp)` from `src/utils/currency.ts`. Free tickets render as "Free" (string literal). Capacity rendering uses `formatCount(capacity)`.

NO inline `Intl.NumberFormat` calls anywhere in event creator code.

### 3.8 TRANSITIONAL inventory

| ID | File | Line region | Trigger | Copy | Exit cycle |
|---|---|---|---|---|---|
| TRANS-CYCLE-3-1 | `CreatorStep4Cover.tsx` | "Replace" Button onPress | Toast | "Custom image upload lands B-cycle." | B-cycle |
| TRANS-CYCLE-3-2 | `CreatorStep4Cover.tsx` | "Crop" Button onPress | Toast | "Crop tool lands B-cycle." | B-cycle |
| TRANS-CYCLE-3-3 | `CreatorStep5Tickets.tsx` | "Add ticket type" CTA onPress (when no ticket exists yet OR when adding 2nd+ ticket) | Toast | "Full ticket editor lands Cycle 5." (Cycle 3 ships inline ticket creation via a Sheet — minimal name/price/capacity/free-toggle; Cycle 5 ships standalone editor with all 27 PRD §4.1 fields) | Cycle 5 |
| TRANS-CYCLE-3-4 | `CreatorStep5Tickets.tsx` | Ticket card "edit" pencil onPress | Toast | "Edit ticket details — Cycle 5." | Cycle 5 |
| TRANS-CYCLE-3-5 | `CreatorStep2When.tsx` | Repeats Sheet footer | Caption inside sheet (NOT Toast) | "More repeat options coming Cycle 4." | Cycle 4 |
| TRANS-CYCLE-3-6 | `CreatorStep1Basics.tsx` | Category Sheet footer | Caption inside sheet (NOT Toast) | "Real categories taxonomy lands B-cycle." | B-cycle |
| TRANS-CYCLE-3-7 | `EventCreatorWizard.tsx` | Post-publish success Toast secondary message | Toast secondary line | "Find this event in Events tab — Cycle 9." | Cycle 9 |
| TRANS-CYCLE-3-8 | `app/event/[id]/preview.tsx` | PREVIEW ribbon footer | Inline label | "PREVIEW · NOT YET PUBLISHED · Full public page lands Cycle 6." | Cycle 6 |

**Retired (2):**
- `home.tsx:110-112` Toast "Event creation lands in Cycle 3."
- `home.tsx:220-225` Toast "Events list lands in Cycle 3."

**Net delta:** +8 new − 2 retired = **+6**.

Implementor report MUST enumerate this exact inventory.

### 3.9 Step body specs

Each step body component receives `{ draft, updateDraft, errors }` props from `EventCreatorWizard` and renders fields per below.

#### Step 1 — Basics (`CreatorStep1Basics.tsx`)

Fields per designer line 82-104:
- **Event name** — `<Input label="Event name" value={draft.name} onChangeText={(v) => updateDraft({ name: v })} error={errors.name} />`
- **Format** — 3-pill segmented control (In person / Online / Hybrid). Tap selects + updates `draft.format`. Active pill: `accent.tint` bg + `accent.border` border. Inactive: `glass.tint.profileBase` + `glass.border.profileBase`. Inline composition (3+ uses → kit-watch-point but DEC-079 closure → defer).
- **Category** — Pressable row "input-shaped" with current value + chevron-down icon. Tap opens a Sheet (see CategorySheet below).

**CategorySheet** — Sheet snap=`half` listing 8 stub categories: Nightlife · Brunch · Concert · Festival · Workshop · Pop-up · Private · Other. Each row: tap → `updateDraft({ category })` + close sheet. Footer caption: "Real categories taxonomy lands B-cycle." (TRANS-CYCLE-3-6).

NEW field beyond designer (PRD U.5.1 required): **Event description** — multi-line text area (use `Input` with `multiline` if supported; else inline `<TextInput>` styled to match Input). Designer mock omits this from Step 1 but PRD requires it; spec adds it here for Cycle 3 sufficiency. Watch-point W-A11-DESC: "Move to Step 4 alongside cover for narrative grouping?" — founder decides post-smoke. Implement in Step 1 for Cycle 3.

#### Step 2 — When (`CreatorStep2When.tsx`)

Fields per designer line 106-126:
- **Repeats** — Pressable row → opens RepeatsSheet (Sheet snap=`peek`, single row "Once" selected, footer caption TRANS-CYCLE-3-5)
- **Date** — Pressable row → opens native iOS/Android date picker (use existing DateTimePicker if available; if not, fall back to a manual `<Input>` with format-helper "DD/MM/YYYY"). **D-IMPL-CYCLE-3-DATEPICKER** — implementor flags if no DateTimePicker available; spec defaults to manual input for safety.
- **Doors open** + **Ends** — 2-column grid; each Pressable opens time picker (similar fallback)
- **Timezone** — Pressable row → opens TimezoneSheet (Sheet snap=`half`, hardcoded list of 6 common UK/EU timezones: Europe/London, Europe/Dublin, Europe/Paris, Europe/Berlin, Europe/Madrid, UTC). Default Europe/London.

#### Step 3 — Where (`CreatorStep3Where.tsx`)

Render branches by `draft.format`:

**format === "in_person":**
- **Venue name** — Input
- **Address** — Input with helper "Hidden until the buyer has a ticket"
- **Map preview placeholder** — solid striped View (no real geocoding; Cycle 3 stub)
- **Privacy info card** — GlassCard with location icon + copy "Address appears in tickets and confirmation emails — not on the public page until the guest checks out."

**format === "online":**
- **Online conferencing URL** — Input (placeholder: "https://...")
- **Privacy info card** — "Link is shared with ticketed guests only."

**format === "hybrid":**
- All in_person fields PLUS online URL field

#### Step 4 — Cover (`CreatorStep4Cover.tsx`)

Per designer line 163-184:
- **Cover preview** — `<EventCover hue={draft.coverHue} radius={radius.lg} label="cover · 16:9" height={180} />`
- **Replace** + **Crop** buttons (2-col grid) — both fire TRANSITIONAL Toasts (TRANS-CYCLE-3-1, TRANS-CYCLE-3-2)
- **GIF library** label
- **6-tile grid** — hardcoded hues `[25, 100, 180, 220, 290, 320]`. Each tile: `<Pressable onPress={() => updateDraft({ coverHue: hue })}><EventCover hue={hue} radius={radius.md} label="" height={null} aspectRatio={1} /></Pressable>`. Selected tile gets `accent.border` 2px outline.

#### Step 5 — Tickets (`CreatorStep5Tickets.tsx`)

Per designer line 186-235:
- **Ticket cards list** — for each ticket in `draft.tickets`, render TicketEditCard component
- **TicketEditCard** — GlassCard with: name (top), pricing/capacity 2-col stats, edit pencil icon (top-right). Edit pencil onPress → TRANS-CYCLE-3-4 Toast.
- **Add ticket type CTA** — dashed-border GlassCard, full-width, `+ Add ticket type` label. onPress → opens TicketStubSheet (Sheet snap=`half`).
- **TicketStubSheet** — minimal ticket creator: name Input, "Free" toggle (when off, Price Input shows in £), Capacity Input. Footer: Cancel + Save. Save → `updateDraft({ tickets: [...draft.tickets, newTicket] })` + close.
- **Summary card** — GlassCard with "Total capacity" + "Max revenue" rows. Compute: capacity = sum(t.capacity for t in tickets) · maxRevenue = sum(t.priceGbp * t.capacity for t in tickets where !t.isFree).
- **TRANSITIONAL Toast** for "Full ticket editor lands Cycle 5" (TRANS-CYCLE-3-3) — fires on first time the Add CTA is tapped (debounced; not on every tap).

#### Step 6 — Settings (`CreatorStep6Settings.tsx`)

Per designer line 237-277:
- **Visibility** — 3-pill segmented control (Public / Unlisted / Private). Same pattern as Step 1 Format pill.
- **4 ToggleRows** (compose inline; no kit primitive lift — DEC-079 closure):
  - Require approval (off by default)
  - Allow ticket transfers (on by default)
  - Hide remaining count (off)
  - Password-protected (off)
- **Toggle implementation:** simple animated switch — 44×26 outer, 20×20 inner; `accent.warm` bg when on, `rgba(255,255,255,0.16)` off. Tap toggles value via `updateDraft`.

**Watch-point WK-CYCLE-3-1:** ToggleRow appears 4× in this step. If Cycle 4+ surfaces 5th use, lift to `<ToggleRow />` kit primitive (carve-out DEC required).

#### Step 7 — Preview (`CreatorStep7Preview.tsx`)

Per designer line 279-305:
- **Mini event card** — Pressable → routes to `/event/[id]/preview`. Composition: small EventCover hero (140px height, hue from draft) + accent eyebrow ("Fri 15 May · 9:00 PM" derived from draft.date + draft.doorsOpen) + draft.name + venue / "From £NN" sub.
- **"Ready to publish" status card** — GlassCard with Stripe-state-aware variant:
  - If `brand.stripeStatus === "active"` AND no paid tickets exist OR Stripe-active + paid tickets → green check icon + "Ready to publish" + sub "Tickets will go live at mingla.com/e/{brand.slug}/{stub-slug}."
  - If `brand.stripeStatus !== "active"` AND paid tickets exist → warn icon + "Stripe required for paid tickets" + sub "Connect Stripe to publish." (J-E3 path activates on Publish tap)
  - If `brand.stripeStatus !== "active"` AND only free tickets → green check + "Ready to publish (free event)"
  - If validation errors exist (cross-step) → warn icon + "Some fields are missing" + sub "Tap Publish to see what's missing." (J-E12 path activates on Publish tap)

### 3.10 PreviewEventView spec

**File:** `mingla-business/src/components/event/PreviewEventView.tsx` (NEW)

MID-fidelity port of `screens-extra.jsx` PublicEventScreen line 7-262.

Layout (top → bottom):
- **Hero** (380px tall): EventCover full-bleed at top + linear gradient overlay bottom
- **Floating chrome** (top 50px from screen top): back IconChrome (left), share IconChrome (right) — share fires TRANSITIONAL Toast "Share modal lands Cycle 7."
- **PREVIEW ribbon** (top 100px): Pill variant=`accent` text "PREVIEW · NOT YET PUBLISHED"
- **Content** (starts at 280px from top, scrolls):
  - Eyebrow accent: formatted date (e.g., "Fri 15 May · 9:00 PM" from draft.date + draft.doorsOpen)
  - Title: draft.name (h1)
  - Brand row: brand monogram tile + brand name + " · 0 going" (stub)
  - Venue card: location icon + draft.venueName + draft.address-clipped-with-helper "address shown after checkout"
  - About section: draft.description (or "No description yet" placeholder)
  - Tickets section: draft.tickets list as `<PublicTicketRow />` (composed inline — name + price + sub "X / Y sold" stub since real sales don't exist)
  - Footer note: "PREVIEW · Full public page lands Cycle 6." (TRANS-CYCLE-3-8)

LOC budget: ~150-180 LOC.

### 3.11 Logout cleanup chain

**Implementor pre-flight task (D-IMPL-CYCLE-3-LOGOUT-CHAIN):**

1. Locate auth signout handler in `mingla-business/` codebase (likely `src/auth/` or `app/_layout.tsx`)
2. Confirm `useCurrentBrandStore.getState().reset()` is called there
3. Add `useDraftEventStore.getState().reset()` adjacent
4. If chain doesn't exist, create `src/utils/clearAllStores.ts`:
   ```ts
   import { useCurrentBrandStore } from "../store/currentBrandStore";
   import { useDraftEventStore } from "../store/draftEventStore";
   
   export const clearAllStores = (): void => {
     useCurrentBrandStore.getState().reset();
     useDraftEventStore.getState().reset();
   };
   ```
   And wire from auth signout
5. Document in implementation report

---

## §4 Validation rules table (per step + publish gate)

| Field | Step | Rule | Error message | Fix-jump target |
|---|---|---|---|---|
| name | 1 | length ≥ 1 | "Event name is required." | step 0 |
| description | 1 | length ≥ 1 | "Add a short description." | step 0 |
| category | 1 | not null | "Pick a category." | step 0 |
| date | 2 | not null | "Set the event date." | step 1 |
| date | 2 | >= today | "Date can't be in the past." | step 1 |
| doorsOpen | 2 | not null | "Set the door-open time." | step 1 |
| endsAt | 2 | not null | "Set the end time." | step 1 |
| venueName | 3 | required if format ∈ {in_person, hybrid}; non-empty | "Add a venue name." | step 2 |
| address | 3 | required if format ∈ {in_person, hybrid}; non-empty | "Add the venue address." | step 2 |
| onlineUrl | 3 | required if format ∈ {online, hybrid}; non-empty | "Add the online conferencing link." | step 2 |
| coverHue | 4 | always set (default 25) | — | — |
| tickets | 5 | length ≥ 1 | "Add at least one ticket type." | step 4 |
| tickets[i].name | 5 | non-empty | "Ticket N needs a name." | step 4 |
| tickets[i].price | 5 | priceGbp > 0 OR isFree=true | "Set a price for {name}, or mark it free." | step 4 |
| tickets[i].capacity | 5 | not null AND > 0 | "Set a capacity for {name}." | step 4 |
| visibility | 6 | always set (default public) | — | — |
| **stripeNotConnected** | publish-gate | if any ticket has priceGbp > 0 → brand.stripeStatus must be "active" | "Connect Stripe to publish paid tickets." | step 4 (Tickets) AND/OR routes to /payments/onboard via banner |

---

## §5 Acceptance criteria (numbered, testable)

47 ACs. Implementor verifies each. Tester maps tests → ACs.

### Wizard chrome + state
- **AC#1** — `/event/create` route creates a new draft and replaces to `/event/{id}/edit?step=0` within 200ms
- **AC#2** — `/event/[id]/edit` route renders EventCreatorWizard at `?step=N` query (or `draft.lastStepReached` if no query)
- **AC#3** — Wizard chrome shows: back/close IconChrome (left) + Stepper (7 dots) + step counter "N/7" (right)
- **AC#4** — Chrome icon is `close` on Step 1 (create mode) AND first-render of edit mode; `chevL` on Step 2-7
- **AC#5** — Brand context subtitle "BrandName · Step N of 7" renders below chrome
- **AC#6** — Step body scrolls; chrome + dock are sticky (paddingTop+paddingBottom flex layout)
- **AC#7** — Continue Button on Steps 1-6 advances to next step on success
- **AC#8** — Step 7 dock shows Publish (primary) + "Preview public page" (ghost) buttons

### Validation per step
- **AC#9** — Continue tap on Step 1 with empty name → inline red border on name field + helper "Event name is required."
- **AC#10** — Continue tap on Step 1 with empty description → inline error on description field
- **AC#11** — Continue tap on Step 1 with no category → category row shows red border
- **AC#12** — Continue tap on Step 2 with no date → inline error on date row
- **AC#13** — Continue tap on Step 2 with past date → inline error "Date can't be in the past."
- **AC#14** — Continue tap on Step 3 with format=in_person and missing venue → inline error
- **AC#15** — Continue tap on Step 3 with format=online and missing URL → inline error
- **AC#16** — Continue tap on Step 5 with no tickets → inline error "Add at least one ticket type."
- **AC#17** — Continue tap on Step 5 with ticket missing capacity → inline error on that ticket card
- **AC#18** — Errors appear ONLY after first Continue tap (not pre-edit)

### Step content
- **AC#19** — Step 1 renders: Event name Input, Format 3-pill, Category row, Description multi-line input
- **AC#20** — Step 2 renders: Repeats row (opens sheet "Once" only), Date row (opens picker), Doors+Ends 2-col, Timezone row
- **AC#21** — Step 3 renders branches: in_person (venue + address + map placeholder + privacy card), online (URL + privacy), hybrid (both)
- **AC#22** — Step 4 renders: cover preview from draft.coverHue, Replace+Crop buttons (TRANSITIONAL), 6-tile GIF grid (sets coverHue)
- **AC#23** — Step 5 renders: ticket cards list, Add CTA, Total/Max-revenue summary
- **AC#24** — Step 5 Add CTA opens TicketStubSheet → save creates ticket in draft.tickets
- **AC#25** — Step 6 renders: Visibility 3-pill + 4 ToggleRows
- **AC#26** — Step 7 renders: mini event card (tappable to /preview), "Ready to publish" status card

### Publish gate (J-E2 / J-E3 / J-E12)
- **AC#27** — Publish tap with all-clean state + Stripe active + paid tickets → ConfirmDialog "Publish event?"
- **AC#28** — ConfirmDialog Confirm → 1.2s Spinner → success Toast "[name] is live." with secondary "Find this event in Events tab — Cycle 9." → routes to /(tabs)/home
- **AC#29** — Publish tap with paid tickets + Stripe NOT active → in-page banner above CTA "Connect Stripe to publish paid tickets" + "Connect Stripe" Button → routes to /brand/[brandId]/payments/onboard
- **AC#30** — Publish tap with validation errors → Sheet snap=half opens with error list
- **AC#31** — Each error row in errors Sheet has a "Fix" link → tapping closes Sheet AND jumps to step containing that field
- **AC#32** — After Fix-jump to step N, the relevant field shows red-border error state (validation pre-applied)
- **AC#33** — Publish tap with all-free tickets + Stripe NOT active → ConfirmDialog "Publish event?" (no Stripe gate; Stripe required only for paid)

### Resume + edit (J-E4)
- **AC#34** — Tap Draft pill row on Home Upcoming list → routes to /event/{draftId}/edit
- **AC#35** — Tap Draft row on Events tab Drafts section → routes to /event/{draftId}/edit
- **AC#36** — Wizard opens at `draft.lastStepReached` step (resume position)
- **AC#37** — Editing existing draft updates `draft.updatedAt` on every change
- **AC#38** — `lastStepReached` only increments (never decrements on back navigation)

### Discard flow (Q-14)
- **AC#39** — Step 1 close + zero edits → routes to /(tabs)/home (no dialog)
- **AC#40** — Step 1 close + edits exist → ConfirmDialog destructive "Discard this event?"
- **AC#41** — Discard Cancel → stays in wizard at Step 1
- **AC#42** — Discard Confirm in create mode → deleteDraft + Toast "Draft discarded." + routes to /(tabs)/home
- **AC#43** — Discard Confirm in edit mode → ConfirmDialog copy reads "Discard your changes?"; confirming abandons edits without deleting draft (but the in-progress unsaved fields revert — actually because edits are saved live to store, "discard" in edit mode is a no-op message; spec adjusts to: edit-mode Step 1 close just exits without dialog since changes auto-save). **CLARIFICATION:** in edit mode, all field changes save to store immediately on change. There is no "unsaved" state. Therefore edit-mode Step 1 close = simple back navigation, no dialog. Discard is create-mode-only.
- **AC#43-revised** — Edit mode Step 1 close → routes to /(tabs)/home (no dialog; all changes are auto-persisted)

### Preview (Q-8)
- **AC#44** — Tap mini-card on Step 7 → routes to /event/{id}/preview
- **AC#45** — Tap "Preview public page" Button on Step 7 dock → routes to /event/{id}/preview
- **AC#46** — Preview route renders MID-fidelity layout with PREVIEW ribbon
- **AC#47** — Back from preview returns to Step 7

---

## §6 Test cases (35 cases)

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-CYCLE-3-01 | Create-fresh | Tap Build CTA on Home with brand selected | New draft created · routes to /event/{id}/edit?step=0 | Route + Store |
| T-CYCLE-3-02 | Create-no-brand | Tap Build CTA with no brand | BrandSwitcherSheet opens; Toast "Create a brand first." | Route |
| T-CYCLE-3-03 | Step 1 happy | Fill name+description+pick category+pick format · Continue | Advances to Step 2 · lastStepReached=1 | Wizard + Store |
| T-CYCLE-3-04 | Step 1 invalid | Continue with empty name | Inline error on name field; stays on Step 1 | Validation |
| T-CYCLE-3-05 | Step 2 happy | Set date today+1, doors 21:00, ends 03:00, default tz | Advances to Step 3 | Validation |
| T-CYCLE-3-06 | Step 2 past date | Set date yesterday | Inline error "Date can't be in the past." | Validation |
| T-CYCLE-3-07 | Step 2 missing time | Date set, doors null, Continue | Inline error on doors | Validation |
| T-CYCLE-3-08 | Step 3 in_person valid | venue=Hidden Rooms, address=14 Curtain Rd | Advances | Validation |
| T-CYCLE-3-09 | Step 3 online valid | format=online · onlineUrl=https://zoom.us/j/123 | Advances | Validation |
| T-CYCLE-3-10 | Step 3 hybrid invalid | format=hybrid · venue set but onlineUrl missing | Inline error on onlineUrl | Validation |
| T-CYCLE-3-11 | Step 4 hue change | Tap GIF tile hue=290 | Cover preview re-renders with hue 290 · draft.coverHue=290 | Component + Store |
| T-CYCLE-3-12 | Step 4 Replace TRANSITIONAL | Tap Replace | Toast "Custom image upload lands B-cycle." · no state change | Component |
| T-CYCLE-3-13 | Step 5 add ticket | Tap Add CTA · enter name=GA, price=£35, cap=200, free=off · Save | New ticket appended · summary updates (cap=200, max=£7000) | Store |
| T-CYCLE-3-14 | Step 5 add free ticket | name=Friends, free=ON, cap=50 · Save | New ticket priceGbp=null, isFree=true | Store |
| T-CYCLE-3-15 | Step 5 zero tickets | Continue with empty tickets[] | Inline error "Add at least one ticket type." | Validation |
| T-CYCLE-3-16 | Step 6 toggle | Toggle Require approval ON | draft.requireApproval=true | Component |
| T-CYCLE-3-17 | Step 7 preview tap | Tap mini-card | Routes to /event/{id}/preview | Route |
| T-CYCLE-3-18 | Step 7 publish happy | Brand active + paid tickets · Publish · Confirm | 1.2s Spinner · Toast "{name} is live." · routes to /home · drafts[] empty for that id | State machine |
| T-CYCLE-3-19 | Step 7 J-E3 Stripe-missing | Brand not_connected + paid tickets · Publish | In-page banner + Connect Stripe Button · routes to /payments/onboard | Publish gate |
| T-CYCLE-3-20 | Step 7 J-E12 errors | Publish with missing fields | Sheet snap=half opens · errors list visible | Publish gate |
| T-CYCLE-3-21 | Fix-jump | Tap Fix on "venue name" error | Sheet closes · routes to Step 3 · venueName field has red border | Publish gate |
| T-CYCLE-3-22 | Fix-jump preserves errors | After Fix-jump back to Step 3, fill venue, Continue | Advances normally; other errors persist on later steps | Validation |
| T-CYCLE-3-23 | Free-only event publish | All free tickets · Stripe not_connected · Publish | ConfirmDialog (no Stripe gate); confirm publishes | Publish gate |
| T-CYCLE-3-24 | Resume from Home | Create draft halfway · close wizard · tap Draft pill on Home | Routes to /event/{id}/edit at last step | J-E4 |
| T-CYCLE-3-25 | Resume from events tab | Same as 24 but tap from events.tsx Drafts section | Same | J-E4 |
| T-CYCLE-3-26 | Multiple drafts isolated | Create 2 drafts on same brand · navigate between | Each draft persists independently · home shows both | Store |
| T-CYCLE-3-27 | Cross-brand drafts isolated | Create draft on Brand A · switch to Brand B via TopBar · check Home Upcoming | Brand B's drafts only (filtered by brandId) | Store filter |
| T-CYCLE-3-28 | Discard create mode | Step 1 close + edits | ConfirmDialog · confirm → draft deleted · routes to /home | Discard flow |
| T-CYCLE-3-29 | Discard cancel | Step 1 close · ConfirmDialog · Cancel | Stays in wizard | Discard flow |
| T-CYCLE-3-30 | Logout clears drafts | Create draft · sign out · sign back in | drafts[] empty (Constitution #6) | Store reset |
| T-CYCLE-3-31 | Persistence across reload | Create draft · kill app · reopen | Draft persists in AsyncStorage | Persistence |
| T-CYCLE-3-32 | I-11 ID resolver | Manually navigate to /event/d_invalid/edit | Routes back to /home + Toast "Draft not found." | Route guard |
| T-CYCLE-3-33 | I-12 host-bg | Inspect each new route's background | Renders canvas.discover via insets.top + paddingTop | Invariant |
| T-CYCLE-3-34 | I-13 overlay portal | Open errors Sheet from publish gate at Step 7 with body scrolled | Sheet renders at screen root, scrim covers full screen | Invariant |
| T-CYCLE-3-35 | TRANSITIONAL count | grep `[TRANSITIONAL]` in Cycle 3 NEW files | Implementation report shows +8 new − 2 retired = +6 net (within margin) | Convention |

---

## §7 Implementation order (16 steps)

Strict dependency order. Implementor must NOT skip ahead.

1. **Persistence types** — `src/store/draftEventStore.ts` (types + store) + `src/utils/draftEventId.ts` (generators)
2. **Validation utility** — `src/utils/draftEventValidation.ts`
3. **Logout chain wire** — locate auth signout, add `draftEventStore.reset()` (D-IMPL-CYCLE-3-LOGOUT-CHAIN); document if no chain exists
4. **Wizard root chrome** — `src/components/event/EventCreatorWizard.tsx` skeleton: chrome (back/close + Stepper + counter), brand subtitle, scrollable body container, sticky dock; state machine scaffolding
5. **Step 1 Basics body** — `CreatorStep1Basics.tsx` + CategorySheet inline
6. **Step 2 When body** — `CreatorStep2When.tsx` + RepeatsSheet inline + TimezoneSheet inline + date/time picker fallback
7. **Step 3 Where body** — `CreatorStep3Where.tsx` with format-branched rendering
8. **Step 4 Cover body** — `CreatorStep4Cover.tsx` + GIF tile grid + TRANSITIONAL Toasts
9. **Step 5 Tickets body** — `CreatorStep5Tickets.tsx` + TicketEditCard inline + TicketStubSheet inline
10. **Step 6 Settings body** — `CreatorStep6Settings.tsx` + ToggleRow inline (4×)
11. **Step 7 Preview body** — `CreatorStep7Preview.tsx` with Stripe-state-aware status card
12. **Publish gate state machine** — wire ConfirmDialog (publish), Sheet (errors), in-page Stripe banner, post-publish flow
13. **Routes** — `app/event/create.tsx` + `app/event/[id]/edit.tsx` + `app/event/[id]/preview.tsx`
14. **Preview component** — `src/components/event/PreviewEventView.tsx` MID-fidelity port
15. **Wire-ups (MOD)** — `app/(tabs)/home.tsx` (retire 2 Toasts + add draft rows) + `app/(tabs)/events.tsx` (light Drafts section)
16. **Verification** — `npx tsc --noEmit` exit 0; manual smoke through 5 journeys (J-E1..J-E4 + J-E12); invariant grep checks (I-11/I-12/I-13)

After step 16, write implementation report per implementor skill protocol.

---

## §8 Invariant preservation table

| Invariant | Source | Cycle 3 risk | Mitigation in spec |
|---|---|---|---|
| **I-11** Format-agnostic ID resolver | Cycle 2 chain | 2 new dynamic-segment routes need same pattern | §3.5 routes 2 + 3 explicit copy of pattern from `app/brand/[id]/index.tsx:27-33` — NO normalization |
| **I-12** Host-bg cascade | Cycle 2 chain | All 3 new routes need `canvas.discover` paddingTop | §3.5 every route docstring + render: `<View style={{ flex: 1, paddingTop: insets.top, backgroundColor: canvas.discover }}>` |
| **I-13** Overlay-portal contract | Cycle 2 J-A8 RC-1 | Wizard mounts ConfirmDialog × 2 + Sheet × 4 (Repeats / Category / Timezone / Errors / TicketStub) | §3.4 explicit: ALL overlays mount at wizard root JSX (NOT inside step body ScrollView) |
| **Constitution #1** No dead taps | Foundational | 8 new TRANSITIONAL Toasts + 2 retires + multiple navigation handlers | §3.8 every TRANSITIONAL exit-conditioned; every interactive control has onPress wired |
| **Constitution #2** One owner per truth | Foundational | Drafts MUST live only in draftEventStore (NOT Brand.drafts) | §3.1 sibling store; §3.6 home.tsx imports `useDraftsForBrand` not Brand.drafts |
| **Constitution #6** Logout clears | Foundational | NEW store needs reset() in signout chain | §3.11 D-IMPL-CYCLE-3-LOGOUT-CHAIN flagged; mandatory pre-flight task |
| **Constitution #7** TRANSITIONAL labelled | Foundational | 8 new markers | §3.8 inventory table; implementor report enumerates |
| **Constitution #8** Subtract before adding | Foundational | 2 home.tsx Toasts retire BEFORE nav handlers wire; events.tsx placeholder text removed BEFORE Drafts section adds | §3.6 explicit ordering in MOD specs |
| **Constitution #10** Currency-aware UI | Cycle 2 J-A12 enforcement | Ticket prices render as £NN | §3.7 explicit: `formatGbp` from `src/utils/currency.ts`; NO inline `Intl.NumberFormat` |

---

## §9 Regression prevention

| Risk class | Prevention |
|---|---|
| Brand-context drift (user switches brand mid-wizard, draft re-parents) | Wizard chrome has no TopBar (no in-wizard switch surface). Resume resolves draft by id, not currentBrand. Documented in EventCreatorWizard docstring. |
| Draft persistence orphan (logout fails to clear) | D-IMPL-CYCLE-3-LOGOUT-CHAIN mandatory pre-flight; T-CYCLE-3-30 verifies. |
| TRANSITIONAL marker drift (markers added without exit cycles) | §3.8 enumerates all 8 with exit cycles. Implementor report MUST include updated TRANSITIONAL inventory section listing markers + exits. |
| Step transitions skip validation | Per-step Continue check enforced (§4 rules table). Test cases T-CYCLE-3-04..15 cover invalid-input paths. |
| Publish gate ships paid event without Stripe | Cross-step rule in §4. Test case T-CYCLE-3-19 verifies J-E3 path. |
| Wizard rendering breaks Sheet portal (I-13) | All overlays mount at wizard root, not inside step ScrollView. §3.4 explicit. T-CYCLE-3-34 verifies. |
| Cross-brand draft leak | `useDraftsForBrand(brandId)` filters at read site. T-CYCLE-3-27 verifies. |
| Edit-mode discard misbehaves | Edit-mode Step 1 close = simple back-nav (auto-save semantics). AC#43-revised + T-CYCLE-3-29. |
| Multi-draft isolation | Drafts keyed by id; updates target only that record. T-CYCLE-3-26 verifies. |

---

## §10 Discoveries for orchestrator

| ID | Discovery | Action |
|---|---|---|
| **D-IMPL-CYCLE-3-LOGOUT-CHAIN** | Verify auth signout chain calls store.reset() — wire draftEventStore.reset() if exists; create utility if not | Implementor pre-flight gate G-1 |
| **D-IMPL-CYCLE-3-DATEPICKER** | Native DateTimePicker may not be available — fallback to manual `<Input>` with format helper | Implementor decides at Step 2 build; logs choice in implementation report |
| **D-CYCLE-3-CATEGORY-LIST** | 8 stub category names need founder confirmation: Nightlife / Brunch / Concert / Festival / Workshop / Pop-up / Private / Other | Founder reviews before smoke or accepts placeholders |
| **D-CYCLE-3-PREVIEW-FIDELITY** | MID-fidelity preview (~150-200 LOC) may feel underbaked or overdone at smoke — adjust post-feedback | Founder decides post-smoke |
| **D-INV-CYCLE-3-1** | I-11/I-12/I-13 not in global INVARIANT_REGISTRY.md — promote post-Cycle-3 close | Orchestrator schedules separate task |
| **WK-CYCLE-3-1** | ToggleRow appears 4× in Step 6 — watch-point for Cycle 4+ kit lift if 5th use materializes (DEC-079 carve-out required) | Tracked watch-point |
| **WK-CYCLE-3-2** | 3-pill segmented control appears 2× (Step 1 Format, Step 6 Visibility). 3rd use → kit lift watch-point | Tracked watch-point |
| **W-A11-1..7** | Step labels watch-points (Q-11) for founder iteration after smoke | Tracked watch-points |
| **D-CYCLE-3-DESC-PLACEMENT** | Description field added to Step 1 (PRD-required, designer omits). Founder may want it elsewhere (Step 4? Step 7?) | Founder reviews; spec defaults to Step 1 |

---

## §11 Confidence summary

| Layer | Confidence | Why |
|---|---|---|
| Type definitions (DraftEvent, TicketStub) | HIGH | PRD U.1 + U.5.1 grounded |
| Persistence (Zustand + persist + migrate) | HIGH | Cycle 2 currentBrandStore precedent |
| Validation rules | HIGH | PRD §U.5.1 grounded |
| Wizard chrome | HIGH | Designer source verbatim |
| Step bodies | HIGH | Designer source verbatim per step |
| Publish gate state machine | HIGH | All 3 paths code-grounded |
| Routes | HIGH | Cycle 2 patterns well-established |
| Preview component | MEDIUM | Stub-depth judgment (D-CYCLE-3-PREVIEW-FIDELITY) |
| Wire-ups | HIGH | Targets explicit |
| Logout chain | MEDIUM | Pre-flight task (D-IMPL-CYCLE-3-LOGOUT-CHAIN) |
| Test cases | HIGH | Each AC mapped |

**Overall: HIGH** for the cycle.

---

## §12 Spec sign-off

This spec is ready for orchestrator REVIEW.

- 47 numbered ACs · 35 test cases · 16-step implementation order
- 9 invariants preserved (I-11/I-12/I-13 + Constitutional #1/#2/#6/#7/#8/#10)
- 8 NEW TRANSITIONAL markers · 2 retired · +6 net delta
- 7 NEW files · 2 MOD files · 0 kit primitive additions (DEC-079 closure honoured)
- 0 new design tokens · 0 new external libs
- 1 mandatory pre-flight task (D-IMPL-CYCLE-3-LOGOUT-CHAIN)
- 10 discoveries flagged for orchestrator/founder

**End of spec.**
