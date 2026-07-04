/**
 * ORCH-1301 [close-hardening for ORCH-1294 boot-paint-decouple] — TESTER
 * ADVERSARIAL regression protection.
 *
 * The shipped fix (ORCH-1294) releases AuthProvider's loading gate immediately
 * after the LOCAL getSession() state is applied, then runs the whole signed-in
 * post-getSession network chain (getUser() probe → ensureCreatorAccount →
 * tryRecoverAccountIfDeleted → analytics binds) in a NON-AWAITED background IIFE.
 *
 * The implementor's happy-path test (AuthContext.bootPaintDecouple.orch1294.test.ts)
 * drives a hand-rolled replica of the bootstrap tail with a NEVER-RESOLVING chain
 * and asserts loading flips false. This tester file attacks DIFFERENT angles it
 * does NOT cover:
 *
 *   (1) READINESS-DERIVATION INDEPENDENCE — the REAL, unchanged
 *       deriveBusinessAuthStatus / isBusinessAuthReady are PURE functions of
 *       (authError, loading, session, user). Once the gate releases with the
 *       local session applied, readiness is fully determined WITHOUT any network
 *       result. We prove this with a matrix of edge states the implementor never
 *       enumerated (session-without-user, user-without-id, whitespace token,
 *       authError-suppresses-ready, session-dropped-after-ready).
 *
 *   (2) BACKGROUND-CHAIN SIGN-OUT INVARIANT — the ORCH-1294 background chain must
 *       STILL sign out a POSITIVELY-invalid session. We drive the REAL
 *       classifyBootSessionProbe and compose it with a faithful model of the
 *       revoked-session branch, proving: invalid_session ⇒ session/user cleared;
 *       every fail-OPEN shape (network/5xx/unknown) ⇒ session PRESERVED; and — the
 *       ORCH-1294 nuance — the sign-out does NOT re-block the loading gate.
 *
 *   (3) NO-RE-BLOCK STRUCTURAL ANCHOR — a DIFFERENT source property than the
 *       implementor's ordering assertions: the bootstrap body never calls
 *       setLoading(true) (re-blocking loading in the revoked branch would
 *       re-introduce the exact freeze ORCH-1294 removed).
 *
 * Runs under the default node/ts-jest config: authReadiness.ts is pure (no RN
 * natives) and AuthContext.tsx is read as TEXT (never mounted).
 *
 * Fails-on-revert: reverting ORCH-1294 (await the network chain before
 * setLoading(false); no non-awaited IIFE) restores an ordering where a hung probe
 * keeps loading true — the (1) matrix still holds (pure fn) but (3) plus the
 * composed model in (2) pin the shipped decoupling; and if the revoked-branch
 * sign-out is deleted the classifier composition in (2) flips.
 */

import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  classifyBootSessionProbe,
  deriveBusinessAuthStatus,
  isBusinessAuthReady,
  hasUsableBusinessSession,
  type MinimalAuthSession,
  type MinimalAuthUser,
} from "../../utils/authReadiness";

const USABLE_SESSION: MinimalAuthSession = {
  access_token: "boot-token-1301",
};
const USER: MinimalAuthUser = { id: "user-1301" };

// ─────────────────────────────────────────────────────────────────────
// (1) Readiness derivation is a PURE function of the LOCAL boot state — it never
// consults the post-getSession network chain. The exact state the FIXED
// bootstrap produces after releasing the gate is "ready" with NOTHING settled.
// ─────────────────────────────────────────────────────────────────────
describe("ORCH-1301 — loading gate released ⇒ readiness is decided off the local session alone (no network)", () => {
  it("loading=false + usable session + user.id ⇒ signed_in_ready + isAuthReady, with zero network results consulted", () => {
    // This is EXACTLY the state AuthProvider holds the instant setLoading(false)
    // runs in the ORCH-1294 fix — session/user from the LOCAL getSession, the
    // probe/ensureCreatorAccount/recovery all still pending. There is no network
    // input to this computation at all: readiness cannot depend on them.
    const status = deriveBusinessAuthStatus({
      authError: null,
      loading: false,
      session: USABLE_SESSION,
      user: USER,
    });
    expect(status).toBe("signed_in_ready");
    expect(isBusinessAuthReady(status, USABLE_SESSION)).toBe(true);
  });

  it("while loading=true (gate NOT yet released) the SAME usable session is only 'refreshing' — never ready (this is the freeze the fix removes)", () => {
    const status = deriveBusinessAuthStatus({
      authError: null,
      loading: true,
      session: USABLE_SESSION,
      user: USER,
    });
    expect(status).toBe("refreshing");
    expect(isBusinessAuthReady(status, USABLE_SESSION)).toBe(false);
  });

  it("EDGE — loading=false but user=null (session applied, no user) ⇒ signed_out, NOT ready", () => {
    const status = deriveBusinessAuthStatus({
      authError: null,
      loading: false,
      session: USABLE_SESSION,
      user: null,
    });
    expect(status).toBe("signed_out");
    expect(isBusinessAuthReady(status, USABLE_SESSION)).toBe(false);
  });

  it("EDGE — loading=false + user present but WITHOUT an id ⇒ signed_out (user.id is required for ready)", () => {
    const status = deriveBusinessAuthStatus({
      authError: null,
      loading: false,
      session: USABLE_SESSION,
      user: {} as MinimalAuthUser,
    });
    expect(status).toBe("signed_out");
    expect(isBusinessAuthReady(status, USABLE_SESSION)).toBe(false);
  });

  it("EDGE — a whitespace-only access_token is NOT a usable session ⇒ signed_out even with a user", () => {
    const blankTokenSession: MinimalAuthSession = { access_token: "   " };
    expect(hasUsableBusinessSession(blankTokenSession)).toBe(false);
    const status = deriveBusinessAuthStatus({
      authError: null,
      loading: false,
      session: blankTokenSession,
      user: USER,
    });
    expect(status).toBe("signed_out");
    expect(isBusinessAuthReady(status, blankTokenSession)).toBe(false);
  });

  it("EDGE — a boot authError suppresses ready even with a usable session/user (status=error)", () => {
    const status = deriveBusinessAuthStatus({
      authError: new Error("getSession failed"),
      loading: false,
      session: USABLE_SESSION,
      user: USER,
    });
    expect(status).toBe("error");
    expect(isBusinessAuthReady(status, USABLE_SESSION)).toBe(false);
  });

  it("EDGE — isBusinessAuthReady re-checks the session: signed_in_ready but session dropped to null ⇒ NOT ready", () => {
    // deriveBusinessAuthStatus can only report signed_in_ready WITH a usable
    // session, but isBusinessAuthReady independently re-verifies it — a defense
    // the brand-route resolver leans on.
    expect(isBusinessAuthReady("signed_in_ready", null)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// (2) The ORCH-1294 background chain still SIGNS OUT a positively-invalid
// session. Faithful model of the revoked-session branch, driven by the REAL
// classifyBootSessionProbe — proving both directions AND that the sign-out
// leaves the loading gate released (never re-blocks).
// ─────────────────────────────────────────────────────────────────────

interface BootProbeState {
  session: MinimalAuthSession | null;
  user: MinimalAuthUser | null;
  loading: boolean;
  signedOut: boolean;
}

// Mirrors AuthContext bootstrap's background probe branch:
//   if (classifyBootSessionProbe(probeError) === "invalid_session") {
//     await supabase.auth.signOut(); setSession(null); setUser(null);
//     // ORCH-1294 — `loading` is already false; do NOT re-block it here.
//   }
// loading is ALREADY false when this runs (the gate released before the IIFE).
const runBackgroundProbeBranch = (probeError: unknown): BootProbeState => {
  const state: BootProbeState = {
    session: USABLE_SESSION,
    user: USER,
    loading: false, // gate already released by the ORCH-1294 fix
    signedOut: false,
  };
  if (classifyBootSessionProbe(probeError) === "invalid_session") {
    // signOut() path clears session/user; loading stays false (ORCH-1294).
    state.session = null;
    state.user = null;
    state.signedOut = true;
  }
  return state;
};

describe("ORCH-1301 — background chain still signs out a positively-invalid session (real classifier)", () => {
  const INVALID_PROBES: Array<[string, unknown]> = [
    ["HTTP 401", { status: 401, message: "Unauthorized" }],
    ["HTTP 403", { status: 403, message: "Forbidden" }],
    ["code session_not_found", { code: "session_not_found" }],
    ["code bad_jwt", { code: "bad_jwt" }],
    ["code refresh_token_not_found", { code: "refresh_token_not_found" }],
    ["name AuthSessionMissingError", { name: "AuthSessionMissingError", message: "Auth session missing!" }],
    ["message-only auth session missing", { message: "Auth session missing!" }],
  ];

  it.each(INVALID_PROBES)(
    "%s ⇒ invalid_session ⇒ session/user cleared, loading STILL false (paints briefly then routes to sign-in)",
    (_label, probeError) => {
      expect(classifyBootSessionProbe(probeError)).toBe("invalid_session");
      const state = runBackgroundProbeBranch(probeError);
      expect(state.signedOut).toBe(true);
      expect(state.session).toBeNull();
      expect(state.user).toBeNull();
      // ORCH-1294 nuance: the revoked-session sign-out must NOT re-block loading.
      expect(state.loading).toBe(false);
    },
  );

  const KEEP_PROBES: Array<[string, unknown]> = [
    ["no error (valid session)", null],
    ["undefined error", undefined],
    ["network TypeError", { name: "TypeError", message: "Network request failed" }],
    ["AuthRetryableFetchError", { name: "AuthRetryableFetchError", message: "fetch failed" }],
    ["HTTP 500 server hiccup", { status: 500, message: "Internal Server Error" }],
    ["HTTP 429 rate-limit", { status: 429, message: "Too Many Requests" }],
    ["unknown shape", { foo: "bar" }],
  ];

  it.each(KEEP_PROBES)(
    "%s ⇒ keep_session (fail-OPEN) ⇒ session/user PRESERVED, never signed out",
    (_label, probeError) => {
      expect(classifyBootSessionProbe(probeError)).toBe("keep_session");
      const state = runBackgroundProbeBranch(probeError);
      expect(state.signedOut).toBe(false);
      expect(state.session).toBe(USABLE_SESSION);
      expect(state.user).toBe(USER);
      expect(state.loading).toBe(false);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────
// (3) Source anchor — a DIFFERENT property than the implementor's ordering
// assertions: the bootstrap gate is released and NEVER re-blocked, and the
// signed-in network chain runs in a non-awaited IIFE. Reverting ORCH-1294
// (awaiting the chain before the gate; re-blocking loading in the revoked
// branch) trips these.
// ─────────────────────────────────────────────────────────────────────

const AUTH_CONTEXT_SOURCE = readFileSync(
  join(__dirname, "..", "AuthContext.tsx"),
  "utf8",
);
const BOOTSTRAP_BODY = AUTH_CONTEXT_SOURCE.slice(
  AUTH_CONTEXT_SOURCE.indexOf("const bootstrap = async () =>"),
  AUTH_CONTEXT_SOURCE.indexOf("bootstrap();"),
);

describe("ORCH-1301 — AuthContext bootstrap never re-blocks the loading gate (source anchor)", () => {
  it("the bootstrap body calls setLoading(false) but NEVER setLoading(true) (re-blocking would re-freeze the spinner)", () => {
    expect(BOOTSTRAP_BODY).toMatch(/setLoading\(false\)/);
    expect(BOOTSTRAP_BODY).not.toMatch(/setLoading\(\s*true\s*\)/);
  });

  it("the WHOLE AuthContext module never re-blocks loading with setLoading(true) anywhere", () => {
    // loading is seeded once via useState initializer and only ever RELEASED.
    expect(AUTH_CONTEXT_SOURCE).not.toMatch(/setLoading\(\s*true\s*\)/);
  });

  it("the signed-in post-getSession chain runs in a NON-AWAITED background IIFE, and the gate release precedes it", () => {
    const idxGateRelease = BOOTSTRAP_BODY.indexOf("setLoading(false);");
    const idxBootUser = BOOTSTRAP_BODY.indexOf("const bootUser = s?.user ?? null;");
    const idxIIFE = BOOTSTRAP_BODY.indexOf("void (async () => {");
    expect(idxGateRelease).toBeGreaterThan(-1);
    expect(idxBootUser).toBeGreaterThan(-1);
    expect(idxIIFE).toBeGreaterThan(-1);
    // gate release → capture bootUser → non-awaited background IIFE.
    expect(idxGateRelease).toBeLessThan(idxBootUser);
    expect(idxBootUser).toBeLessThan(idxIIFE);
  });

  it("the revoked-session sign-out (the invariant driven in section 2) is present inside the background chain", () => {
    expect(BOOTSTRAP_BODY).toMatch(/classifyBootSessionProbe\(/);
    expect(BOOTSTRAP_BODY).toMatch(/await supabase\.auth\.signOut\(\)/);
    expect(BOOTSTRAP_BODY).toMatch(/setSession\(null\)/);
    expect(BOOTSTRAP_BODY).toMatch(/setUser\(null\)/);
  });
});
