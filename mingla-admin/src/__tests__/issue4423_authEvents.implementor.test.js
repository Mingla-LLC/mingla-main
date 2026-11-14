// Issue #4423 (W1.2, W1.3, W1.6): what AuthContext does with auth events.
//
// auth-js sends SIGNED_IN on every hidden -> visible change (and echoes it to
// every tab). Before #4423 each one re-rendered the app and re-checked access
// (2 RPCs), hidden tabs too. The decision is the pure decideAuthEvent; the
// wiring in context/AuthContext.jsx is pinned below.
//
// FAILS-ON-REVERT: put `setSession(newSession); void refreshAccess(newSession);`
// back on the same-user path (or make decideAuthEvent return "resolve" for
// the same user) and "repeated SIGNED_IN / TOKEN_REFRESHED" plus the wiring
// tests go red.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideAuthEvent, sameAccess } from "../lib/authEvents.js";

const ME = "user-1";
const visible = true;

describe("#4423 decideAuthEvent", () => {
  it("same user + SIGNED_IN: ignore", () => {
    assert.equal(decideAuthEvent({ event: "SIGNED_IN", sessionUserId: ME, acceptedUserId: ME, visible }), "ignore");
  });
  it("same user + TOKEN_REFRESHED: ignore", () => {
    assert.equal(decideAuthEvent({ event: "TOKEN_REFRESHED", sessionUserId: ME, acceptedUserId: ME, visible }), "ignore");
  });
  it("same user, hidden tab (a cross-tab echo): ignore, for every event but USER_UPDATED", () => {
    for (const event of ["SIGNED_IN", "TOKEN_REFRESHED", "INITIAL_SESSION", "MFA_CHALLENGE_VERIFIED"]) {
      assert.equal(decideAuthEvent({ event, sessionUserId: ME, acceptedUserId: ME, visible: false }), "ignore", event);
    }
  });
  it("another user: resolve (visible or hidden)", () => {
    for (const v of [true, false]) assert.equal(decideAuthEvent({ event: "SIGNED_IN", sessionUserId: "user-2", acceptedUserId: ME, visible: v }), "resolve");
  });
  it("null session (signed out, here or in another tab): resolve, visible or hidden", () => {
    for (const v of [true, false]) {
      assert.equal(decideAuthEvent({ event: "SIGNED_OUT", sessionUserId: null, acceptedUserId: ME, visible: v }), "resolve");
      assert.equal(decideAuthEvent({ event: "SIGNED_OUT", sessionUserId: undefined, acceptedUserId: ME, visible: v }), "resolve");
    }
  });
  it("USER_UPDATED for the same user: resolve", () => {
    assert.equal(decideAuthEvent({ event: "USER_UPDATED", sessionUserId: ME, acceptedUserId: ME, visible }), "resolve");
  });
  it("nobody accepted yet (sign-in in progress, or a pending access retry): resolve", () => {
    assert.equal(decideAuthEvent({ event: "SIGNED_IN", sessionUserId: ME, acceptedUserId: null, visible }), "resolve");
  });

  it("repeated SIGNED_IN / TOKEN_REFRESHED for the same user, visible and hidden: 0 access RPCs", () => {
    // A model of the listener: "resolve" runs resolveSession (2 RPCs:
    // admin_team_my_access + admin_team_my_operational_areas).
    let rpcs = 0;
    let rerenders = 0;
    const onEvent = (event, sessionUserId, isVisible) => {
      if (decideAuthEvent({ event, sessionUserId, acceptedUserId: ME, visible: isVisible }) === "resolve") { rpcs += 2; rerenders += 1; }
    };
    for (let i = 0; i < 100; i += 1) {
      onEvent("SIGNED_IN", ME, true);
      onEvent("TOKEN_REFRESHED", ME, true);
      onEvent("SIGNED_IN", ME, false);
      onEvent("TOKEN_REFRESHED", ME, false);
    }
    assert.equal(rpcs, 0);
    assert.equal(rerenders, 0);
    // signing out still goes through, once
    onEvent("SIGNED_OUT", null, false);
    assert.equal(rpcs, 2);
  });
});

describe("#4423 sameAccess (hidden flaw 2)", () => {
  const a = { email: "a@x.co", role: "admin", status: "active", areas: ["crm", "ops", "messages"] };
  it("areas in a different order are the same access", () => {
    assert.equal(sameAccess(a, { ...a, areas: ["messages", "crm", "ops"] }), true);
  });
  it("it never mutates the areas it compares", () => {
    const b = { ...a, areas: ["ops", "crm", "messages"] };
    sameAccess(a, b);
    assert.deepEqual(b.areas, ["ops", "crm", "messages"]);
    assert.deepEqual(a.areas, ["crm", "ops", "messages"]);
  });
  it("a real change is a change", () => {
    assert.equal(sameAccess(a, { ...a, areas: ["crm", "ops"] }), false);
    assert.equal(sameAccess(a, { ...a, areas: ["crm", "ops", "support"] }), false);
    assert.equal(sameAccess(a, { ...a, role: "member" }), false);
    assert.equal(sameAccess(a, { ...a, status: "invited" }), false);
    assert.equal(sameAccess(a, { ...a, email: "b@x.co" }), false);
    assert.equal(sameAccess(null, a), false);
    assert.equal(sameAccess(a, null), false);
  });
});

describe("#4423 AuthContext wiring", () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const auth = strip(readFileSync(new URL("../context/AuthContext.jsx", import.meta.url), "utf8"));
  const listener = auth.slice(auth.indexOf("onAuthStateChange("), auth.indexOf("subscription.unsubscribe()"));

  it("the auth listener asks decideAuthEvent and never calls setSession or refreshAccess itself", () => {
    assert.match(listener, /decideAuthEvent\(\{/);
    assert.match(listener, /if \(decision === "ignore"\) return;/);
    assert.match(listener, /visible: typeof document === "undefined" \|\| document\.visibilityState === "visible"/);
    assert.equal(/setSession\(/.test(listener), false, "no setSession on the event path");
    assert.equal(/refreshAccess\(/.test(listener), false, "no access re-check on the event path");
    assert.match(listener, /void resolveSession\(newSession\);/);
  });

  it("access is re-checked only by the gated 30 s poller and the page-return signal (no own listeners)", () => {
    assert.match(auth, /const ACCESS_GATE_KEY = "auth-access";/);
    assert.match(auth, /const ACCESS_REFRESH_MS = 30_000;/);
    assert.match(auth, /createPoller\(\{\s*refresh: \(options\) => refreshCurrentAccess\(options\),\s*intervalMs: ACCESS_REFRESH_MS,\s*pageReturn,\s*initial: false,/);
    assert.match(auth, /if \(quiet && !tabPollGate\.allow\(ACCESS_GATE_KEY\)\) return \{ skipped: true \};/);
    assert.match(auth, /tabPollGate\.start\(ACCESS_GATE_KEY, \{ background: quiet \}\);/);
    assert.match(auth, /tabPollGate\.settle\(\s*ACCESS_GATE_KEY,/);
    assert.equal(/addEventListener\(/.test(auth), false);
    assert.equal(/setInterval\(/.test(auth), false);
  });

  it("(W1.3) the provider value is memoised and the actions are stable callbacks", () => {
    assert.match(auth, /const value = useMemo\(\(\) => \(\{/);
    assert.match(auth, /<AuthContext\.Provider value=\{value\}>/);
    for (const name of ["acceptInvite", "completeInviteSetup", "verifyPassword", "sendOtp", "verifyOtp", "signOut", "retryAccess", "refreshCurrentAccess", "endSession", "clearAuthNotice"]) {
      assert.match(auth, new RegExp(`const ${name} = useCallback\\(`), name);
    }
    // completeInviteSetup reads the invite through a ref, not a stale closure
    assert.match(auth, /const inviteSetup = inviteSetupRef\.current;/);
  });

  it("the 2FA rules are unchanged (FULL_AUTH_KEY set only after OTP or invite set-up)", () => {
    const sets = auth.match(/localStorage\.setItem\(FULL_AUTH_KEY, "true"\)/g) || [];
    assert.equal(sets.length, 2);
    assert.match(auth, /const twoFA = !!localStorage\.getItem\(FULL_AUTH_KEY\) \|\| otpVerifiedRef\.current;/);
    assert.match(auth, /otpVerifiedRef\.current = true;\s*\n\s*try \{\s*\n\s*const \{ error \} = await supabase\.auth\.verifyOtp\(/);
  });
});
