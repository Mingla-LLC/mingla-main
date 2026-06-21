# TEST — ORCH-1192 [app analytics instrumentation gaps]

Adversarial QA of `app_opened` (cold + foreground) + native `checkout_started`
added to BOTH native apps via the existing `postHogService.capture(...)` facade.

Working tree: `~/Desktop/mingla-orchs/ORCH-1192-[app-instrumentation-gaps]/`
on branch `ORCH-1192-app-instrumentation-gaps` (impl commit `c751b947d`,
rebased on `origin/main bce57a1a0`).

---

## 1. VERDICT

**CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 1 · P4: 2.

Source + behavioral + gate evidence is `proven` at the logic layer (the
double-fire defenses, opt-out, key-missing no-op, ordering, and add-alongside
are all independently re-derived and fail-on-revert). The single CONDITION is
the **on-device runtime emission**, which is `probable` not `proven`: both apps
are OTA-frozen (COMMS-0052 business / COMMS-0051+0047 consumer) so the events
cannot be observed landing in the live PostHog project until the next NATIVE
builds ship. This is a pure-JS change that rides those builds; there is no path
for this skill to verify runtime emission today. Verdict caps at CONDITIONAL
pending Seth's acceptance of that deferral (already mandated by the COMMSs).

No defect blocks merge. The double-fire defenses — the real risk — are correct.

Also handled COMMS-0052 (BLOCK, ALL): acknowledged. As tester I perform no OTA /
deploy, so the business-OTA freeze is complied with by construction; the freeze
is the basis for the runtime-emission CONDITION above.

---

## 2. SC-by-SC matrix

| SC | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| SC-1 | consumer cold `app_opened` once after init | PASS | `app-mobile/app/index.tsx:318-323` — chained off `initialize().then`, inside a `useEffect(…, [])` (fires once on mount, never on re-render) |
| SC-2 | consumer foreground `app_opened`, no first-active double-fire | PASS | `useForegroundRefresh.ts:140` sits AFTER `if (!wasBackground || !isNowActive) return` (L127); `appStateRef` seeds from `AppState.currentState` (L92) → first 'active' has no prior 'background' → no fire; iOS inactive→active excluded |
| SC-3 | business cold `app_opened` once after init | PASS | `mingla-business/app/_layout.tsx:481-486` — chained off `initialize().then` inside the boot effect |
| SC-4 | business foreground `app_opened`, no first-active double-fire | PASS | `_layout.tsx:585` `prevAppStateRef = useRef(AppState.currentState)` seeded "active"; handler L589 `wasBackground = prev === "background"` → first 'active' = false → no fire; single listener with `subscription.remove()` cleanup |
| SC-5 | props `{ cold_start, surface }` exact | PASS | all four sites verified verbatim |
| SC-6 | consumer `checkout_started` before sheet + before `purchase_completed` | PASS | `ConsumerEventDetailScreen.tsx:408-414` inside `handleBuy`, after validation, before `setCheckoutInFlight(true)` (L419); guarded by `if (checkoutInFlight) return` (L379) |
| SC-7 | business event/trip/experience `checkout_started` before pay + before completed | PASS | event `checkout/[eventId]/payment.tsx:349`, trip `checkout-trip/[tripEventId]/payment.tsx:379`, experience `checkout-experience/[experienceEventId]/payment.tsx:293` — all at top of `handlePay` after the `if (processing) return` guard, before web/native split |
| SC-8 | props match `purchase_completed` id/type `{ event_id, offering_type, value?, currency }` | PASS | consumer always includes value; business includes value only when `allInPreviewCents !== null` (Constitution #9 — no fabricated value) |
| SC-9 | fires ONCE per attempt (re-render/double-tap guarded) | PASS (logic) / P3 | guarded by `checkoutInFlight`/`processing` early-return; captures live in callbacks not effects → no re-render re-fire. See P3 re double-tap micro-race (pre-existing, shared with mixpanel) |
| SC-10 | same facade; no new infra; opt-out/consent honored | PASS | facade unchanged; opt-out enforced at SDK level via `client.optOut()` at init (`postHogService.ts:138`); proven by adversarial test #3 |
| SC-11 | native-only; no web analytics touched | PASS | `git diff --name-only origin/main` = native src + tests + gate + workflow + report ONLY; zero `.web.ts`/admin/marketing/supabase/webAnalytics files |
| SC-12 | I-PROPOSED-1187 gates + new gate pass | PASS | all 8 `i-proposed-1187-*` gates PASS; `orch-1192-app-events-wired` PASS (EXIT 0) |

**Runtime emission (all SCs):** NOT observed on-device — apps OTA-frozen
(COMMS-0052/0051/0047). Confidence = `probable`. This is the CONDITION.

---

## 3. Double-fire results (the core risk) — EXPLICIT

### app_opened
- **Cold start fires exactly once.** Consumer: `useEffect([])` mount effect →
  one capture, never on re-render. Business: boot-effect `.then` → one capture.
- **First post-boot 'active' does NOT double-fire.** Both apps seed their
  prev-state ref from `AppState.currentState` (= "active" at cold boot), so the
  `wasBackground && active` gate is false on the first 'active'. Proven by my
  adversarial test #1 routing the real cold + first-active sequence through the
  REAL facade and asserting `appOpenedCalls()` length === 1.
- **Real bg→active round-trip fires exactly one warm `app_opened`
  (cold_start:false).** Proven by adversarial test #2: active→active→inactive→
  active→background→active yields exactly `[cold, warm]` (the inactive→active
  flicker is correctly excluded).
- **Consumer warm gate** reuses the SAME proven gate as the already-shipped
  mixpanel warm event (`source:'warm'`), with `subscription.remove()` cleanup
  and `[userId, queryClient]` deps → no stacked listeners.

### checkout_started
- **Fires once per checkout attempt, not per render.** All four sites place the
  capture INSIDE a callback (`handleBuy`/`handlePay`), NOT a `useEffect` — there
  is no useEffect-without-deps / render-loop vector. The capture sits AFTER the
  `if (checkoutInFlight) return` / `if (processing) return` early-return, so a
  re-render that re-invokes the callback while in-flight early-returns BEFORE the
  capture. Proven by adversarial test #3: three back-to-back invocations while
  `processing` produce exactly one fire; a new attempt after the guard clears
  fires again.
- Covers consumer (event) + business (event + trip + experience) = all 4 sites.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Re-run on branch tip `c751b947d` (impl) in this worktree:

1. **CI gate** `orch-1192-app-events-wired.mjs`: true LINE DELETION of the
   business foreground `app_opened` block in `_layout.tsx` →
   `node …/orch-1192-app-events-wired.mjs` prints
   `FAIL: … foreground app_opened { cold_start:false, surface:"business_app" } NOT found` and exits **1**.
   Restored → exits **0**. (Confirmed true exit codes: reverted=1, restored=0.)
2. **Implementor ts-jest** `postHogService.orch1192.test.ts`: same revert →
   **2 failed / 9 passed**; restored → **11 passed**.

Both fails-on-revert claims independently reproduced. Hash run: `c751b947d`.

---

## 5. Adversarial test added (tester-owned, DIFFERENT angle)

Path: `mingla-business/src/services/__tests__/postHogService.orch1192.tester.adversarial.test.ts`
(commit on branch — see chat return). 6 tests, all PASS.

**Different angle:** the implementor's behavioral test (`makeHandler`)
reimplements the resume guard and pushes to a PRIVATE array — it never exercises
the real facade's no-op / opt-out gating that the two new events INHERIT. My
test drives the **REAL `postHogService` facade** (mocked posthog-react-native,
proven 1187 mock surface) and asserts: (1) cold + first-active = exactly ONE
`app_opened` via the real `client.capture`; (2) real bg→active round-trip = one
warm; (3) per-attempt guard semantics; (4) opt-out-at-init → `client.optOut()`
called and the new events route through the SAME governed `capture` (no bypass);
(5) key-missing → no client, hard no-op, no throw; (6) `checkout_started` before
`purchase_completed` ordering.

**fails-on-revert verified at `c751b947d`:** deleting the facade
opt-out-at-init block (`postHogService.ts:138` `if (…analyticsOptOut) client.optOut()`)
→ adversarial test #3 FAILS (`1 failed / 5 passed`); restored → `6 passed`.

Both the implementor happy-path test AND this adversarial test appear in
`git diff origin/main…HEAD --name-only` (the adversarial is the new untracked
file committed to the branch).

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | N/A | no new interactive UI |
| 2 | One owner per truth | PASS | single `postHogService` facade owns capture |
| 3 | No silent failures | PASS | analytics no-op is intentional + documented; never masks a user-facing failure |
| 4 | One query key per entity | N/A | no query keys |
| 5 | Server state stays server-side | N/A | no Zustand server state added |
| 6 | Logout clears everything | PASS | facade `reset()` unchanged; new events add no identity state |
| 7 | Label `[TRANSITIONAL]` | N/A | none introduced |
| 8 | Subtract before adding | PASS | reuses existing facade + existing resume gate; no parallel infra |
| 9 | No fabricated data | PASS | business `value` omitted (not `null`/0) when all-in preview unresolved |
| 10 | Currency-aware | PASS | `currency` from `seed.currency` / `totals.currency`, never hardcoded |
| 11 | One auth instance | N/A | no auth touched |
| 12 | Validate at right time | PASS | `checkout_started` fires after validation, at user's pay action |
| 13 | Exclusion consistency | PASS | iOS inactive→active consistently excluded both apps |
| 14 | Persisted-state startup | PASS | opt-out read from persisted store at init (`analyticsPrefsStore`) |

Zero violations.

---

## 7. Device / parity matrix

| Surface | Verdict | Note |
|---------|---------|------|
| Consumer iOS | PASS (source/logic) / runtime PROBABLE | cold+warm `app_opened` + event `checkout_started`; OTA-frozen (COMMS-0051/0047) → no on-device run |
| Consumer Android | PASS (source/logic) / runtime PROBABLE | shared RN; same as iOS |
| Buyer/anon Web | N/A | native facade is a web no-op; web analytics owned by `webAnalytics.web.ts` (untouched); no `.web.ts` in diff |
| Business iOS | PASS (source/logic) / runtime PROBABLE | cold+warm `app_opened` + event/trip/experience `checkout_started`; OTA-frozen (COMMS-0052) |
| Business Android | PASS (source/logic) / runtime PROBABLE | shared RN; same as iOS |
| Admin Web (adjacent) | N/A | different codebase; untouched |
| Business Web preview (adjacent) | N/A | native postHogService no-ops on web |

**Physical iPhone HITL:** NOT performed — both apps are OTA-frozen pending native
builds, so the events are not in any installable binary; a device run would test
stale code. BLOCKED on the COMMS-0052/0051/0047 native builds. Operator unblock:
once the paired business+consumer native builds ship, re-run device smoke to
observe `app_opened` (cold + bg→active) and `checkout_started` landing in the
PostHog project. No tester-resolvable path exists today.

**Live deploy state:** no edge functions / migrations in this ORCH (read-only
confirmed: diff has no `supabase/` files).

---

## 8. Findings

### P3-1 — checkout_started double-tap micro-race (PRE-EXISTING, not a regression)
- **Evidence:** `checkout/[eventId]/payment.tsx:339-354` — the `if (processing) return`
  guard reads a React state value; `setProcessing(true)` is async, so two taps
  dispatched in the SAME event-loop tick (before the re-render commits
  `processing=true`) could both pass the guard and both fire `checkout_started`.
  Identical for consumer `checkoutInFlight`.
- **Impact:** at most a duplicate `checkout_started` on a genuine rapid double-tap;
  analytics-only, never a double charge (the server checkout is idempotent at a
  separate layer). The EXISTING `mixpanelService.track("ticket_checkout_pay_started")`
  already lives behind the exact same guard and shares this characteristic —
  `checkout_started` merely inherits it. NOT introduced by ORCH-1192.
- **Required fix (optional, future):** if dashboards show inflated starts, gate
  with a `useRef` flag flipped synchronously before the capture. Out of scope here.
- **Retest:** dedupe by `distinct_id + event_id` at the dashboard, or add the ref guard.

### P4-1 — implementor behavioral test asserts a reimplemented copy, not real source
- The implementor's `makeHandler` mirrors the guard but is not the real handler,
  so a logic-ordering bug in the REAL `_layout.tsx` handler would not trip it
  (only deletion trips the static-grep). Mitigated: my adversarial test routes
  through the real facade, and the static gate + regex catch deletion. Noted for
  pattern awareness, not a defect.

### P4-2 — clean add-alongside (praise)
- AppsFlyer + Mixpanel cold/warm events preserved verbatim at every site;
  PostHog captures sit strictly alongside. `value` correctly omitted (not faked)
  when the server all-in preview is unresolved (Constitution #9). Single-owner
  facade reuse, no new infra. Exemplary scope discipline.

---

## 9. Gate + typecheck results

- `orch-1192-app-events-wired.mjs`: **PASS** (EXIT 0).
- All 8 `i-proposed-1187-*` gates: **PASS**.
- Business `tsc --noEmit`: zero errors in any touched source file or the new test.
- Consumer `tsc --noEmit`: zero errors in `index.tsx` / `useForegroundRefresh.ts` /
  `ConsumerEventDetailScreen.tsx`.
- Full posthog jest suite (4 suites): **24/24 PASS** (1187 happy + 1187 adversarial
  + 1192 implementor 11 + 1192 tester adversarial 6).
- `git diff --name-only origin/main`: native src + tests + gate + workflow +
  report ONLY — **no web**.
- **Build gates (expo export):** PENDING CI — `app-mobile` lacks jest/native deps
  in this worktree's node_modules (COMMS-0052/0051 native-dep freeze). Marked
  PENDING, not passed on source alone.

---

## 10. Discoveries for Orchestrator

- The implementor's resume-guard behavioral test (P4-1) tests a private copy of
  the handler logic rather than the real source. Acceptable given the static gate
  + my real-facade adversarial test, but a future pattern note: behavioral tests
  of RN lifecycle handlers should drive the real facade where the heavy native
  import can be mocked (as the 1187 facade tests do).
- Runtime emission across BOTH apps is the only open verification, blocked solely
  by the COMMS-0052/0051/0047 native-build freeze — not by anything in this ORCH.
  These events should be on the device-smoke checklist for the next paired native
  builds.
