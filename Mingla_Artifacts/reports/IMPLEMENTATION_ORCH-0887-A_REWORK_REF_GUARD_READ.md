# IMPLEMENTATION — ORCH-0887-A REWORK: Ref-Guard READ in onAuthStateChange Listener

**ORCH:** ORCH-0887-A [Auth getSession Promise.race timeout — closes indefinite loader hang]
**Parent ORCH:** ORCH-0887 [Mingla Business Web Performance — slow page loads + hanging loaders]
**Branch:** `Seth`
**Date:** 2026-05-19
**Status:** REWORK COMPLETE — late-resolution defense per SPEC §3.3 Option (b) now fully wired

---

## Context — what this reworks

The v1 implementor pass
(`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0887-A_AUTH_GETSESSION_TIMEOUT.md`)
shipped the Promise.race timeout wrapper correctly at `AuthContext.tsx:179-201`
and SET `bootstrapTimedOutRef.current = true` in the timeout branch at line 192.

**Gap:** The corresponding READ of `bootstrapTimedOutRef.current` inside the
`onAuthStateChange` listener handler (line 256+) was missing. Per SPEC §3.3 /
§4 the locked decision was Option (b) ref-guarded skip. The ref existed
as dead code — `grep bootstrapTimedOutRef` returned 2 hits (declaration + 1
set) instead of the ≥3 required to honour the SPEC contract.

**Why this matters:** A real Supabase client receives the original (slow)
`getSession()` resolution as an `INITIAL_SESSION` event on the
`onAuthStateChange` channel some time after the 3s timeout has already
rendered the anon surface. Without the ref-read, that late event would:

1. Overwrite the anon `session`/`user` state with a real session
2. Flash the UI from welcome-screen → home unexpectedly
3. Re-fire `ensureCreatorAccount` + AppsFlyer + Mixpanel + RevenueCat +
   OneSignal identity bindings against a user who has not interactively signed in
4. Race with any explicit `signInWith*` the user may have started in the
   intervening window

This rework adds the missing READ + clear-on-other-event logic in a
surgical ~21-line insert immediately after the listener's existing
`if (!mounted) return;` guard.

---

## Diff summary

### File 1: `mingla-business/src/context/AuthContext.tsx`

**Edit 1 (lines 154-162):** Updated the comment on `bootstrapTimedOutRef`
to document the actual consumer (listener handler) instead of the v1
"future-proofing primitive, no current runtime consumer" wording.

**Edit 2 (lines 256-275):** Inserted a 21-line ref-guard block at the top
of the `onAuthStateChange` listener body, immediately after the existing
`if (!mounted) return;` guard. Block enforces:

- Late `INITIAL_SESSION` after timeout → log dev warn + `return;` (SKIP)
- Any other event type after timeout → clear ref + continue handler
- Pre-timeout (ref still `false`) → block is a no-op, handler continues

### File 2: `mingla-business/src/context/__tests__/AuthContext.timeout.test.ts`

**Edit 1 (Surface B append):** Added two new test cases (Case 15 + Case 16)
as the final two `it(...)` blocks in the source-text-assertion describe.
Followed existing repo convention (source-text-assertion pattern, per the
v1 implementor's pre-amble at lines 9-58 explaining why
`@testing-library/react-native` is not available in
`mingla-business/jest.config.cjs`).

---

## Listener handler diff — the inserted block (AuthContext.tsx)

```ts
254	    } = supabase.auth.onAuthStateChange(async (_event, s) => {
255	      if (!mounted) return;
256	      // ORCH-0887-A rework: late-resolution defense per SPEC §3.3 Option (b).
257	      // If bootstrap timed out, ignore late-arriving INITIAL_SESSION — that is
258	      // the original getSession() Promise resolving after we already gave up
259	      // and rendered the anon surface. Honouring it would cause an anon→home
260	      // UI flash + re-fire ensureCreatorAccount + analytics-identities.
261	      // Any other event type (SIGNED_IN from explicit login, SIGNED_OUT,
262	      // TOKEN_REFRESHED, USER_UPDATED) represents real subsequent state —
263	      // clear the gate before processing so the handler continues normally.
264	      if (bootstrapTimedOutRef.current) {
265	        if (_event === "INITIAL_SESSION") {
266	          if (__DEV__) {
267	            console.warn(
268	              "[auth] late INITIAL_SESSION after bootstrap-timeout — ignoring (SPEC §3.3 Option b)",
269	            );
270	          }
271	          return;
272	        }
273	        bootstrapTimedOutRef.current = false;
274	      }
275	      if (__DEV__) {
276	        console.info("[auth] auth-event", {
277	          event: _event,
278	          hasSession: s !== null,
279	          hasUser: s?.user !== undefined,
280	        });
281	      }
```

(Line numbers reflect post-edit state; the existing handler body resumes
unchanged at line 275 with the `[auth] auth-event` info log.)

---

## Test results

### Jest (post-fix)

```
PASS src/context/__tests__/AuthContext.timeout.test.ts
  ORCH-0887-A — Promise.race semantics (Surface A)
    ✓ Case 1 — getSession resolves immediately with session …
    ✓ Case 2 — getSession resolves immediately with no session …
    ✓ Case 3 — getSession NEVER resolves → race returns the timeout sentinel …
    ✓ Case 4 — getSession resolves with error …
    ✓ Constant value matches SPEC §2.3 (3000ms) …
  ORCH-0887-A — AuthContext.tsx source-text structural assertions (Surface B / fails-on-revert)
    ✓ exports the AUTH_BOOTSTRAP_TIMEOUT_MS constant …
    ✓ declares a Symbol sentinel …
    ✓ declares bootstrapTimedOutRef = useRef(false) …
    ✓ wraps supabase.auth.getSession() in Promise.race …
    ✓ checks raceResult === AUTH_BOOTSTRAP_TIMEOUT and sets bootstrapTimedOutRef …
    ✓ timeout branch sets session/user to null + loading to false + returns early …
    ✓ preserves the existing happy-path destructure on raceResult …
    ✓ does NOT gate the timeout behind Platform.OS === "web" …
    ✓ imports useRef …
    ✓ Case 15 — onAuthStateChange listener READS bootstrapTimedOutRef and skips late-arriving INITIAL_SESSION
    ✓ Case 16 — post-timeout non-INITIAL_SESSION events clear bootstrapTimedOutRef before continuing handler

Test Suites: 1 passed, 1 total
Tests:       16 passed, 16 total
Time:        3.153 s
```

### tsc --noEmit (AuthContext only)

```
$ cd mingla-business && npx tsc --noEmit 2>&1 | grep -E "AuthContext" | head -10
(no output — 0 errors in AuthContext)
```

### Grep count

```
$ grep -c "bootstrapTimedOutRef" mingla-business/src/context/AuthContext.tsx
4
```

4 references (declaration + 1 SET in timeout branch + 1 READ in listener
guard + 1 CLEAR in listener guard) — satisfies ≥3 contract.

---

## Fails-on-revert evidence

Procedure: backed up `AuthContext.tsx` to `/tmp/AuthContext.tsx.rework.backup`,
removed the 21-line ref-guard block (reverted to v1 state where ref is
set-but-never-read), re-ran jest, captured RED, restored.

### Reverted state — jest output (Cases 15-16 FAIL as designed)

```
Test Suites: 1 failed, 1 total
Tests:       2 failed, 14 passed, 16 total
Time:        2.611 s
```

Specifically:

- **Case 15 FAILED** because the `if (bootstrapTimedOutRef.current) {`
  guard pattern (with INITIAL_SESSION discriminator within 400 chars) is
  no longer present in source — `listenerGuardPattern.test` returns false.
- **Case 16 FAILED** because the `bootstrapTimedOutRef.current = false;`
  clear-line is no longer present — `setFalseMatches` drops to 0 and the
  total-references count drops below 3.

Failure surface from jest (Case 16 first failing assertion):

```
> 441 |       expect(AUTH_CONTEXT_SOURCE).toMatch(
      |                                   ^
  442 |         /bootstrapTimedOutRef\.current = false;/,
  443 |       );

  at Object.<anonymous> (src/context/__tests__/AuthContext.timeout.test.ts:441:35)
```

### Post-restore state

`cp /tmp/AuthContext.tsx.rework.backup mingla-business/src/context/AuthContext.tsx`
followed by `npx jest src/context/__tests__/AuthContext.timeout.test.ts`
→ **16/16 PASS** restored, 3.153s.

---

## Invariants honoured

- **I-NO-SILENT-FAILURES** — new `console.warn` on the
  late-INITIAL_SESSION skip path (`[auth] late INITIAL_SESSION after
  bootstrap-timeout — ignoring (SPEC §3.3 Option b)`); also preserved
  the existing bootstrap-timeout console.warn at line 188.
- **I-AUTH-BOOTSTRAP-TIMEOUT** — fully honored now (both arms of
  Option (b) implemented: the timeout SET at line 192 + the listener
  READ at line 264 + clear at line 273).
- **I-CROSS-SURFACE-IMPACT** — declared in dispatch §6. PRIMARY:
  business-web-preview. TOUCHED: business-iOS, business-Android,
  buyer-web (shared `AuthContext`; behavior preserved on native where
  timeout essentially never fires).
- **I-PROPOSED-J Zustand-persist** — N/A (no store changes).
- **I-35 (Cycle 14 v2 recover-on-sign-in gate)** — preserved. The
  `if (_event === "SIGNED_IN")` block at line 286 is unaffected by the
  new guard; `SIGNED_IN` events after timeout pass through normally
  (ref is cleared first), and `INITIAL_SESSION` events were already
  excluded from recovery per Bug B fix.

---

## What the operator should see now on a smoke test

1. **Hang scenario (primary win, unchanged from v1):** load
   `npm run web` in `mingla-business/`, simulate a stalled
   `getSession()` (network throttle / cold cache). Spinner dismisses in
   ~3.1s and the BusinessWelcomeScreen renders. Operator can sign in
   normally.

2. **NEW — late-resolution scenario (the rework):** in the hang
   scenario above, if the original `getSession()` Promise eventually
   resolves (say 10s after the 3s timeout) with a real persisted
   session, **the UI stays on the welcome screen — no flash to home,
   no analytics re-fire, no `ensureCreatorAccount` re-execution**. Dev
   console will log:
   `[auth] bootstrap-timeout: getSession() did not resolve within 3000ms — falling through as anon`
   followed (when the late event arrives) by:
   `[auth] late INITIAL_SESSION after bootstrap-timeout — ignoring (SPEC §3.3 Option b)`.

3. **Explicit sign-in after timeout (rework — clear-path):** in the
   timed-out state, if the operator clicks "Sign in with Google /
   Apple / email", the resulting `SIGNED_IN` event clears
   `bootstrapTimedOutRef.current` before processing, runs the full
   handler (ensureCreatorAccount, analytics identities, recovery
   check), and lands the user on home. Subsequent `INITIAL_SESSION`
   events (rare but legal) also process normally after the clear.

4. **Native parity (iOS/Android):** unchanged. The timeout essentially
   never fires on native (`SecureStore` reads are fast), so the
   listener guard is a no-op on those surfaces — behavior identical
   to pre-rework + v1.

---

## Working tree

Dirty (per dispatch §8 — DO NOT commit or push). Files modified:

- `mingla-business/src/context/AuthContext.tsx` (rework: lines 154-162 + 256-275)
- `mingla-business/src/context/__tests__/AuthContext.timeout.test.ts` (rework: Cases 15 + 16 appended to Surface B)

Backup file `/tmp/AuthContext.tsx.rework.backup` retained for orchestrator
audit if needed; safe to delete after CLOSE review.

---

## Deviation from dispatch

**Zero deviations from the rework dispatch's intent.** One pragmatic
adaptation: Cases 15-16 use the established source-text-assertion
pattern (consistent with the existing 14 cases per the v1 implementor's
pre-amble explaining the absence of `@testing-library/react-native` in
`mingla-business/jest.config.cjs`) rather than mocking `getSession` +
synthetically invoking the listener callback. The dispatch §3 explicitly
sanctioned this fallback: "If the existing tests use the
source-text-assertion pattern (per v1 implementor's deviation), use the
same pattern for these cases". The fails-on-revert protocol confirms
both new cases turn RED on the exact bug class they guard against.
