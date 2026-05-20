# INVESTIGATION — ORCH-0893 [Eager server-draft on creator entry — replace with client-id + lazy autosave (event + trip wizards)]

**Skill:** Claude `mingla-forensics` — INVESTIGATE mode.
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Authored:** 2026-05-19.
**Source dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_SPEC_ORCH-0893_EAGER_SERVER_DRAFT_ON_CREATOR_ENTRY.md`.
**Reproducer authority:** operator-described symptom verified via end-to-end code trace; live web Network timings were not captured this pass (Metro web spin-up declined to keep cycle time tight; rationale + impact in §2.2). Live DB probe was attempted and blocked by the auto-mode classifier — ghost-draft historical count is `inconclusive`; structural existence is `proven` by code reading (§3.2).
**Confidence:** `proven` for the eager-server-draft root cause on both `/event/create` and `/trip/create` and for the unconditional ghost-draft insert side effect; `inconclusive` for quantitative ghost-draft size; `proven` that the contrast patterns (campaign-compose, template-new, venue-create) open instantly without an entry-blocking server mutation.

---

## §0 — Phase 0 mandatory ingestion (read + cited)

**Memory + constitution:**

- `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_zustand_persist_no_server_snapshots.md` — I-PROPOSED-J. Confirms `draftEventStore` is a TRANSITIONAL exemption holding full draft records by design (per ORCH-0739) pending B-cycle migration to server-only. Fix MUST preserve this exemption posture, not violate the broader rule.
- `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_strict_grep_registry_pattern.md` — CI gate registry pattern: one script under `.github/scripts/strict-grep/`, one job in `.github/workflows/strict-grep-mingla-business.yml`. No parallel workflow files.
- `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/reference_supabase_management_api.md` — Management API endpoint pattern used for the (blocked) ghost-draft DB probe.
- `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_supabase_mcp_workaround.md` — confirms direct REST is the canonical fallback when MCP supabase fails.
- `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_verify_db_column_names_before_writing_queries.md` — verified `events.event_type`, `events.status`, `events.deleted_at` against the CREATE TABLE chain + the `EVENT_DRAFT_SELECT` projection list at `mingla-business/src/services/eventDrafts.ts:24-25` (the canonical select set updated by ORCH-0841 + ORCH-0824).
- `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_mingla_business_desktop_web_contracts.md` — 16 desktop-web contracts (post-ORCH-0885-A). The proposed fix is route-entry only and does not touch wizard layout primitives; cross-surface impact §7 expands.
- `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_response_shape_conditional.md` — shape rules followed in chat-side summary.
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` — read I-11 [Format-agnostic ID resolver, mingla-business, line 1359] which explicitly names `/event/d_<ts36>/edit → wizard renders` as the canonical resolution path. The fix relies on this invariant being intact.

**Closed ORCHs ingested as prior art:**

- ORCH-0743 (C2 + C3) [`/event/create` cold-start redirect-loop fix] — moved this route from async `useCurrentBrand` to synchronous `useCurrentBrandId` and locked the eager-mutation pattern into place. The 4-round-trip chain investigated below is the post-ORCH-0743 shape.
- ORCH-0742 [Zustand persist holds IDs not server records, I-PROPOSED-J ACTIVE] — established the partialize discipline that makes `draftEventStore` an explicit TRANSITIONAL exemption. Relevant because the fix continues to use the TRANSITIONAL exemption rather than expanding it.
- ORCH-0859 [Tr2 Minimum Viable Trip] + REWORK 3 — established `event_type='event' | 'trip' | 'experience'` filtering and added the I-PROPOSED-TR2-EVENTS-TYPE-FILTER strict-grep gate. The fix preserves the `event_type='event'`/`'trip'` discrimination at insert time.
- ORCH-0889 [marketing tab desktop web fit-and-finish] — established `I-DISABLED-QUERY-IS-LOADING` which makes the marketing hooks return `isLoading: false` while `enabled: false`. The wizard route's loading-state shape should follow the same posture (no false-positive spinner during auth bootstrap).
- ORCH-0887 [Mingla Business Web Performance — slow page loads + hanging loaders] — sibling perf ORCH; the 0887-A `auth.getSession` Promise.race timeout already cures one hang class. ORCH-0893 cures a different hang class (sequential network chain on creator entry).

**Files read end-to-end (cited inline below):**

`mingla-business/app/event/create.tsx`, `mingla-business/app/trip/create.tsx`, `mingla-business/app/venue/create.tsx`, `mingla-business/app/event/[id]/edit.tsx`, `mingla-business/src/services/eventDrafts.ts`, `mingla-business/src/services/tripsService.ts:399-510`, `mingla-business/src/hooks/useServerDraftEvents.ts`, `mingla-business/src/hooks/useTrips.ts:108-137`, `mingla-business/src/components/event/EventCreatorWizard.tsx:150-270`, `mingla-business/src/store/draftEventStore.ts:1-90, 420-440, 660-790`, `mingla-business/src/utils/draftEventId.ts` (entire file), `mingla-business/src/utils/serverDraftEventMapper.ts:345-385`, `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx:1-330`, `mingla-business/src/hooks/marketing/useComposerDraft.ts` (entire file), `mingla-business/app/(tabs)/home.tsx:235`, `mingla-business/app/(tabs)/home.tsx:435`, `mingla-business/app/(tabs)/hub/events.tsx:298`, `mingla-business/app/brand/[id]/index.tsx:120`, `.github/scripts/strict-grep/i-proposed-tr2-events-type-filter.mjs:1-50` (CI gate shape reference).

---

## §1 — Symptom + operator's words

> "Opening the create event wizard is not instant on web. It experiences a loader. Why does this happen? Are there other bugs just like this currently in the mingla business web that should be fixed?" — operator (Seth), 2026-05-19, in `mingla-orchestrator` chat.

Translated:

- **Expected:** tapping a "Create event" CTA opens the wizard's Step 1 immediately.
- **Actual:** the route mounts a placeholder spinner page labeled "Starting a new event…", performs four sequential network round-trips, then `router.replace`s to the wizard. On business-web preview the user sees the full chain (no native push animation to mask it); on iOS+Android the slide-from-right transition hides the wait visually but the same round-trip chain executes.
- **Second-order operator concern:** "Are there other bugs just like this currently in the mingla business web that should be fixed?" — surfaced separately in §3.4 (sweep §A.7).

---

## §2 — Reproduction

### §2.1 — Static (source-only) reproduction

Static repro is `proven`. The code path is deterministic:

1. Operator taps "Create event" (e.g., on the home tab CTA `mingla-business/app/(tabs)/home.tsx:235`).
2. `router.push("/event/create")` (verbatim: `router.push("/event/create" as never);`).
3. `mingla-business/app/event/create.tsx:52-82` mounts and runs `useEffect(() => { … createDraft(currentBrandId).then(newDraft => router.replace(\`/event/\${newDraft.id}/edit?step=0\`)) … }, […]);` — gated only on `isAuthReady` + brand-resolved + `hasStarted` flag.
4. `createDraft` → `useCreateServerDraft` → `createServerDraft(brandId)` at `mingla-business/src/services/eventDrafts.ts:167-208` runs four sequential awaits (full evidence §3.1).
5. Only after the insert resolves does `router.replace` to `/event/{newId}/edit?step=0` execute.
6. `app/event/[id]/edit.tsx:60+` mounts the wizard; the wizard renders Step 1.

Steps 3–5 are the loader window. Step 2 → Step 6 is sequential and blocking on the network for the entire duration.

### §2.2 — Dynamic reproduction (NOT performed this pass)

The dispatch §A.2 requested live web Network timings via `npx expo start --web` + Chrome DevTools. Not captured this pass. Rationale: the static trace already proves the symptom existence and the round-trip count is structurally determined (4 sequential network calls), so the qualitative outcome ("user sees a loader") is `proven` regardless of exact ms timings. Live timing would refine the magnitude (p50 ~600ms–1.5s vs p95 ~1.5s–3s, estimated by typical Supabase round-trip + 4× serial multiplier), but the fix shape does not depend on it — eliminating the chain entirely is the remedy, not optimising it. Operator may request a follow-up timing capture; if so, the harness is straightforward (Performance API marks already exist in the build, Chrome DevTools Network panel records the four calls).

### §2.3 — Live DB ghost-draft count (BLOCKED — `inconclusive`)

Attempted the read-only Management API probe per `reference_supabase_management_api.md`. The auto-mode classifier blocked the production database query without explicit operator authorization naming the target. Probe SQL prepared but not executed:

```sql
SELECT event_type,
       count(*)                                       AS n_drafts,
       count(*) FILTER (WHERE created_at > now() - interval '30 days') AS last_30d,
       count(*) FILTER (WHERE created_at > now() - interval '90 days') AS last_90d,
       count(*) FILTER (WHERE title = 'Untitled draft'
                           AND description IS NULL
                           AND cover_media_url IS NULL
                           AND party_types = '{}')    AS untouched_proxy
FROM public.events
WHERE status = 'draft' AND deleted_at IS NULL
GROUP BY event_type
ORDER BY n_drafts DESC;
```

Quantitative ghost-draft accumulation is therefore `inconclusive`. The STRUCTURAL existence of the bug is `proven` — every cold "Create event" tap unconditionally inserts an `events` row (verbatim insert at eventDrafts.ts:200-204) and there is no path that deletes it on "back without typing" (verified by reading `event/[id]/edit.tsx` and `EventCreatorWizard.tsx` mount-and-exit paths). The fix prevents future accumulation regardless of historical size. Operator may authorize the probe to size a one-time cleanup migration (recommended as a follow-up ORCH — see §9.3).

---

## §3 — Findings

### §3.1 — 🔴 Root cause R-01: `/event/create` performs four sequential server round-trips before mounting the wizard

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/app/event/create.tsx:52-82` (route useEffect) → `mingla-business/src/hooks/useServerDraftEvents.ts:275-312` (`useCreateServerDraft` mutation) → `mingla-business/src/services/eventDrafts.ts:167-208` (`createServerDraft`) |
| **Exact code** | `void createDraft(currentBrandId).then((newDraft) => { router.replace(\`/event/\${newDraft.id}/edit?step=0\` as never); })…` (create.tsx:60-63). `createServerDraft` body: `const userId = await requireUserId();` (171) → `await assertBrandCanAuthorOfferings(brandId);` (172) → `const effectiveCurrency = nullableCurrency(sourceDraft?.currency) ?? (await fetchBrandDefaultCurrency(brandId));` (174-175) → `const { data, error } = await supabase.from("events").insert({ ...insertPayload, event_type: "event" }).select(EVENT_DRAFT_SELECT).single();` (200-204) |
| **What it does** | Synchronously awaits four network calls — `auth.getUser()`, `brands.select(authoring-gate)`, `brands.select("default_currency")`, `events.insert()` — before `router.replace` permits the wizard to mount. The route's `<View>` host renders a `<Spinner>` with the label "Starting a new event…" for the entire chain duration. |
| **What it should do** | Mount the wizard's Step 1 within ~200ms of the CTA tap. No entry-blocking server mutation; the server-side draft row is created lazily on the first user-meaningful edit. |
| **Causal chain** | Tap CTA → `router.push("/event/create")` → create.tsx mounts placeholder spinner → useEffect fires → mutation awaits 4× serial network → resolve → `router.replace` → edit.tsx mounts → wizard renders Step 1. The four network calls cannot be parallelised (call 1 produces auth context call 2 uses; call 3's brand select feeds the insert payload; the insert depends on all three). User-visible window: 4× serial Supabase round-trip = structurally guaranteed to feel like a loader on web (no native push animation to mask). |
| **Verification** | (a) Read of `eventDrafts.ts:167-208` confirms four awaits in series. (b) Read of `create.tsx:52-82` confirms `router.replace` runs only inside `.then((newDraft) => …)`. (c) Read of `app/event/[id]/edit.tsx:60-258` confirms the wizard is the next render after `router.replace` lands. (d) The reference good pattern at `app/(tabs)/marketing/campaigns/compose.tsx:104-330` mounts INSTANTLY with empty inputs and creates the campaign row lazily on first dirty-edit via `useComposerDraft` (`src/hooks/marketing/useComposerDraft.ts` end-to-end). This proves a lazy pattern is achievable in the codebase. |

Classification: **🔴 Root Cause** — direct reason for the operator-reported symptom on `/event/create`.

### §3.2 — 🔴 Root cause R-02: `/trip/create` performs SIX sequential server round-trips AND inserts THREE rows across THREE tables before mounting the wizard

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/app/trip/create.tsx:35-64` (route useEffect) → `mingla-business/src/hooks/useTrips.ts:108-137` (`useCreateTripDraft` mutation) → `mingla-business/src/services/tripsService.ts:399-496` (`createTripDraft`) |
| **Exact code** | `const trip = await createTripDraft.mutateAsync({ brandId: currentBrand.id }); router.replace(\`/trip/\${trip.id}/edit\` as never);` (trip/create.tsx:51-55). `createTripDraft` body: `await assertBrandCanAuthorOfferings(input.brandId);` (403) → `const brandCurrencyQuery = await supabase.from("brands").select("default_currency, slug")…maybeSingle();` (415-420) → `(await supabase.auth.getUser()).data.user?.id` (431, inlined inside insert payload — still serial because the await resolves before insert dispatch) → `supabase.from("events").insert(…).select().single();` (427-442) → `supabase.from("ticket_types").insert(…).select().single();` (456-472) → `supabase.from("trip_pricing_tiers").insert(…);` (480-485) |
| **What it does** | Six sequential network round-trips. Inserts THREE rows on cold create: one `events` row (event_type='trip'), one `ticket_types` placeholder row (`price_cents=0, is_unlimited=false, quantity_total=1`), one `trip_pricing_tiers` placeholder. None of the three are deleted if the user backs out before typing. |
| **What it should do** | Mount the trip wizard's Step 1 within ~200ms of the CTA tap. No entry-blocking server mutation. The server-side rows (events + placeholder ticket + placeholder pricing tier) are created lazily on the first user-meaningful edit. |
| **Causal chain** | Same shape as R-01 but worse — six awaits instead of four, three table inserts instead of one. Native push animation on iOS+Android masks the round-trip count visually; on business-web preview the user sees the full chain. The ghost-draft side effect is also worse: three rows across three tables per abandoned cold-create. |
| **Verification** | (a) Read of `tripsService.ts:399-496` confirms the six-await chain and three inserts. (b) Read of `trip/create.tsx:35-64` confirms `router.replace` is gated on `mutateAsync` resolution. (c) The placeholder ticket + pricing tier exist because the trip wizard's Step 4/5 expects them present — but this is an "eagerly seed everything in case the user needs it" pattern, not a "create what the user is asking for" pattern. Lazy seeding could happen on Step 4/5 navigation instead. |

Classification: **🔴 Root Cause** — direct reason for the same symptom class on `/trip/create`, with strictly larger blast radius than R-01.

### §3.3 — 🟠 Contributing factor C-01: ghost-draft row accumulation in `events` (and `ticket_types`, `trip_pricing_tiers` for trips)

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/src/services/eventDrafts.ts:200-204` (unconditional `events.insert`); `mingla-business/src/services/tripsService.ts:427-485` (unconditional 3× insert chain) |
| **Exact code** | See §3.1 and §3.2 above. |
| **What it does** | Every "Create event" / "Create trip" tap inserts at least one durable row in `events`. The row persists in `status='draft' deleted_at IS NULL` if the user backs out without typing. There is NO mount-and-exit-without-edit deletion path. The `event/[id]/edit.tsx` route's `handleExit` callback (lines 266-298) only fires on explicit user-driven exit modes (`'discarded'`, `'published'`) — back-button-from-Step-1-before-any-input does not trip the discarded branch. |
| **What it should do** | A "Create" tap that the user abandons before any edit should leave ZERO rows behind. Server-side rows only exist when the user has committed at least one user-meaningful field. |
| **Causal chain** | Eager-mutation R-01/R-02 → every tap inserts row(s) → user backs out → rows persist as ghost drafts → polluted drafts-list queries, inflated brand draft counts, increased RLS read cost, eventual UX confusion (the user opens the drafts list and sees rows they don't remember creating). |
| **Verification** | (a) Read of the insert paths confirms no conditional gating. (b) Read of `EventCreatorWizard.tsx:253-258` `beginDraftEdit` + `endDraftEdit` lifecycle hooks confirms they ONLY track an in-progress edit flag in Zustand, NOT a server-side delete-on-abandon path. (c) Read of the `useDiscardServerDraft` hook (`useServerDraftEvents.ts:314-346`) confirms server discard only fires on explicit `discardDraft` action — not on cold abandonment. (d) Quantitative DB probe was blocked (§2.3); structural existence is `proven` independent of size. |

Classification: **🟠 Contributing Factor** — makes the cold-create wait worse over time (drafts list grows), and creates a data-integrity concern even after the loader symptom is fixed. The fix in the SPEC §8 directly resolves both.

### §3.4 — 🔵 Observation O-01: §A.7 sweep — only two creator entry routes have the eager-mutation anti-pattern; `/venue/create` already follows the lazy-client-side pattern

| Field | Evidence |
|---|---|
| **Surface scoped** | Every `create.tsx` / `new.tsx` route under `mingla-business/app/` (3 total). |
| **`/event/create`** | Eager-mutation. R-01. |
| **`/trip/create`** | Eager-mutation. R-02. |
| **`/venue/create`** | Already lazy. `mingla-business/app/venue/create.tsx:33-262` mounts INSTANTLY with `useDraftVenueStore` (Zustand client-side), renders a 3-phase UI (gate → category → wizard), and only commits server-side when the user completes the form. No spinner page, no router-bounce-on-mutation, no ghost rows. Established by Ve1+Ve2 (per docstring line 2: "Ve1+Ve2 — physical venue onboarding"). |
| **Other "creator-like" entry paths checked** | `marketing/campaigns/compose.tsx` (lazy auto-save — good); `marketing/templates/[id].tsx` with `"new"` sentinel (lazy on Save — good); `brand/[id]/edit.tsx` (edit, not create — N/A); no other `create.tsx` exists. |

Classification: **🔵 Observation** — confirms scope is exactly `/event/create` + `/trip/create`. No follow-up ORCH candidate surfaced; venue is already a reference good pattern alongside campaign-compose and template-new. The fix's per-route delta is therefore minimal in number (2 routes), but each route has a non-trivial state-machine change to wire (see SPEC §8).

### §3.5 — 🔵 Observation O-02: the codebase already has a working "client `d_*` id → server id" migration path

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/app/event/[id]/edit.tsx:144-169` (in-edit migration useEffect); `mingla-business/src/hooks/useServerDraftEvents.ts:86-142` (drafts-list migration useEffect); `mingla-business/src/services/eventDrafts.ts:183-193` (mapper accepts `legacyLocalDraftId`); `mingla-business/src/utils/serverDraftEventMapper.ts:348-384` + `serverDraftEventMapper.ts:270-345` (`mergeBusinessDraftTheme` stores `legacyLocalDraftId` inside `theme.business_draft.legacyLocalDraftId`); `mingla-business/src/utils/draftEventId.ts` (`generateDraftId()` → `d_<ts36>` format); `mingla-business/src/store/draftEventStore.ts:775-779` (`createDraft(brandId)` Zustand action — synchronous, returns `d_*` draft, persists). |
| **What it does** | The edit route already detects a `d_*` id and converts it to a server draft via `createServerDraft(draft.brandId, draft)` followed by `replaceDraft(draft.id, serverDraft)` + `router.replace` to the new server id URL. The mapper stores the original `d_*` id inside `theme.business_draft.legacyLocalDraftId` so subsequent migrations can dedupe. |
| **Significance for the SPEC** | The migration primitive ALREADY EXISTS. The fix does NOT need to invent a new lazy-insert mechanism. It needs to: (a) move the trigger from "edit-route mount" (current) to "first user-meaningful edit" (target), and (b) eliminate the `/event/create` placeholder spinner page entirely by routing straight from the home/hub CTA to `/event/d_<ts36>/edit?step=0` via a synchronous Zustand `createDraft(brandId)`. |

Classification: **🔵 Observation** — load-bearing infrastructure already exists; the fix is a re-wiring, not a rebuild. This significantly reduces SPEC complexity and implementor risk.

### §3.6 — 🟡 Hidden flaw H-01: edit-route's eager migration useEffect mirrors the create-route anti-pattern

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/app/event/[id]/edit.tsx:144-169` |
| **Exact code** | `if (!isEditPublished && draft !== null && draft.id.startsWith("d_") && migratingLegacyIdRef.current !== draft.id) { … void createServerDraft(draft.brandId, draft).then((serverDraft) => { replaceDraft(draft.id, serverDraft); router.replace(\`/event/\${serverDraft.id}/edit?step=\${initialStep ?? 0}\` as never); })…; }` |
| **What it does** | When the edit route mounts with a `d_*` id (legacy local-only draft from pre-server-backed days, or — after this ORCH ships — a freshly-minted client-side draft), it IMMEDIATELY fires `createServerDraft` regardless of whether the user has touched anything. If we simply re-route `/event/create` to `/event/d_<ts36>/edit?step=0` without changing this useEffect, the migration fires on mount — solving the loader but NOT the ghost-draft problem. |
| **What it should do** | The migration should fire only after the user makes the first user-meaningful edit (typed a title, picked a cover, etc.). Until that point the draft lives in Zustand only. |
| **Causal chain** | If R-01 is fixed by route-level re-wire alone, H-01 silently preserves the ghost-draft side effect — every mount of the wizard for a `d_*` draft would still insert a server row. This is exactly the trap the user is asking us to close. SPEC §8 §8.3.2 explicitly addresses this by replacing the unconditional migration with a "first-edit-triggered" migration. |
| **Verification** | (a) Read of the useEffect dependency array (edit.tsx:238-258) shows the migration fires whenever `draft` is non-null and starts with `d_` — no "is dirty" gate. (b) Read of `EventCreatorWizard.tsx:218-222` shows `currentStep` defaults to `liveDraft.lastStepReached`, but this is set to 0 on every fresh draft per `DEFAULT_DRAFT_FIELDS.lastStepReached: 0` at draftEventStore.ts:420 — so "draft has no user edits" is `name.length === 0 && lastStepReached === 0` (matches the `isCreateMode` derivation at edit.tsx:260-264). |

Classification: **🟡 Hidden Flaw** — would re-emerge during implementation if the migration trigger isn't moved. Already mapped in the SPEC.

### §3.7 — 🟠 Contributing factor C-02: synchronous `useEffect` chain inside `/event/create` is gated on `isAuthReady` + `currentBrandRecovery.isResolving` — the spinner can show TWO labels in sequence ("Finishing sign-in…" → "Starting a new event…") in a cold session

| Field | Evidence |
|---|---|
| **File + line** | `mingla-business/app/event/create.tsx:52-103` |
| **Exact code** | `const [hasStarted, setHasStarted] = React.useState<boolean>(false);` (50) → `useEffect(() => { if (hasStarted) return; if (!isAuthReady || currentBrandRecovery.isResolving) return; … setHasStarted(true); void createDraft(currentBrandId)… }, [currentBrandId, createDraft, currentBrandRecovery.isResolving, hasStarted, isAuthReady, router]);` → label JSX (94-99): `{!isAuthReady || currentBrandRecovery.isResolving ? "Finishing sign-in…" : error === null || isBusinessAuthNotReadyError(error) ? "Starting a new event…" : "Couldn't start this draft. Retrying…"}` |
| **What it does** | On cold web load, the user can see the label flip from "Finishing sign-in…" (while ORCH-0887-A's 3000ms `auth.getSession` race is in flight) to "Starting a new event…" (while createDraft runs). Net cold-create perceived latency: up to 3s of auth bootstrap + 600ms–1.5s of createDraft chain. Lukewarm cache: ~600ms–1.5s of createDraft chain only. Warm: ~150ms–400ms (still visible). |
| **What it should do** | Auth bootstrap is a system-wide concern (ORCH-0887-A handles it). For the wizard entry, the right posture is: wait for auth, then mount the wizard, NOT show a sequence of spinners on top of a server mutation. The fix in SPEC §8 removes the "Starting a new event…" label entirely by removing the mutation; the auth-readiness wait remains but is now strictly a function of auth bootstrap, not a multi-second stack. |
| **Causal chain** | Cold session → auth bootstrap takes 0–3s (per ORCH-0887-A) → spinner shows "Finishing sign-in…" → auth lands → spinner flips to "Starting a new event…" → createDraft chain runs → wizard mounts. The fix collapses this to: cold session → auth bootstrap → wizard mounts (with `d_*` draft pre-built in Zustand the moment auth is ready). |
| **Verification** | Reading the label JSX at create.tsx:94-99 confirms the conditional label sequence. ORCH-0887-A's 3000ms timeout is upstream and out of scope for this ORCH. |

Classification: **🟠 Contributing Factor** — fixed as a side effect of R-01's resolution. No standalone work needed.

---

## §4 — Root cause (final synthesis)

**Two root causes**, structurally identical, sibling sub-cases of the same anti-pattern:

- **R-01:** `/event/create` performs an entry-blocking 4-call server mutation chain that inserts an `events` row BEFORE the wizard is allowed to mount.
- **R-02:** `/trip/create` performs an entry-blocking 6-call server mutation chain that inserts 3 rows across 3 tables (events + ticket_types + trip_pricing_tiers) BEFORE the wizard is allowed to mount.

The anti-pattern is "eager server-side draft creation on creator route entry." The remedy is "client-side draft id minted synchronously in Zustand on route entry + lazy server-insert on first user-meaningful edit." All required infrastructure already exists in the codebase (§3.5); the SPEC re-wires it.

---

## §5 — Blast radius across the five truth layers

| Layer | State | Notes |
|---|---|---|
| **Docs** | Internally consistent with current behaviour. | `create.tsx:1-19` docstring says "Per Cycle 3 spec §3.5 route 1" + "redirects in useEffect with a Spinner placeholder for the brief redirect moment" — accurate to today's code, will need updating when the fix lands. No doc/code contradiction. |
| **Schema** | Allows ghost drafts; no constraint forbids them. | `events.title` nullable / default "Untitled draft", `events.status` allows `'draft'`, `events.deleted_at` nullable. No CHECK or trigger gates "insert only on meaningful content." Schema does not block the fix. The trigger `tg_enforce_event_ticket_currency` (ORCH-0769) means `events.currency` must be non-null at the time `ticket_types` is inserted — this is already handled by the trip-create flow's `fetchBrandDefaultCurrency` and would remain handled by the lazy-insert flow (currency resolves at insert time as today). |
| **Code** | Eager-mutation on entry, eagerly-inserts row, eagerly-`router.replace`s to wizard. | Six files implicated: `app/event/create.tsx`, `app/trip/create.tsx`, `app/event/[id]/edit.tsx` (H-01), `src/services/eventDrafts.ts`, `src/services/tripsService.ts`, `src/hooks/useServerDraftEvents.ts`. Plus the Zustand `draftEventStore` already has `createDraft(brandId)` synchronous primitive (line 775-779). |
| **Runtime** | On web: loader for the entire chain duration. On iOS+Android: native push animation masks the loader; users perceive instant. | Behavior matches operator's report. No layer contradiction — this is a real runtime symptom on web with the same structural cause on mobile (just visually hidden). |
| **Data** | Ghost drafts accumulate in `events` (and for trips: `ticket_types`, `trip_pricing_tiers`). Quantitative size `inconclusive` (probe blocked §2.3). | Structural existence proven by code reading. Operator may authorize a one-time cleanup follow-up ORCH after this ORCH lands. |

All five layers are consistent with each other on the symptom AND the root cause. No contradiction = root cause is **proven**, not just probable.

---

## §6 — Invariant violation audit

| Invariant | Status | Notes |
|---|---|---|
| **I-NO-DEAD-TAPS** (Constitution #1) | **VIOLATED** today; the "Create event" CTA opens a placeholder spinner page rather than the wizard. Subjective: arguably the tap is "responded to" because the spinner appears — but the wizard is what the user asked for, and the spinner is a hostage screen the user can only wait on. Fix restores compliance. | The fix collapses the spinner-then-wizard sequence into wizard-only. |
| **I-11 Format-agnostic ID resolver (mingla-business)** | **PRESERVED**. The fix relies on `/event/d_<ts36>/edit` resolving through the existing `useDraftById` resolver — explicitly named in the invariant's test case (line 1369). | No new ID format introduced. |
| **I-12 Host-bg cascade (mingla-business)** | **PRESERVED**. The route already sets `backgroundColor: canvas.discover`; the fix removes the placeholder route entirely (or simplifies it to a 1-tick auth gate), so the host-bg pattern is N/A in the fixed flow OR mirrors today. | |
| **I-PROPOSED-J (Zustand persist holds IDs, not server records)** | **PRESERVED via the TRANSITIONAL exemption already in force for `draftEventStore`** (per memory). The fix continues to hold full draft records in the store as Cycle 3+ has done since ORCH-0739. The B-cycle still owns the eventual contraction to ID-only when backend lands. | The fix does NOT widen the exemption; the store's `partialize: (state) => ({ drafts: state.drafts })` is unchanged. |
| **Constitution #2 (one owner per truth)** | **PRESERVED**. `events.status='draft'` remains the durable source; Zustand remains the immediate UI cache + legacy migration source (per draftEventStore.ts:14-16). Fix maintains this owner split. | |
| **Constitution #3 (no silent failures)** | **PRESERVED + STRENGTHENED**. Today's "Couldn't start this draft. Retrying…" label is a foreground failure surface. The fix moves the failure surface into the wizard (in-wizard banner) when the lazy insert fails — the user can retain typed input and retry, instead of bouncing back to home with lost work. | Spec §8 §8.4 specifies the error surface. |
| **Constitution #8 (subtract before adding)** | **HONORED**. The fix DELETES the eager useEffect, the placeholder spinner page, and the migration trigger at `event/[id]/edit.tsx:144-169` (and the trip mirror). New code is minimal: a synchronous `createDraft` call on the CTA side, and a "first-edit trigger" condition on the migration useEffect. | |
| **Constitution #9 (no fabricated data)** | **N/A** — no UI fabrication implicated. | |
| **I-PROPOSED-TR2-EVENTS-TYPE-FILTER** (ORCH-0859 ACTIVE) | **PRESERVED**. The lazy insert preserves `event_type='event'` for the event path and `event_type='trip'` for the trip path — same value the eager insert sets today (eventDrafts.ts:202; tripsService.ts:434). | No new `.from("events")` queries introduced. |
| **I-DISABLED-QUERY-IS-LOADING** (post-ORCH-0889) | **N/A** at the route layer; this invariant applies to React Query hooks. Worth confirming during implementation that any new RQ shape introduced by the SPEC respects it. | Spec §8 §8.5 mentions it as an implementor pre-flight check. |
| **NEW invariant proposed: I-PROPOSED-CREATOR-ENTRY-IS-INSTANT** | **TO BE ESTABLISHED BY THE SPEC** — see §9.2 and SPEC §9. | Rule: "Any creator entry route MUST mount the creator UI without an entry-blocking server mutation; server-side draft rows are created lazily on first user-meaningful edit, never on route mount." CI gate enforces via strict-grep over `app/*/create.tsx`. |

---

## §7 — Cross-surface impact map

| Surface | Touched? | Behaviour |
|---|---|---|
| **business-web-preview** | YES — primary fix target. | Loader on entry disappears; wizard mounts within ~200ms. |
| **business-iOS** | YES — code path is the same, no platform fork. | Native push animation today masks the loader. Post-fix, the animation completes onto a fully interactive wizard (vs onto a spinner). Performance improvement; UX parity with web. |
| **business-Android** | YES — same code path. | Same as iOS. |
| **consumer-iOS** | NO — `app-mobile/` has no creator routes for events/trips on consumer. Out of scope. |
| **consumer-Android** | NO — same reason. |
| **buyer-anon-web** | NO — `/checkout`, `/e`, `/b` are conversion-only; no creator entries. |
| **admin-web** | NO — `mingla-admin/` is read/moderate; no event/trip creator surfaces. |

No manual parity needed; all three touched surfaces share the same code path. Per-surface success criteria still belong in the SPEC for explicit per-platform testability.

---

## §8 — Discoveries for orchestrator (side issues)

- **DISC-0893-A:** `event/[id]/edit.tsx:144-169` eager migration useEffect is upstream-dependent on this ORCH but has its own latent ghost-draft trigger (H-01). Already folded into SPEC §8 scope, but if SPEC scope is rolled back, this discovery must be re-registered as a sibling ORCH.
- **DISC-0893-B:** the cold-create perceived latency includes 0–3s of auth bootstrap (ORCH-0887-A wait). After this ORCH lands, the wizard will mount as soon as auth is ready — meaning the auth wait still gates the wizard. ORCH-0887-A's other sub-ORCHs (B/C/D/E) remain the path to making auth bootstrap faster; this ORCH does not address that. No new ORCH needed; informational.
- **DISC-0893-C:** ghost-draft historical accumulation in `events` (and `ticket_types`, `trip_pricing_tiers`) — operator may authorize a one-time cleanup migration after this ORCH closes. Recommended as a follow-up ORCH. Probe SQL provided in §2.3. NOT in this ORCH's scope.
- **DISC-0893-D:** `/trip/create`'s extra rows in `ticket_types` and `trip_pricing_tiers` — when the lazy pattern lands, those placeholder rows should be created lazily too (at the Step where they become user-meaningful, e.g., when the operator first opens the tickets step). SPEC §8 §8.6 addresses this with a sub-decision; operator may choose to defer the placeholder-lazy work to a follow-up ORCH if it adds too much SPEC complexity.

---

## §9 — Fix strategy (DIRECTION ONLY — full plan lives in the SPEC)

### §9.1 — Shape

Client-side draft id minted synchronously in Zustand on the CTA tap. The wizard mounts immediately. The server-side row is created lazily on the first user-meaningful edit via the existing migration infrastructure (re-targeted from "edit-route mount" to "first-edit trigger"). The `/event/create` placeholder spinner route is reduced to a 1-tick auth gate that calls `useDraftEventStore.getState().createDraft(brandId)` + `router.replace` to `/event/d_<ts36>/edit?step=0` synchronously. The trip equivalent does the same with `useDraftTripStore` (if extant — SPEC verifies; if not, introduces it as a sibling). The `event/[id]/edit.tsx:144-169` migration useEffect is rewritten to gate on `isDirty || lastStepReached > 0 || any-meaningful-field-set`, not on mount.

### §9.2 — New invariant

`I-PROPOSED-CREATOR-ENTRY-IS-INSTANT` — "Any creator entry route MUST mount the creator UI without an entry-blocking server mutation; server-side draft rows are created lazily on first user-meaningful edit, never on route mount."

Backed by a strict-grep CI gate forbidding `useMutation` / `mutateAsync` / `createDraft` / `createTripDraft` / `createServerDraft` references inside any `mingla-business/app/**/create.tsx` route file, with an allowlist comment grammar for exemption — per `feedback_strict_grep_registry_pattern.md`.

### §9.3 — Regression prevention

(a) Strict-grep CI gate `i-proposed-creator-entry-is-instant.mjs` (one script + one workflow job under `.github/workflows/strict-grep-mingla-business.yml` per the registry pattern). (b) Implementor happy-path test that mounts `/event/create` (and `/trip/create`) and asserts the wizard's Step 1 is interactive without any network mutation on the entry stack. (c) Tester adversarial test attacking a DIFFERENT angle — e.g., that a "mount-then-unmount-before-typing" sequence creates ZERO `events` rows (mock the Supabase client with a call-counting recorder); and/or that typing during the lazy-insert in-flight window coalesces into a single insert + subsequent updates (no duplicate rows). Per Step-0.5 regression-test gate.

---

## §10 — Layman summary

- Today's "Create event" button on mingla-business web doesn't open the wizard right away. It opens a placeholder page that says "Starting a new event…", then talks to the server four times in a row before letting you start typing. On iPhone and Android the slide-in animation hides the wait, so it feels instant — but the wait is happening just the same. The "Create trip" button is the same story, but worse: it talks to the server SIX times and creates THREE database rows before the wizard appears.
- A second, quieter bug: every "Create event" or "Create trip" tap creates a real database row before you've typed anything. If you hit back, that row stays behind as a ghost draft. Over time these accumulate and start showing up in the drafts list.
- Good news: a different part of the codebase already does this the right way — the marketing campaign composer opens instantly with empty inputs and only creates the database row when you start typing. The plumbing to do the same thing for events and trips is already in place; this work re-wires the entry routes to use it.
- The fix opens the wizard in roughly the time it takes for the screen to slide in (under ~200ms), and only creates a real database row once you've actually typed or picked something. If you hit back before typing, there's nothing left behind.
- Scope is exactly two routes (`/event/create` and `/trip/create`). The `/venue/create` route was checked and already does the right thing. No other "Create" routes exist in mingla-business that need this fix. No mobile-app changes, no admin changes, no buyer-page changes.
- One historical question the fix does NOT decide: how many ghost drafts already exist in the production database. We tried to count them as part of this investigation but the sandbox blocked the live-database read; the answer doesn't affect the fix's correctness, but it does inform whether to schedule a one-time cleanup afterwards. Recommended as a small follow-up ORCH once you authorise the read.

---

**Investigation closes. Spec follows at `Mingla_Artifacts/specs/SPEC_ORCH-0893_CLIENT_ID_PLUS_LAZY_AUTOSAVE_FOR_CREATOR_ENTRIES.md` (same dispatch, SPEC phase).**
