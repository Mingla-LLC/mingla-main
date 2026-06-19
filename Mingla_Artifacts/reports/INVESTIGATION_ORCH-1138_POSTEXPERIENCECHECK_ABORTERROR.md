# INVESTIGATION — ORCH-1138 — `usePostExperienceCheck` AbortError on trip detail

**Mode:** INVESTIGATE (read-only). No code proposed, no fix written.
**Date:** 2026-06-15
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on branch `ORCH-1138-trip-page-redesign` (13 ahead / 0 behind origin/main).
**Dispatched by:** orchestrator — Seth saw a console error on the consumer app while testing the ORCH-1138 trip detail.

---

## Symptom summary

- **Reported (actual):** consumer app (`app-mobile`), after a while on/around the trip detail screen, logs:
  `console.error: [usePostExperienceCheck] Query error: AbortError: Network request timed out`
- **Expected:** no console error while viewing a trip.

---

## Investigation manifest (files read, in trace order)

1. `COMMS_LEDGER.md` — entry scan. No OPEN BLOCK to forensics/ORCH-1138/ALL. (WARN rows 0002/0009/0015/0018 are stale infra notes, not relevant.)
2. `app-mobile/src/hooks/usePostExperienceCheck.ts` — the hook itself (full read).
3. `app-mobile/app/index.tsx:286` (+ surrounding) — the mount site.
4. `app-mobile/src/services/supabase.ts` — the shared client + `fetchWithTimeout` wrapper (origin of the AbortError).
5. `git diff origin/main...HEAD` — what ORCH-1138 actually changed.
6. `app-mobile/src/hooks/useConsumerTripFoundation.ts`, `ConsumerTripDetailScreen.tsx`, `components/offering/*` — the new 1138 trip-detail code, checked for any link to the hook.
7. Live prod DB (project `gqnoajqerqhnvulmnyvv`, read-only `EXPLAIN ANALYZE` + table stats) — backend latency of the exact query.

---

## Q-scorecard

### Q1 — What does `usePostExperienceCheck` query, and where/when does it fire?
**Verdict (proven):** It queries the **`calendar_entries` table directly via the supabase-js PostgREST client** (NOT an edge function, NOT an RPC) — `usePostExperienceCheck.ts:49-58`. It powers the post-experience *review* prompt modal (find the oldest past, unreviewed scheduled experience and pop a review modal), it has nothing to do with experiences-the-offering. It mounts ONCE, globally, at the app root/Home host — `app/index.tsx:286` — NOT on the trip detail screen. It fires: (a) once on login/mount (`:103-108`); (b) on every app foreground transition (`:111-127`); and (c) **on a `setInterval` every 60 s** while a user is logged in (`:130-145`, `INTERVAL_CHECK_MS = 60_000` at `:24`). The 60 s loop is the "after a while" trigger.

### Q2 — Where does the `AbortError: Network request timed out` come from?
**Verdict (proven):** From the shared client fetch wrapper, NOT from PostgREST/Postgres. `supabase.ts:54-58` — `fetchWithTimeout` runs a `Promise.race` between the real `fetch` and a `setTimeout` that, after **`TIMEOUT_MS = 20000`** (`:27`), calls `controller.abort()` and `reject(createAbortError('Network request timed out'))`. `createAbortError` (`:16-20`) builds `new Error(message)` with `error.name = 'AbortError'`, so its string form is exactly `AbortError: Network request timed out`. The hook catches this on the query path and logs it at `usePostExperienceCheck.ts:60-61` (`console.error('[usePostExperienceCheck] Query error:', error.message)`). String reconciles exactly with the symptom.

### Q3 — Is the backend slow (genuine server timeout)?
**Verdict (proven NO).** Live read-only `EXPLAIN ANALYZE` of the EXACT hook query on prod: **Execution Time 0.740 ms** via `Index Scan using idx_calendar_entries_user_id`. Table is **296 kB, ~11 rows, 6 indexes**. There is no plausible server-side path to a 20-second response. The 20 s client timeout therefore fired on a request that never completed at the **network/transport** layer (transient connectivity loss / socket stall / device or sim network blip), not on slow SQL.

### Q4 — Did ORCH-1138 (Leg 1C) cause or change this?
**Verdict (proven NO — PRE-EXISTING).** `git diff origin/main...HEAD` shows the hook, its mount (`app/index.tsx`), and the client wrapper (`supabase.ts`) are **byte-identical to origin/main** (empty diff for all three). `git log -1` on the files: hook last touched **2026-03-03** (commit `c2eb45e9c`), client wrapper **2026-04-10** (`6bdbbd307`, ORCH-0366/0367) — both months before ORCH-1138. The 1138 trip-detail rewrite (`ConsumerTripDetailScreen.tsx`, `useConsumerTripFoundation.ts`, `ConsumerTripReserveBar.tsx`, `ConsumerRefundLadder.tsx`) contains **no reference** to `usePostExperienceCheck`/`PostExperience`/`calendar_entries`, and `useConsumerTripFoundation.ts` makes **no network calls at all** (no `supabase`/`.from(`/`.rpc(`/`invoke`). The hook fires on its 60 s global timer regardless of which screen is on top — it just happened to log while Seth lingered on the trip page.

### Q5 — Is it a CRASH or a logged error?
**Verdict (proven: logged error, non-fatal).** The error is caught (`:60-63`), logged, and the function `return`s early; `isCheckingRef` is reset in `finally` (`:97-99`). No throw escapes, no error boundary is hit, no state corruption. The next 60 s tick (or next foreground) simply retries. It is console noise, not a crash.

---

## Findings (six-field evidence)

### F-1 — AbortError is a client-side 20 s network timeout, not a server error. CONFIRMED ROOT CAUSE.
1. **Symptom:** `[usePostExperienceCheck] Query error: AbortError: Network request timed out`.
2. **Layer:** code (client fetch wrapper) + runtime (network transport).
3. **Probe:** read `app-mobile/src/services/supabase.ts` + `usePostExperienceCheck.ts`; live `EXPLAIN ANALYZE` of the exact query on prod.
4. **Evidence:** `supabase.ts:27` `const TIMEOUT_MS = 20000;`; `:54-58` `timeoutId = setTimeout(() => { controller.abort(); reject(createAbortError('Network request timed out')); }, TIMEOUT_MS);`; `:16-19` sets `error.name = 'AbortError'`. Hook `usePostExperienceCheck.ts:60-61` logs `error.message`. Prod `EXPLAIN ANALYZE`: `Execution Time: 0.740 ms`, index scan, ~11 rows / 296 kB.
5. **Mechanism:** A `calendar_entries` fetch (fired by the hook's 60 s interval) failed to complete at the network layer; after 20 s the shared `Promise.race` timeout rejected with the AbortError, which supabase-js surfaced to the hook's query path, which logged it. Backend latency (<1 ms) rules out slow SQL — the request never reached/returned over the wire.
6. **Severity:** CONFIRMED ROOT CAUSE (of the log line). Confidence: **proven** (source + live prod latency; sim repro of a transient network blip is not feasible/needed — the mechanism is fully traced).

### F-2 — Hook is global + pre-existing; ORCH-1138 is not in its path. CONFIRMED (RULES OUT 1138).
1. **Symptom:** error appears "on the trip detail" → implies 1138 relation.
2. **Layer:** code + git history.
3. **Probe:** `git diff origin/main...HEAD` (whole-tree + per-file), `git log -1` per file, grep of 1138 trip files.
4. **Evidence:** empty diff for `usePostExperienceCheck.ts`, `app/index.tsx`, `supabase.ts` vs origin/main. Hook mounts at `app/index.tsx:286` (global host). Hook last commit `c2eb45e9c` 2026-03-03. 1138 trip files contain no `usePostExperienceCheck`/`calendar_entries` reference; `useConsumerTripFoundation.ts` makes zero network calls.
5. **Mechanism:** The hook runs on a 60 s app-wide timer independent of the visible screen; it logs while on the trip page only because that is where Seth was sitting when a tick's fetch timed out. ORCH-1138 neither mounts, calls, nor modifies anything in this path.
6. **Severity:** CONFIRMED (correlation, not causation). Confidence: **proven**.

### F-3 — Non-fatal: caught, logged, self-retries. CONFIRMED.
Evidence: `usePostExperienceCheck.ts:60-63` early-return on error; `:97-99` `finally { isCheckingRef.current = false; }`; `:130-137` interval retries every 60 s. No throw escapes the hook. Severity: CONFIRMED non-fatal. Confidence: **proven** (source-traced).

---

## Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction? |
|-------|---------|----------------|
| Docs | Hook = post-experience review prompt (memory: experiences-consumer follow-ons). Not trip-page related. | none |
| Schema | `calendar_entries` 296 kB / ~11 rows / 6 indexes; `idx_calendar_entries_user_id` present. | none |
| Code | Hook queries `calendar_entries` via PostgREST; 20 s client timeout in `supabase.ts`; caught + logged. | none |
| Runtime | 20 s timeout fired → AbortError → logged. Non-fatal. | none |
| Data | Exact query executes in 0.74 ms on prod. Backend is NOT the bottleneck. | **Confirms** the timeout is network-transport, not server latency. |

No cross-layer contradictions. The only "gap" — a 20 s timeout against a <1 ms query — is itself the proof that the failure is transport-level, not server-level.

---

## Repro evidence

No live sim repro attempted: the trigger is a **transient network failure** (non-deterministic — you cannot reliably force a 20 s no-response on a healthy connection without artificial network shaping, and doing so would only re-demonstrate the already-traced wrapper behavior). The mechanism is fully traced through source + confirmed against live prod latency, so confidence is **proven** on the *mechanism* and **proven** on the *not-1138* verdict. The frequency/trigger of the underlying network blip is environmental (device/sim/Wi-Fi), not a code defect on the queried path.

---

## Blast radius / cross-surface map

- **In-scope of the symptom:** consumer iOS + Android (`app-mobile`), wherever a logged-in user sits idle ≥60 s with flaky connectivity. Surfaces on ANY screen (Home, deck, trip, event, profile) — the hook is mounted at the app root, not the trip page.
- **The same 20 s `fetchWithTimeout` wrapper backs EVERY supabase-js call in `app-mobile`** (`supabase.ts:77-79` `global.fetch`). So any query/edge call on a stalled network produces an analogous `AbortError: Network request timed out` — this hook is just one of many that happens to `console.error` it by name. This is a global client behavior, not specific to post-experience checks.
- **Out-of-scope:** `mingla-business`, `mingla-admin`, web buyer funnel (different clients). ORCH-1138 trip-page work (decoupled).

## Invariant impact

None violated. The 20 s timeout + `Promise.race` is an intentional resilience pattern (documented in `supabase.ts:8-14, 22-27`, ORCH-0366/0367). No invariant governs post-experience-check logging.

## Discoveries for orchestrator

- **D-1 (noise/UX, low):** the hook `console.error`s a routine transient network timeout at error severity. App-wide, any stalled supabase call on flaky networks logs `AbortError: Network request timed out`. If Seth wants the console clean, a *separate, tiny* follow-up could downgrade transient AbortErrors to a warn/silent path (e.g. distinguish AbortError from real PostgREST errors at the catch). NOT an ORCH-1138 concern; would touch the shared client + multiple hooks — register as its own micro-ORCH if desired. No code proposed here.
- **D-2 (info):** the 60 s polling interval means a backgrounded-then-flaky session will periodically retry and may log repeatedly. Expected by design.

## Confidence

**Proven** on: (a) root cause of the log line (client 20 s network timeout, F-1); (b) PRE-EXISTING / not-ORCH-1138 (F-2, byte-identical to origin/main, months-old, decoupled from trip code); (c) non-fatal (F-3); (d) backend is fast (0.74 ms live).

## Recommended next phase + scope (direction only — NOT a fix)

- **Does NOT block the ORCH-1138 trip-page leg.** The error is pre-existing, global, non-fatal console noise unrelated to the trip rework. The "trip page done" verdict stands on its own merits; this log line is not a regression introduced by 1138 and should not gate it.
- **Recommendation:** treat as a **separate, optional, low-priority follow-up ORCH** (per D-1) if console cleanliness is wanted — scope = downgrade transient AbortError logging in the shared client / `usePostExperienceCheck`. Otherwise WONTFIX as benign environmental noise. No fix proposed (INVESTIGATE).
