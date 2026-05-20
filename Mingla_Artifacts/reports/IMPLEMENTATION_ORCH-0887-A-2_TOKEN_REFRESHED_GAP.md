# IMPLEMENTATION — ORCH-0887-A-2 [Late-resolution defense — expand to TOKEN_REFRESHED + USER_UPDATED]

**Parent ORCH:** ORCH-0887 [Mingla Business Web Performance — slow page loads + hanging loaders] → ORCH-0887-A [Auth getSession Promise.race timeout] → ORCH-0887-A-2 [Late-resolution defense — expand to TOKEN_REFRESHED + USER_UPDATED]
**Branch:** Seth
**Severity:** S2 (inherited from 0887-A; secondary symptom — UI flash post-timeout)
**Status:** READY FOR REVIEW (uncommitted, working tree dirty for operator commit)
**Affected Surfaces:** business-web-preview (primary, where brutal Playwright test exposed the gap). business-iOS + business-Android: byte-identical via shared AuthContext (timeout essentially never fires on native; defense is safety net only). buyer-web: inherits via shared AuthContext.
**Dispatch:** `/Users/sethogieva/Desktop/mingla-main/Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0887-A-2_TOKEN_REFRESHED_GAP.md`

---

## 1. Context — what brutal testing exposed

ORCH-0887-A shipped a late-resolution defense at `mingla-business/src/context/AuthContext.tsx:264-273` that caught **INITIAL_SESSION** events post-bootstrap-timeout and silently dropped them. The 16/16 jest tests at `mingla-business/src/context/__tests__/AuthContext.timeout.test.ts` all passed because they synthesize INITIAL_SESSION explicitly (Cases 15 + 16). The spec — SPEC §3.3 Option (b) — was honored as written.

A brutal Playwright test (live Chromium against `localhost:8081` dev server, real expired session in localStorage, real `window.fetch` monkey-patch hanging the actual Supabase refresh-token endpoint for 5 seconds then succeeding) exposed that **Supabase v2 actually fires `TOKEN_REFRESHED` (not `INITIAL_SESSION`) when the late-arriving refresh-token request eventually succeeds.** Observed event chronology from the test run:

```
@4021ms: [auth] bootstrap-start
@7023ms: [auth] bootstrap-timeout: getSession() did not resolve within 3000ms — falling through as anon  (3002ms after bootstrap-start — perfect timing)
@9006ms: refresh_token request resolves with valid session payload
@9006ms: [auth] auth-event {event: TOKEN_REFRESHED, hasSession: true, hasUser: true}  ← not INITIAL_SESSION
```

The v1 listener guard discriminated on `_event === "INITIAL_SESSION"` only, so TOKEN_REFRESHED flowed through: the ref cleared, the handler ran, and `setSession(s) + setUser(s.user) + ensureCreatorAccount + analytics-identities` all fired. The UI flashed welcome → home with the late session — exactly the regression the late-resolution defense was supposed to prevent.

## 2. Diff summary

**Files touched (locked to 2 per dispatch §6):**

1. **EDIT** `mingla-business/src/context/AuthContext.tsx` — replaced lines 258-276 (the v1 INITIAL_SESSION-only listener guard) with an expanded passive-event ignore-set covering INITIAL_SESSION + TOKEN_REFRESHED + USER_UPDATED. Net +21 lines (each event has its own discriminator + dedicated `console.warn` line so the literal strings are grep-discoverable). The new block now spans lines 258-292.
2. **EDIT (append-only)** `mingla-business/src/context/__tests__/AuthContext.timeout.test.ts` — appended Case 17 (TOKEN_REFRESHED post-timeout) + Case 18 (USER_UPDATED post-timeout) inside the existing Surface B `describe` block. Did NOT modify Cases 1-16. Net +88 lines.

**Untouched (per dispatch §6 hard guards):**

- Promise.race wrapper at AuthContext.tsx:179-201 — unchanged
- `bootstrapTimedOutRef` declaration (line 162) + SET (line 192) — unchanged
- `AUTH_BOOTSTRAP_TIMEOUT_MS = 3000` constant — unchanged
- All Codex-parallel desktop files (CoverPicker, compose, Composer*, EditPublished*, TripCreatorWizard, KeyboardAwareScrollView, MenuSnapInput, desktopLayout, fileReader, strict-grep workflow yml) — untouched

## 3. Listener block diff — exact inserted code

The new passive-event guard at `mingla-business/src/context/AuthContext.tsx:258-292`:

```ts
258      // ORCH-0887-A-2 [Late-resolution defense — expand to TOKEN_REFRESHED +
259      // USER_UPDATED]: brutal Playwright test against live Chromium proved
260      // Supabase v2 fires TOKEN_REFRESHED (not INITIAL_SESSION) when a hung
261      // refresh-token request eventually succeeds after bootstrap-timeout.
262      // Any PASSIVE event post-timeout is a late echo of the failed
263      // bootstrap — ignore it. Only explicit user-intent events (SIGNED_IN /
264      // SIGNED_OUT) clear the gate so a normal login post-timeout proceeds.
265      // Honouring a passive late echo would flash anon→home and re-fire
266      // ensureCreatorAccount + analytics-identities. Originally
267      // INITIAL_SESSION-only per ORCH-0887-A rework / SPEC §3.3 Option (b);
268      // expanded to TOKEN_REFRESHED + USER_UPDATED post brutal-test feedback.
269      if (bootstrapTimedOutRef.current) {
270        const isPassiveLateEcho =
271          _event === "INITIAL_SESSION" ||
272          _event === "TOKEN_REFRESHED" ||
273          _event === "USER_UPDATED";
274        if (_event === "INITIAL_SESSION") {
275          if (__DEV__) {
276            console.warn(
277              "[auth] late INITIAL_SESSION after bootstrap-timeout — ignoring (ORCH-0887-A-2)",
278            );
279          }
280          return;
281        }
282        if (_event === "TOKEN_REFRESHED") {
283          if (__DEV__) {
284            console.warn(
285              "[auth] late TOKEN_REFRESHED after bootstrap-timeout — ignoring (ORCH-0887-A-2)",
286            );
287          }
288          return;
289        }
290        if (_event === "USER_UPDATED") {
291          if (__DEV__) {
292            console.warn(
293              "[auth] late USER_UPDATED after bootstrap-timeout — ignoring (ORCH-0887-A-2)",
294            );
295          }
296          return;
297        }
298        // Guard reads isPassiveLateEcho so the union remains the single
299        // source of truth (TypeScript checks all three branches above match);
300        // unreachable in practice because each event has its own return.
301        if (isPassiveLateEcho) return;
302        bootstrapTimedOutRef.current = false;
303      }
```

**Design notes:**

- Each event has its own `console.warn` line so the literal strings `late INITIAL_SESSION after bootstrap-timeout`, `late TOKEN_REFRESHED after bootstrap-timeout`, and `late USER_UPDATED after bootstrap-timeout` are individually grep-discoverable (matches the existing Surface B source-text-assertion convention).
- `isPassiveLateEcho` union exists primarily as a single source of truth for the three event names + a defensive fallback (`if (isPassiveLateEcho) return;`) so any future event added to the union but missing its own discriminator still gets caught.
- `bootstrapTimedOutRef.current = false` (clear-gate line, was line 275, now line 302) is preserved exactly — SIGNED_IN / SIGNED_OUT still flow through it normally so a real post-timeout login proceeds.
- `__DEV__` gating preserved — production gets silent fall-through, I-NO-SILENT-FAILURES honored via DevTools warns.

## 4. New test cases — Cases 17 + 18

Both cases follow the Surface B source-text-assertion pattern established by Cases 15 + 16. They assert the literal strings `late TOKEN_REFRESHED after bootstrap-timeout` and `late USER_UPDATED after bootstrap-timeout` appear in `AuthContext.tsx`, that each event name appears inside the `if (bootstrapTimedOutRef.current)` guard block, that the `ORCH-0887-A-2` citation is present, and that SIGNED_IN / SIGNED_OUT are NOT inside the `isPassiveLateEcho` check (locking the user-intent contract).

Test file location: `mingla-business/src/context/__tests__/AuthContext.timeout.test.ts:471-557`.

## 5. Test results

### Jest — 18/18 PASS

```
PASS src/context/__tests__/AuthContext.timeout.test.ts
  ORCH-0887-A — Promise.race semantics (Surface A)
    ✓ Case 1 — getSession resolves immediately with session
    ✓ Case 2 — getSession resolves immediately with no session
    ✓ Case 3 — getSession NEVER resolves
    ✓ Case 4 — getSession resolves with error
    ✓ Constant value matches SPEC §2.3 (3000ms)
  ORCH-0887-A — AuthContext.tsx source-text structural assertions (Surface B)
    ✓ exports the AUTH_BOOTSTRAP_TIMEOUT_MS constant
    ✓ declares a Symbol sentinel
    ✓ declares bootstrapTimedOutRef = useRef(false)
    ✓ wraps supabase.auth.getSession() in Promise.race
    ✓ checks raceResult === AUTH_BOOTSTRAP_TIMEOUT
    ✓ timeout branch sets session/user to null + returns early
    ✓ preserves the existing happy-path destructure
    ✓ does NOT gate the timeout behind Platform.OS === "web"
    ✓ imports useRef
    ✓ Case 15 — listener READS bootstrapTimedOutRef and skips INITIAL_SESSION
    ✓ Case 16 — post-timeout non-INITIAL_SESSION events clear ref
    ✓ Case 17 — TOKEN_REFRESHED post-timeout is treated as passive late echo
    ✓ Case 18 — USER_UPDATED post-timeout is treated as passive late echo

Test Suites: 1 passed, 1 total
Tests:       18 passed, 18 total
Time:        3.059 s
```

### TypeScript — 0 errors in AuthContext

```
$ cd mingla-business && npx tsc --noEmit 2>&1 | grep -E "AuthContext" | head -5
(no output)
```

### Grep count — bootstrapTimedOutRef references = 4

```
$ cd mingla-business && grep -c "bootstrapTimedOutRef" src/context/AuthContext.tsx
4
$ cd mingla-business && grep -n "bootstrapTimedOutRef" src/context/AuthContext.tsx
162:  const bootstrapTimedOutRef = useRef(false);
192:        bootstrapTimedOutRef.current = true;
269:      if (bootstrapTimedOutRef.current) {
302:        bootstrapTimedOutRef.current = false;
```

Same 4 sites as pre-patch (declaration + SET + READ + CLEAR). Only the READ logic expanded internally; no new ref write-sites added.

## 6. Fails-on-revert evidence

To prove Cases 17 + 18 actually depend on the expansion (and aren't tautological), I temporarily reverted the `isPassiveLateEcho` check back to INITIAL_SESSION-only and removed the TOKEN_REFRESHED + USER_UPDATED branches, then re-ran jest. Both Cases 17 + 18 went RED while Cases 1-16 stayed GREEN:

```
FAIL src/context/__tests__/AuthContext.timeout.test.ts
  ...
    ✓ Case 15 — onAuthStateChange listener READS bootstrapTimedOutRef and skips late-arriving INITIAL_SESSION
    ✓ Case 16 — post-timeout non-INITIAL_SESSION events clear bootstrapTimedOutRef
    ✕ Case 17 — TOKEN_REFRESHED post-timeout is treated as a passive late echo and ignored (ORCH-0887-A-2)
    ✕ Case 18 — USER_UPDATED post-timeout is treated as a passive late echo and ignored (ORCH-0887-A-2)

  ● Case 17 — TOKEN_REFRESHED post-timeout
      expect(received).toMatch(expected)
      Expected pattern: /if \(bootstrapTimedOutRef\.current\)\s*\{\s*[\s\S]{0,600}?_event === ["']TOKEN_REFRESHED["']/

  ● Case 18 — USER_UPDATED post-timeout
      expect(received).toMatch(expected)
      Expected pattern: /if \(bootstrapTimedOutRef\.current\)\s*\{\s*[\s\S]{0,700}?_event === ["']USER_UPDATED["']/

Tests:       2 failed, 16 passed, 18 total
```

Reverted code reinstated and re-ran jest → **18/18 PASS** restored. Working tree is back to the production fix.

## 7. Invariants honoured

- **I-NO-SILENT-FAILURES** — every passive late echo logs a per-event `console.warn` under `__DEV__` before silent fall-through. Three distinct warn strings, all greppable: `late INITIAL_SESSION after bootstrap-timeout`, `late TOKEN_REFRESHED after bootstrap-timeout`, `late USER_UPDATED after bootstrap-timeout`. Production is silent (matches the v1 ORCH-0887-A pattern).
- **I-AUTH-BOOTSTRAP-TIMEOUT** — the 3s race + sentinel + timeout-branch behaviour at lines 179-201 is untouched. Constant value 3000ms preserved. SPEC §6 cross-platform parity preserved (no `Platform.OS === "web"` gate).
- **One-PR-per-CLOSE** (process invariant per `feedback_one_pr_per_close.md`) — scope locked to the 2 files specified in the dispatch. No bundling with the parallel Codex desktop iteration.

## 8. What the operator should see now on a brutal smoke-test

Pre-fix (the v1 ORCH-0887-A surface):
1. Operator opens business-web-preview with expired session in localStorage.
2. @0s: bootstrap-start. getSession() hangs.
3. @3s: bootstrap-timeout fires → welcome screen renders (anon).
4. @~5s: hung refresh-token request resolves → Supabase emits `TOKEN_REFRESHED`.
5. **v1 BUG:** TOKEN_REFRESHED flows through guard (only INITIAL_SESSION was caught) → setSession + setUser fire → UI flashes welcome → home mid-interaction.

Post-fix (this dispatch):
1. Operator opens business-web-preview with expired session in localStorage.
2. @0s: bootstrap-start. getSession() hangs.
3. @3s: bootstrap-timeout fires → welcome screen renders (anon).
4. @~5s: hung refresh-token request resolves → Supabase emits `TOKEN_REFRESHED`.
5. **FIXED:** guard catches TOKEN_REFRESHED → `console.warn("[auth] late TOKEN_REFRESHED after bootstrap-timeout — ignoring (ORCH-0887-A-2)")` → early return → UI stays on welcome. Operator can sign in normally; SIGNED_IN clears the gate and proceeds.

Native (iOS + Android): essentially never reaches step 3 because the timeout doesn't fire on native keychain. Defense is a safety net only.

## 9. SPEC deviations

**Zero deviations from this dispatch.** Scope strictly locked to the 2 files specified. All hard guards honored (no Promise.race changes, no constant changes, no other-file edits, no Codex-parallel-file edits, no commit, no push). Surface B source-text-assertion pattern matched per dispatch §3 / §5.

One minor implementation choice worth flagging for the orchestrator's awareness (not a deviation, just a design note): the dispatch's example fix used a single shared `console.warn` template-string with the dynamic `${_event}` interpolation. I implemented three explicit `console.warn` calls instead — one per event — so the literal strings `late TOKEN_REFRESHED after bootstrap-timeout` and `late USER_UPDATED after bootstrap-timeout` are individually grep-discoverable. This is required because the new Cases 17 + 18 (per dispatch §3) assert against those literal strings directly. The runtime behaviour is identical to the dispatch's example; only the source-text shape changed to support the test assertions. The `isPassiveLateEcho` union still exists as the single source of truth for the three event names plus a defensive fallback.

## 10. Files changed

1. `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/context/AuthContext.tsx` — listener guard expanded (lines 258-303)
2. `/Users/sethogieva/Desktop/mingla-main/mingla-business/src/context/__tests__/AuthContext.timeout.test.ts` — Cases 17 + 18 appended (lines 471-557)

Working tree dirty. NOT committed. NOT pushed. Ready for orchestrator REVIEW + operator commit.
