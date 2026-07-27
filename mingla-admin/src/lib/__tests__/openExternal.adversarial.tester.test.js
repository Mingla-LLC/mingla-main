/**
 * ISSUE-903 [window.open one-owner hardening] — TESTER adversarial regression
 * suite for the mingla-admin openExternal owner.
 *
 * DIFFERENT ANGLE from the implementor's happy-path (openExternal.test.js, which
 * proved bare-open + fallback + call-site routing). This suite attacks the
 * SECURITY / ROBUSTNESS invariants that survive a plausible future refactor:
 *
 *   (a) OPENER-SEVERANCE (the security guarantee that REPLACED `noopener`).
 *       A setter-spy opener proves `win.opener` is actually ASSIGNED null on the
 *       success path — not merely observed null. If a future edit drops the
 *       `win.opener = null` line, the setter never fires and this test FAILS.
 *       Also asserts NO open() call ever carries a noopener/noreferrer feature
 *       string (that is what makes open() return null-on-success — the ORCH-1381
 *       trap).
 *   (b) SSR / undefined-window safety, proven on TWO paths the implementor did
 *       not both cover: the explicit `openExternal(dest, undefined)` no-op AND
 *       the DEFAULT-PARAMETER path `openExternal(dest)` under a real
 *       window-less (node) runtime — the `typeof window === "undefined"` guard
 *       itself. Neither may throw, open, or assign.
 *   (c) NO DOUBLE-NAVIGATION on the success path. When open() returns a truthy
 *       window, location.assign must be UNREACHABLE. This is enforced with a
 *       location.assign that THROWS if invoked, so an unconditional/extra assign
 *       (the exact ORCH-1381 bug) blows the test up rather than passing silently.
 *
 * Append-only: this file adds NEW coverage; it does not modify or weaken the
 * implementor's openExternal.test.js.
 *
 * Fails-on-revert (tester's angle): deleting `win.opener = null` breaks (a);
 * re-adding a noopener/noreferrer feature string breaks (a); making
 * location.assign unconditional breaks (c); removing the SSR guard breaks (b).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openExternal } from "../openExternal.js";

const NOOPENER_OR_NOREFERRER = /\bno(?:opener|referrer)\b/i;

/**
 * A fake Window whose open() returns a stub tab carrying a HIJACKABLE opener
 * reference (simulating the reverse-tabnabbing threat noopener used to mitigate).
 * The stub's `opener` is a getter/setter pair, so we can prove the owner performs
 * a real assignment to null — not just that the value happens to read null.
 */
function makeHijackableSuccessWindow() {
  const openCalls = [];
  const assignCalls = [];
  const openerAssignments = [];
  let openerValue = { hijack: "attacker-controlled origin reference" };

  const stubTab = {};
  Object.defineProperty(stubTab, "opener", {
    configurable: true,
    get() {
      return openerValue;
    },
    set(next) {
      openerValue = next;
      openerAssignments.push(next);
    },
  });

  const w = {
    open(...args) {
      openCalls.push(args);
      return stubTab;
    },
    location: {
      assign(...args) {
        assignCalls.push(args);
      },
    },
  };
  return { w, stubTab, openCalls, assignCalls, openerAssignments };
}

describe("openExternal — TESTER adversarial (mingla-admin owner)", () => {
  it("(a) severs win.opener to null via a real assignment, and never passes noopener/noreferrer", () => {
    const { w, stubTab, openCalls, openerAssignments } = makeHijackableSuccessWindow();

    // Precondition: the stub genuinely starts with a hijackable opener, so a
    // passing assertion below cannot be vacuous.
    assert.notEqual(stubTab.opener, null, "precondition: opener starts non-null (test would be vacuous otherwise)");

    openExternal("https://cv.example.com/signed?token=abc", w);

    assert.equal(openCalls.length, 1, "open() called exactly once");

    // The security-critical property: the noopener feature string is GONE, so
    // open() returns a real window even on success (no null-return trap).
    const [dest, target, ...featureArgs] = openCalls[0];
    assert.equal(dest, "https://cv.example.com/signed?token=abc");
    assert.equal(target, "_blank");
    assert.equal(featureArgs.length, 0, "open() must be BARE (no 3rd feature-string argument)");
    assert.ok(
      !NOOPENER_OR_NOREFERRER.test(openCalls[0].join(" ")),
      "no open() argument may carry noopener/noreferrer (the null-return-on-success trap)",
    );

    // The replacement security guarantee: opener is severed by ASSIGNMENT to null.
    assert.equal(openerAssignments.length, 1, "win.opener must be ASSIGNED exactly once (severance actually runs)");
    assert.strictEqual(openerAssignments[0], null, "win.opener must be assigned the value null (not undefined/falsy)");
    assert.strictEqual(stubTab.opener, null, "after openExternal, win.opener reads null — reverse-tabnabbing severed");
  });

  it("(b1) openExternal(dest, undefined) is a silent no-op — no throw, undefined return", () => {
    // Without the `if (w === undefined) return;` guard this would execute
    // `undefined.open(...)` and throw — so doesNotThrow proves neither open nor
    // assign is reached.
    let ret;
    assert.doesNotThrow(() => {
      ret = openExternal("https://example.com/ssr-explicit", undefined);
    });
    assert.equal(ret, undefined, "returns void");
  });

  it("(b2) DEFAULT-PARAMETER SSR path: openExternal(dest) is a no-op when there is no global window", () => {
    // node:test runs with no DOM — `typeof window === "undefined"` is true here,
    // so the default parameter resolves to undefined and the guard short-circuits.
    // This exercises the default-param expression itself (the implementor's T-3
    // passed `undefined` explicitly and never hit this path).
    assert.equal(typeof window, "undefined", "precondition: window-less runtime (SSR-like)");
    let ret;
    assert.doesNotThrow(() => {
      ret = openExternal("https://example.com/ssr-default");
    });
    assert.equal(ret, undefined, "returns void under the default-param SSR guard");
  });

  it("(c) success path NEVER double-navigates — location.assign is unreachable when open() succeeds", () => {
    const openCalls = [];
    const stubTab = { opener: { hijack: true } };
    const w = {
      open(...args) {
        openCalls.push(args);
        return stubTab; // truthy → success path
      },
      location: {
        assign() {
          throw new Error(
            "REGRESSION: location.assign() invoked on the SUCCESS path — this is the exact " +
              "ORCH-1381 double-navigation bug (an unconditional/extra assign).",
          );
        },
      },
    };

    assert.doesNotThrow(
      () => openExternal("https://example.com/success", w),
      "assign must not fire when open() returns a truthy window",
    );
    assert.equal(openCalls.length, 1, "open() attempted exactly once");
    assert.strictEqual(stubTab.opener, null, "opener still severed on the no-double-nav path");
  });
});
