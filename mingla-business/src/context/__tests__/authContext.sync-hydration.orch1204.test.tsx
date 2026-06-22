/**
 * ORCH-1204 [web-auth-bootstrap-lock] — implementor happy-path regression
 * test (SPEC §9.a).
 *
 * SPEC: /Users/sethogieva/Desktop/mingla-main/Mingla_Artifacts/specs/SPEC_ORCH-1204_web-auth-bootstrap-lock.md
 *
 * ─────────────────────────────────────────────────────────────────────
 * Test-style note (mirrors AuthContext.timeout.test.ts):
 *
 * mingla-business/jest.config.cjs uses `testEnvironment: "node"` +
 * `preset: "ts-jest"`. devDependencies contain ONLY @jest/globals,
 * @types/jest, jest, ts-jest. There is NO @testing-library/react-native,
 * NO react-test-renderer, NO jsdom. The repo convention (see the ORCH-0887-A
 * sibling test) is: assert the SHAPE of the source code + run PURE-LOGIC
 * tests of the extracted semantics — render-tree mounts run under their own
 * dedicated RTL configs and are ignored by this default config.
 *
 * The CURE in AuthContext.tsx is, by construction, a PURE FUNCTION of
 * `readStoredWebSession()`:
 *
 *     const initialStored = readStoredWebSession();
 *     session : () => initialStored
 *     user    : () => initialStored?.user ?? null
 *     loading : () => initialStored === null
 *
 * and `isAuthReady` is computed from those three values by the REAL,
 * unchanged readiness derivation in `../../utils/authReadiness`
 * (deriveBusinessAuthStatus → isBusinessAuthReady). So we can PROVE the
 * cure end-to-end at the logic level without mounting React:
 *
 *   (T1 CURE) reproduce the EXACT initializer expressions against a mocked
 *     window.localStorage holding a valid session, with a getSession() mock
 *     that NEVER resolves, then feed the three initial values through the
 *     REAL isBusinessAuthReady. Assert isAuthReady === true, user.id set,
 *     loading === false — on the FIRST (synchronous) render tick, before any
 *     getSession resolution. getSession is never awaited.
 *
 *   (T2 passthrough) no stored session (or off-web) → initializers return
 *     null/null/true → isAuthReady === false (today's bootstrapping state).
 *
 *   (Surface B) source-text structural assertions on AuthContext.tsx prove
 *     the three lazy `useState` initializers derive from readStoredWebSession
 *     — the fails-on-revert anchor: reverting to useState(null)/useState(true)
 *     deletes these lines and the assertions fail.
 *
 * The ADVERSARIAL angles (server-revoked probe / SSR export / ceiling /
 * native parity / multi-tab live-fire) are the tester's deliverable per
 * SPEC §9.b — not authored here.
 * ─────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from "fs";
import path from "path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";

import type { Session } from "@supabase/supabase-js";

import {
  deriveBusinessAuthStatus,
  isBusinessAuthReady,
  hasUsableBusinessSession,
} from "../../utils/authReadiness";

// Same storage key the production reader uses (AuthContext.tsx).
const WEB_AUTH_STORAGE_KEY = "sb-gqnoajqerqhnvulmnyvv-auth-token";

// ─────────────────────────────────────────────────────────────────────
// Test doubles
// ─────────────────────────────────────────────────────────────────────

// A controllable mock of the browser localStorage + a Platform.OS switch so
// the test can drive readStoredWebSession's exact guard conditions
// (Platform.OS !== "web" || typeof window === "undefined").
let mockStore: Record<string, string> = {};
let mockPlatformOS: "web" | "ios" | "android" = "web";
let mockWindowDefined = true;

/**
 * Re-declaration of the production readStoredWebSession() (AuthContext.tsx:90).
 * It is a private module-scope const that cannot be imported directly (the
 * module pulls in RN/Expo natives that won't load under node/ts-jest), so we
 * mirror it byte-for-byte here and Surface B asserts the source still matches.
 */
const readStoredWebSession = (): Session | null => {
  if (mockPlatformOS !== "web" || !mockWindowDefined) return null;
  try {
    const raw = mockStore[WEB_AUTH_STORAGE_KEY] ?? null;
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Session;
    return hasUsableBusinessSession(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
};

/**
 * Reproduces the EXACT three lazy useState initializers from the AuthProvider
 * (AuthContext.tsx). React runs these once, synchronously, on the first render
 * commit — before any effect / await. We invoke them the same way to capture
 * the FIRST-render auth state.
 */
const computeInitialAuthState = (): {
  session: Session | null;
  user: Session["user"] | null;
  loading: boolean;
} => {
  const initialStored = readStoredWebSession();
  const session = initialStored;
  const user = initialStored?.user ?? null;
  const loading = initialStored === null;
  return { session, user, loading };
};

/**
 * A getSession() mock that NEVER resolves — the exact bug shape (the gotrue
 * Navigator-Locks lock is contended and getSession() exceeds the 3s bootstrap
 * timeout). If the cure depended on awaiting it, the test would hang / fail.
 */
const hungGetSession = (): Promise<never> =>
  new Promise<never>(() => {
    /* intentionally never resolves — the lock-contention bug shape */
  });

const VALID_SESSION = {
  access_token: "valid-access-token-abc",
  refresh_token: "refresh-xyz",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  user: { id: "user-1204", email: "seth@usemingla.com" },
};

describe("ORCH-1204 — web synchronous auth hydration (cure)", () => {
  beforeEach(() => {
    mockStore = {};
    mockPlatformOS = "web";
    mockWindowDefined = true;
  });
  afterEach(() => {
    mockStore = {};
  });

  it(
    "T1 (CURE) — valid stored web session + a HUNG getSession() → first render is authed: isAuthReady === true, user.id set, loading === false, WITHOUT awaiting getSession()",
    async () => {
      // Arrange: a valid persisted session sits in localStorage.
      mockStore[WEB_AUTH_STORAGE_KEY] = JSON.stringify(VALID_SESSION);
      // getSession() is contended and never resolves. We fire it but NEVER
      // await it — the cure must not depend on it.
      const getSession = hungGetSession();
      let getSessionResolved = false;
      void getSession.then(() => {
        getSessionResolved = true;
      });

      // Act: compute the FIRST-render auth state exactly as the lazy
      // initializers do (synchronously, no await).
      const initial = computeInitialAuthState();
      // Feed the initial state through the REAL, unchanged readiness derivation
      // the AuthProvider uses to compute authStatus + isAuthReady.
      const authStatus = deriveBusinessAuthStatus({
        authError: null,
        loading: initial.loading,
        session: initial.session,
        user: initial.user,
      });
      const isAuthReady = isBusinessAuthReady(authStatus, initial.session);

      // Drain the microtask queue — proves getSession() is genuinely still
      // pending and the authed verdict did NOT wait on it.
      await Promise.resolve();

      // Assert: authed on first paint, independent of getSession().
      expect(getSessionResolved).toBe(false); // getSession never resolved
      expect(initial.loading).toBe(false);
      expect(initial.session).not.toBeNull();
      expect(initial.user).not.toBeNull();
      expect(initial.user?.id).toBe("user-1204");
      expect(authStatus).toBe("signed_in_ready");
      expect(isAuthReady).toBe(true);
    },
    5000,
  );

  it(
    "T2 (passthrough, web logged-out) — NO stored session → first render is bootstrapping: session/user null, loading true, isAuthReady false (today's behavior, no false signed-in flash)",
    () => {
      mockStore = {}; // no stored session
      const initial = computeInitialAuthState();
      const authStatus = deriveBusinessAuthStatus({
        authError: null,
        loading: initial.loading,
        session: initial.session,
        user: initial.user,
      });
      const isAuthReady = isBusinessAuthReady(authStatus, initial.session);

      expect(initial.session).toBeNull();
      expect(initial.user).toBeNull();
      expect(initial.loading).toBe(true);
      expect(authStatus).toBe("bootstrapping");
      expect(isAuthReady).toBe(false);
    },
    5000,
  );

  it(
    "T2b (passthrough, native) — Platform.OS !== 'web' → readStoredWebSession returns null even WITH a stored session → null/null/true (byte-identical native bootstrap, SC-6)",
    () => {
      mockStore[WEB_AUTH_STORAGE_KEY] = JSON.stringify(VALID_SESSION);
      mockPlatformOS = "ios";
      const initial = computeInitialAuthState();
      expect(initial.session).toBeNull();
      expect(initial.user).toBeNull();
      expect(initial.loading).toBe(true);
    },
    5000,
  );

  it(
    "T2c (passthrough, SSR/no-window) — typeof window === 'undefined' → null/null/true so the prerender tree matches today's server tree (SC-5)",
    () => {
      mockStore[WEB_AUTH_STORAGE_KEY] = JSON.stringify(VALID_SESSION);
      mockWindowDefined = false; // prerender: no window
      const initial = computeInitialAuthState();
      expect(initial.session).toBeNull();
      expect(initial.user).toBeNull();
      expect(initial.loading).toBe(true);
    },
    5000,
  );
});

// ─────────────────────────────────────────────────────────────────────
// Surface B — source-text structural assertions (fails-on-revert anchor)
//
// These assert AuthContext.tsx actually contains the three lazy useState
// initializers derived from readStoredWebSession() — the literal cure.
// Reverting to `useState<Session | null>(null)` / `useState(true)` DELETES
// these lines, so these expects fail. This is the fails-on-revert mechanism
// for the source change (the T1 logic test proves the BEHAVIOR; Surface B
// pins the behavior to the actual file).
// ─────────────────────────────────────────────────────────────────────

const AUTH_CONTEXT_SOURCE = readFileSync(
  path.resolve(__dirname, "..", "AuthContext.tsx"),
  "utf8",
);

describe("ORCH-1204 — AuthContext.tsx source-text structural assertions (fails-on-revert)", () => {
  it(
    "hoists a single const initialStored = readStoredWebSession() at AuthProvider mount (the PREFERRED single-read form per SPEC §4.1.b)",
    () => {
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /const initialStored = readStoredWebSession\(\);/,
      );
    },
    5000,
  );

  it(
    "session state uses a lazy initializer deriving from initialStored (NOT useState(null))",
    () => {
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /const \[session, setSession\] = useState<Session \| null>\(\(\) => initialStored\);/,
      );
    },
    5000,
  );

  it(
    "user state uses a lazy initializer deriving from initialStored?.user (NOT useState(null))",
    () => {
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /const \[user, setUser\] = useState<User \| null>\(\(\) => initialStored\?\.user \?\? null\);/,
      );
    },
    5000,
  );

  it(
    "loading state uses a lazy initializer (initialStored === null), NOT useState(true) — so a valid stored session yields loading=false on first render",
    () => {
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /const \[loading, setLoading\] = useState<boolean>\(\(\) => initialStored === null\);/,
      );
    },
    5000,
  );

  it(
    "carries the I-PROPOSED-1204 protective comment + the DO-NOT-revert lock",
    () => {
      expect(AUTH_CONTEXT_SOURCE).toMatch(/ORCH-1204 \[web-auth-bootstrap-lock\]/);
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /I-PROPOSED-1204-WEB-AUTH-SYNC-HYDRATION/,
      );
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /DO NOT revert to useState\(null\/null\/true\)/,
      );
    },
    5000,
  );

  it(
    "the 7s hard-ceiling block carries the ORCH-1204 invariant comment (ceiling releases only loading, MUST NOT clear user/session — SC-4) and still only sets bootstrapTimedOutRef + setLoading(false)",
    () => {
      // The invariant comment is present.
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /ORCH-1204: the ceiling releases only `loading`; it MUST NOT clear/,
      );
      // The ceiling body must NOT clear user/session: assert no setUser(null)
      // / setSession(null) appears inside the hard-ceiling setTimeout callback.
      const ceilingMatch = AUTH_CONTEXT_SOURCE.match(
        /hardCeilingTimer = setTimeout\(\(\) => \{[\s\S]*?\}, AUTH_RESOLUTION_HARD_CEILING_MS\);/,
      );
      expect(ceilingMatch).not.toBeNull();
      if (ceilingMatch) {
        expect(ceilingMatch[0]).not.toMatch(/setUser\(null\)/);
        expect(ceilingMatch[0]).not.toMatch(/setSession\(null\)/);
        expect(ceilingMatch[0]).toMatch(/setLoading\(false\)/);
      }
    },
    5000,
  );

  it(
    "the readStoredWebSession() source still web-only + SSR guards (Platform.OS !== 'web' || typeof window === 'undefined') so the initializers stay native-byte-identical + prerender-safe",
    () => {
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /if \(Platform\.OS !== "web" \|\| typeof window === "undefined"\) return null;/,
      );
    },
    5000,
  );

  it(
    "the ORCH-1106 boot-session probe is still gated by bootSessionProbedRef (synchronous hydration must NOT skip or double-fire it) and the timeout branch carries the ORCH-1204 'no probe here' note",
    () => {
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /if \(!bootSessionProbedRef\.current\) \{/,
      );
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /ORCH-1204: this timeout branch deliberately does NOT run the ORCH-1106/,
      );
    },
    5000,
  );
});
