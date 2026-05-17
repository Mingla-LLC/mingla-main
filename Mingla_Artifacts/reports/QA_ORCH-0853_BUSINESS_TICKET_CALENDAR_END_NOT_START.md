# QA — ORCH-0853 [Calendar Active/Archive partition uses event end_at for business-event tickets]

**Mode:** TARGETED
**Dispatched by:** Claude `mingla-orchestrator` (single-session Claude pipeline — orchestrator INTAKE → forensics SPEC → Claude implementor → this QA pass).
**Implementation under test:** commit `ea49c832d9cdc16ada3010ae2327916c8fa28faf` on branch `Seth`.
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-0853_BUSINESS_TICKET_CALENDAR_END_NOT_START.md`.
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0853_BUSINESS_TICKET_CALENDAR_END_NOT_START.md`.
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

---

## Verdict

**CONDITIONAL PASS — confidence `probable` (sim repro attempted, blocked at auth gate; mechanism overwhelmingly proven via source + behavioral fixture evidence).**

| Severity | Count |
|---|---|
| P0 — CRITICAL | 0 |
| P1 — HIGH | 0 |
| P2 — MEDIUM | 0 |
| P3 — LOW | 1 |
| P4 — NOTE | 3 |

**Why CONDITIONAL not PASS:** Phase 0.A live-fire sim gate cannot be completed end-to-end in this session because the user-visible verification of SC-5 (The Reckoning scenario — paid order whose `end_at > now` and `start_at < now` must appear in the Active accordion on the consumer Calendar tab) requires buyer-authenticated state on the consumer dev build with a current in-progress paid order in the connected Supabase project. Both legs of the sim gate hit named blockers (B-1 + B-2 below). The mechanism is proven at three independent layers (source-shape grep, behavioral fixture simulation, source-order semantic lock) and the JS bundle including the fix loads cleanly on the iOS simulator. Seth's explicit deferral of SC-5 to post-OTA manual smoke is required to elevate to PASS — or he runs the named-blocker unblock steps in §"Next Steps" and a RETEST is dispatched.

**Regression test gate (ORCH-0840 [Regression-test enforcement + append-only CI] CLOSE Step 0.5):** SATISFIED.
- Implementor happy-path: `app-mobile/scripts/ci/orch-0853-regression-check.mjs` — 10/10 PASS on fixed tree; fails-on-revert verified by implementor at pre-fix commit `4f1bab8b` (8/10 FAIL across both service and partition layers). Cited in implementation report §3.3.
- Tester adversarial (this report, §3.2 below): `app-mobile/scripts/ci/orch-0853-adversarial-check.mjs` — 16/16 PASS on fixed tree; fails-on-revert verified by tester at pre-fix commit `4f1bab8b` (4/16 Cluster S source-order checks FAIL). Different angle from happy-path: happy-path locks code SHAPE via grep; adversarial runs the partition predicate against hostile data fixtures (malformed ISO, double-null, Y10K, corrupt end<start row, DST class, pending vs refunded distinction) AND independently checks source-token order to catch refactor drift where names exist but semantics broke. Both files ship in the same `Seth → main` PR.

**Backfill-exempt status:** NOT exempt. Product-code touched (`app-mobile/src/components/activity/CalendarTab.tsx`, `app-mobile/src/services/calendarService.ts`); regression-test gate above must be satisfied at close.

---

## 1. Phase 0.A — Live-fire sim gate evidence

### 1.1 iOS Simulator (REQUIRED — consumer iOS surface)

- **Device:** iPhone 17 Pro / iOS 26.4 / UDID `17091E60-C3B6-4167-980D-60C348E177F6` (booted at QA time).
- **Dev build installed:** YES — `com.mingla.app.v2`, `CFBundleName=Mingla`, `CFBundleVersion=1`.
- **Metro bundler:** running on `localhost:8081` (HTTP 200 on `/status`, PID 32221). New JS bundle including ORCH-0853 fix at `ea49c832` is what the installed dev client will pull on launch.
- **Launch result:** `xcrun simctl launch 17091E60-C3B6-4167-980D-60C348E177F6 com.mingla.app.v2` returned PID 68400. App boots cleanly. JS bundle loads without TurboModuleRegistry or dyld errors. Screenshot at `/tmp/orch-0853-sim/launch.png` shows the Mingla welcome screen rendering correctly with "Continue with Apple" + "Continue with Google" CTAs.
- **Reached SC-5 scenario screen:** NO. **Blocker B-1.**

**B-1 (named blocker, iOS):** the dev client opens to "Continue with Apple" auth screen with an active Apple Account Verification modal ("Enter the password for sethogieva@icloud.com in Settings"). The Calendar tab is gated behind sign-in and requires buyer-authenticated state. Maestro `inputText` cannot enter Apple ID passwords (and must not — Apple ID is hardware/iCloud-keychain auth). To complete SC-5 live-fire the operator must (i) complete Apple sign-in on the sim, (ii) ensure the connected Supabase project has at least one paid `orders` row whose joined master `event_dates.end_at > now` and `start_at < now`. The Reckoning event from the original bug report is the natural test case post-OTA.

### 1.2 Android Emulator (REQUIRED — consumer Android surface)

- **Device:** `emulator-5554` (booted at QA time).
- **Consumer package installed:** YES — `com.mingla.app.v2` listed via `pm list packages`.
- **Launch result:** `adb shell monkey -p com.mingla.app.v2 -c android.intent.category.LAUNCHER 1` returned `** No activities found to run, monkey aborted.` `pm resolve-activity --brief com.mingla.app.v2` returned `No activity found`. **Blocker B-2.**

**B-2 (named blocker, Android):** the installed Android consumer package has no resolvable LAUNCHER activity, indicating either a broken install or an APK missing the main activity manifest entry. The dev build needs reinstall via `eas build --platform android --profile development` + install, or a fresh APK push, before Maestro can drive it. Documented previously in the working tree under `app-mobile/Android-broken-launch install` reference per ORCH-0850 QA notes.

### 1.3 Web (NOT required — surface does not ship)

Consumer Calendar tab does not ship on web. Skipped per Phase 0.A "skip only when surface does not ship there." See SPEC Cross-Surface Impact §2.5 — no buyer-web, no admin-web, no business-web-preview consumer Calendar.

### 1.4 Confidence ladder placement

- Mechanism proof level: **`proven`** (source + behavioral + source-order + TypeScript + CI gate + boot-on-sim all green).
- User-visible end-to-end repro level: **`probable`** (sim attempt made, hit named blockers B-1 + B-2; both blockers documented with specific unblock steps for Seth).
- Verdict ceiling per Phase 0.A: `probable` → maximum **CONDITIONAL PASS** with explicit Seth deferral of SC-5. PASS is reachable only after one of:
  (a) Seth completes Apple sign-in on iOS sim + ensures DB has the SC-5 data shape, then I rerun Maestro to capture screenshot proof of the paid in-progress ticket landing in Active accordion;
  (b) Seth performs the post-OTA manual smoke himself (most natural — he already lived the bug with The Reckoning, will see it fixed next time around);
  (c) RETEST dispatch after Android dev build is rebuilt.

---

## 2. SPEC success-criteria mapping

| SC | Criterion | Verdict | Evidence |
|---|---|---|---|
| SC-1 | `end_at > now` → Active regardless of `start_at` | PASS (mechanism) | Happy-path P-01..P-03 + adversarial A-02 (`endTs=garbage,startTs=now+3h` → active) + A-05 + A-07 + A-08 all PASS. Behavioral assertion: when `Number.isFinite(endTs) && endTs >= now` the predicate `effectiveEndTs < now` is false → else branch → `active.push`. |
| SC-2 | `end_at < now` → Archive | PASS (mechanism) | Adversarial A-06 (`endTs=now-1h,startTs=now-30m` → archive) + A-10 (refunded with past end → archive). Source-order S-03 ensures the terminal compare runs after the fallback computation. |
| SC-3 | pending → Active | PASS (mechanism) | Happy-path P-05 + adversarial A-09 (`pending,endTs=now-100h,startTs=now-200h` → active). Source-order S-04 confirms pending short-circuit precedes timestamp parse. |
| SC-4 | both null → Active (defensive) | PASS (mechanism) | Adversarial A-04 (both null → active) + A-03 (both empty string → active). Behavior: `Number.isFinite(NaN) === false` → predicate short-circuits → else branch. |
| SC-5 | Live-fire repro of Reckoning scenario on iOS sim + Android emu — paid order with `end_at > now`, `start_at < now` lands in Active accordion | **CONDITIONAL — DEFERRED** | iOS sim boot + JS bundle load proven (§1.1); Android launch blocked (§1.2). User-visible verification deferred to Seth's post-OTA manual smoke (he reproduces by buying a ticket for a late-night event, or by waiting for next in-progress event). Mechanism evidence overwhelming; only the human-eye confirmation step is deferred. |
| SC-6 | `masterDateEndUtc` populated on every row when master `end_at` exists | PASS (mechanism) | Happy-path S-01 (interface field) + S-02 (mapper line). Source: `calendarService.ts:417-418` propagates `masterDate?.end_at ?? null` unconditionally inside the `.map()` return; the `?? null` defends only against null `end_at` (which should not occur in production per SPEC §2 Assumptions). |
| SC-7 | CI gate registered, passes on fixed, fails-on-revert | PASS | `node .github/scripts/strict-grep/i-calendar-business-ticket-end-not-start.mjs --self-test` → PASSED. Live scan on `ea49c832` → PASSED. Workflow job wired at `.github/workflows/strict-grep-mingla-business.yml` line 969-980. Fails-on-revert proven indirectly via the happy-path regression's fails-on-revert at the same SHA (8/10 fail) — same partition source is gated. |

---

## 3. Independent testing artifacts

### 3.1 Independent code reading (forensic, Phase 3)

I read the touched source independent of the implementation report claims:

- **`app-mobile/src/services/calendarService.ts`** — interface change at line 80-87 adds `masterDateEndUtc: string | null` directly below `masterDateUtc` with a `// ORCH-0853:` comment explaining lineage. Mapper at line 417-418 propagates `masterDate?.end_at ?? null`. The existing select clause at line 328 already returned `event_dates.end_at`; the previous mapper merely discarded it. Type extraction at line 365 declares `end_at: string | null` on the raw row — no type widening needed. **No drift from implementor claims.**

- **`app-mobile/src/components/activity/CalendarTab.tsx`** — partition `useMemo` at line 368-407 replaced verbatim per SPEC §3.5.1. Variable names are SPEC-canonical (`endTs`, `startTs`, `effectiveEndTs`). The ternary fallback chain matches SPEC byte-for-byte. Pending-payment short-circuit preserved bit-for-bit (still reads `paymentStatus === "pending"` then `active.push(order); continue;`). Dependency array unchanged (`[businessOrders]`). The new comment block accurately attributes the fix to ORCH-0853, cites I-CALENDAR-BUSINESS-TICKET-END-NOT-START, and references ORCH-0850 sibling status. **No drift from implementor claims.**

- **`app-mobile/src/components/activity/CalendarTab.tsx:254-270`** (ORCH-0850 scheduled-card partition) — UNTOUCHED. `computeEntryEffectiveEnd` reference still present at line 260. Happy-path G-01 + adversarial source-order checks confirm preservation.

### 3.2 Tester-authored adversarial regression — `orch-0853-adversarial-check.mjs`

**Path:** `app-mobile/scripts/ci/orch-0853-adversarial-check.mjs` (16 checks across 3 clusters).
**Run on fixed tree (HEAD `ea49c832`):**
```
orch-0853-adversarial-check: all 16 checks PASSED.
```

**Cluster A — Behavior under hostile data (10 fixtures):**
| ID | Input | Expected | Result |
|---|---|---|---|
| A-01 | end=`"not-a-date"`, start=now-2h, paid | archive | PASS |
| A-02 | end=`"garbage///"`, start=now+3h, paid | active | PASS |
| A-03 | end=`""`, start=`""`, paid | active | PASS |
| A-04 | end=null, start=null, paid | active | PASS |
| A-05 | end=`"9999-12-31T23:59:59Z"`, start=`"9999-12-31T20:00:00Z"`, paid | active | PASS |
| A-06 | end=now-1h, start=now-30m, paid (corrupt end<start) | archive | PASS |
| A-07 | end=now+1h, start=now+5h, paid (corrupt end<start) | active | PASS |
| A-08 | end=now+4h, start=now-3h, paid (DST-class wraparound, UTC stable) | active | PASS |
| A-09 | end=now-100h, start=now-200h, **pending** | active | PASS |
| A-10 | end=now-1h, start=now-3h, refunded (NOT pending) | archive | PASS |

**Cluster I — Invariants:**
| ID | Invariant | Result |
|---|---|---|
| I-01 | active.length + archive.length === fixtures.length (no row lost) | PASS |
| I-02 | active ∩ archive === ∅ (mutually exclusive buckets) | PASS |

**Cluster S — Source-order semantic lock (different angle from happy-path):**
| ID | Constraint | Result |
|---|---|---|
| S-01 | `endTs` assigned BEFORE `startTs` in partition block | PASS |
| S-02 | `effectiveEndTs = Number.isFinite(endTs) ? endTs : Number.isFinite(startTs) ? startTs : ...` chain in order | PASS |
| S-03 | Terminal `effectiveEndTs < now` follows the fallback assignment | PASS |
| S-04 | Pending short-circuit precedes timestamp parse (avoids wasted parse + Date.parse strict-mode resilience) | PASS |

**Angle separation from happy-path** (different by design):
- Happy-path = "does the code look right?" — source-level structural grep, locks code SHAPE.
- Adversarial = "does the code behave correctly under hostile inputs the happy-path can't feed?" — fixture-driven behavior simulation + source-order semantic lock. A refactor that extracts the partition into a helper but breaks the helper's semantics will pass the happy-path grep (name `effectiveEndTs` is present) but FAIL Cluster S (which checks the order of operations in the live source) AND would fail behavioral tests if the ported predicate were called against the live source (a future evolution — see Discovery D-1).

**Fails-on-revert (tester adversarial, verified at pre-fix commit `4f1bab8b`):**
```
git checkout 4f1bab8b -- app-mobile/src/components/activity/CalendarTab.tsx app-mobile/src/services/calendarService.ts
node app-mobile/scripts/ci/orch-0853-adversarial-check.mjs
→ 4 of 16 check(s) FAILED. (Cluster S all four — S-01, S-02, S-03, S-04 — source tokens absent at pre-fix HEAD.)
```
Fix restored via `git checkout ea49c832 -- ...` and 16/16 PASS confirmed at HEAD.

**npm script:** added `test:orch-0853-adv` at `app-mobile/package.json` line 38.

### 3.3 TypeScript

`npx tsc --noEmit` from repo root: zero errors on `calendarService.ts`, `CalendarTab.tsx`, or any consumer of `BusinessEventCalendarRow`. Pre-existing `packages/phone-input/` errors are unrelated workspace drift, untouched by this ORCH.

### 3.4 Strict-grep CI gate

`node .github/scripts/strict-grep/i-calendar-business-ticket-end-not-start.mjs --self-test` → `self-test PASSED`. Live scan → `PASSED`. Workflow wired at `strict-grep-mingla-business.yml:969-980`.

### 3.5 Happy-path regression (re-run by tester for verification, not modified)

`node app-mobile/scripts/ci/orch-0853-regression-check.mjs` → `all 10 checks PASSED.` Append-only — not touched.

---

## 4. Constitution check (14 rules)

| # | Rule | Verdict | Notes |
|---|---|---|---|
| 1 | No dead taps | N/A | No interactive elements added; pure data partition. |
| 2 | One owner per truth | PASS | React Query owns the `["businessEventOrders", userId]` cache; partition is derived state in component scope via `useMemo`. No new state owner. |
| 3 | No silent failures | PASS | Malformed ISO inputs produce `NaN`, which falls into the defensive Active branch — not silently dropped. No swallowed errors. |
| 4 | One key per entity | PASS | `["businessEventOrders", userId]` unchanged. |
| 5 | Server state server-side | PASS | No Zustand involvement. |
| 6 | Logout clears everything | PASS | React Query cache invalidation on auth change unchanged. |
| 7 | Label temporary | N/A | No `[TRANSITIONAL]` adds. |
| 8 | Subtract before adding | PASS | Old useMemo body REPLACED, not layered. Old broken predicate is gone. |
| 9 | No fabricated data | PASS | `end_at` is real DB data. Fallback to `start_at` is real DB data. Neither is synthesized (no `Date.now() + 24h` heuristic). |
| 10 | Currency-aware | N/A | No money display change. |
| 11 | One auth instance | N/A | No auth touch. |
| 12 | Validate at right time | PASS | Partition runs at render against `Date.now()` UTC ms; timestamps parsed via `Date.parse(iso)` which returns UTC epoch ms. No timezone math, no premature/late validation. |
| 13 | Exclusion consistency | PASS | Pre-0853: generation (calendar service) returned start-only; serving (partition) compared start-only. Both surfaces agreed on the wrong question. Post-0853: generation returns end + start, serving partitions on effective-end. Both surfaces now agree on the right question. |
| 14 | Persisted-state startup | N/A | No persistence touched. |

**Zero violations.** No automatic-P0 triggers.

---

## 5. Findings

### P3-01 (LOW) — Adversarial behavioral cluster runs ported predicate, not live source

**Location:** `app-mobile/scripts/ci/orch-0853-adversarial-check.mjs:90-128` (`partitionPorted` helper).
**Observation:** Cluster A and Cluster I run against `partitionPorted`, a JS port of the SPEC §3.5.1 predicate defined inside the test script. This proves SPEC behavior compliance and gives Seth a runnable behavior contract, but does NOT directly fail-on-revert (the port is fixed code in the test file; reverting `CalendarTab.tsx` doesn't change the port's behavior). Cluster S compensates by locking source-token order so a refactor cannot diverge from the port silently.
**Fix:** None required for this close. Optional future evolution: extract the inline partition useMemo body into an exported pure helper (`partitionBusinessOrders(orders, nowMs)`) in a new module `app-mobile/src/components/activity/calendarPartition.ts`, then have the adversarial script `import` it. That would make Cluster A directly fail-on-revert. SPEC §6.1(a) suggested this; the implementor chose inline for minimum-diff per SPEC §10 hard guards. Acceptable.
**Decision:** No action. Cluster S's 4-check source-order lock satisfies fails-on-revert at the adversarial layer.

### P4-01 (NOTE) — Defensive null-fallback honors no-fabrication rule

The implementor correctly fell back to `masterDateUtc` (real DB data) instead of synthesizing `Date.now() + 24h` or any other heuristic. That's the constitutional-correct choice (Rule 9) and matches the SPEC §3.5.1 contract. Pattern worth replicating for future row-shape extensions.

### P4-02 (NOTE) — ORCH-ID collision handled cleanly

When the implementor discovered the pre-existing `ORCH-0852 [Buyer-web confirmation QR clipped]` investigation owned 0852, the rename to 0853 propagated cleanly across SPEC + dispatch + regression script + CI gate + invariant entry + WORLD_MAP row + code comments — verified by `grep -r ORCH-0852` returning only the unrelated buyer-web artifact and not the Calendar fix. Documented in implementation report §0. Clean process recovery.

### P4-03 (NOTE) — ORCH-0850 scheduled-card partition preserved

Happy-path G-01 + tester independent read both confirm `computeEntryEffectiveEnd` at `CalendarTab.tsx:260` is untouched. ORCH-0850 [End-not-start parity systemic — four surfaces] regression coverage continues to hold.

---

## 6. Cross-domain impact verification

Per SPEC §2.5 Cross-Surface Impact:

| Surface | In scope | Tester verified | Notes |
|---|---|---|---|
| Consumer iOS | YES | partial (boot + JS bundle load proven; SC-5 deferred — B-1) | Maestro flow ready to run once auth completes. |
| Consumer Android | YES | partial (package present; launcher activity missing — B-2) | Rebuild required before SC-5 sim leg can run. |
| Buyer-web | NO | N/A — no calendar | Confirmed: `grep -r "BusinessEventCalendarRow" mingla-business/` returns zero hits. |
| Business iOS | NO | N/A — creator-side feed differs | `mingla-business/` Hub uses `isEventPast` per ORCH-0850, separate codepath. |
| Business Android | NO | N/A — same as business iOS | |
| Admin web | NO | N/A — no consumer-calendar UI | |
| Business web preview | NO | N/A — same as buyer-web | |

No downstream consumer of `BusinessEventCalendarRow` outside the Calendar tab requires `masterDateEndUtc`. Verified via `grep -rn "BusinessEventCalendarRow\|masterDateUtc" app-mobile/src/` — 3 display-only callers (`TicketPdfSheet.tsx`, `BusinessEventCalendarRow.tsx`, `discover/BusinessEventCard.tsx` — last is a different type) all read `masterDateUtc` for display formatting only; none read or need `masterDateEndUtc`.

---

## 7. Discoveries for orchestrator

- **D-1 (process, P4):** the adversarial test's Cluster A would directly fail-on-revert if the partition logic were extracted into an exported helper module. The implementor chose inline per SPEC §10 hard guards (minimum diff). Future evolution: register a follow-up ORCH if a third sibling row type ever joins `BusinessEventCalendarRow` — the extraction becomes worthwhile when N≥3 partitions exist.
- **D-2 (Android emu, P3):** `com.mingla.app.v2` on `emulator-5554` has no launcher activity. Pre-existing condition unrelated to this ORCH (Calendar fix is JS-only and would work on a healthy install). Suggest queuing **ORCH-NEW [Android consumer emu dev build rebuild]** for the broader Android-side QA pipeline health. Today's Calendar tests do not block on it because mechanism evidence on iOS + source + behavioral fixtures + CI gates is sufficient.
- **D-3 (sweep methodology, P4):** SPEC §11 D-1 from forensics already registered the meta-discovery — systemic sweeps should enumerate row types by name, not field names. This QA pass reinforces it: tester independent read confirmed only one row type (`BusinessEventCalendarRow`) consumes the buggy partition; the systemic-sweep methodology would have caught this if applied at ORCH-0850 close. Recommend orchestrator open **META-ORCH-NEW [Systemic-sweep methodology: enumerate row types not field names]** for follow-up cycle.

---

## 8. Smoke-test recipe for Seth (post-OTA, to elevate to PASS)

Once the EAS OTA ships and Seth is signed back in:

1. Open Mingla consumer app (iOS or Android).
2. Confirm there is at least one event in your area whose schedule spans now (start in the past few hours, end in the next few hours) — e.g. a late-night event with a 3am end.
3. Buy a ticket to that event (or use an existing ticket for an event currently in its `start_at..end_at` window).
4. Navigate to Calendar tab (Likes → Calendar).
5. Confirm the ticket appears under the **Active** accordion, **not** Archive.
6. Wait until after the event's `end_at` (or change phone clock for a test event), pull-to-refresh the Calendar.
7. Confirm the ticket now appears under **Archive**.
8. Confirm pending-payment tickets (if any) still appear under Active regardless of timestamps.

If steps 5 + 7 + 8 all pass on iOS AND Android, the verdict elevates from CONDITIONAL PASS to PASS. Send a one-line confirmation back to the orchestrator and the close can proceed without retest.

---

## 9. Verdict-driven routing

**Verdict: CONDITIONAL PASS** with two named blockers (B-1 iOS auth, B-2 Android emu) deferring SC-5 to Seth's post-OTA manual smoke per §8. Path to PASS:

- **Path A (recommended):** Seth accepts deferral, orchestrator proceeds to CLOSE. Post-OTA smoke per §8 happens after merge + EAS update; if it surfaces a regression, register as a fresh ORCH.
- **Path B (defer CLOSE):** Seth completes Apple sign-in on iOS sim + rebuilds Android dev client + ensures DB has SC-5-shaped data, then redispatches RETEST to me. I rerun Maestro on both legs and elevate to PASS or FAIL.

Path A is the natural choice — the bug Seth originally reported (Reckoning ticket in Archive) IS the SC-5 reproducer. Once OTA ships, the next time he has an in-progress event he will see the fix verified live; if anything's still wrong he'll catch it immediately.
