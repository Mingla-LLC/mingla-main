# SPEC — ORCH-0893 [Client-id + lazy autosave for creator entries (event + trip wizards)]

**Skill:** Claude `mingla-forensics` — SPEC mode (follows INVESTIGATE in the same dispatch).
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Authored:** 2026-05-19.
**Predecessor:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0893_EAGER_SERVER_DRAFT_ON_CREATOR_ENTRY.md` (read before implementing).
**Scope owner:** implementor (`mingla-implementor` default; `implementor-mingla` alternate per orchestrator routing).
**Out of scope for this SPEC:** changes to `EventCreatorWizard` step internals, schema/RLS changes, marketing tab, `app-mobile/`, `mingla-admin/`, the ghost-draft cleanup migration (see §11 follow-up), any other `app/*/create.tsx` route beyond `event/create` and `trip/create` (sweep §A.7 in the investigation confirms only these two are affected).

---

## §0 — Phase 0 mandatory ingestion

Same as the investigation. Re-cite each in the implementation report:
- `feedback_zustand_persist_no_server_snapshots.md` (I-PROPOSED-J — TRANSITIONAL exemption for draftEventStore preserved)
- `feedback_strict_grep_registry_pattern.md` (one script + one workflow job)
- `feedback_supabase_mcp_workaround.md` + `reference_supabase_management_api.md` (DB access posture)
- `feedback_verify_db_column_names_before_writing_queries.md` (column-name fidelity)
- `feedback_mingla_business_desktop_web_contracts.md` (16 contracts unchanged — fix is route-entry only)
- `feedback_response_shape_conditional.md` (response shape for the implementor report)
- `feedback_implementor_uses_ui_ux_pro_max.md` (mandatory pre-flight `/ui-ux-pro-max` for wizard-mount transition feel — even though the visible change is "spinner page goes away," that IS a UX change that benefits from a design pre-flight to specify mount animation, focus management, and skeleton fallback if any)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` — I-11 (format-agnostic ID resolver), I-12 (host-bg cascade), I-PROPOSED-J (preserved)

---

## §1 — Scope, non-goals, and assumptions

### §1.1 — Scope (exactly)

1. **Route entry change** — `mingla-business/app/event/create.tsx` and `mingla-business/app/trip/create.tsx` mount the wizard without an entry-blocking server mutation. They mint a client-side `d_<ts36>` draft id synchronously and `router.replace` directly to the edit route.
2. **First-edit lazy server-insert** — `mingla-business/app/event/[id]/edit.tsx:144-169` migration useEffect is rewritten so the server-side `events` insert fires only after the first user-meaningful edit, not on mount. Mirror change on the trip side at `mingla-business/app/trip/[id]/edit.tsx` (verify implementation matches the event side; equivalent rewrite if it does).
3. **Transparent id swap** — the wizard does not unmount or lose typed state when the client `d_*` id is replaced by the server-issued id.
4. **New invariant + CI gate** — `I-PROPOSED-CREATOR-ENTRY-IS-INSTANT` codified in `INVARIANT_REGISTRY.md`; strict-grep gate `i-proposed-creator-entry-is-instant.mjs` added to `.github/scripts/strict-grep/` + one job in `.github/workflows/strict-grep-mingla-business.yml`.
5. **Step-0.5 regression tests** — two tests at two different angles per the close-gate (§9).

### §1.2 — Non-goals (explicit)

- NO change to `EventCreatorWizard.tsx` step internals (validation rules, step ordering, ticket types, etc.).
- NO change to `TripCreatorWizard.tsx` step internals.
- NO schema changes. NO RLS changes. NO new database constraints.
- NO change to `events`, `ticket_types`, or `trip_pricing_tiers` columns.
- NO ghost-draft cleanup migration in this ORCH — a follow-up ORCH (DISC-0893-C in the investigation) handles historical accumulation.
- NO change to marketing tab, brand profile, admin, or consumer `app-mobile/`.
- NO change to `/venue/create` — already follows the lazy pattern (investigation §3.4).
- NO refactor of `eventDrafts.ts` beyond the changes required for the lazy trigger.
- NO change to `assertBrandCanAuthorOfferings` — still runs at insert time, just deferred to first-edit instead of route entry.
- NO pre-warm of brand currency / authoring gate at home-screen mount (rejected — adds home-screen complexity for sub-second savings on a per-tap basis; the lazy-insert is already fast because it only runs when the user has typed something, by which time the home query cache is warm).

### §1.3 — Assumptions

- The `useDraftEventStore.createDraft(brandId)` synchronous action at `mingla-business/src/store/draftEventStore.ts:775-779` works as documented — it mints `d_<ts36>` via `generateDraftId()`, builds the default draft via `buildDraftEvent`, persists via Zustand. Verified in the investigation (§3.5).
- I-11 format-agnostic ID resolver remains active — `/event/d_<ts36>/edit` resolves to the Zustand-persisted draft via `useDraftById`. Verified in the investigation (§3.5, citing INVARIANT_REGISTRY.md line 1369).
- The wizard's `useDraftEventStore` hydration (EventCreatorWizard.tsx:208-210) reads the live draft from the store on every render — no network call needed for client-only drafts. Verified in the investigation (§ ingest).
- The TRANSITIONAL exemption for `draftEventStore` holding full draft records (per I-PROPOSED-J memory) remains in force; this SPEC does not widen it.

---

## §2 — Open SPEC questions (operator to resolve OR implementor takes the recommended path)

### Q-01 — Trip side: introduce `draftTripStore.ts` or use route-only client state?

**Context:** the investigation (§3.5) confirmed `draftEventStore.ts` already has a synchronous `createDraft(brandId)` primitive. The trip side has NO equivalent `draftTripStore.ts` — `mingla-business/src/store/` contains `draftEventStore.ts` and `draftVenueStore.ts` but no trip draft store. The trip wizard reads from the server via `useTripById` (or similar — verify in implementation).

**Option (a) — Introduce `draftTripStore.ts`.** Mirror `draftEventStore` for trips. Substantial new code (~300-500 lines of store + persist + migration scaffolding) but maximises parity with the event side and preserves the trip wizard's ability to resume an in-progress un-saved draft after a cold-start. New TRANSITIONAL exemption to register against I-PROPOSED-J.

**Option (b) — Route-only client state with `d_*` id (RECOMMENDED).** Generate `d_<ts36>` synchronously in `/trip/create`, `router.replace` to `/trip/d_<ts36>/edit`, have the trip edit route detect the `d_*` prefix and mount the wizard with empty defaults (no store hydration; the wizard's React state IS the draft until the first lazy insert lands). Cold-start before-first-edit-completes = no resume, but the user hasn't typed anything anyway. Far less code, no new persisted store. Aligned with how `venue/create.tsx` operates pre-store.

**Recommended:** Option (b). Trade-off: a user who taps "Create trip", starts typing, force-kills the app before the 800ms debounce fires the lazy insert, and reopens later WILL lose those typed-but-not-saved keystrokes. This is an acceptable failure mode (matches buyer composer behaviour today and is bounded by the debounce window). If operator prefers the parity-with-events posture, switch to Option (a) — implementor effort grows ~2-3x.

**Implementor must pick Option (b) unless operator explicitly authorizes Option (a) before implementation starts.**

### Q-02 — Auth-readiness gate position

**Context:** today's `/event/create.tsx:54-58` gates the createDraft on `isAuthReady && !currentBrandRecovery.isResolving && currentBrandId !== null`. The lazy pattern still needs auth-readiness before mounting the wizard, because the brand-authoring gate and `auth.getUser()` will eventually fire on the first lazy insert.

**Resolution:** keep the auth-readiness wait at the route entry (1-tick spinner while auth is hydrating). Once auth is ready and `currentBrandId !== null`, mint the client draft synchronously and `router.replace`. The spinner reduces from "blocking on a 4-call chain" to "blocking on auth bootstrap only" — a fix orthogonal to ORCH-0887-A (which already shortens that bootstrap to a 3s max).

### Q-03 — Migration-trigger condition wording

**Context:** SPEC §8 §8.3 needs a precise definition of "first user-meaningful edit." The investigation noted candidates: `name.length > 0`, `lastStepReached > 0`, `tickets.length > 0`, `coverMediaUrl !== null`, any field deviating from `DEFAULT_DRAFT_FIELDS`.

**Resolution:** define `isDraftDirty(draft: DraftEvent): boolean` returning `true` when ANY of:
- `draft.name.trim().length > 0`
- `draft.description.trim().length > 0`
- `draft.coverMediaUrl !== null`
- `draft.tickets.length > 0`
- `draft.date !== null` OR `draft.startsAt !== null`
- `draft.locationText.length > 0` OR `draft.onlineUrl !== null`
- `draft.lastStepReached > 0`
- `draft.party_types.length > 0` OR `draft.vibe_tags.length > 0` OR `draft.music_genres.length > 0`

A pure default draft from `buildDraftEvent(brandId)` MUST return `false`. Implementor unit-tests `isDraftDirty(buildDraftEvent('test_brand'))` returns `false` and that flipping any single field flips the result to `true`.

(For trips, the equivalent helper checks against the trip's empty default state.)

### Q-04 — Lazy-insert trigger plumbing

**Context:** the existing autosave hook `useServerDraftAutosave` (`mingla-business/src/hooks/useServerDraftEvents.ts:181-273`) calls `autosaveServerDraft(draft)` which is an UPDATE path. For a `d_*` draft, it would 404 because the server row doesn't exist.

**Resolution:** the wizard's autosave callback (`onAutosaveDraft` prop, EventCreatorWizard.tsx:173-180) currently flows through `useServerDraftAutosave.saveDraft(draft)`. SPEC change: the route handler (`event/[id]/edit.tsx`) — which owns the autosave wiring — checks `draft.id.startsWith("d_") && isDraftDirty(draft)` before each save call. If the predicate is true AND no migration is in flight: call `createServerDraft(draft.brandId, draft)` instead of `autosaveServerDraft`, then `replaceDraft(d_id, serverDraft)` + `router.replace` to the server-id URL. If migration is in flight: queue the save (skip this tick; the next debounced save lands on the server id). If predicate is false: skip — no save at all (avoids ghost drafts).

This is the SAME mechanism the existing migration useEffect at edit.tsx:144-169 uses; the SPEC just moves the trigger from "mount" to "first dirty save."

---

## §3 — Database layer

**No changes.** Schema, RLS, constraints, indexes, RPCs — all unchanged. The lazy insert uses the existing `events` insert path (`createServerDraft`) with the same payload shape, same RLS policy traversal, same `event_type='event'` filter (per ORCH-0859 REWORK 3). Mirror on the trip side.

Verification at implementation time: read the latest migration that touches `events.event_type` and `ticket_types` to confirm no new columns or constraints landed since 2026-05-19. Cite the migration filename in the implementation report.

---

## §4 — Edge function layer

**No changes.** No edge function involved in the creator entry path.

---

## §5 — Service layer

### §5.1 — `mingla-business/src/services/eventDrafts.ts`

**`createServerDraft(brandId, sourceDraft?)`** — unchanged signature and body. Already accepts a `sourceDraft` with a `d_*` id and stores `legacyLocalDraftId` in `theme.business_draft.legacyLocalDraftId` via `draftToServerInsert` (line 187-193). Verified in investigation §3.5. NO modification needed.

**`autosaveServerDraft(draft)`** — unchanged. Still owns the UPDATE path for already-server-backed drafts.

**`isDraftDirty(draft: DraftEvent): boolean`** — NEW helper. Add to `mingla-business/src/services/eventDrafts.ts` (or a sibling `mingla-business/src/utils/draftDirtyCheck.ts` if the implementor prefers — both are acceptable). Definition per Q-03 above. Pure function, no network. Required exports: `isDraftDirty`. Required unit tests: see §10.

### §5.2 — `mingla-business/src/services/tripsService.ts`

**`createTripDraft(input, role)`** — minor change to accept an optional `clientDraftId?: string` parameter. When provided, store it in the equivalent of `theme.business_draft.legacyLocalDraftId` on the new `events` row (mirror the event mapper pattern). This enables the trip side to dedupe the eventual server-issued id against the client-side `d_*` id. The body otherwise unchanged — still inserts events + ticket_types + trip_pricing_tiers, still resolves brand currency.

**`isTripDraftDirty(trip: TripDraftState): boolean`** — NEW helper. Mirror `isDraftDirty` for the trip's local state shape (whatever the route-only client state for trips ends up being — Q-01 Option (b) means it's the wizard's React state).

### §5.3 — `mingla-business/src/utils/serverDraftEventMapper.ts`

**No changes.** Already accepts `legacyLocalDraftId` parameter (line 353); `mergeBusinessDraftTheme` already stores it (line 380). Verified in investigation §3.5.

---

## §6 — Hook layer

### §6.1 — `mingla-business/src/hooks/useServerDraftEvents.ts`

**`useCreateServerDraft`** — unchanged surface. Still exported for use by the lazy-insert trigger and the existing drafts-list legacy migration loop. The route handler stops calling it on mount but still calls it on first dirty save.

**`useServerDraftAutosave`** — minor enhancement: accept an optional `onMigrated?: (clientId: string, serverDraft: DraftEvent) => void` callback. When the wizard saves a `d_*` draft for the first time, the hook fires `onMigrated` so the route can `router.replace` to the new URL without losing the wizard's state. Implementation detail: distinguish "this is a `d_*` save → call createServerDraft" from "this is a server-backed save → call autosaveServerDraft" inside the mutationFn based on `draft.id.startsWith("d_")`.

Alternative (acceptable, implementor's choice): keep `useServerDraftAutosave` exactly as-is and have the route handler do the dispatch — wrap `useServerDraftAutosave.saveDraft` with a route-local function that checks `draft.id.startsWith("d_") && isDraftDirty(draft)` and routes to `createServerDraft` instead of the autosave path. Same behaviour, cleaner separation of concerns.

**Recommended:** the route-local-wrapper approach. Less hook-API churn.

### §6.2 — `mingla-business/src/hooks/useTrips.ts`

**`useCreateTripDraft`** — accept optional `clientDraftId` and forward to `createTripDraft` (per §5.2). Otherwise unchanged.

---

## §7 — Store layer

### §7.1 — `mingla-business/src/store/draftEventStore.ts`

**`createDraft(brandId): DraftEvent`** at line 775-779 — unchanged. Already returns a fresh `d_*` draft and persists.

Add `replaceDraft` confirmation test (already exists at line 124 in `useServerDraftEvents.ts`'s migration loop; the SPEC doesn't change the action, just relies on it).

Add a comment at the `createDraft` action documenting "Per ORCH-0893: this action is the entry primitive for `/event/create`. Do not refactor without invalidating the I-PROPOSED-CREATOR-ENTRY-IS-INSTANT invariant."

### §7.2 — Trip side (per Q-01 Option (b) recommendation)

**No new store.** The trip wizard's `d_*` draft lives in route-local React state until the first lazy insert lands.

If the operator selects Q-01 Option (a) instead, introduce `mingla-business/src/store/draftTripStore.ts` mirroring `draftEventStore` end-to-end with a fresh persist key (`mingla-business.draftTrip.v1`), version-1 migrations only, and the same TRANSITIONAL exemption posture. Substantial new code; defer scoping to a re-spec.

---

## §8 — Route + component layer (the actual fix)

### §8.1 — `mingla-business/app/event/create.tsx` — rewrite

**Replace the entire useEffect-with-createDraft chain (lines 39-103) with this pattern:**

```typescript
export default function EventCreateRoute(): React.ReactElement {
  const router = useRouter();
  const currentBrandId = useCurrentBrandId();
  const { isAuthReady } = useAuth();
  const currentBrandRecovery = useCurrentBrandRecovery();
  // ORCH-0893: createDraft is the SYNCHRONOUS Zustand action, not the mutation.
  const createClientDraft = useDraftEventStore((s) => s.createDraft);
  const startedRef = useRef<boolean>(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (!isAuthReady || currentBrandRecovery.isResolving) return;
    if (currentBrandId === null) {
      router.replace("/(tabs)/home" as never);
      return;
    }
    startedRef.current = true;
    // ORCH-0893: synchronous client-side draft id; no server round-trip.
    // I-PROPOSED-CREATOR-ENTRY-IS-INSTANT.
    const draft = createClientDraft(currentBrandId);
    router.replace(`/event/${draft.id}/edit?step=0` as never);
  }, [currentBrandId, currentBrandRecovery.isResolving, isAuthReady, router, createClientDraft]);

  return (
    <View style={[styles.host, { paddingTop: insets.top, backgroundColor: canvas.discover }]}>
      <View style={styles.center}>
        <Spinner size={36} />
        <Text style={styles.label}>
          {!isAuthReady || currentBrandRecovery.isResolving
            ? "Finishing sign-in…"
            : "Loading…"}
        </Text>
      </View>
    </View>
  );
}
```

Notes:
- The placeholder host page exists ONLY for the auth-readiness wait window. In a fully-warm session, `useEffect` fires synchronously after mount, `router.replace` runs in the same tick, and the user never sees the placeholder past the first paint.
- The label "Starting a new event…" is REMOVED — the route no longer talks to the server. If auth is hydrating, the label "Finishing sign-in…" remains. Otherwise the brief placeholder shows "Loading…" (or nothing — implementor decides; recommended: no label at all on the auth-ready branch since it's a single-frame flash).
- The `error` state branch and "Couldn't start this draft. Retrying…" label are REMOVED. Error surfaces now belong to the wizard itself when the lazy insert fails (§8.4).
- `useCreateServerDraft` import is REMOVED from this file.

### §8.2 — `mingla-business/app/trip/create.tsx` — rewrite

Mirror §8.1. Per Q-01 Option (b):

```typescript
import { generateDraftId } from "../../src/utils/draftEventId";

export default function TripCreateRoute(): React.ReactElement {
  const router = useRouter();
  const currentBrand = useCurrentBrand();
  const startedRef = useRef<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    if (currentBrand === null) return;
    if (currentBrand.kind !== "trip_planner") {
      startedRef.current = true;
      setErrorMessage("Trip planning is for trip-planner brands. Switch to a trip-planner brand or create one in the brand switcher.");
      return;
    }
    startedRef.current = true;
    // ORCH-0893: synchronous client-side draft id; no server round-trip.
    // I-PROPOSED-CREATOR-ENTRY-IS-INSTANT.
    const clientId = generateDraftId();
    router.replace(`/trip/${clientId}/edit` as never);
  }, [currentBrand, router]);

  // … unchanged loading/error JSX …
}
```

`useCreateTripDraft` import is REMOVED from this file. The mutation hook still exists in `useTrips.ts` and is called from the trip edit route's lazy-insert trigger.

### §8.3 — `mingla-business/app/event/[id]/edit.tsx` — rewrite the migration useEffect

**Replace lines 144-169 (the eager-on-mount migration) with a first-edit-triggered migration.** The new shape:

1. On mount, if `draft !== null && draft.id.startsWith("d_")`, mark the wizard as "client-only state" — do NOT call `createServerDraft` yet.
2. Wire the wizard's `onAutosaveDraft` callback through a route-local helper:
   - If `draft.id` starts with `d_` AND `isDraftDirty(draft)`: call `createServerDraft(draft.brandId, draft)`, then `replaceDraft(d_id, serverDraft)`, then `router.replace` to `/event/{serverDraft.id}/edit?step={currentStep}` — without unmounting the wizard.
   - If `draft.id` starts with `d_` AND `!isDraftDirty(draft)`: skip the save entirely (no ghost row).
   - If `draft.id` does NOT start with `d_`: existing autosave path (`useServerDraftAutosave.saveDraft`) — unchanged behaviour.

3. Idempotency: a single `migratingLegacyIdRef` ref (already present at line 125) gates the migration call to prevent double-inserts in race conditions (e.g., user types two characters within the same 800ms debounce window — the autosave hook handles the second character as a separate tick, but the ref ensures only one createServerDraft is in flight).

**`router.replace` during typing:** Expo Router's `router.replace` preserves the wizard component tree as long as the route file path is unchanged — `/event/[id]/edit` is the same regardless of which id segment lands. The wizard's internal React state (`currentStep`, `showStepErrors`, `discardDialogVisible`, etc.) persists across the URL change because React reconciles on the same component tree. Verify this empirically in the implementation: type a character, watch the URL flip from `d_*` to the server id, confirm the focus is preserved on the same input. If focus is lost, the implementor wraps the input in a focus-restoration `useEffect`.

### §8.4 — Error surface (Constitution #3 compliance)

When the lazy insert fails (auth lapse, RLS reject, brand-authoring gate denied):
- DO NOT unmount the wizard. DO NOT clear typed input.
- Display an inline error banner in the wizard chrome (top of the wizard, below the step indicator). Copy: "Couldn't save this draft. Tap Save again or check your connection."
- Add a Save retry CTA that re-fires the lazy-insert.
- On the next user edit (which retriggers debounced save), if the migration succeeds, the banner clears.
- If `BusinessAuthNotReadyError`, the banner copy adapts: "Finishing sign-in. We'll save automatically." (Per existing pattern at `useCreateServerDraft` lines 293-302.)

### §8.5 — Mirror on the trip edit route

`mingla-business/app/trip/[id]/edit.tsx` — apply the same first-edit-triggered lazy-insert wiring. The trip flow's three inserts (events + ticket_types + trip_pricing_tiers) all fire as a unit on the first dirty save. If any one fails, all three roll back (verify that `createTripDraft` is transactional today — read tripsService.ts:399-510 in full during implementation; if it is NOT transactional, that's a P1 bug pre-existing this ORCH and out of scope, but flag it as a follow-up discovery).

### §8.6 — Trip placeholder rows (sub-decision)

The trip flow creates placeholder ticket_types + trip_pricing_tiers rows at lazy-insert time. SPEC keeps this behaviour intact: the trip wizard expects them present by Step 4/5 (per the existing implementation comment at tripsService.ts:393-397). Splitting the placeholder insert from the events insert (so each is created at its own Step) would change Step 4/5 logic — OUT OF SCOPE for this ORCH. Operator may queue a follow-up if the trio-insert latency on first edit is unacceptable in practice.

---

## §9 — Cross-surface impact (HARD gate per SPEC §2.5)

| Surface | Touched? | User-visible behaviour the SPEC demands | File paths the SPEC touches | Parity posture |
|---|---|---|---|---|
| **business-web-preview** | YES | Tap "Create event" / "Create trip" → wizard's Step 1 visible and interactive within 200ms (Performance API mark before `router.push`, mark after wizard's first paint). No spinner page. Back-without-typing leaves ZERO `events` rows. | `app/event/create.tsx`, `app/trip/create.tsx`, `app/event/[id]/edit.tsx`, `app/trip/[id]/edit.tsx`, `src/services/eventDrafts.ts` (helper add), `src/services/tripsService.ts` (clientDraftId param), `src/hooks/useTrips.ts` (clientDraftId param) | Automatic — shared code |
| **business-iOS** | YES | Same code path. Native push animation completes onto an interactive wizard rather than onto a spinner. No app-mobile changes. | Same | Automatic — shared code |
| **business-Android** | YES | Same as iOS. | Same | Automatic — shared code |
| **consumer-iOS** | NO | No creator routes in `app-mobile/`. | None | N/A |
| **consumer-Android** | NO | Same reason. | None | N/A |
| **buyer-anon-web** | NO | `/checkout`, `/e`, `/b` are conversion routes only; no creator entries. | None | N/A |
| **admin-web** | NO | `mingla-admin/` is read/moderate; no creator surfaces. | None | N/A |

**Per-surface success criteria** are listed in §10 (SC-1-web, SC-1-iOS, SC-1-Android format) so the tester has unambiguous per-platform gates.

---

## §10 — Success criteria (numbered, measurable)

**SC-1-web — Instant wizard mount on business-web preview.**
On a warm session (auth ready, brand resolved), tap "Create event" CTA on `/(tabs)/home`. Within 200ms (Performance API: `performance.mark('orch-0893-cta-tap')` immediately before the `router.push`, `performance.mark('orch-0893-wizard-mounted')` inside `EventCreatorWizard` useEffect at first non-empty render, `performance.measure('orch-0893-mount-latency', 'orch-0893-cta-tap', 'orch-0893-wizard-mounted')`), the wizard's Step 1 title input is rendered and focusable. No network request to Supabase fires in this window (verify via Chrome DevTools Network filter on `gqnoajqerqhnvulmnyvv.supabase.co`).

**SC-1-iOS — Wizard interactive on landing on business-iOS Simulator.**
Tap "Create event" CTA. The native slide animation completes onto a fully interactive wizard (Step 1 title input visible and tappable as soon as the slide finishes). No Network log entries to Supabase fire during the entry stack.

**SC-1-Android — Mirror SC-1-iOS on Android emulator.**

**SC-2 — Trip parity.**
Same as SC-1 family but for the "Create trip" CTA on `/(tabs)/home`. Wizard mounts instantly on web, slide-and-land on mobile, no Supabase network during entry stack.

**SC-3-web — Cold-create-then-back leaves zero rows.**
On business-web preview, with a clean auth session, tap "Create event" → wizard mounts → tap the chrome X / browser back BEFORE typing anything. Then re-open `/(tabs)/hub/events`. The drafts list MUST be unchanged (no new row). Mirror for trip.

**SC-4 — First-edit triggers exactly one insert.**
Tap "Create event" → wizard mounts → type one character into the Title input → wait 1s (past the 800ms debounce). Network shows exactly ONE `events` insert call. URL flips from `/event/d_<ts36>/edit` to `/event/<server-uuid>/edit`. The wizard's title input retains the typed character and keeps focus.

**SC-5 — Subsequent edits are UPDATE, not duplicate INSERT.**
After SC-4 lands, type a second character. Network shows ONE `events` UPDATE call (the autosave path). No second INSERT. No duplicate row in the drafts table.

**SC-6 — Race condition: rapid typing during in-flight insert coalesces correctly.**
Tap "Create event" → wizard mounts → type 5 characters within 200ms (fast typist). The debounce coalesces into one save. After 800ms, exactly ONE INSERT fires. Subsequent edits are UPDATEs. No duplicate `events` row. Verifiable via a tester adversarial test with a Supabase client mock recorder.

**SC-7 — Auth-lapse error surface.**
Force the lazy insert to fail (operator stubs `requireUserId` to throw `BusinessAuthNotReadyError`). Wizard displays the "Finishing sign-in. We'll save automatically." banner. Typed input is preserved. On retry, when auth lands, the save succeeds and the banner clears.

**SC-8 — RLS-rejection error surface.**
Force the lazy insert to fail with an RLS error (e.g., simulate a brand-authoring gate denial). Wizard displays the "Couldn't save this draft. Tap Save again or check your connection." banner with a retry CTA. Typed input is preserved.

**SC-9 — Strict-grep CI gate green.**
`node .github/scripts/strict-grep/i-proposed-creator-entry-is-instant.mjs` exits 0 against the repo on `Seth`. The gate FAILS on revert of `app/event/create.tsx` or `app/trip/create.tsx` to the pre-ORCH-0893 eager-mutation shape.

**SC-10 — All existing jest + tsc + lint green.**
`cd mingla-business && npx tsc --noEmit && npm test -- --runInBand` exit 0. No regression to existing tests. Two new tests added per §11 below.

**SC-11 — I-11 format-agnostic ID resolver preserved.**
The strict-grep gate already enforces I-11 indirectly (no normalization on `idParam`). Implementor confirms no normalization is added to the rewritten routes. Verified by reading the rewritten files.

**SC-12 — `/venue/create` unchanged.**
`git diff Seth -- app/venue/create.tsx` is empty. The fix does NOT touch venue.

---

## §11 — Test cases (Step-0.5 regression-test gate satisfaction)

### §11.1 — Implementor happy-path regression test

**Path:** `mingla-business/src/components/event/__tests__/eventCreateRouteInstantMount.test.tsx` (or sibling — implementor's choice if the path more naturally fits a different folder, but the test MUST be under `mingla-business/**/__tests__/**` per the Step-0.5 gate's allowed-path list).

**What it tests:** mount the `/event/create` route, assert the wizard's Step 1 renders synchronously without any network mutation on mount.

**Shape:**
```typescript
import { render } from "@testing-library/react-native";
import { useDraftEventStore } from "@/store/draftEventStore";
// Mock the Supabase client to a call-counting recorder.
const supabaseCallCount = jest.fn();
jest.mock("@/services/supabase", () => ({
  supabase: { from: () => { supabaseCallCount("from"); return /* chainable mock */; } },
}));

it("ORCH-0893 SC-1: /event/create mounts the wizard without entry-blocking network mutation", async () => {
  // Arrange: auth ready, brand selected.
  setupAuthMock({ isAuthReady: true });
  useCurrentBrandIdStore.setState({ currentBrandId: "b_test123" });

  // Act: render the route component.
  const { findByText } = render(<EventCreateRoute />);

  // Assert: the placeholder spinner is brief (one frame). Then the wizard mounts.
  // The Zustand store has exactly one `d_*` draft for the test brand.
  // No supabase.from() call fired during this render pass.
  await waitFor(() => {
    const drafts = useDraftEventStore.getState().drafts.filter(d => d.brandId === "b_test123");
    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toMatch(/^d_/);
  });
  expect(supabaseCallCount).not.toHaveBeenCalled();
});
```

**Fails-on-revert:** when the implementor reverts to the eager-mutation shape, the test fails because `supabase.from()` IS called during mount.

**Mirror test for trip:** `mingla-business/src/components/trip/__tests__/tripCreateRouteInstantMount.test.tsx` — mounts `/trip/create`, asserts the route generates a `d_*` id and `router.replace`s without `from("events")` or `from("ticket_types")` or `from("trip_pricing_tiers")` firing.

### §11.2 — Tester adversarial regression test

**Path:** `mingla-business/src/components/event/__tests__/eventCreateRoute_noGhostDraft_adversarial.test.tsx`.

**Different angle:** the tester's test attacks the GHOST-DRAFT side effect, not the loader. It mounts the route, waits for the placeholder-then-wizard sequence to complete, then unmounts WITHOUT typing anything, then re-mounts and inspects the supabase mock for INSERT calls.

**Shape:**
```typescript
it("ORCH-0893 SC-3 adversarial: mount-and-unmount-before-typing leaves zero events.insert calls", async () => {
  // Arrange: auth ready, brand selected, supabase mock recording all from/insert calls.
  setupAuthMock({ isAuthReady: true });
  useCurrentBrandIdStore.setState({ currentBrandId: "b_test123" });
  const insertSpy = jest.fn();
  mockSupabase({ onInsert: insertSpy });

  // Act: mount the route, wait for wizard mount, unmount immediately.
  const { unmount } = render(<EventCreateRoute />);
  await waitFor(() => expect(screen.queryByTestId("event-wizard-step-1")).toBeTruthy());
  unmount();
  await new Promise(r => setTimeout(r, 1200)); // past 800ms debounce + buffer

  // Assert: no INSERT to events ever fired.
  expect(insertSpy).not.toHaveBeenCalled();
});
```

**Why this is a DIFFERENT angle than §11.1:** §11.1 asserts "no network on mount." §11.2 asserts "no network on the entire mount-unmount-no-typing lifecycle." The race surface is different — §11.1 catches a synchronous mount-time bug; §11.2 catches a deferred bug where the migration fires on a useEffect cleanup or unmount handler.

**Mirror adversarial test for trip:** `mingla-business/src/components/trip/__tests__/tripCreateRoute_noGhostDraft_adversarial.test.tsx`. Asserts ZERO inserts to ANY of the three trip tables (events, ticket_types, trip_pricing_tiers) on mount-and-unmount-before-typing.

### §11.3 — Fails-on-revert verification (mandatory per Step-0.5)

For BOTH tests, the implementor MUST run a fails-on-revert check: revert the fix (restore `app/event/create.tsx` to the eager-mutation version), re-run the tests, capture the FAIL output. Then restore the fix, re-run, capture PASS. Include the commit hash for both states in the implementation report.

---

## §12 — Invariant registration (NEW)

Add to `Mingla_Artifacts/INVARIANT_REGISTRY.md` as a DRAFT entry (flips to ACTIVE on CLOSE):

```markdown
### I-PROPOSED-CREATOR-ENTRY-IS-INSTANT

**Rule:** Every creator entry route in `mingla-business/app/` (file path matching `app/*/create.tsx`) MUST mount its creator UI without an entry-blocking server mutation. The route MAY mint a client-side draft id (e.g., `d_<ts36>` via `generateDraftId()` or equivalent) and `router.replace` to the resume route. Server-side draft rows MUST be created lazily on the first user-meaningful edit, NEVER on route mount.

**Why:** eager server-side draft creation on entry causes (a) a foreground network wait the user perceives as a "loader" on web, (b) ghost draft rows accumulating in the database when users back out without typing, (c) UX inconsistency with the marketing-composer + venue-create + template-new patterns that already follow the lazy posture.

**Established by:** ORCH-0893 close.

**Enforcement:** strict-grep CI gate `i-proposed-creator-entry-is-instant.mjs` over `mingla-business/app/**/create.tsx` files. Forbids the literals `useMutation`, `mutateAsync`, `useCreateServerDraft`, `useCreateTripDraft`, `createServerDraft`, `createTripDraft` inside these files. Allowlist comment grammar: `// orch-strict-grep-allow creator-entry-is-instant — <reason>` immediately preceding the violating line (per `feedback_strict_grep_registry_pattern.md`).

**Test:** SC-1 (instant mount) + SC-3 (no ghost draft on back-without-typing) verify the invariant end-to-end. Adversarial test in §11.2 catches deferred / cleanup-time violations.

**Status:** DRAFT — flips to ACTIVE on ORCH-0893 CLOSE.
```

---

## §13 — Strict-grep CI gate grammar

**File to create:** `.github/scripts/strict-grep/i-proposed-creator-entry-is-instant.mjs`

**Mirror the structure of:** `.github/scripts/strict-grep/i-proposed-tr2-events-type-filter.mjs` (read in full as the canonical template — same shape, same allowlist mechanism, same exit codes 0/1).

**Behaviour:**

1. Walk all files matching the glob `mingla-business/app/**/create.tsx` (currently 3 files: `event/create.tsx`, `trip/create.tsx`, `venue/create.tsx`).
2. For each file, scan for the forbidden tokens: `useMutation`, `mutateAsync`, `useCreateServerDraft`, `useCreateTripDraft`, `createServerDraft`, `createTripDraft`.
3. If a forbidden token appears, check the immediately previous non-blank line for the allowlist comment: `// orch-strict-grep-allow creator-entry-is-instant — <reason>`.
4. If no allowlist, output: `[ORCH-0893 violation] {file}:{line}: <token> is forbidden inside creator entry routes. Creator routes must mount without an entry-blocking server mutation. See I-PROPOSED-CREATOR-ENTRY-IS-INSTANT in Mingla_Artifacts/INVARIANT_REGISTRY.md. To allow: precede the line with '// orch-strict-grep-allow creator-entry-is-instant — <reason>'.`
5. Exit codes: 0 if clean, 1 if any violation.

**Workflow job:** add to `.github/workflows/strict-grep-mingla-business.yml` mirroring the existing `i-proposed-tr2-events-type-filter` job shape.

**Registry update:** add the gate to `.github/scripts/strict-grep/README.md` under "Active gates registered."

---

## §14 — Implementation order

1. Add helper `isDraftDirty(draft: DraftEvent): boolean` to `mingla-business/src/services/eventDrafts.ts` (or `mingla-business/src/utils/draftDirtyCheck.ts`). Unit-test it (4-6 cases: pure default returns false; each meaningful field flip returns true; empty whitespace title returns false).
2. Add trip equivalent `isTripDraftDirty` helper.
3. Rewrite `mingla-business/app/event/create.tsx` per §8.1. Run jest + tsc.
4. Rewrite `mingla-business/app/trip/create.tsx` per §8.2. Run jest + tsc.
5. Rewrite `mingla-business/app/event/[id]/edit.tsx` migration useEffect per §8.3. Run jest + tsc.
6. Mirror on `mingla-business/app/trip/[id]/edit.tsx` per §8.5.
7. Add the `clientDraftId` parameter to `createTripDraft` per §5.2 + `useCreateTripDraft` per §6.2.
8. Wire the in-wizard error banner per §8.4 (one new component or props addition to the wizard chrome).
9. Write the two implementor happy-path tests per §11.1. Verify PASS.
10. Write the two tester adversarial tests per §11.2. Verify PASS. Fails-on-revert check per §11.3.
11. Write the strict-grep gate script per §13. Add the workflow job. Verify the gate is GREEN on the new code and RED on a synthetic revert.
12. Register the new invariant in `INVARIANT_REGISTRY.md` per §12 (DRAFT status).
13. Run the full jest + tsc + lint suite. All green.
14. Write implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0893_CLIENT_ID_PLUS_LAZY_AUTOSAVE_FOR_CREATOR_ENTRIES.md` with old→new file receipts, fails-on-revert commit hashes, per-SC verification, and any DISCOVERIES surfaced during implementation.
15. Hand off to Claude `mingla-tester` for TARGETED test mode with iOS + Android + business-web preview parity (per `feedback_tester_canonical_and_platform_parity.md`).

---

## §15 — Hard guards for the implementor

- DO NOT touch `EventCreatorWizard.tsx` step internals.
- DO NOT touch `TripCreatorWizard.tsx` step internals.
- DO NOT touch `mingla-admin/`, `app-mobile/`, marketing tab, brand profile.
- DO NOT add schema changes, RLS changes, new RPCs.
- DO NOT add new persisted Zustand stores beyond the existing `draftEventStore` (Option (b) for trip per Q-01 — no new store).
- DO NOT call `supabase db push` — operator owns DB migrations (this ORCH has none anyway).
- DO NOT deploy any edge function — none touched.
- DO NOT broaden the strict-grep gate scope beyond `mingla-business/app/**/create.tsx`. Other entry surfaces are out of scope (sweep confirmed only `/event/create` and `/trip/create` are affected; `/venue/create` already complies and gets caught by the gate too — that's fine, it has no forbidden tokens to begin with).
- DO NOT add a ghost-draft cleanup migration — that's DISC-0893-C, a separate ORCH.
- DO honor the 16 desktop-web contracts (`feedback_mingla_business_desktop_web_contracts.md`) — fix is route-entry only, no wizard layout change, so this should be automatic.
- DO invoke `/ui-ux-pro-max` as a pre-flight per `feedback_implementor_uses_ui_ux_pro_max.md` — even though the visible change is "spinner page goes away", the wizard's MOUNT transition feel changes (no animation in between; the wizard lands directly). The designer pass should confirm focus management (Step 1 title input auto-focuses or not — recommended NOT, to avoid keyboard popping up unbidden on mobile; let the user tap to focus).

---

## §16 — Layman summary of the report

- Two routes (`/event/create` and `/trip/create`) are the source of the loader the operator reported. Both run a chain of 4-6 sequential server calls before showing the wizard, and both leave a real database row behind even when the user backs out without typing.
- The fix re-wires both routes to mint a temporary client-side id (the existing `d_<ts36>` format) and open the wizard immediately. The real database row is created only when the user starts typing.
- All the plumbing for this pattern already exists in the codebase — the marketing composer, the venue-create flow, and template-new all follow it. The `event` Zustand store already has a synchronous `createDraft(brandId)` action that produces the client id. The edit route already knows how to migrate a `d_*` draft to a server draft. The only changes needed are: (a) call the Zustand action instead of the network mutation on entry, (b) delay the migration trigger from "edit route mounts" to "user makes the first meaningful edit," and (c) preserve the wizard's state during the URL swap.
- The trip side gets a slightly different shape: instead of introducing a new trip Zustand store, the trip wizard holds its early state in route-local React state until the first user edit lands. This trades parity with the event side for ~300 fewer lines of new code. Operator can override this choice (Q-01 Option (a)) if exact parity matters more than the line count.
- New invariant `I-PROPOSED-CREATOR-ENTRY-IS-INSTANT` codifies the rule so the next person writing a creator route can't accidentally regress. A new CI gate at `.github/scripts/strict-grep/` fails any PR that re-introduces eager mutation in `app/*/create.tsx`.
- Two regression tests live in the repo: one happy-path (wizard mounts with zero network traffic) and one adversarial (mount-and-unmount-before-typing leaves zero database rows). Both run independent fails-on-revert checks so the close gate is satisfied.
- 12 measurable success criteria cover web, iOS, Android, the error surfaces, the race-coalescing case, and the strict-grep gate.
- No schema changes, no migration, no edge function deploys. The change is OTA-eligible. The ghost-draft rows that ALREADY accumulated in production are a separate, follow-up cleanup ORCH (the implementor should not touch them in this ORCH).

---

**Spec closes. Implementor pickup at the next dispatch.**
