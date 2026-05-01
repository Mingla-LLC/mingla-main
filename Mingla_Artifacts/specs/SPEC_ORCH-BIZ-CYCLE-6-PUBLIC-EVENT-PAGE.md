# Spec — ORCH-BIZ-CYCLE-6-PUBLIC-EVENT-PAGE

**ORCH-ID:** ORCH-BIZ-CYCLE-6-PUBLIC-EVENT-PAGE
**Cycle:** 6 — Phase 3 (Public Surfaces). First public-facing surface.
**Pairs with:** [`reports/INVESTIGATION_ORCH-BIZ-CYCLE-6-PUBLIC-EVENT-PAGE.md`](../reports/INVESTIGATION_ORCH-BIZ-CYCLE-6-PUBLIC-EVENT-PAGE.md)
**Mode:** Frontend-only (DEC-071). No backend, no real checkout, no real Stripe charges.
**Pace:** Sequential.

---

## 1. Layman summary

Cycle 6 ships two halves in one cycle:

**Half A — Infrastructure** (~6-8 hrs): A new `liveEventStore` holds published events with computed slugs. The Cycle 3 `publishDraft` stub gets refactored to convert DraftEvent → LiveEvent + push to store + delete draft (atomic transfer). New `eventSlug.ts` helper generates URL-safe brand-scoped slugs. `clearAllStores` extends one line. This unlocks Cycle 9 (event management) + Cycle 13 (reconciliation) downstream.

**Half B — Public Page Surface** (~32-40 hrs): A new route `app/e/[brandSlug]/[eventSlug].tsx` resolves a LiveEvent by URL and renders `PublicEventPage` with 7 state variants (published / sold-out / pre-sale / past-event / password-gate / approval-indication / cancelled). Buyer actions stub to TRANSITIONAL toasts pointing at Cycles 8/10 + B3/B4/B5. SEO meta tags via `expo-router/head`.

**Cycle 5b absorption** (~16 hrs): Ticket description (PRD §4.1) + sale period dates (sale_start_at, sale_end_at). Schema bumps v4 → v5 (additive).

**Total: ~54 hrs.**

---

## 2. Scope and non-goals

### In scope

| Area | Deliverable |
|------|-------------|
| **Persistence** | NEW `liveEventStore.ts` (Zustand persist v1). Schema v4→v5 on TicketStub (description, sale period). |
| **Helpers** | NEW `eventSlug.ts` (URL-safe slug generator + uniqueness check). NEW `liveEventConverter.ts` (DraftEvent → LiveEvent). |
| **publishDraft refactor** | `draftEventStore.publishDraft` → atomic transfer to liveEventStore. |
| **Logout cleanup** | `clearAllStores` extends with `useLiveEventStore.getState().reset()`. |
| **Route** | NEW `app/e/[brandSlug]/[eventSlug].tsx` — Expo Router dynamic segments. |
| **Component** | NEW `PublicEventPage.tsx` — 7 state variants, buyer-flow stubs. |
| **SEO** | `<Head>` from `expo-router/head` with OG + Twitter Card + canonical URL. |
| **5b absorbed** | Ticket description input + render. Sale period start/end pickers + countdown logic for pre-sale variant. |
| **Wizard polish** | After publish, route to public event URL (or celebration screen) instead of bouncing home. |

### Out of scope (hard non-goals)

- ❌ Real checkout / Stripe Payment Element (Cycle 8 + B3)
- ❌ Real waitlist email invites (B5)
- ❌ Real approval submit/notify (B5 + push)
- ❌ Real ticket QR issuance (B3)
- ❌ Backend events/event_dates tables (B1)
- ❌ Buyer accounts / login flow (Cycle 8)
- ❌ Full Share modal (Cycle 7)
- ❌ Public BRAND page (Cycle 7)
- ❌ Public organiser page (Cycle 7)
- ❌ Marketing landing on `mingla.com` (Cycle 15)
- ❌ Cycle 9 event management surfaces (orders, refunds, cancel-event)
- ❌ Real password hashing (B4)
- ❌ Real cover image upload (Cycle 5b/B-cycle)
- ❌ Vanity slug override (Cycle 9 — random-only at publish for Cycle 6)
- ❌ Validity period inputs (Cycle 5b/17 polish)
- ❌ Online-only/In-person-only flags (Cycle 5b/17 polish)
- ❌ Info tooltips on ticket sheet (Cycle 5b/17 polish)
- ❌ Collapsible ticket-sheet sections (Cycle 5b/17 polish)

### Assumptions

- Cycle 5 baseline at commit `c2796b09` is the working tree
- DEC-071 (frontend-first), DEC-076 (auth), DEC-081 (web = Expo Web) all hold
- I-11 through I-15 invariants preserved
- Brand has `slug: string` field (verified — Cycle 1 schema)
- `expo-router/head` works on Expo Web (verified for SDK 54; production smoke at impl time)

---

## 3. Layer-by-layer specification

### 3.1 Persistence layer

#### 3.1.1 NEW `mingla-business/src/store/liveEventStore.ts`

```ts
/**
 * liveEventStore — persisted Zustand store for PUBLISHED events.
 *
 * Constitutional notes:
 *   - #6 logout clears: extend `clearAllStores`. NEW.
 *   - #2 one owner per truth: live events live ONLY here. NEVER duplicated
 *     in draftEventStore. The publishDraft action is the SINGLE ownership
 *     transfer point — establishes invariant I-16.
 *
 * [TRANSITIONAL] Zustand persist holds all live events client-side.
 * B1 backend cycle migrates to server storage; this store contracts to
 * a cache + ID-only when backend lands.
 *
 * Per Cycle 6 spec §3.1.
 */

import { useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
} from "zustand/middleware";

import type {
  DraftEventFormat,
  DraftEventVisibility,
  MultiDateEntry,
  RecurrenceRule,
  TicketStub,
  WhenMode,
} from "./draftEventStore";

export type LiveEventStatus = "live" | "cancelled" | "ended";

export interface LiveEvent {
  // Identity
  id: string;                          // le_<ts36>
  brandId: string;
  brandSlug: string;                   // FROZEN at publish — preserves URL stability
  eventSlug: string;                   // generated; brand-scoped unique
  // Lifecycle
  status: LiveEventStatus;
  publishedAt: string;                 // ISO 8601
  cancelledAt: string | null;          // populated when status = "cancelled"
  endedAt: string | null;              // populated when last event date passes
  // Content snapshot (frozen from DraftEvent at publish)
  name: string;
  description: string;
  format: DraftEventFormat;
  category: string | null;
  whenMode: WhenMode;
  date: string | null;
  doorsOpen: string | null;
  endsAt: string | null;
  timezone: string;
  recurrenceRule: RecurrenceRule | null;
  multiDates: MultiDateEntry[] | null;
  venueName: string | null;
  address: string | null;
  onlineUrl: string | null;
  hideAddressUntilTicket: boolean;
  coverHue: number;
  tickets: TicketStub[];
  visibility: DraftEventVisibility;
  requireApproval: boolean;
  allowTransfers: boolean;
  hideRemainingCount: boolean;
  passwordProtected: boolean;
  // Forward-compat for Cycle 9
  orders: never[];                     // empty until B3
  // Meta
  createdAt: string;                   // when the original draft was created
  updatedAt: string;                   // last modification (publish initially)
}

export interface LiveEventState {
  events: LiveEvent[];
  /** Add a fully-formed LiveEvent. Used by liveEventConverter only. */
  addLiveEvent: (event: LiveEvent) => void;
  /** Lookup by id. */
  getLiveEvent: (id: string) => LiveEvent | null;
  /** Lookup by (brandSlug, eventSlug) — drives public URL routing. */
  getLiveEventBySlug: (
    brandSlug: string,
    eventSlug: string,
  ) => LiveEvent | null;
  /** All live events for a brand — used by Cycle 9. */
  getLiveEventsForBrand: (brandId: string) => LiveEvent[];
  /** Update lifecycle fields (Cycle 9 cancel; Cycle 13 endedAt computation). */
  updateLifecycle: (
    id: string,
    patch: Partial<Pick<LiveEvent, "status" | "cancelledAt" | "endedAt">>,
  ) => void;
  reset: () => void;
}

type PersistedState = Pick<LiveEventState, "events">;

const persistOptions: PersistOptions<LiveEventState, PersistedState> = {
  name: "mingla-business.liveEvent.v1",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (state) => ({ events: state.events }),
  version: 1,
  // No migrate function needed — net new store. Future cycles will add
  // migrators here.
};

export const useLiveEventStore = create<LiveEventState>()(
  persist(
    (set, get) => ({
      events: [],
      addLiveEvent: (event) => {
        set((s) => ({ events: [...s.events, event] }));
      },
      getLiveEvent: (id) => get().events.find((e) => e.id === id) ?? null,
      getLiveEventBySlug: (brandSlug, eventSlug) =>
        get().events.find(
          (e) => e.brandSlug === brandSlug && e.eventSlug === eventSlug,
        ) ?? null,
      getLiveEventsForBrand: (brandId) =>
        get().events.filter((e) => e.brandId === brandId),
      updateLifecycle: (id, patch) => {
        const now = new Date().toISOString();
        set((s) => ({
          events: s.events.map((e) =>
            e.id === id ? { ...e, ...patch, updatedAt: now } : e,
          ),
        }));
      },
      reset: () => set({ events: [] }),
    }),
    persistOptions,
  ),
);

/** Selector hook — public page URL → LiveEvent | null. */
export const useLiveEventBySlug = (
  brandSlug: string | null,
  eventSlug: string | null,
): LiveEvent | null => {
  const events = useLiveEventStore((s) => s.events);
  return useMemo(() => {
    if (brandSlug === null || eventSlug === null) return null;
    return (
      events.find(
        (e) => e.brandSlug === brandSlug && e.eventSlug === eventSlug,
      ) ?? null
    );
  }, [events, brandSlug, eventSlug]);
};

/** Selector hook — all live events for a brand (Cycle 9 future). */
export const useLiveEventsForBrand = (brandId: string | null): LiveEvent[] => {
  const events = useLiveEventStore((s) => s.events);
  return useMemo(
    () => (brandId === null ? [] : events.filter((e) => e.brandId === brandId)),
    [events, brandId],
  );
};
```

#### 3.1.2 NEW `mingla-business/src/utils/liveEventId.ts` (or extend `draftEventId.ts`)

```ts
/** Format-agnostic per I-11. */
export const generateLiveEventId = (): string =>
  `le_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
```

#### 3.1.3 NEW `mingla-business/src/utils/eventSlug.ts`

```ts
/**
 * Event slug generator — URL-safe brand-scoped event slugs.
 *
 * Format: `<kebab-case-from-name>-<4-char-suffix>`
 * Example: "Slow Burn vol. 4" → "slow-burn-vol-4-x7q3"
 *
 * Brand-scoped uniqueness: the suffix retries on collision against the
 * brand's existing live events. Maximum 8 retries before giving up
 * (statistically impossible with 36^4 = 1.6M slot space).
 *
 * Per Cycle 6 spec §3.1.3.
 */

const SLUG_SUFFIX_LEN = 4;
const MAX_RETRIES = 8;

const kebabify = (raw: string): string => {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60); // cap base for URL length
};

const randomSuffix = (): string =>
  Math.random().toString(36).slice(2, 2 + SLUG_SUFFIX_LEN);

export const generateEventSlug = (
  rawName: string,
  existingSlugsForBrand: ReadonlySet<string>,
): string => {
  const base = kebabify(rawName) || "event";
  for (let i = 0; i < MAX_RETRIES; i++) {
    const candidate = `${base}-${randomSuffix()}`;
    if (!existingSlugsForBrand.has(candidate)) return candidate;
  }
  // Fall through — append timestamp as last resort
  return `${base}-${Date.now().toString(36)}`;
};

/** URL-safe sanitizer for brand slugs (defensive — HIDDEN-1). */
export const sanitizeSlugForUrl = (raw: string): string => {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");
};
```

#### 3.1.4 NEW `mingla-business/src/utils/liveEventConverter.ts`

```ts
/**
 * DraftEvent → LiveEvent converter. Single ownership transfer point.
 *
 * Used ONLY by `draftEventStore.publishDraft`. Frozen brandSlug at
 * publish time (renaming brand later doesn't break URL — sluggable
 * identity is frozen). Establishes invariant I-16 (live-event ownership).
 *
 * Per Cycle 6 spec §3.1.4.
 */

import { useCurrentBrandStore } from "../store/currentBrandStore";
import {
  useLiveEventStore,
  type LiveEvent,
} from "../store/liveEventStore";
import type { DraftEvent } from "../store/draftEventStore";
import { generateEventSlug, sanitizeSlugForUrl } from "./eventSlug";
import { generateLiveEventId } from "./liveEventId";

export const convertDraftToLiveEvent = (draft: DraftEvent): LiveEvent | null => {
  // Resolve current brand for slug freezing
  const brand = useCurrentBrandStore
    .getState()
    .brands.find((b) => b.id === draft.brandId);
  if (brand === undefined) {
    // Brand was deleted between draft creation and publish — fail loud
    throw new Error(
      `Cannot publish: brand ${draft.brandId} not found in store.`,
    );
  }
  const brandSlug = sanitizeSlugForUrl(brand.slug);
  // Resolve uniqueness against this brand's existing live events
  const existingSlugs = new Set(
    useLiveEventStore
      .getState()
      .getLiveEventsForBrand(draft.brandId)
      .map((e) => e.eventSlug),
  );
  const eventSlug = generateEventSlug(draft.name, existingSlugs);
  const now = new Date().toISOString();
  return {
    id: generateLiveEventId(),
    brandId: draft.brandId,
    brandSlug,
    eventSlug,
    status: "live",
    publishedAt: now,
    cancelledAt: null,
    endedAt: null,
    name: draft.name,
    description: draft.description,
    format: draft.format,
    category: draft.category,
    whenMode: draft.whenMode,
    date: draft.date,
    doorsOpen: draft.doorsOpen,
    endsAt: draft.endsAt,
    timezone: draft.timezone,
    recurrenceRule: draft.recurrenceRule,
    multiDates: draft.multiDates,
    venueName: draft.venueName,
    address: draft.address,
    onlineUrl: draft.onlineUrl,
    hideAddressUntilTicket: draft.hideAddressUntilTicket,
    coverHue: draft.coverHue,
    tickets: draft.tickets,
    visibility: draft.visibility,
    requireApproval: draft.requireApproval,
    allowTransfers: draft.allowTransfers,
    hideRemainingCount: draft.hideRemainingCount,
    passwordProtected: draft.passwordProtected,
    orders: [],
    createdAt: draft.createdAt,
    updatedAt: now,
  };
};
```

#### 3.1.5 publishDraft refactor (`draftEventStore.ts`)

```ts
publishDraft: (id): void => {
  const draft = get().drafts.find((d) => d.id === id);
  if (draft === undefined) return;
  // Convert + push to liveEventStore (atomic ownership transfer per I-16).
  // The converter is imported at module top to avoid cycle.
  const liveEvent = convertDraftToLiveEvent(draft);
  if (liveEvent === null) return;
  useLiveEventStore.getState().addLiveEvent(liveEvent);
  // Then delete the draft (single transfer — never both)
  set((s) => ({ drafts: s.drafts.filter((d) => d.id !== id) }));
},
```

The publishDraft action does NOT return the live event — Cycle 6 wizard's `handleConfirmPublish` re-resolves the published event after the call by querying liveEventStore for the latest one matching the brand. (Alternative: extend publishDraft signature to return the LiveEvent — minor refactor; spec defers to implementor's call.)

#### 3.1.6 TicketStub schema v4→v5 (5b absorption)

Add to `TicketStub`:

```ts
export interface TicketStub {
  // ... existing v4 fields ...
  // ---- Cycle 6 additions (5b absorption) ----
  /** Ticket description for buyers. Max ~280 chars. Optional. */
  description: string | null;
  /** ISO 8601 datetime — sales open. null = no pre-sale window. */
  saleStartAt: string | null;
  /** ISO 8601 datetime — sales close. null = no end. */
  saleEndAt: string | null;
}
```

**Migration v4 → v5** (additive): defaults `description: null`, `saleStartAt: null`, `saleEndAt: null` per existing ticket. Persist version 4 → 5.

#### 3.1.7 clearAllStores extension

```ts
import { useLiveEventStore } from "../store/liveEventStore";

export const clearAllStores = (): void => {
  useCurrentBrandStore.getState().reset();
  useDraftEventStore.getState().reset();
  useLiveEventStore.getState().reset(); // NEW Cycle 6
};
```

---

### 3.2 Routing layer

#### 3.2.1 NEW `mingla-business/app/e/[brandSlug]/[eventSlug].tsx`

```tsx
/**
 * /e/{brandSlug}/{eventSlug} — public event page route.
 *
 * Resolves a LiveEvent by URL (brand-scoped slug). Renders PublicEventPage
 * with branched rendering per state variant.
 *
 * Per Cycle 6 spec §3.2.
 */

import React from "react";
import { useLocalSearchParams } from "expo-router";

import { useLiveEventBySlug, useLiveEventStore } from "../../../src/store/liveEventStore";
import { useBrandList } from "../../../src/store/currentBrandStore";
import { PublicEventPage } from "../../../src/components/event/PublicEventPage";
import { PublicEventNotFound } from "../../../src/components/event/PublicEventNotFound";

export default function PublicEventRoute(): React.ReactElement {
  const params = useLocalSearchParams<{
    brandSlug: string | string[];
    eventSlug: string | string[];
  }>();
  const brandSlug = Array.isArray(params.brandSlug) ? params.brandSlug[0] : params.brandSlug;
  const eventSlug = Array.isArray(params.eventSlug) ? params.eventSlug[0] : params.eventSlug;

  const event = useLiveEventBySlug(
    typeof brandSlug === "string" ? brandSlug : null,
    typeof eventSlug === "string" ? eventSlug : null,
  );
  const brands = useBrandList();
  const brand = event !== null
    ? brands.find((b) => b.id === event.brandId) ?? null
    : null;

  if (event === null) {
    return <PublicEventNotFound />;
  }

  return <PublicEventPage event={event} brand={brand} />;
}
```

#### 3.2.2 NEW `app/e/_layout.tsx` (optional — for shared SEO defaults)

Skip unless the implementor finds value. The Stack root from `app/_layout.tsx` covers it.

---

### 3.3 Component layer

#### 3.3.1 NEW `mingla-business/src/components/event/PublicEventPage.tsx`

The 7 state variants are all branches inside this single component. Pseudocode shape:

```tsx
import { Head } from "expo-router/head";

interface PublicEventPageProps {
  event: LiveEvent;
  brand: Brand | null;
}

export const PublicEventPage: React.FC<PublicEventPageProps> = ({ event, brand }) => {
  // Compute variants
  const isPast = event.endedAt !== null && new Date(event.endedAt) < new Date();
  const isCancelled = event.status === "cancelled";
  const isPreSale = computeIsPreSale(event); // checks ticket.saleStartAt vs now
  const allTicketsSoldOut = event.tickets.every(
    (t) => !t.isUnlimited && (t.capacity ?? 0) === 0,
  );
  const requiresPassword = event.tickets.some((t) => t.passwordProtected);
  const [passwordUnlocked, setPasswordUnlocked] = useState<boolean>(false);

  // Variant order of precedence (most-restrictive wins):
  //   cancelled > past > password-gate (until unlocked) > pre-sale > sold-out > published
  const variant = isCancelled ? "cancelled"
                : isPast ? "past"
                : (requiresPassword && !passwordUnlocked) ? "password-gate"
                : isPreSale ? "pre-sale"
                : allTicketsSoldOut ? "sold-out"
                : "published";

  return (
    <View style={styles.host}>
      <Head>
        <title>{event.name} · {brand?.displayName ?? "Mingla"}</title>
        <meta name="description" content={event.description.slice(0, 160)} />
        <meta property="og:title" content={event.name} />
        <meta property="og:description" content={event.description.slice(0, 200)} />
        <meta property="og:url" content={`https://business.mingla.com/e/${event.brandSlug}/${event.eventSlug}`} />
        <meta property="og:image" content={ogImageUrl(event)} />
        <meta property="og:type" content="event" />
        <meta name="twitter:card" content="summary_large_image" />
        <link rel="canonical" href={`https://business.mingla.com/e/${event.brandSlug}/${event.eventSlug}`} />
      </Head>

      {variant === "cancelled" ? (
        <CancelledVariant event={event} brand={brand} />
      ) : variant === "past" ? (
        <PastVariant event={event} brand={brand} />
      ) : variant === "password-gate" ? (
        <PasswordGateVariant event={event} onUnlock={() => setPasswordUnlocked(true)} />
      ) : (
        // Default: published / pre-sale / sold-out share the same body shell with state-aware ticket rendering
        <PublishedBody
          event={event}
          brand={brand}
          variant={variant}
        />
      )}
    </View>
  );
};
```

**Sub-components in the same file** (or co-located):

- `<PublishedBody>` — hero (cover gradient by hue) + title + brand chip + venue card (honoring `hideAddressUntilTicket`) + about + recurring/multi-date pill+expand (reuses `formatDraftDateLine`-style helpers but adapted for LiveEvent) + tickets list + share button
- `<CancelledVariant>` — full-page "This event has been cancelled" + refund-status copy + brand chip
- `<PastVariant>` — same as published but with greyed style + "This event has ended" pill + ticket buttons disabled
- `<PasswordGateVariant>` — centered card "This event requires a password" + password input + "Unlock" button + frontend stub validation
- `<TicketRow>` — buyer-side ticket card, uses `formatTicketSubline`, `formatTicketBadges`, `formatTicketButtonLabel` from `ticketDisplay.ts` (I-15). Tap behavior per buyer-flow stub copy (Q-5)

**Helpers (NEW):**
- `computeIsPreSale(event)` — examines tickets' `saleStartAt`; returns true if ALL tickets have a future `saleStartAt`
- `ogImageUrl(event)` — TRANSITIONAL: returns `https://business.mingla.com/og/event/${event.id}.png` placeholder (when image upload lands, swap for real cover) OR a static gradient endpoint OR a CSS-rendered fallback. Implementor decides at /ui-ux-pro-max.

**Filter rule:** `event.tickets.filter(t => t.visibility !== "hidden")` BEFORE rendering the buyer-facing ticket list. Hidden tickets are not shown on real public pages (only in PreviewEventView for organisers). This is the difference from Cycle 5's preview behavior.

#### 3.3.2 NEW `mingla-business/src/components/event/PublicEventNotFound.tsx`

Renders when slug doesn't resolve. Friendly 404:

```
┌─────────────────────────────┐
│                             │
│     This event isn't live   │
│                             │
│  The link may be expired    │
│  or the event hasn't been   │
│  published yet.             │
│                             │
│   [ Browse Mingla → ]       │
│                             │
└─────────────────────────────┘
```

Tap "Browse Mingla" → routes to `/` (root marketing landing — Cycle 15). For now, route to home tab if logged in or some other reasonable default.

#### 3.3.3 EventCreatorWizard `handleConfirmPublish` polish

After `publishDraft` succeeds, instead of routing home, look up the new live event and route to its public URL:

```ts
const handleConfirmPublish = useCallback(async (): Promise<void> => {
  setIsPublishing(true);
  const draftName = liveDraft.name;
  const draftBrandId = liveDraft.brandId;
  const draftId = liveDraft.id;
  // Simulated 1.2s submit per spec AC#28.
  await new Promise<void>((resolve) => setTimeout(resolve, 1200));
  publishDraft(draftId);
  setIsPublishing(false);
  setPublishConfirmVisible(false);
  // Find the freshly-published event for this brand
  const liveEvent = useLiveEventStore
    .getState()
    .getLiveEventsForBrand(draftBrandId)
    .find((e) => e.name === draftName);
  if (liveEvent !== undefined) {
    onExit("published", { name: draftName, slug: { brandSlug: liveEvent.brandSlug, eventSlug: liveEvent.eventSlug } });
  } else {
    onExit("published", { name: draftName });
  }
}, [...]);
```

Update `onExit` signature to optionally include slug. The route handler can navigate to the public page when slug is provided.

---

### 3.4 SEO + share

Per spec §3.3.1's `<Head>` block. The share button on PublicEventPage uses native Share API:

```ts
const handleShare = async (): Promise<void> => {
  const url = `https://business.mingla.com/e/${event.brandSlug}/${event.eventSlug}`;
  if (Platform.OS === "web" && navigator.share !== undefined) {
    try { await navigator.share({ title: event.name, url }); } catch (e) { /* user cancelled */ }
  } else if (Platform.OS === "web") {
    await navigator.clipboard.writeText(url);
    showToast("Link copied");
  } else {
    // Native — RN Share API
    await Share.share({ message: `${event.name} — ${url}`, url });
  }
};
```

Cycle 7 will replace this with a richer Share modal.

---

## 4. Success criteria (numbered, observable, testable)

1. **AC-1** Publishing a draft (any whenMode) creates a LiveEvent in liveEventStore + removes the draft from draftEventStore (atomic transfer)
2. **AC-2** LiveEvent has frozen brandSlug, computed eventSlug, publishedAt timestamp
3. **AC-3** Two events published from the same brand with the same name produce different eventSlugs (uniqueness retry)
4. **AC-4** Logout clears liveEventStore via `clearAllStores`
5. **AC-5** Schema v4→v5 migration adds description/saleStartAt/saleEndAt to existing tickets with null defaults
6. **AC-6** Public route `/e/{brandSlug}/{eventSlug}` resolves to LiveEvent
7. **AC-7** Bad slug (typo or unpublished) → renders PublicEventNotFound
8. **AC-8** J-P1 published variant: hero + title + brand chip + venue card + about + tickets list + share + buy button per modifier
9. **AC-9** J-P2 sold-out variant: every ticket capped at 0 (frontend stub) → "Sold out" pills; if waitlistEnabled, "Join waitlist" button replaces Buy
10. **AC-10** J-P3 pre-sale variant: ticket has future saleStartAt → countdown + "On sale {date}" copy; ticket buttons disabled
11. **AC-11** J-P4 past-event variant: endedAt < now → greyed, "This event has ended" pill, buttons disabled
12. **AC-12** J-P5 password-gate: any ticket has passwordProtected=true → renders password-gate screen FIRST; on correct password → reveals normal page; on wrong password → shake + helper
13. **AC-13** J-P6 approval-required indication: ticket button label = "Request access"
14. **AC-14** J-P7 cancelled: status="cancelled" → renders cancelled variant (Cycle 9 introduces cancellation flow; Cycle 6 supports rendering)
15. **AC-15** Hidden tickets are FILTERED OUT of the public page (not rendered at all)
16. **AC-16** `hideAddressUntilTicket=true` → public page shows venue NAME but masks address with "Address shared after ticket purchase"
17. **AC-17** Multi-date events show first date prominently + "{N-1} more dates" pill; tap expands to full list
18. **AC-18** Recurring events show first occurrence + "Repeats every {dow} · {N} dates" pill; tap expands to computed list
19. **AC-19** OG/Twitter/canonical meta tags inject via `expo-router/head` `<Head>` component (verified in dev; production smoke required)
20. **AC-20** Share button on web uses navigator.share if available, else clipboard + toast "Link copied"
21. **AC-21** Buyer "Buy ticket" tap → TRANSITIONAL toast "Online checkout lands Cycle 8"
22. **AC-22** Buyer "Request access" tap → toast "Approval flow lands Cycle 10 + B4"
23. **AC-23** Buyer "Join waitlist" tap → toast "Waitlist invites land B5"
24. **AC-24** Buyer "Enter password to unlock" → frontend stub validation against ticket.password; success unlocks, failure shows helper
25. **AC-25** After publish, wizard routes to the new public event URL (not back to home)
26. **AC-26** Ticket sheet now has Description input (multiline, optional, max 280 chars)
27. **AC-27** Ticket sheet now has Sale period start + end date pickers (optional)
28. **AC-28** Schema migration v4→v5: existing tickets default description=null, saleStartAt=null, saleEndAt=null
29. **AC-29** Cycles 3/4/5 single/recurring/multi-date drafts all publish correctly into LiveEvents
30. **AC-30** TypeScript strict compiles clean
31. **AC-31** No new external libs added (verify package.json delta = 0)
32. **AC-32** I-11/I-12/I-13/I-14/I-15 invariants preserved
33. **AC-33** I-16 invariant established: live events ONLY in liveEventStore; never duplicated in draftEventStore
34. **AC-34** `/ui-ux-pro-max` consulted on PublicEventPage (variants, hero gradient, share button placement, password-gate visual)

---

## 5. Test matrix

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Publish single-mode draft | Cycle 3 single + paid + Stripe active | Draft removed; LiveEvent in store with all fields snapshotted | Persistence |
| T-02 | Publish recurring-mode draft | Cycle 4 recurring + 4 occurrences | LiveEvent has whenMode=recurring + recurrenceRule preserved | Persistence |
| T-03 | Publish multi-date draft | Cycle 4 multi_date + 5 dates | LiveEvent has multiDates preserved | Persistence |
| T-04 | Slug uniqueness | Publish 2 events with same name from same brand | Two different eventSlugs (suffix differs) | Helper |
| T-05 | Brand slug freeze | Publish event, rename brand later | Public URL still works (brandSlug frozen) | Persistence + Routing |
| T-06 | Logout clears | Publish event, sign out | useLiveEventStore.getState().events = [] after sign-out | Constitution #6 |
| T-07 | Public URL resolves | Visit /e/{brandSlug}/{eventSlug} | PublicEventPage renders the event | Routing |
| T-08 | Bad slug 404 | Visit /e/foo/bar | PublicEventNotFound renders | Routing |
| T-09 | J-P1 published render | Live event, no special states | Hero + title + brand + venue + tickets + share | Component |
| T-10 | J-P2 sold-out render | All tickets capacity=0 | Sold-out pills; Buy buttons disabled or "Join waitlist" if enabled | Component |
| T-11 | J-P3 pre-sale render | Ticket saleStartAt = now+1day | Countdown + disabled buttons | Component + Helper |
| T-12 | J-P4 past-event render | Event endedAt < now | Greyed + "This event has ended" pill | Component |
| T-13 | J-P5 password-gate | Ticket passwordProtected=true | Password-gate screen first; correct password reveals body | Component |
| T-14 | J-P6 approval indication | Ticket approvalRequired=true | "Request access" button label | Component |
| T-15 | J-P7 cancelled render | LiveEvent status="cancelled" | Cancelled-variant screen | Component |
| T-16 | Hidden ticket filtered | Ticket visibility="hidden" | Not rendered on public page | Component |
| T-17 | Address hidden | hideAddressUntilTicket=true | Venue name shown; address replaced with "Address shared after checkout" | Component |
| T-18 | Address shown | hideAddressUntilTicket=false | Full address visible | Component |
| T-19 | Multi-date public expand | 5 dates | First date prominent + "4 more dates" pill; tap expands | Component + Helper |
| T-20 | Recurring public expand | weekly + count=4 | First date prominent + "Repeats every Mon · 4 dates" pill; tap expands | Component + Helper |
| T-21 | OG/Twitter tags | View page source on web | Tags present with event name + description + canonical URL | SEO |
| T-22 | Share button web (with navigator.share) | Tap share | Native share dialog opens | Component |
| T-23 | Share button web (no navigator.share) | Tap share | URL copied; toast "Link copied" | Component |
| T-24 | Share button native | Tap share | RN Share dialog opens | Component |
| T-25 | Buyer Buy ticket stub | Tap Buy on paid ticket | Toast "Online checkout lands Cycle 8" | Component + UX |
| T-26 | Buyer Request access stub | Tap on approval ticket | Toast "Approval flow lands Cycle 10 + B4" | Component + UX |
| T-27 | Buyer Join waitlist stub | Tap on sold-out + waitlist ticket | Toast "Waitlist invites land B5" | Component + UX |
| T-28 | Password unlock success | Enter correct password | Public body reveals | Component + Validation |
| T-29 | Password unlock failure | Enter wrong password | Shake + "Wrong password" helper | Component + Validation |
| T-30 | Wizard publish-success route | Publish from Step 7 | Wizard exits → routes to new public event URL | Wizard + Routing |
| T-31 | Schema v4→v5 migration | Open Cycle 5 build with tickets | Existing tickets gain null description/saleStartAt/saleEndAt | Persistence |
| T-32 | Description input + render | Fill description on a ticket | Saved on ticket; rendered on public page | Sheet + Component |
| T-33 | Sale period pickers | Set saleStartAt = future | Public page shows pre-sale variant for that ticket | Sheet + Component |
| T-34 | I-16 enforcement (manual) | Read code | publishDraft is the only place a LiveEvent gets created; no draftEventStore code reads from liveEventStore or vice versa | Code review |
| T-35 | TS strict | tsc --noEmit | Exit 0 | Build |
| T-36 | No new external libs | package.json git diff | 0 lines added | Build |

---

## 6. Invariants

### Preserved

| ID | Status | Verification |
|----|--------|--------------|
| I-11 Format-agnostic ID | ✅ Y | LiveEvent.id is opaque string (`le_<ts36>`) |
| I-12 Host-bg cascade | ✅ Y | Public page sets its own bg per design |
| I-13 Overlay-portal | ✅ Y | Password-gate + share modal use Sheet primitive |
| I-14 Date-display single source | ✅ Y | Public page uses helpers from `eventDateDisplay.ts` |
| I-15 Ticket-display single source | ✅ Y | Public page uses helpers from `ticketDisplay.ts` |

### NEW invariant established

**I-16: Live-event ownership separation.** Live events live ONLY in `liveEventStore`. The `publishDraft` action is the SINGLE ownership transfer point (DraftEvent → LiveEvent + delete draft, atomic). No code path may copy a live event back into drafts. (Constitution #2 — one owner per truth at structural level.)

**Enforcement:** Header docstring at `liveEventStore.ts:1-18` declares the rule. The `publishDraft` refactor includes a code comment guarding the atomic transfer pattern.

**Test that catches a regression:** `grep -rn "useDraftEventStore.*addDraft\|useLiveEventStore.*addLiveEvent" mingla-business/src/` — only call site for `addLiveEvent` should be inside `liveEventConverter.ts`'s converter, called from `publishDraft`. Any other call site is a violation.

---

## 7. Implementation order

1. **liveEventStore.ts NEW** + types (LiveEvent, LiveEventStatus, LiveEventState)
2. **liveEventId.ts NEW** + **eventSlug.ts NEW** (helpers)
3. **liveEventConverter.ts NEW** (DraftEvent → LiveEvent)
4. **draftEventStore.publishDraft refactor** — call converter + addLiveEvent + delete draft
5. **clearAllStores extension** — one line
6. **TicketStub schema v4→v5** — add description/saleStartAt/saleEndAt + migrator + persist version bump
7. **CreatorStep5Tickets — Description input** — multiline TextInput with 280 char limit, after Name field
8. **CreatorStep5Tickets — Sale period inputs** — start/end date pickers, conditional "Pre-sale" section
9. **TicketStubSheet integration** — wire new fields into save handler + state
10. **PublicEventPage NEW** + variant sub-components + helpers
11. **PublicEventNotFound NEW**
12. **app/e/[brandSlug]/[eventSlug].tsx route handler NEW**
13. **EventCreatorWizard.handleConfirmPublish polish** — route to public URL after publish
14. **SEO `<Head>` integration** — verify on Expo Web
15. **Final greps + TS check + /ui-ux-pro-max review**
16. **Implementation report**

---

## 8. Regression prevention

### Cycle 3-5 invariants — implementor verifies preserved

After each major step (steps 4, 6, 10, 13), implementor must:
- Open existing Cycles 3/4/5 drafts → publish → confirm LiveEvent appears in liveEventStore correctly
- Visit the resulting public URL → confirm renders correctly per variant matrix
- Confirm hidden tickets don't appear on public page
- Confirm address hiding logic works
- Confirm logout clears all 3 stores

### NEW invariant I-16 (post-Cycle-6 close)

Add to INVARIANT_REGISTRY:
```markdown
### I-16 Live-event ownership separation (mingla-business)

**Rule:** Live events live ONLY in `liveEventStore`. `publishDraft` is the SINGLE ownership transfer point (atomic: convert + push + delete draft). No code path duplicates a live event back into drafts.

**Why:** Without this rule, an organiser could end up with both a draft AND a live event for the same logical event, leading to "which is canonical?" bugs.

**Established by:** Cycle 6 — ORCH-BIZ-CYCLE-6-PUBLIC-EVENT-PAGE.

**Test:** grep for direct calls to `useLiveEventStore.getState().addLiveEvent(` outside `liveEventConverter.ts` — should be zero.
```

### Failure-pattern guard

The most likely regression: **a future cycle calls `addLiveEvent` directly without going through publishDraft, breaking I-16**. Mitigation: code comment in `liveEventStore.addLiveEvent` warning callers to use `publishDraft` only:

```ts
addLiveEvent: (event) => {
  // [I-16 GUARD] This is the ONLY way to add a LiveEvent.
  // Callers MUST be liveEventConverter (called from publishDraft).
  // Direct calls from other code paths violate the ownership invariant.
  set((s) => ({ events: [...s.events, event] }));
},
```

---

## 9. Open Questions — orchestrator must confirm before implementor dispatch

| Q | Question | Spec assumption |
|---|----------|-----------------|
| Q-1 | Slug strategy: hybrid (random at publish + vanity Cycle 9) | YES |
| Q-2 | Slug uniqueness: brand-scoped | YES |
| Q-3 | Store boundaries: separate stores | YES |
| Q-4 | LiveEvent shape (forward-compat for Cycle 9/13)? | Per §3.1.1 |
| Q-5 | Buyer-flow stub copy? | Per investigation Q-5 table |
| Q-6 | Multi-date public display: clean buyer-side | YES |
| Q-7 | Past-event: render past-event variant (not 404) | YES |
| Q-8 | SEO: expo-router/head | YES |
| Q-9 | Cycle 5b absorption: description + sale period | YES |

**Q-9 is the user-facing decision** that affects scope. Founder confirms ABSORB description + sale period, DEFER the rest.

---

## 10. Discoveries for orchestrator (repeated from investigation §8)

- D-FOR-CYCLE6-1: Cycle 6 estimate ~46-58 hrs (2 cycles in 1) depending on absorption
- D-FOR-CYCLE6-2: LiveEvent shape forward-compat with Cycle 9 + 13 (no future migration needed)
- D-FOR-CYCLE6-3: I-16 (live-event ownership) for INVARIANT_REGISTRY at close
- D-FOR-CYCLE6-4: Remaining 5b items (~22 hrs) → Cycle 17 polish or post-MVP
- D-FOR-CYCLE6-5: OG image URL is TRANSITIONAL — swap to real upload at Cycle 5b/B-cycle
- D-FOR-CYCLE6-6: Implementor smoke-tests `<Head>` SSR on Vercel deploy
- D-FOR-CYCLE6-7: Wizard publish-success could route to public URL OR celebration screen — /ui-ux-pro-max decides

---

## 11. End conditions

A passing Cycle 6 implementation:
- ✅ All 34 ACs verified (manually or via TypeScript)
- ✅ All 36 Ts pass (manual smoke or unit-equivalent)
- ✅ Zero new TypeScript errors
- ✅ Zero new external libs
- ✅ Cycles 3/4/5 drafts publish correctly into LiveEvents
- ✅ Logout clears all 3 stores (currentBrand, draft, live)
- ✅ Public URLs work for any whenMode + any modifier combination
- ✅ I-16 established
- ✅ `/ui-ux-pro-max` consulted on PublicEventPage variants
- ✅ Implementation report written
- ✅ Discoveries logged

---

**End of spec.**
