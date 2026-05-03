# SPEC v2 — ORCH-0704 — Full Edit-After-Publish + Notification Stack + Reason Audit

**Date:** 2026-05-02
**Author:** mingla-forensics
**Mode:** SPEC v2 (revision)
**Investigation (canonical):** [INVESTIGATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md](../reports/INVESTIGATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md)
**Supersedes:** [SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md](SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md) v1 — operator overrode Q-704-1..6 defaults on 2026-05-02
**Cycle 9 J-E11:** also superseded (narrow J-E11 scope from `SPEC_BIZ_CYCLE_9_EVENT_MANAGEMENT.md` §3.B is fully obsolete)

---

## 1 — Why v2 exists (operator's locked ruleset)

v1 spec recommended permissive defaults — silent push for cosmetic fields, hard-lock for destructive changes when sales exist. Operator overrode all six defaults on 2026-05-02 in favor of:

1. **Multi-channel notification stack on every material change.** Banner (in-app, rendered Cycle 9c) + email (Resend, B-cycle) + SMS for web purchases (Twilio, B-cycle) + push (deferred to consumer app). All four channels SPEC'D in this cycle; only banner-write + email-stub + SMS-stub fire today.
2. **whenMode unlocked entirely.** Operator can switch single↔recurring↔multi-date even with sales — but only if the change does NOT drop a previously-active date the buyer had access to. If it would, save is blocked with refund-first reject.
3. **Refund-first as unified destructive pattern.** Tier delete with sales, capacity drop below sold count, multi-date entry removal with sales, whenMode change that drops a date, recurrence rule change that drops occurrences — all blocked with reject dialog "Refund N orders first." Operator refunds via Orders flow (Cycle 9c), then save unblocks. Tier price change with sales + tier free-toggle with sales also fall under refund-first.
4. **Reason mandatory for EVERY save.** 10–200 chars. UI: char counter, Save button disabled until min met. Reason flows into notification copy + permanent edit audit log.
5. **Edit audit log permanent.** New `useEventEditLogStore` (Zustand persisted, append-only). Every successful save records: timestamp, changed fields, reason, severity, affected order IDs (zero in stub mode; populated when 9c useOrderStore lives). Cycle 9c reads to render buyer's material-change history.

v1's investigation findings + sectioned-screen reuse strategy + step-body decoupling + EditableLiveEventFields type + subtract list for narrow 9b-2 ALL stay. v2 is layered additions, not a redesign.

**v2-A and v2-B follow-up defaults locked (operator implicitly accepted by approving full v2 dispatch):**
- v2-A: SMS only fires for material+ severity (additive-only edits → banner + email only, no SMS) → reduces fatigue
- v2-B: reason 10–200 chars

---

## 2 — Scope and Non-Goals

### 2.1 In scope (operator-side, this cycle)

- Replace narrow `EditPublishedScreen` with sectioned full-edit screen reusing `CreatorStepN` body components (v1 strategy retained)
- Replace `liveEventStore.updateLiveEventEditableFields` with `updateLiveEventFields` accepting full editable patch + `reason: string` parameter + `context: SoldCountContext`
- Add buyer-protection guard rails as REFUND-FIRST rejects (not silent locks): capacity floor, tier-delete-block, tier-price-block, tier-free-toggle-block, multi-date-removal-block, whenMode-drops-date-block, recurrence-drops-occurrence-block
- Extend `StepBodyProps` with optional `editMode?: { soldCountByTier: Record<string, number> }`
- Modify `CreatorStep5Tickets` to render lock UX when `editMode.soldCountByTier[ticketId] > 0` (price field disabled with helper, isFree toggle disabled, capacity validates inline floor, Delete hidden — UX prevents arming the violation; if user bypasses via API the runtime guard rail catches it)
- Subtract narrow 9b-2 files (`liveEventToEditPatch.ts`, narrow `EditPublishedScreen.tsx` content)
- Expand `EditAfterPublishBanner` copy
- Enrich `ChangeSummaryModal` differ + add required reason input + char counter + notification footer note
- NEW `useEventEditLogStore` (Zustand persisted, append-only)
- NEW `eventChangeNotifier` service with TRANSITIONAL email + SMS console-log stubs
- NEW `scheduleDateExpansion` utility for active-date computation + dropped-date diff
- Wire `useEventEditLogStore.reset` into `clearAllStores` (Const #6)

### 2.2 In scope (forward-looking schema definitions, built in Cycle 9c)

- `useOrderStore` shape (OrderRecord, OrderLineRecord, BuyerSnapshot, RefundRecord) — unchanged from v1
- `getSoldCountByTier` selector contract — unchanged from v1
- Material-change banner detection algorithm + copy — REVISED to read from `useEventEditLogStore` (not derived from event diff)
- Buyer order detail page renders banner from edit log entries since `lastSeenEventUpdatedAt`

### 2.3 Out of scope

- `useOrderStore` IMPLEMENTATION (built in Cycle 9c)
- `confirm.tsx` wire-up to `useOrderStore` (built in Cycle 9c)
- Buyer order detail page rendering (built in Cycle 9c)
- Real Resend email send (B-cycle wiring; ORCH-0704 ships console-log stub)
- Real Twilio SMS send (B-cycle wiring; ORCH-0704 ships console-log stub)
- OneSignal push notifications (deferred to consumer app cycle)
- No-show + post-event ops (ORCH-0705)
- Dispute paths (ORCH-0705)
- Capacity-decrease-with-buyer-refund flow (post-Stripe)
- Refund execution UI (Cycle 9c — Orders flow)
- Per-date sales tracking (post-MVP — current model is event-level tickets only)

### 2.4 Assumptions

- Operator's 4 steering decisions (2026-05-02) + v2 expansion are final
- Narrow 9b-2 files are uncommitted (verified by `git status` 2026-05-02)
- `mingla-business/` Expo Web only per DEC-081
- `?mode=edit-published` query param routing already correct (per Cycle 9b-2 narrow impl)
- `expandRecurrenceToDates(rule, firstDate): Date[]` exists at `mingla-business/src/utils/recurrenceRule.ts:184` — reusable for active-date computation
- `clearAllStores` central reset utility at `mingla-business/src/utils/clearAllStores.ts` — extend with new store reset

---

## 3 — Layer-by-Layer Specification

### 3.1 Schema (TypeScript types)

#### 3.1.1 `EditableLiveEventFields` (unchanged from v1)

In `mingla-business/src/store/liveEventStore.ts`:

```ts
export type EditableLiveEventFields = Pick<
  LiveEvent,
  | "name" | "description" | "format" | "category" | "whenMode"
  | "date" | "doorsOpen" | "endsAt" | "timezone"
  | "recurrenceRule" | "multiDates"
  | "venueName" | "address" | "onlineUrl" | "hideAddressUntilTicket"
  | "coverHue" | "tickets"
  | "visibility" | "requireApproval" | "allowTransfers"
  | "hideRemainingCount" | "passwordProtected"
>;
```

#### 3.1.2 `UpdateLiveEventResult` (REVISED)

```ts
export type UpdateLiveEventRejection =
  | "event_not_found"
  | "missing_edit_reason"
  | "invalid_edit_reason"            // < 10 or > 200 chars
  | "capacity_below_sold"
  | "tier_delete_with_sales"
  | "tier_price_change_with_sales"
  | "tier_free_toggle_with_sales"
  | "multi_date_remove_with_sales"
  | "when_mode_drops_active_date"
  | "recurrence_drops_occurrence";

export type UpdateLiveEventResult =
  | { ok: true; editLogEntryId: string }
  | {
      ok: false;
      reason: UpdateLiveEventRejection;
      tierIds?: string[];          // for per-tier rejects
      droppedDates?: string[];     // for whenMode/recurrence drops (ISO YYYY-MM-DD)
      affectedOrderCount?: number; // for refund-first messages
      details?: string;
    };
```

Note: `when_mode_change_with_sales` from v1 REMOVED — replaced with the more precise `when_mode_drops_active_date`. v1's blanket "any whenMode change blocked when sold" rule is gone; operator can switch modes freely as long as no previously-active dates are dropped.

#### 3.1.3 `EventEditEntry` + `EventEditLogState` (NEW)

In NEW file `mingla-business/src/store/eventEditLogStore.ts`:

```ts
export type EditSeverity = "additive" | "material" | "destructive";

export interface EventEditEntry {
  id: string;                        // ee_<ts36>_<rand>
  eventId: string;
  brandId: string;                   // denormalized for fast brand-scoped queries
  editedAt: string;                  // ISO 8601
  reason: string;                    // operator's explanation (10..200 chars)
  severity: EditSeverity;
  changedFieldKeys: string[];        // e.g. ["address", "doorsOpen", "tickets"]
  diffSummary: string[];             // human-readable lines for notification copy
  /**
   * Order IDs affected by this change. Empty in ORCH-0704 stub mode
   * (useOrderStore not yet built). Populated by Cycle 9c onwards by
   * filtering useOrderStore.getOrdersForEvent(eventId).
   */
  affectedOrderIds: string[];
}

export interface EventEditLogState {
  entries: EventEditEntry[];
  /**
   * Append-only. Returns the newly created entry (caller stores entry.id).
   * Never mutates an existing entry.
   */
  recordEdit: (entry: Omit<EventEditEntry, "id" | "editedAt">) => EventEditEntry;
  /** All entries for an event, newest first. */
  getEditsForEvent: (eventId: string) => EventEditEntry[];
  /** Single most-recent entry for an event, or null. */
  getLatestEditForEvent: (eventId: string) => EventEditEntry | null;
  /** All entries since `sinceIso` (used by 9c material-change banner). */
  getEditsForEventSince: (eventId: string, sinceIso: string) => EventEditEntry[];
  /** Logout reset — wired into clearAllStores. */
  reset: () => void;
}
```

Persistence:
- AsyncStorage key: `mingla-business.eventEditLog.v1`
- Partialize: `{ entries: [...] }`
- Version: 1 (no migrators yet)

#### 3.1.4 `NotificationPayload` (NEW)

In NEW file `mingla-business/src/services/eventChangeNotifier.ts`:

```ts
export interface NotificationPayload {
  eventId: string;
  eventName: string;
  brandName: string;
  brandSlug: string;
  eventSlug: string;
  reason: string;
  diffSummary: string[];
  severity: EditSeverity;
  affectedOrderIds: string[];
  occurredAt: string;
  // Forward-looking — populated by Cycle 9c when useOrderStore exposes payment method
  // For ORCH-0704 stub: empty array (every order treated as eligible for SMS as soft default)
  webPurchaseOrderIds?: string[];
}

export interface NotificationChannelFlags {
  banner: boolean;       // always true for material+ — Cycle 9c renders
  email: boolean;        // true for material+ AND additive (per v2-A — additive gets email but no SMS)
  sms: boolean;          // true for material+ ONLY, AND only if any web-purchase orders exist
  push: boolean;         // always false in ORCH-0704 (deferred)
}
```

#### 3.1.5 `OrderRecord` etc. (forward-looking, unchanged from v1)

OrderRecord, OrderLineRecord, BuyerSnapshot, RefundRecord shapes carry over from v1 §3.1.3 verbatim. Cycle 9c implementor consumes.

### 3.2 Store layer mutations

#### 3.2.1 `useLiveEventStore.updateLiveEventFields` (REPLACE narrow mutation)

DELETE existing `updateLiveEventEditableFields` (lines 117-120 type signature + 160-177 implementation).

ADD new mutation:

```ts
/**
 * Update editable post-publish fields (ORCH-0704 v2). Accepts full editable
 * patch; rejects frozen fields at the type level. Validates buyer-protection
 * guard rails BEFORE applying. On success: bumps updatedAt, applies patch,
 * records edit log entry, fires notification stack.
 *
 * Per ORCH-0704 v2 §3.2.1.
 */
updateLiveEventFields: (
  id: string,
  patch: Partial<EditableLiveEventFields>,
  context: SoldCountContext,
  reason: string,
) => UpdateLiveEventResult;
```

Implementation outline (full code in implementor dispatch):

```ts
updateLiveEventFields: (id, patch, context, reason): UpdateLiveEventResult => {
  // ---- 1. Reason validation ----
  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0) {
    return { ok: false, reason: "missing_edit_reason" };
  }
  if (trimmedReason.length < 10 || trimmedReason.length > 200) {
    return { ok: false, reason: "invalid_edit_reason" };
  }

  // ---- 2. Event lookup ----
  const event = get().events.find((e) => e.id === id);
  if (event === undefined) return { ok: false, reason: "event_not_found" };

  const { soldCountByTier, soldCountForEvent } = context;

  // ---- 3. Compute proposed schedule + dropped dates (whenMode / recurrence / multiDates changes) ----
  const beforeSchedule = {
    whenMode: event.whenMode,
    date: event.date,
    recurrenceRule: event.recurrenceRule,
    multiDates: event.multiDates,
  };
  const afterSchedule = {
    whenMode: patch.whenMode ?? event.whenMode,
    date: patch.date !== undefined ? patch.date : event.date,
    recurrenceRule: patch.recurrenceRule !== undefined ? patch.recurrenceRule : event.recurrenceRule,
    multiDates: patch.multiDates !== undefined ? patch.multiDates : event.multiDates,
  };
  const droppedDates = computeDroppedDates(beforeSchedule, afterSchedule);
  // (Implementation in scheduleDateExpansion.ts — see §3.3.4)

  if (droppedDates.length > 0 && soldCountForEvent > 0) {
    // Classify the rejection type by the kind of change:
    if (afterSchedule.whenMode !== beforeSchedule.whenMode) {
      return {
        ok: false,
        reason: "when_mode_drops_active_date",
        droppedDates,
        affectedOrderCount: soldCountForEvent,
      };
    }
    if (!deepEqual(afterSchedule.recurrenceRule, beforeSchedule.recurrenceRule)) {
      return {
        ok: false,
        reason: "recurrence_drops_occurrence",
        droppedDates,
        affectedOrderCount: soldCountForEvent,
      };
    }
    // Multi-date entry removal
    if (!deepEqual(afterSchedule.multiDates, beforeSchedule.multiDates)) {
      return {
        ok: false,
        reason: "multi_date_remove_with_sales",
        droppedDates,
        affectedOrderCount: soldCountForEvent,
      };
    }
  }

  // ---- 4. Per-tier guard rails ----
  if (patch.tickets !== undefined) {
    const oldById = new Map(event.tickets.map((t) => [t.id, t]));
    const newIds = new Set(patch.tickets.map((t) => t.id));

    // Tier delete with sales
    for (const oldT of event.tickets) {
      if (!newIds.has(oldT.id) && (soldCountByTier[oldT.id] ?? 0) > 0) {
        return {
          ok: false,
          reason: "tier_delete_with_sales",
          tierIds: [oldT.id],
          affectedOrderCount: soldCountByTier[oldT.id],
        };
      }
    }

    for (const newT of patch.tickets) {
      const oldT = oldById.get(newT.id);
      if (oldT === undefined) continue;  // new tier
      const sold = soldCountByTier[newT.id] ?? 0;
      if (sold === 0) continue;

      // Capacity floor
      if (newT.capacity !== null && newT.capacity < sold) {
        return {
          ok: false,
          reason: "capacity_below_sold",
          tierIds: [newT.id],
          affectedOrderCount: sold,
        };
      }
      // Price change with sales
      if (newT.priceGbp !== oldT.priceGbp) {
        return {
          ok: false,
          reason: "tier_price_change_with_sales",
          tierIds: [newT.id],
          affectedOrderCount: sold,
        };
      }
      // Free toggle with sales
      if (newT.isFree !== oldT.isFree) {
        return {
          ok: false,
          reason: "tier_free_toggle_with_sales",
          tierIds: [newT.id],
          affectedOrderCount: sold,
        };
      }
    }
  }

  // ---- 5. Apply patch ----
  const now = new Date().toISOString();
  set((s) => ({
    events: s.events.map((e) =>
      e.id === id ? { ...e, ...patch, updatedAt: now } : e,
    ),
  }));

  // ---- 6. Classify severity + record edit log + fire notifications ----
  const changedFieldKeys = (Object.keys(patch) as (keyof EditableLiveEventFields)[])
    .filter((k) => !deepEqual(event[k], (patch as Record<string, unknown>)[k]));
  const severity = classifySeverity(changedFieldKeys);
  const diffSummary = computeDiffSummary(event, patch);

  const entry = useEventEditLogStore.getState().recordEdit({
    eventId: id,
    brandId: event.brandId,
    reason: trimmedReason,
    severity,
    changedFieldKeys: changedFieldKeys.map(String),
    diffSummary,
    affectedOrderIds: [],  // populated by 9c when useOrderStore exists
  });

  // Fire notification stack (await not needed — fire-and-forget log stubs)
  void notifyEventChanged(
    {
      eventId: id,
      eventName: event.name,
      brandName: "" /* resolved by caller from currentBrandStore + passed in payload OR resolved inside notifier */,
      brandSlug: event.brandSlug,
      eventSlug: event.eventSlug,
      reason: trimmedReason,
      diffSummary,
      severity,
      affectedOrderIds: [],
      occurredAt: now,
    },
    deriveChannelFlags(severity, /* hasWebPurchaseOrders */ false),
  );

  return { ok: true, editLogEntryId: entry.id };
},
```

Helper functions (in `liveEventAdapter.ts` or a new `editFieldClassifier.ts`):

```ts
const SAFE_KEYS: ReadonlyArray<keyof EditableLiveEventFields> = [
  "name", "description", "category", "coverHue",
  "hideAddressUntilTicket", "requireApproval", "hideRemainingCount",
  "allowTransfers", "passwordProtected", "visibility",
];

const MATERIAL_KEYS: ReadonlyArray<keyof EditableLiveEventFields> = [
  "format", "date", "doorsOpen", "endsAt", "timezone",
  "venueName", "address", "onlineUrl",
  "whenMode", "recurrenceRule", "multiDates",
  "tickets",  // ticket additions / non-destructive edits
];

export const classifySeverity = (
  changedKeys: ReadonlyArray<keyof EditableLiveEventFields>,
): EditSeverity => {
  // Destructive cases never reach here (rejected pre-apply)
  for (const k of changedKeys) {
    if (MATERIAL_KEYS.includes(k)) return "material";
  }
  return "additive";
};
```

Note: tier modifier-only changes (visibility, displayOrder, etc.) sit inside `tickets` — classified material per the rule above. If the implementor wants finer granularity (modifier changes = additive vs structural changes = material), spec recommends KEEPING simple: any tickets array change = material. Tier modifier toggles are infrequent compared to ticket adds/removes/renames; over-notifying once is acceptable.

#### 3.2.2 `useEventEditLogStore` (NEW)

Standard Zustand persisted store. Implementation outline:

```ts
import { create } from "zustand";
import { persist, createJSONStorage, type PersistOptions } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

const generateEditEntryId = (): string => {
  const ts36 = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, "0");
  return `ee_${ts36}_${rand}`;
};

type PersistedState = Pick<EventEditLogState, "entries">;

const persistOptions: PersistOptions<EventEditLogState, PersistedState> = {
  name: "mingla-business.eventEditLog.v1",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (s): PersistedState => ({ entries: s.entries }),
  version: 1,
};

export const useEventEditLogStore = create<EventEditLogState>()(
  persist(
    (set, get) => ({
      entries: [],
      recordEdit: (entry): EventEditEntry => {
        const newEntry: EventEditEntry = {
          ...entry,
          id: generateEditEntryId(),
          editedAt: new Date().toISOString(),
        };
        set((s) => ({ entries: [newEntry, ...s.entries] }));
        return newEntry;
      },
      getEditsForEvent: (eventId): EventEditEntry[] =>
        get().entries.filter((e) => e.eventId === eventId),
      getLatestEditForEvent: (eventId): EventEditEntry | null => {
        const es = get().entries.filter((e) => e.eventId === eventId);
        return es.length > 0 ? es[0] : null;  // entries prepended → newest first
      },
      getEditsForEventSince: (eventId, sinceIso): EventEditEntry[] =>
        get().entries.filter(
          (e) => e.eventId === eventId && e.editedAt > sinceIso,
        ),
      reset: (): void => {
        set({ entries: [] });
      },
    }),
    persistOptions,
  ),
);
```

Wire `useEventEditLogStore.getState().reset()` into `clearAllStores.ts`:

```ts
// mingla-business/src/utils/clearAllStores.ts
import { useEventEditLogStore } from "../store/eventEditLogStore";

export const clearAllStores = (): void => {
  useCurrentBrandStore.getState().reset();
  useDraftEventStore.getState().reset();
  useLiveEventStore.getState().reset();
  useEventEditLogStore.getState().reset();  // NEW ORCH-0704 v2 — Const #6
};
```

### 3.3 Service / utility layer

#### 3.3.1 `eventChangeNotifier.notifyEventChanged` (NEW)

```ts
// mingla-business/src/services/eventChangeNotifier.ts

/**
 * [TRANSITIONAL] Fires the notification stack for an event edit.
 * Today: console-logs each channel's payload.
 *
 * EXIT CONDITIONS:
 *   - email: B-cycle replaces stub with Resend send via edge function
 *   - sms: B-cycle replaces stub with Twilio send via edge function
 *   - push: consumer app cycle wires OneSignal player IDs per buyer
 *   - banner: Cycle 9c reads useEventEditLogStore on buyer order detail page
 *
 * Fire-and-forget. Caller does not await — notifications are best-effort.
 *
 * Per ORCH-0704 v2 §3.3.1.
 */
export const notifyEventChanged = async (
  payload: NotificationPayload,
  channels: NotificationChannelFlags,
): Promise<void> => {
  // Banner: no synchronous action — Cycle 9c reads useEventEditLogStore directly
  // on buyer order detail page. The recordEdit call (in updateLiveEventFields)
  // is what populates the data; this stub exists so the wire-up shape is locked.
  if (channels.banner) {
    // No-op in ORCH-0704 — entry is in useEventEditLogStore already
    console.log("[banner-recorded]", { eventId: payload.eventId, severity: payload.severity });
  }

  if (channels.email) {
    const { subject, body } = composeEmailPayload(payload);
    console.log("[email-stub]", {
      to: `<resolved-by-9c-from-affectedOrderIds>`,
      subject,
      body,
      eventId: payload.eventId,
    });
  }

  if (channels.sms) {
    const text = composeSmsPayload(payload);
    console.log("[sms-stub]", {
      to: `<resolved-by-9c-from-webPurchaseOrderIds>`,
      text,
      eventId: payload.eventId,
    });
  }

  if (channels.push) {
    // ORCH-0704: never fires (channels.push is always false here)
    console.log("[push-deferred]", { reason: "consumer app not built yet", eventId: payload.eventId });
  }
};

export const deriveChannelFlags = (
  severity: EditSeverity,
  hasWebPurchaseOrders: boolean,
): NotificationChannelFlags => {
  // v2-A: SMS only on material+ AND only if web-purchase orders exist
  // additive → banner + email only (no SMS)
  // material → banner + email + (SMS if any web orders)
  // destructive → unreachable (rejected pre-apply); but if reached, treat as material
  return {
    banner: true,
    email: true,
    sms: severity !== "additive" && hasWebPurchaseOrders,
    push: false,  // deferred
  };
};
```

#### 3.3.2 Email + SMS payload composers (NEW)

Define in same `eventChangeNotifier.ts`:

```ts
export const composeEmailPayload = (
  p: NotificationPayload,
): { subject: string; body: string } => {
  const subject = `${p.brandName} updated '${p.eventName}': ${truncate(p.reason, 80)}`;
  const body = [
    `Hi,`,
    ``,
    `${p.brandName} just updated their event '${p.eventName}'.`,
    ``,
    `Why: ${p.reason}`,
    ``,
    `What changed:`,
    ...p.diffSummary.map((line) => `  • ${line}`),
    ``,
    `Tap here to review your order: <web-link-resolved-by-9c>`,
    ``,
    `— Mingla Business`,
  ].join("\n");
  return { subject, body };
};

export const composeSmsPayload = (p: NotificationPayload): string => {
  // SMS hard-cap at 160 chars; truncate reason if needed.
  const baseLen = `${p.brandName} updated ${p.eventName}: . Details: <orderUrl>`.length;
  const reasonBudget = 160 - baseLen;
  const reasonForSms = p.reason.length > reasonBudget
    ? `${p.reason.slice(0, reasonBudget - 1)}…`
    : p.reason;
  return `${p.brandName} updated ${p.eventName}: ${reasonForSms}. Details: <orderUrl>`;
};

const truncate = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, max - 1)}…`;
```

`<web-link-resolved-by-9c>` and `<orderUrl>` are placeholder tokens — Cycle 9c implementor replaces with actual buyer order detail URLs once the route exists. ORCH-0704 ships the placeholders verbatim in stub log output.

#### 3.3.3 `liveEventAdapter.ts` (NEW — same file as v1, unchanged shape)

Same as v1 §3.4.3:
- `liveEventToEditableDraft(liveEvent: LiveEvent): DraftEvent`
- `editableDraftToPatch(original: LiveEvent, edited: DraftEvent): Partial<EditableLiveEventFields>`
- `computeRichFieldDiffs(original: LiveEvent, edited: DraftEvent): FieldDiff[]`
- `computeTicketDiffs(original: TicketStub[], edited: TicketStub[]): TicketDiff[]`
- `FIELD_LABELS` map
- `MATERIAL_KEYS` array
- `SAFE_KEYS` array (NEW v2 — used by classifySeverity)
- `classifySeverity(changedKeys): EditSeverity` (NEW v2)
- `computeDiffSummary(event, patch): string[]` — NEW v2; produces human-readable lines for notification copy. E.g.:
  ```
  ["Description updated", "Date moved to 2026-06-15", "Address changed"]
  ```

#### 3.3.4 `scheduleDateExpansion.ts` (NEW)

```ts
// mingla-business/src/utils/scheduleDateExpansion.ts

/**
 * Active-date computation for ORCH-0704 v2 dropped-date detection.
 *
 * "Active date" = a calendar date the event is scheduled to occur on.
 *
 * Per ORCH-0704 v2 §3.3.4.
 */

import { expandRecurrenceToDates } from "./recurrenceRule";
import type {
  WhenMode,
  RecurrenceRule,
  MultiDateEntry,
} from "../store/draftEventStore";

export interface ActiveSchedule {
  whenMode: WhenMode;
  date: string | null;
  recurrenceRule: RecurrenceRule | null;
  multiDates: MultiDateEntry[] | null;
}

/**
 * Returns sorted ISO YYYY-MM-DD list of all dates the event is scheduled for.
 * - single mode: [event.date] (filtered if null)
 * - recurring mode: expandRecurrenceToDates → ISO formatted
 * - multi_date mode: multiDates[i].date list
 */
export const computeActiveDates = (s: ActiveSchedule): string[] => {
  if (s.whenMode === "single") {
    return s.date !== null ? [s.date] : [];
  }
  if (s.whenMode === "recurring") {
    if (s.date === null || s.recurrenceRule === null) return [];
    const dates = expandRecurrenceToDates(s.recurrenceRule, s.date);
    return dates.map(toIsoDate).sort();
  }
  if (s.whenMode === "multi_date") {
    if (s.multiDates === null) return [];
    return s.multiDates.map((m) => m.date).sort();
  }
  // Exhaustive — TypeScript catches missing branches
  const _exhaust: never = s.whenMode;
  return _exhaust;
};

/**
 * Returns dates present in `before.activeDates` but missing from `after.activeDates`.
 * If empty, no destructive whenMode/recurrence/multi-date change occurred.
 */
export const computeDroppedDates = (
  before: ActiveSchedule,
  after: ActiveSchedule,
): string[] => {
  const beforeDates = new Set(computeActiveDates(before));
  const afterDates = new Set(computeActiveDates(after));
  return [...beforeDates].filter((d) => !afterDates.has(d)).sort();
};

const toIsoDate = (d: Date): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};
```

#### 3.3.5 `orderStoreHelpers.ts` (TRANSITIONAL stub — unchanged from v1)

Same as v1 §3.3:

```ts
export interface SoldCountContext {
  soldCountByTier: Record<string, number>;
  soldCountForEvent: number;
}

/**
 * [TRANSITIONAL] Returns empty/zero in ORCH-0704 because useOrderStore
 * is built in Cycle 9c. EXIT CONDITION: Cycle 9c implementor wires
 * useOrderStore + replaces this stub with live selectors.
 */
export const getSoldCountContextForEvent = (
  event: LiveEvent,
): SoldCountContext => {
  void event;
  return { soldCountByTier: {}, soldCountForEvent: 0 };
};
```

### 3.4 Component layer

#### 3.4.1 Extend `StepBodyProps` (unchanged from v1)

```ts
// mingla-business/src/components/event/types.ts
export interface StepBodyProps {
  draft: DraftEvent;
  updateDraft: (patch: Partial<Omit<DraftEvent, "id" | "brandId" | "createdAt">>) => void;
  errors: ValidationError[];
  showErrors: boolean;
  onShowToast: (message: string) => void;
  scrollToBottom: () => void;
  /**
   * When provided, the step body is in edit-after-publish mode.
   * Currently only Step 5 reads this for tier lock UX.
   * Per ORCH-0704 v2 §3.4.1.
   */
  editMode?: {
    soldCountByTier: Record<string, number>;
  };
}
```

#### 3.4.2 Modify `CreatorStep5Tickets` (same UX as v1; clarified messaging)

When `props.editMode?.soldCountByTier[t.id] > 0`:
- TicketCard subline: append `· Sold: N`
- TicketCard Delete (trash) button: hide entirely
- TicketSheet on opening this tier:
  - Price field: rendered disabled (`pointerEvents="none"`, `opacity: 0.5`) with helper line "Existing buyers locked at £X. To change for new buyers, refund and remove this tier first, then add a new one."
  - Free toggle: same disabled treatment with helper "Existing buyers paid the original amount."
  - Capacity field: editable, but `validateStep`-runs treat `< sold` as an inline error. Helper: "Can't drop below {sold} tickets sold."
  - Visibility section: PROMOTE the visibility toggle (currently in modifiers section) to top-level when sold > 0 — operator's primary action for "stop selling" is `visibility: "disabled"`.
  - Sheet bottom Delete button: hidden when sold > 0.

The runtime guard rail (in `updateLiveEventFields`) catches violations even if the UI is bypassed via API — defense-in-depth.

#### 3.4.3 Modify `EditAfterPublishBanner`

Update copy:

```ts
heading: "You're editing a live event"
body: "Changes save immediately. Existing buyers stay protected — their tickets and prices won't change. Material changes (date, venue, format) notify your buyers via email + SMS. Some changes require refunding existing buyers first."
```

Layout unchanged (orange-tinted GlassCard + flag icon).

#### 3.4.4 Enrich `ChangeSummaryModal` v2

The modal now contains:

1. **Diff list** (same v1 + sub-renderer for tickets):
   - Each diff row: label + old → new + severity dot (`safe`=tertiary, `material`=accent.warm)
   - For `tickets` key: expand to per-tier added/removed/updated sub-list using `computeTicketDiffs`

2. **REQUIRED reason input** (NEW v2):
   ```
   Why are you making this change? *
   ┌────────────────────────────────────┐
   │ e.g. Venue change due to weather…  │  (multiline TextInput, 3-4 lines tall)
   └────────────────────────────────────┘
   Min 10 characters · {N} / 200
   ```
   - State held by ChangeSummaryModal locally (lifted to EditPublishedScreen on Save click)
   - char counter live-updates
   - placeholder: "e.g. Venue change due to weather; updating ticket prices for next phase; correcting typo"
   - Validation: trim, count chars, must be 10..200

3. **Notification footer note** (conditional on severity):
   - severity = additive: footer text "Changes will be logged in your event's edit history. No buyer notification."
   - severity = material: footer text "Material changes notify your buyers by email${webPurchasePresent ? ' and SMS' : ''}. Reason will be included in the message."

4. **CTAs**:
   - Cancel (ghost): closes modal; preserves edits
   - Save changes (primary): disabled while reason invalid; shows spinner during 800ms simulated processing
   - Both disabled while submitting

Submitting state lifted from EditPublishedScreen (parent owns submission flow).

```ts
export interface ChangeSummaryModalProps {
  visible: boolean;
  diffs: FieldDiff[];
  ticketDiffs?: TicketDiff[];           // NEW v2 — for tickets sub-renderer
  severity: EditSeverity;               // NEW v2 — drives footer note
  webPurchasePresent: boolean;          // NEW v2 — drives "and SMS" copy
  onClose: () => void;
  onConfirm: (reason: string) => void;  // NEW v2 — passes reason up
  submitting: boolean;
}
```

#### 3.4.5 New `EditPublishedScreen` (sectioned — same as v1 architecture)

Component structure unchanged from v1 §3.4.3. Save flow REVISED:

```
1. User taps "Save changes" button (sticky bottom dock) → handleSavePress()
2. Run validation across all sections (validateStep per section on edited state) →
   if any errors: setShowErrors(true) + scroll → return
3. const patch = editableDraftToPatch(liveEvent, editState)
4. if Object.keys(patch).length === 0 → toast "No changes to save." → return
5. const ticketDiffs = patch.tickets ? computeTicketDiffs(liveEvent.tickets, editState.tickets) : undefined
6. const fieldDiffs = computeRichFieldDiffs(liveEvent, editState)
7. const severity = classifySeverity(Object.keys(patch))
8. setModalState({visible: true, fieldDiffs, ticketDiffs, severity})
9. User enters reason in modal → confirms → handleConfirmSave(reason)
10. setSubmitting(true)
11. await new Promise(r => setTimeout(r, 800))  // stub processing
12. const ctx = getSoldCountContextForEvent(liveEvent)
13. const result = useLiveEventStore.getState().updateLiveEventFields(
      liveEvent.id, patch, ctx, reason,
    )
14. setSubmitting(false); setModalState({visible: false})
15. if result.ok=true → toast "Saved. Live now." → 600ms delay → router.back
16. if result.ok=false → setRejectDialog(mapResultToDialog(result))
```

`mapResultToDialog(result)` returns `{title, body, primaryAction, primaryLabel}` per the table in §3.5 below.

Discard handling: same as v1 (back arrow → discard local edits → router.back; no confirmation).

#### 3.4.6 Reject dialog (NEW v2 — refund-first variant)

```ts
// EditPublishedScreen-internal helper or new `editRejectDialog.ts` util
export interface RejectDialogContent {
  title: string;
  body: string;
  primaryLabel: string;
  primaryAction: () => void;
}

export const mapRejectionToDialog = (
  result: Extract<UpdateLiveEventResult, { ok: false }>,
  router: { push: (path: string) => void; back: () => void },
  eventId: string,
  setOpen: (open: boolean) => void,
): RejectDialogContent => {
  switch (result.reason) {
    case "event_not_found":
      return {
        title: "Couldn't find this event",
        body: "It may have been deleted. Tap back to return.",
        primaryLabel: "Back",
        primaryAction: () => { setOpen(false); router.back(); },
      };
    case "missing_edit_reason":
    case "invalid_edit_reason":
      // Shouldn't reach here — modal blocks save before invocation.
      return {
        title: "Reason needed",
        body: "Please enter a reason between 10 and 200 characters.",
        primaryLabel: "Got it",
        primaryAction: () => setOpen(false),
      };
    case "capacity_below_sold": {
      const n = result.affectedOrderCount ?? 0;
      return {
        title: "Refund first",
        body: `${n} tickets are sold for this tier. To drop capacity below ${n}, refund the buyers first.`,
        primaryLabel: "Open Orders",
        primaryAction: () => { setOpen(false); router.push(`/event/${eventId}/orders`); },
      };
    }
    case "tier_delete_with_sales": {
      const n = result.affectedOrderCount ?? 0;
      return {
        title: "Refund first",
        body: `${n} tickets are sold for this tier. Refund all ${n} buyers before deleting.`,
        primaryLabel: "Open Orders",
        primaryAction: () => { setOpen(false); router.push(`/event/${eventId}/orders`); },
      };
    }
    case "tier_price_change_with_sales":
      return {
        title: "Refund first",
        body: `Existing buyers are protected at the price they paid. Refund all ${result.affectedOrderCount ?? "existing"} buyers, then change the price (or add a new tier at the new price).`,
        primaryLabel: "Open Orders",
        primaryAction: () => { setOpen(false); router.push(`/event/${eventId}/orders`); },
      };
    case "tier_free_toggle_with_sales":
      return {
        title: "Refund first",
        body: `Toggling free/paid for a sold tier requires refunding all ${result.affectedOrderCount ?? "existing"} buyers first.`,
        primaryLabel: "Open Orders",
        primaryAction: () => { setOpen(false); router.push(`/event/${eventId}/orders`); },
      };
    case "multi_date_remove_with_sales": {
      const dropped = result.droppedDates ?? [];
      const n = result.affectedOrderCount ?? 0;
      return {
        title: "Refund first",
        body: `Tickets sold for this event grant access to all dates. Refund ${n} orders before removing ${dropped.length === 1 ? `the date ${dropped[0]}` : "these dates"}.`,
        primaryLabel: "Open Orders",
        primaryAction: () => { setOpen(false); router.push(`/event/${eventId}/orders`); },
      };
    }
    case "when_mode_drops_active_date": {
      const dropped = result.droppedDates ?? [];
      const n = result.affectedOrderCount ?? 0;
      return {
        title: "Refund first",
        body: `Switching mode would drop ${dropped.length === 1 ? `the date ${dropped[0]}` : `${dropped.length} dates`} from your schedule. ${n} buyers paid for this event — refund them before switching.`,
        primaryLabel: "Open Orders",
        primaryAction: () => { setOpen(false); router.push(`/event/${eventId}/orders`); },
      };
    }
    case "recurrence_drops_occurrence": {
      const dropped = result.droppedDates ?? [];
      const n = result.affectedOrderCount ?? 0;
      return {
        title: "Refund first",
        body: `Your new recurrence rule drops ${dropped.length === 1 ? `the date ${dropped[0]}` : `${dropped.length} occurrences`}. ${n} buyers paid for this event — refund them first.`,
        primaryLabel: "Open Orders",
        primaryAction: () => { setOpen(false); router.push(`/event/${eventId}/orders`); },
      };
    }
    default: {
      const _exhaust: never = result.reason;
      return _exhaust;
    }
  }
};
```

The reject dialog uses the existing `ConfirmDialog` primitive (or composes inline) — primary CTA label varies, secondary "Cancel" closes the dialog and returns operator to the edit screen with edits intact.

NOTE on `/event/${eventId}/orders` route: doesn't exist today (Cycle 9c builds it). For ORCH-0704 stub mode, the "Open Orders" CTA in the dialog shows "Open Orders (lands Cycle 9c)" tooltip OR routes to a placeholder toast. Implementor recommendation: show a toast "Orders ledger lands Cycle 9c — your refund flow is coming." and close the dialog. When 9c lands, swap the action to real navigation.

### 3.5 Routing

Unchanged from v1: `?mode=edit-published` query param branch in `app/event/[id]/edit.tsx` already correct; renders `<EditPublishedScreen liveEvent={liveEvent} />` (the v2 EditPublishedScreen accepts the same prop).

### 3.6 Forward-looking Cycle 9c contract (REVISED from v1)

When 9c implementor builds buyer order detail page:

1. **Replace stub `getSoldCountContextForEvent`** in `orderStoreHelpers.ts` with live version (per v1 §3.3 example).
2. **Wire `confirm.tsx`** to `useOrderStore.getState().recordOrder({...})`.
3. **Build buyer order detail page** at TBD route (`/order/[orderId]` outside `(tabs)/`, anon-tolerant per `feedback_anon_buyer_routes`):
   - Reads `OrderRecord` from useOrderStore + `LiveEvent` from liveEventStore (live)
   - Frozen financial fields from OrderRecord.lines[]
   - Displayable fields from LiveEvent
   - **Material-change banner driven by `useEventEditLogStore`** (REVISED from v1 — banner reads edit log entries since `lastSeenEventUpdatedAt`, NOT a per-field diff against snapshot):
     ```ts
     const editsSinceLastSeen = useEventEditLogStore.getState()
       .getEditsForEventSince(eventId, order.lastSeenEventUpdatedAt);
     const materialEdits = editsSinceLastSeen.filter((e) => e.severity !== "additive");
     // Show banner if materialEdits.length > 0; latest entry's reason in copy
     ```
   - Banner copy: `"{brandName} updated this event{N > 1 ? ' multiple times' : ''}. Latest reason: '{latestEdit.reason}'. Tap to review."`
   - "Got it" action: `useOrderStore.getState().updateOrder(orderId, { lastSeenEventUpdatedAt: latestEdit.editedAt })`
4. **Update notification stack stubs to real wiring** (B-cycle): swap `console.log("[email-stub]", ...)` for real Resend/Twilio invocation.

ORCH-0704 implementor MUST NOT touch any of these. They're documented for 9c context only.

---

## 4 — Success Criteria

### Operator-side full edit (carried from v1, plus new v2)

| # | Criterion | Verification |
|---|-----------|-------------|
| 0704-AC#1 | Open EditPublishedScreen on a live event with no sales — every section is expandable; every field editable; no lock UX shown | Manual |
| 0704-AC#2 | Edit name → save → ChangeSummaryModal shows "Event name: old → new" diff + reason input → enter reason ≥10 chars → Confirm → 800ms → toast "Saved. Live now." → router.back | Manual |
| 0704-AC#3 | Edit address (material) → ChangeSummaryModal shows material-severity indicator + footer "Material changes notify your buyers by email and SMS" | Manual |
| 0704-AC#4 | Edit cover hue + description in same session → save → ChangeSummaryModal shows BOTH diffs | Manual |
| 0704-AC#5 | Add new tier → save → ChangeSummaryModal shows "Tickets: Added: {name}" | Manual |
| 0704-AC#6 | Remove tier (no sales) → save → ChangeSummaryModal shows "Tickets: Removed: {name}" → save succeeds | Manual |
| 0704-AC#7 | Update tier capacity (no sales) → save → ChangeSummaryModal shows "Tickets: Updated: {name} — capacity 100 → 200" | Manual |
| 0704-AC#8 | Multi-field edit — name + description + add tier → ChangeSummaryModal shows 3 diffs | Manual |
| 0704-AC#9 | Save with no changes → toast "No changes to save." | Manual |
| 0704-AC#10 | ChangeSummaryModal Cancel → returns to edit screen with edits intact | Manual |
| 0704-AC#11 | Back arrow / chrome X → discards edits → router.back | Manual |
| 0704-AC#12 | Public event page reflects edits immediately after save | Manual |
| 0704-AC#13 | tsc strict: passing frozen field key (e.g. `id`) to `updateLiveEventFields` is a compile error | tsc check |
| 0704-AC#14 | grep `oklch(` returns no matches | grep |
| 0704-AC#15 | Subtraction verified: `liveEventToEditPatch.ts` does NOT exist; old `EditPublishedScreen.tsx` content fully replaced; old `updateLiveEventEditableFields` removed | grep + read |
| 0704-AC#16 | Drafts: editing a draft from Drafts pill opens Cycle 3 wizard (NOT EditPublishedScreen) | Manual regression |
| 0704-AC#17 | Cycle 3 wizard create flow unchanged | Manual regression |
| 0704-AC#18 | tsc --noEmit EXIT=0 across mingla-business workspace | Build verify |

### v2 — reason capture

| # | Criterion | Verification |
|---|-----------|-------------|
| 0704-AC#19 | Reason input visible in ChangeSummaryModal whenever it opens (every save flow) | Manual |
| 0704-AC#20 | Reason char counter live-updates; Save button disabled until reason ≥ 10 chars | Manual |
| 0704-AC#21 | Reason > 200 chars: cannot be entered (input maxLength enforced) | Manual |
| 0704-AC#22 | Calling `updateLiveEventFields(...)` with `reason=""` returns `{ok: false, reason: "missing_edit_reason"}` | Unit test recommended |
| 0704-AC#23 | Calling `updateLiveEventFields(...)` with `reason="123456789"` (9 chars) returns `{ok: false, reason: "invalid_edit_reason"}` | Unit test recommended |
| 0704-AC#24 | After successful save, `useEventEditLogStore.getEditsForEvent(eventId)` returns the new entry with the correct reason | Manual + grep |

### v2 — edit audit log

| # | Criterion | Verification |
|---|-----------|-------------|
| 0704-AC#25 | First successful save creates 1 entry in `useEventEditLogStore.entries` | Manual |
| 0704-AC#26 | Entries are append-only (newest first); no mutation API exists | Code review |
| 0704-AC#27 | Edit log persists across app restarts (Zustand persist) | Manual: kill app, reopen, verify entries present |
| 0704-AC#28 | `clearAllStores()` → `useEventEditLogStore.entries === []` | Manual: trigger logout, verify empty |
| 0704-AC#29 | Each entry has correct severity classification (additive vs material) | Manual: edit description-only → severity "additive"; edit address → severity "material" |

### v2 — notification stack

| # | Criterion | Verification |
|---|-----------|-------------|
| 0704-AC#30 | After successful additive save: `[email-stub]` console log fires; `[sms-stub]` does NOT fire | Manual: open dev console, edit description, verify logs |
| 0704-AC#31 | After successful material save: `[email-stub]` AND `[sms-stub]` console logs fire | Manual: open dev console, edit address, verify logs |
| 0704-AC#32 | `[push-deferred]` log NEVER fires (channels.push always false in ORCH-0704) | grep dev console output |
| 0704-AC#33 | `[banner-recorded]` log fires for every successful save | Manual |
| 0704-AC#34 | Email payload contains: subject with brand+event+reason; body with reason + diff summary | Read console output |
| 0704-AC#35 | SMS payload ≤ 160 chars; reason truncated with ellipsis if needed | Read console output |

### v2 — refund-first guard rails (simulated soldCount via mock)

| # | Criterion | Verification |
|---|-----------|-------------|
| 0704-AC#36 | Drop tier capacity below sold (simulated) → reject dialog "Refund first — N tickets are sold" with primary "Open Orders" | Unit + manual |
| 0704-AC#37 | Try delete tier with sales (simulated) → tier card has no Delete button (UI guard); API call returns reject "tier_delete_with_sales" | Unit + manual |
| 0704-AC#38 | Try change tier price with sales (simulated) → price field disabled in TicketSheet (UI guard); API call returns reject "tier_price_change_with_sales" | Unit + manual |
| 0704-AC#39 | Try toggle isFree on sold tier (simulated) → toggle disabled in TicketSheet (UI guard); API call returns reject "tier_free_toggle_with_sales" | Unit + manual |
| 0704-AC#40 | whenMode change that DROPS a previously-active date with sales (simulated) → reject "when_mode_drops_active_date" with droppedDates in dialog body | Unit |
| 0704-AC#41 | whenMode change that PRESERVES all previously-active dates (e.g. zero sales OR new schedule includes original date) → save succeeds | Unit |
| 0704-AC#42 | Recurrence rule change that drops occurrences (simulated soldCount > 0) → reject "recurrence_drops_occurrence" | Unit |
| 0704-AC#43 | Recurrence rule change that ADDS occurrences (no drops) → save succeeds | Unit |
| 0704-AC#44 | Multi-date entry removal with sales (simulated) → reject "multi_date_remove_with_sales" | Unit |
| 0704-AC#45 | Stub-mode (real run): all guard rails inactive (soldCount returns 0) — operator can perform any edit | Manual |

### Schema lock (forward-looking, validated when 9c implements)

| # | Criterion | Verification |
|---|-----------|-------------|
| 0704-AC#46 | OrderRecord shape verbatim per spec §3.1.5 | 9c read |
| 0704-AC#47 | Stub helper `getSoldCountContextForEvent` labeled `[TRANSITIONAL]` with explicit EXIT CONDITION | grep + read |
| 0704-AC#48 | When 9c replaces stub with live version, EditPublishedScreen + updateLiveEventFields callers do NOT change | Forward verify |
| 0704-AC#49 | When 9c builds buyer order detail page, banner reads `useEventEditLogStore.getEditsForEventSince(eventId, lastSeenEventUpdatedAt)` for material-change history | Forward verify |

---

## 5 — Invariants

### Preserved (from v1)

I-11 through I-17 (mingla-business) preserved as documented in v1 §5.

I-18 (DRAFT — Cycle 8) preserved by spec'd OrderRecord shape (Cycle 9c implementation).

### NEW v2 invariants

#### **I-19 — Immutable order financials**

> An order's `totalGbpAtPurchase`, `lines[i].unitPriceGbpAtPurchase`, `lines[i].ticketNameAtPurchase`, `lines[i].isFreeAtPurchase`, `currency`, and `buyer` snapshot are write-once at order insertion to `useOrderStore`. No subsequent operator action — including event edit, tier rename, tier reprice, refund, cancel — mutates these fields. Refund/cancel mutations create NEW records (RefundRecord) and update `status` + `refundedAmountGbp` aggregates only.

Status: ratified at ORCH-0704 v2 close.
CI gate (post-Stripe, B-cycle): SQL CHECK or trigger.

#### **I-20 — Edit reason mandatory + audit log permanence**

> Every successful `updateLiveEventFields` call MUST:
> 1. Receive a non-empty `reason: string` (10 ≤ trimmed-length ≤ 200) from the caller
> 2. Append exactly one entry to `useEventEditLogStore` BEFORE returning success
> 3. Fire the notification stack via `eventChangeNotifier.notifyEventChanged` BEFORE returning success
>
> The audit log entry, once written, is immutable. No edit / delete mutations exist on `useEventEditLogStore`. Logout clears the store entirely (Const #6 owns the data lifetime).

Status: ratified at ORCH-0704 v2 close.

Preservation:
- Compile-time: `reason: string` parameter is required by signature; passing empty string is technically possible.
- Runtime: store mutation rejects with `reason: "missing_edit_reason"` or `"invalid_edit_reason"`.
- Audit log mutation API exposes ONLY `recordEdit` (append) + `getEditsForEvent` (read) + `getLatestEditForEvent` (read) + `getEditsForEventSince` (read) + `reset` (logout). No `updateEdit`, `deleteEdit`.

Test verifying preservation: unit test (recommended) — call `updateLiveEventFields(id, {description: "x"}, ctx, "")` → expect `{ok: false, reason: "missing_edit_reason"}`.

---

## 6 — Test Cases

### Operator-side full edit (T-1 to T-12 from v1, retained)

Same as v1 §6. T-1: edit name. T-2: edit description. ... T-12: public event page reflects edit.

### v2 — reason capture (T-13 to T-17)

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-13 | Reason min length | Open modal, type 9 chars | Save button disabled; counter shows 9/200 | Component |
| T-14 | Reason min length met | Type 10th char | Save button enabled | Component |
| T-15 | Reason max length | Type 201st char (or paste 250-char text) | Input rejects beyond 200; counter shows 200/200 | Component |
| T-16 | API empty reason | Call updateLiveEventFields(id, patch, ctx, "") directly | Returns `{ok: false, reason: "missing_edit_reason"}` | Store |
| T-17 | API short reason | Call updateLiveEventFields(id, patch, ctx, "abc") | Returns `{ok: false, reason: "invalid_edit_reason"}` | Store |

### v2 — edit audit log (T-18 to T-22)

| Test | Scenario | Expected |
|------|----------|----------|
| T-18 | Single save creates 1 entry | useEventEditLogStore.entries.length === 1 after successful save |
| T-19 | Entry contains correct reason | entry.reason === "Updated venue due to weather" (whatever operator typed) |
| T-20 | Entry severity classification | description-only edit → severity="additive"; address edit → severity="material" |
| T-21 | Persist across restart | Save edit → kill app → reopen → entries still present |
| T-22 | Logout clears | clearAllStores() → entries === [] |

### v2 — notification stack (T-23 to T-27)

| Test | Scenario | Expected |
|------|----------|----------|
| T-23 | Additive save fires email but not SMS | console: `[email-stub]` present, `[sms-stub]` absent |
| T-24 | Material save fires email + SMS | console: both present |
| T-25 | Push never fires | No `[push-deferred]` log content; only the deferred-marker log |
| T-26 | Email payload shape | `subject` contains brand + event + truncated reason; `body` includes diff summary |
| T-27 | SMS payload ≤ 160 chars | console output line length ≤ 160 |

### v2 — refund-first guard rails (T-28 to T-37)

(All tests require simulated `soldCountByTier` / `soldCountForEvent` via mock helper override or unit test setup.)

| Test | Scenario | Expected |
|------|----------|----------|
| T-28 | Capacity below sold | `{ok:false, reason:"capacity_below_sold", tierIds:["tier1"], affectedOrderCount:50}` |
| T-29 | Tier delete with sales | `{ok:false, reason:"tier_delete_with_sales"}` |
| T-30 | Tier price change with sales | `{ok:false, reason:"tier_price_change_with_sales"}` |
| T-31 | Tier free toggle with sales | `{ok:false, reason:"tier_free_toggle_with_sales"}` |
| T-32 | Multi-date remove with sales | `{ok:false, reason:"multi_date_remove_with_sales", droppedDates:["2026-06-15"]}` |
| T-33 | whenMode change drops dates | `{ok:false, reason:"when_mode_drops_active_date", droppedDates:[...]}` |
| T-34 | whenMode change preserves dates | `{ok:true, editLogEntryId: "ee_..."}` |
| T-35 | Recurrence drops occurrences | `{ok:false, reason:"recurrence_drops_occurrence", droppedDates:[...]}` |
| T-36 | Recurrence adds occurrences only | `{ok:true, ...}` |
| T-37 | Stub mode all rules inactive | All edits succeed (soldCount stub returns 0) |

### Regression (T-R1 to T-R5 from v1, retained)

T-R1: Cycle 3 wizard create. T-R2: Cycle 3 wizard edit-draft. T-R3: Cycle 9a manage menu. T-R4: Cycle 9b-1 lifecycle. T-R5: Cycle 8 checkout.

### Schema lock (T-S1 to T-S5 — verified at 9c implementation time)

| Test | Scenario | Expected |
|------|----------|----------|
| T-S1 | OrderRecord shape | Matches spec §3.1.5 verbatim |
| T-S2 | Helper API stability | Replacing stub with live version requires zero changes to EditPublishedScreen |
| T-S3 | I-19 preservation | Operator edits LiveEvent (rename tier); existing OrderRecord lines unchanged |
| T-S4 | Banner reads from edit log | Buyer order detail page reads `useEventEditLogStore.getEditsForEventSince` |
| T-S5 | Banner copy matches latest entry's reason | Banner shows operator's actual reason |

---

## 7 — Implementation Order

### Subtract phase (Const #8 — before adding)

1. DELETE `mingla-business/src/utils/liveEventToEditPatch.ts`
2. MOD `mingla-business/src/store/liveEventStore.ts`:
   - Remove `updateLiveEventEditableFields` type signature + impl
   - Add `EditableLiveEventFields` type (Pick from LiveEvent)
   - Add `UpdateLiveEventRejection` enum + `UpdateLiveEventResult` discriminated union
   - Add `updateLiveEventFields` mutation with reason validation + guard rails + log + notify

### Add phase — types & helpers

3. CREATE `mingla-business/src/store/orderStoreHelpers.ts`:
   - `SoldCountContext` type
   - `getSoldCountContextForEvent` TRANSITIONAL stub returning zeros

4. CREATE `mingla-business/src/store/eventEditLogStore.ts`:
   - `EditSeverity`, `EventEditEntry`, `EventEditLogState` types
   - Zustand persist; AsyncStorage key `mingla-business.eventEditLog.v1`
   - Mutations: `recordEdit`, `getEditsForEvent`, `getLatestEditForEvent`, `getEditsForEventSince`, `reset`
   - `generateEditEntryId()` helper (ee_ts36_rand)

5. MOD `mingla-business/src/utils/clearAllStores.ts`:
   - Add `useEventEditLogStore.getState().reset()` after liveEventStore reset

6. CREATE `mingla-business/src/utils/scheduleDateExpansion.ts`:
   - `ActiveSchedule` type
   - `computeActiveDates(schedule): string[]`
   - `computeDroppedDates(before, after): string[]`
   - Reuses `expandRecurrenceToDates` from `recurrenceRule.ts`

7. CREATE `mingla-business/src/services/eventChangeNotifier.ts`:
   - `NotificationPayload`, `NotificationChannelFlags` types
   - `notifyEventChanged(payload, channels)` — TRANSITIONAL console-log stubs
   - `deriveChannelFlags(severity, hasWebPurchaseOrders)` per v2-A rules
   - `composeEmailPayload(payload)` + `composeSmsPayload(payload)`

8. CREATE `mingla-business/src/utils/liveEventAdapter.ts`:
   - `liveEventToEditableDraft`, `editableDraftToPatch` (v1)
   - `computeRichFieldDiffs`, `computeTicketDiffs` (v1)
   - `FIELD_LABELS`, `MATERIAL_KEYS`, `SAFE_KEYS` (v2)
   - `classifySeverity(changedKeys)`, `computeDiffSummary(event, patch)` (v2)

### Add phase — components

9. MOD `mingla-business/src/components/event/types.ts`:
   - Extend `StepBodyProps` with optional `editMode?: { soldCountByTier: Record<string, number> }`

10. MOD `mingla-business/src/components/event/CreatorStep5Tickets.tsx`:
    - Read `props.editMode?.soldCountByTier`
    - TicketCard subline + Delete button gating
    - TicketSheet price/isFree disable when sold > 0
    - Capacity inline-floor validation
    - Visibility promotion when sold > 0

11. MOD `mingla-business/src/components/event/EditAfterPublishBanner.tsx`:
    - Update body copy per §3.4.3

12. MOD `mingla-business/src/components/event/ChangeSummaryModal.tsx`:
    - Accept v2 props (severity, ticketDiffs, webPurchasePresent, onConfirm(reason))
    - Tickets-diff sub-renderer (uses `TicketDiff[]`)
    - REQUIRED reason TextInput (multiline) + char counter
    - Notification footer note (severity-dependent)
    - Save button disabled until reason valid
    - Submitting state lifted to parent

13. REPLACE `mingla-business/src/components/event/EditPublishedScreen.tsx` (full rewrite per §3.4.5):
    - Sectioned layout (6 collapsible cards: Basics, When, Where, Cover, Tickets, Settings)
    - Local edit state via `useState(liveEventToEditableDraft(liveEvent))`
    - Per-section CreatorStepN body component reuse
    - Save flow per §3.4.5 (validate → diff → ChangeSummaryModal → confirm with reason → mutation → toast → back)
    - Reject dialog mapping per `mapRejectionToDialog` helper
    - Keyboard handling mirrors EventCreatorWizard pattern

### Verify phase

14. tsc --noEmit → EXIT=0
15. grep `oklch(` → no matches in mingla-business/src + mingla-business/app
16. grep `liveEventToEditPatch` → no matches
17. grep `updateLiveEventEditableFields` → no matches (removed)
18. grep `[TRANSITIONAL]` shows expected stubs (orderStoreHelpers, eventChangeNotifier email + sms + push)
19. Manual smoke per success criteria §4

---

## 8 — Regression Prevention

### Structural safeguards

1. **TypeScript-enforced frozen fields.** `updateLiveEventFields` accepts only `Partial<EditableLiveEventFields>`. Compile error on any frozen key (id, brandId, brandSlug, eventSlug, status, publishedAt, cancelledAt, endedAt, createdAt, updatedAt, orders).

2. **Runtime guard rails in store.** Reason validation, sold-count guards, dropped-date detection — all enforced in `updateLiveEventFields` BEFORE applying patch. Returns discriminated union; UI cannot bypass.

3. **TRANSITIONAL labels with explicit EXIT CONDITIONS.** Required on:
   - `getSoldCountContextForEvent` (orderStoreHelpers.ts) — exit: Cycle 9c
   - `notifyEventChanged` email branch — exit: B-cycle Resend
   - `notifyEventChanged` sms branch — exit: B-cycle Twilio
   - `notifyEventChanged` push branch — exit: consumer app cycle
   - Implementor's grep for "TRANSITIONAL" surfaces all four.

4. **Audit log append-only API.** Store exposes only `recordEdit` (append) + reads + `reset` (logout). No update/delete mutations. Defense-in-depth against accidental log tampering.

5. **Optional `editMode` prop on StepBodyProps.** Default undefined; backward-compatible with create-flow.

6. **Adapter functions are pure.** No side effects. `liveEventToEditableDraft` + `editableDraftToPatch` + `computeActiveDates` + `computeDroppedDates` — all stateless.

7. **Severity classification is exhaustive.** `classifySeverity` defaults to "additive" for unknown keys; explicit test for every editable key.

### Protective comments

- `liveEventStore.ts` — comment above `updateLiveEventFields`: "// Per ORCH-0704 v2. Frozen fields blocked at compile time via EditableLiveEventFields. Runtime guards: reason 10..200; capacity floor; tier delete/price/free with sales; whenMode/recurrence dropped-date detection."
- `eventEditLogStore.ts` — header doc: "Append-only audit log. EXIT CONDITION: when buyer order detail page (Cycle 9c) lands, the material-change banner reads from this store."
- `eventChangeNotifier.ts` — header doc per channel: explicit EXIT CONDITION lines.
- `scheduleDateExpansion.ts` — header doc: "Active-date computation. Used by updateLiveEventFields to enforce refund-first when whenMode/recurrence/multiDates change drops a previously-active date."

---

## 9 — Layer touchpoint summary

| Layer | Files |
|-------|-------|
| Schema (types) | `liveEventStore.ts` (EditableLiveEventFields, UpdateLiveEventRejection, UpdateLiveEventResult); `eventEditLogStore.ts` (EditSeverity, EventEditEntry, EventEditLogState); `eventChangeNotifier.ts` (NotificationPayload, NotificationChannelFlags); spec'd-only OrderRecord/RefundRecord/BuyerSnapshot for 9c |
| Store | `liveEventStore.ts` (replace mutation); `eventEditLogStore.ts` (NEW); `orderStoreHelpers.ts` (NEW stub); `clearAllStores.ts` (MOD — wire reset) |
| Service | `eventChangeNotifier.ts` (NEW — stub log) |
| Adapter / utility | `liveEventAdapter.ts` (NEW — adapter + diff + classifier); `scheduleDateExpansion.ts` (NEW — active-date) |
| Hook | None |
| Component | REPLACE `EditPublishedScreen.tsx`; MOD `EditAfterPublishBanner.tsx`, `ChangeSummaryModal.tsx`, `CreatorStep5Tickets.tsx`, `types.ts` |
| Realtime | N/A |
| Edge function | N/A (all client-side stub) |
| Database | N/A (Zustand persist only) |
| Routing | None — `?mode=edit-published` already correct |

Total: 6 NEW + 5 MOD + 1 REPLACE + 1 DELETE.

---

## 10 — File touch matrix

| File | Action | LOC est |
|------|--------|---------|
| `mingla-business/src/store/liveEventStore.ts` | MOD | +120 / -25 |
| `mingla-business/src/store/eventEditLogStore.ts` | NEW | ~150 |
| `mingla-business/src/store/orderStoreHelpers.ts` | NEW | ~40 |
| `mingla-business/src/services/eventChangeNotifier.ts` | NEW | ~140 |
| `mingla-business/src/utils/liveEventAdapter.ts` | NEW | ~220 |
| `mingla-business/src/utils/scheduleDateExpansion.ts` | NEW | ~80 |
| `mingla-business/src/utils/clearAllStores.ts` | MOD | +2 |
| `mingla-business/src/utils/liveEventToEditPatch.ts` | DELETE | -110 |
| `mingla-business/src/components/event/types.ts` | MOD | +8 |
| `mingla-business/src/components/event/CreatorStep5Tickets.tsx` | MOD | +90 / -5 |
| `mingla-business/src/components/event/EditAfterPublishBanner.tsx` | MOD | +5 / -5 |
| `mingla-business/src/components/event/ChangeSummaryModal.tsx` | MOD | +200 / -40 (reason input + tickets sub-renderer + footer note + props expansion) |
| `mingla-business/src/components/event/EditPublishedScreen.tsx` | REPLACE | ~700 |
| **Net** | | ~+1500 / -200 (~+1300 net) |

---

## 11 — Constraints reminder

Memory rules in force (verify implementor honors):
- `feedback_keyboard_never_blocks_input` — EditPublishedScreen mirrors EventCreatorWizard's keyboard pattern
- `feedback_rn_color_formats` — hsl/hex only
- `feedback_toast_needs_absolute_wrap` (REVISED 2026-05-02) — Toast self-positions via Modal portal
- `feedback_anon_buyer_routes` — buyer order detail page (9c) outside `(tabs)/`, no useAuth
- `feedback_implementor_uses_ui_ux_pro_max` — implementor MUST run `/ui-ux-pro-max` pre-flight before writing the new ChangeSummaryModal v2 (reason input + char counter + footer) AND new EditPublishedScreen sectioned layout
- `feedback_short_responses` — chat reply ≤ 20 lines, all detail in this spec file
- `feedback_no_summary_paragraph` — implementor's chat reply has no summary paragraph

Constitution honored:
- **#1 No dead taps** — every section header / button / reject dialog CTA wired
- **#2 One owner per truth** — LiveEvent in liveEventStore; OrderRecord in useOrderStore (9c); EventEditEntry in eventEditLogStore; CartLine in cart context
- **#3 No silent failures** — UpdateLiveEventResult discriminated union surfaces every reject with explicit reason
- **#6 Logout clears** — useEventEditLogStore.reset wired into clearAllStores
- **#7 TRANSITIONAL labels** — orderStoreHelpers stub + email/SMS/push notification stubs
- **#8 Subtract before adding** — narrow 9b-2 first
- **#9 No fabricated data** — real soldCount in 9c; zero stub in ORCH-0704
- **#10 Currency-aware UI** — OrderRecord locks `currency: "GBP"` at purchase

---

## 12 — Decisions to log

When ORCH-0704 v2 closes:

### DEC-087 — Full edit-after-publish + buyer protection + notification stack + reason audit

Date: 2026-05-02 (steering); ratify on tester PASS.

Locks:
1. Full event edit; existing buyers protected via I-19 (immutable order financials)
2. Buyer-side displayable info reads LIVE from current LiveEvent
3. Material changes fire notification stack: banner (in-app, Cycle 9c renders) + email (Resend, B-cycle) + SMS (Twilio, B-cycle for web purchases) + push (consumer app, deferred)
4. Refund-first as unified destructive pattern: capacity floor, tier-delete-with-sales, tier-price-change-with-sales, tier-free-toggle-with-sales, multi-date-remove-with-sales, whenMode-drops-active-date, recurrence-drops-occurrence
5. Reason mandatory on every save (10..200 chars)
6. Edit audit log permanent (`useEventEditLogStore`); banner reads from log; logout clears
7. Stub-mode (ORCH-0704) ships zero soldCount + console-log notifications; guard rails inactive until 9c wires useOrderStore + B-cycle wires Resend/Twilio

Rationale: operator decision 2026-05-02. Industry-standard buyer-protection pattern (Eventbrite/Ticketmaster). Multi-channel notification with reason capture preserves audit trail + buyer trust + operator accountability.

Alternatives considered:
- v1 spec (silent push for cosmetic, lock destructive) — rejected by operator
- Wizard mode prop refactor — rejected (wrong UX shape, 769 LOC churn)
- Per-section sub-routes — rejected (navigation overhead)

### I-19 + I-20

Ratify both at ORCH-0704 v2 close (per §5).

### ORCH-0705 placeholder

Register in MASTER_BUG_LIST + WORLD_MAP with:
- Status: deferred
- Dependency: real Stripe integration
- Scope: no-show + post-event ops + dispute paths + post-Stripe refund flows

---

## 13 — Implementor dispatch readiness

Spec is implementor-ready when orchestrator REVIEW returns APPROVED.

Implementor pre-flight reading list (in dispatch prompt):
1. This v2 spec (canonical)
2. Investigation report (canonical)
3. Narrow Cycle 9b-2 implementation report (to understand subtraction target)
4. The 6 step body files (Step 1, 2, 3, 4, 5, 6)
5. EventCreatorWizard.tsx (keyboard + scroll patterns to mirror)
6. CartContext.tsx (cart line snapshot fields)
7. liveEventStore.ts (current shape + I-16 guard)
8. clearAllStores.ts (where to wire new reset)
9. recurrenceRule.ts (expandRecurrenceToDates signature)
10. ConfirmDialog primitive (or Sheet primitive for reject dialog composition)

Pre-implementation checklist:
- [ ] Read all 10 files
- [ ] Run `/ui-ux-pro-max` for ChangeSummaryModal v2 (reason input + counter + footer note) AND sectioned EditPublishedScreen layout
- [ ] Confirm subtract list (delete liveEventToEditPatch.ts; replace EditPublishedScreen content; remove updateLiveEventEditableFields)
- [ ] Begin implementation in order: subtract → schema/types/stores/utils → step5 mod → component build → notification service → verification

---

## 14 — Open questions for operator (resolved unless deviation flagged)

v1's Q-704-1..6 RESOLVED by operator's 2026-05-02 answers (notification stack everywhere, whenMode unlocked, refund-first for destructive, reason on every change).

v2's two follow-ups:
- **v2-A**: SMS for additive-only? Recommendation: NO (banner + email only). Spec assumes accepted unless operator flags deviation.
- **v2-B**: Reason length 10..200? Recommendation: YES. Spec assumes accepted unless operator flags deviation.

If operator wants to flip either, orchestrator updates spec section before implementor dispatch.

---

## 15 — Cross-references

- v1 spec (now obsolete): [SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md](SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md)
- Investigation (canonical): [INVESTIGATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md](../reports/INVESTIGATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md)
- v1 dispatch: [FORENSICS_SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md](../prompts/FORENSICS_SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md)
- v2 dispatch: [SPEC_v2_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md](../prompts/SPEC_v2_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md)
- Forward dependency: Cycle 9c (renders banner from useEventEditLogStore + builds Orders refund flow + replaces stub helper)
- Forward dependency: ORCH-0705 (no-show + post-event ops; deferred until post-Stripe)
- B-cycle dependency: real Resend (email) + real Twilio (SMS)
- Consumer-app dependency: push notifications (deferred)
