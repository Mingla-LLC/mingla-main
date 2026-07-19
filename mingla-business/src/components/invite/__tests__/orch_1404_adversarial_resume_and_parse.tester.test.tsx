/**
 * ORCH-1404 [accept-invite-web-error-recovery] — TESTER ADVERSARIAL suite.
 *
 * A DIFFERENT ANGLE from the implementor's two suites:
 *   - implementor's `orch_1404_functions_error_parse.tester.test.ts` proves the
 *     FLAT happy `FunctionsHttpError` (context.status + body) parses to the right
 *     status/code, plus network / unparseable / legacy shapes.
 *   - implementor's `orch_1404_wrong_account_recovery.tester.test.tsx` proves the
 *     screen exposes the switch button and `buildSwitchAccountResume` routes a
 *     BENIGN token (`abc123`, `tok_xyz`) through `/auth?next=…`, and tests
 *     `sanitizeNextRoute` DIRECTLY on attack strings.
 *
 * NEITHER exercises the COMPOSITION — a HOSTILE token pushed all the way through
 * `buildSwitchAccountResume(token)` → decode → re-`sanitizeNextRoute` (exactly
 * what `/auth` does on the other side) — nor a NESTED/again-`.response`-shaped
 * error `context`. This suite attacks precisely those two seams:
 *
 *   ATTACK 1 (open-redirect via the token, composition):
 *     `sanitizeNextRoute`'s `//` and `..` guards apply to the STRING HEAD / PATH
 *     SEGMENT — but the invite token lives in the QUERY. So a token engineered to
 *     smuggle `&next=//evil.com` or a `../../` traversal survives the FIRST
 *     `sanitizeNextRoute` inside `buildSwitchAccountResume` (path is still
 *     `/accept-brand-invitation`). This proves that even so, the OUTER
 *     `encodeURIComponent` neutralises the smuggle: the value `/auth` receives
 *     is ONE encoded param, and when `/auth` re-sanitizes it the landing path is
 *     STILL same-origin `/accept-brand-invitation` — never a navigable
 *     `//evil.com`, never a scheme. The recovery cannot be weaponised into an
 *     open redirect through its token.
 *
 *   ATTACK 2 (malformed-token → validated null fallback — FAILS ON REVERT):
 *     a token with malformed percent-encoding (`%`, `%zz`) makes
 *     `decodeURIComponent` throw inside `sanitizeNextRoute` → it returns null →
 *     `buildSwitchAccountResume` MUST fall back to a bare `/auth` (no `?next=`),
 *     never an unvalidated redirect. If `buildSwitchAccountResume` is reverted to
 *     skip `sanitizeNextRoute` (e.g. `/auth?next=${encodeURIComponent(candidate)}`
 *     directly), this returns `/auth?next=…` and the assertion FAILS.
 *
 *   ATTACK 3 (parser NESTED-context trap — FAILS ON REVERT):
 *     a `FunctionsHttpError` whose `context` carries BOTH the canonical
 *     `.status` (403) AND a nested legacy `.response.status` (500). The canonical
 *     parser (I-PROPOSED-1404-FUNCTIONS-ERROR-PARSE-CANONICAL) MUST read
 *     `context.status` (403). If reverted to the old `context.response.status`
 *     read, it returns 500 and this FAILS. Guards against re-introducing the
 *     EXACT F-2 bug even when a `.response` happens to exist.
 *
 * Append-only; never modifies the implementor's files. Runs under the default
 * node/ts-jest config (no RN render harness) — the pure helpers are called as
 * functions; react-native + Button are mocked to plain markers.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// ── Mocks (plain markers — we call the pure exports, never render) ──
jest.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  ActivityIndicator: "ActivityIndicator",
  StyleSheet: { create: (s: unknown) => s },
  Platform: {
    OS: "web",
    select: (o: Record<string, unknown>) => o.web ?? o.default ?? o.ios,
  },
}));
const MockButton = (_props: { label: string; onPress: () => void }): null => null;
jest.mock("../../ui/Button", () => ({ Button: MockButton, default: MockButton }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ authStatus: "signed_in_ready", user: null, signOut: jest.fn() }),
}));
jest.mock("../../../hooks/useBrandInvitations", () => ({
  useAcceptBrandInvitation: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock("../BusinessAppDownloadCta", () => ({
  BusinessAppDownloadCta: (): null => null,
}));
jest.mock("../../../services/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

// Real modules under test.
import { sanitizeNextRoute } from "../../../utils/nextRoute";
import { buildSwitchAccountResume } from "../../../../app/accept-brand-invitation";
import {
  acceptBrandInvitation,
  parseFunctionsError,
  BrandInvitationServiceError,
} from "../../../services/brandInvitationsService";
import { supabase } from "../../../services/supabase";

const invoke = supabase.functions.invoke as jest.MockedFunction<
  typeof supabase.functions.invoke
>;

/**
 * Re-run exactly what `/auth` does on the receiving end: pull the `next` param
 * off the `/auth?next=…` target, decode it once, and re-validate it through the
 * ONE validator. Returns what `/auth` would actually resume to (or null).
 */
function whatAuthWouldResumeTo(target: string): string | null {
  const prefix = "/auth?next=";
  if (!target.startsWith(prefix)) return null; // bare /auth → resumes home
  const inner = decodeURIComponent(target.slice(prefix.length));
  return sanitizeNextRoute(inner);
}

describe("ORCH-1404 ADVERSARIAL — hostile token cannot open-redirect via the resume", () => {
  // ATTACK 1a — an `&next=//evil.com` smuggle in the token.
  test("token smuggling `&next=//evil.com` never yields a navigable off-origin target", () => {
    const target = buildSwitchAccountResume("x&next=//evil.com");
    // Outer target is always /auth-rooted, never off-origin, never a scheme.
    expect(target.startsWith("/auth")).toBe(true);
    expect(target).not.toMatch(/^\/\//);
    expect(target).not.toMatch(/^https?:/i);
    // The smuggled `//evil.com` must NOT appear as a bare (unencoded) substring
    // that a browser could read as protocol-relative — it is percent-encoded.
    expect(target).not.toContain("//evil.com");
    // And what /auth actually resumes to stays same-origin on the accept path.
    const resume = whatAuthWouldResumeTo(target);
    expect(resume).not.toBeNull();
    expect(resume!.startsWith("/accept-brand-invitation")).toBe(true);
    expect(resume).not.toMatch(/^\/\//);
    expect(resume).not.toMatch(/^https?:/i);
  });

  // ATTACK 1b — a `../../` traversal in the token (query, not path).
  test("token carrying a `../../` traversal stays same-origin on the accept path", () => {
    const target = buildSwitchAccountResume("../../brand/1/payments");
    const resume = whatAuthWouldResumeTo(target);
    // Either dropped (bare /auth) or resolved same-origin to the accept path —
    // NEVER to /brand/1/payments as its own landing path.
    if (resume !== null) {
      expect(resume.startsWith("/accept-brand-invitation")).toBe(true);
      // The `..` lives in the QUERY, so the landing PATH is never /brand/…
      const landingPath = resume.split(/[?#]/)[0];
      expect(landingPath).toBe("/accept-brand-invitation");
    } else {
      expect(target).toBe("/auth");
    }
  });

  // ATTACK 2 — malformed percent-encoding → validated null fallback. FAILS ON
  // REVERT if buildSwitchAccountResume stops routing through sanitizeNextRoute.
  test.each(["%", "%zz", "%E0%A4"])(
    "malformed-encoding token %p degrades to a bare /auth (no unvalidated ?next=)",
    (tok) => {
      // Precondition: sanitizeNextRoute genuinely rejects this candidate.
      expect(sanitizeNextRoute(`/accept-brand-invitation?token=${tok}`)).toBeNull();
      // Therefore the builder MUST emit exactly `/auth` — not `/auth?next=…`.
      const target = buildSwitchAccountResume(tok);
      expect(target).toBe("/auth");
      expect(target).not.toContain("?next=");
    },
  );

  // ATTACK 2b — a benign token still round-trips intact (the fallback is not a
  // blanket "always drop"; the token is preserved when valid).
  test("a benign token round-trips through /auth back to the exact accept URL", () => {
    const target = buildSwitchAccountResume("tok_LEGIT-123.abc");
    expect(whatAuthWouldResumeTo(target)).toBe(
      "/accept-brand-invitation?token=tok_LEGIT-123.abc",
    );
  });
});

describe("ORCH-1404 ADVERSARIAL — parseFunctionsError nested-context trap", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  function makeNestedContextError(
    canonicalStatus: number,
    nestedResponseStatus: number,
    body: Record<string, unknown>,
  ): Error {
    const readJson = async (): Promise<unknown> => body;
    // context IS the Response (canonical .status), but ALSO carries a nested
    // `.response.status` — the exact trap the old buggy reader dug into.
    const response = {
      status: canonicalStatus,
      ok: false,
      clone: () => ({ json: readJson }),
      json: readJson,
      response: { status: nestedResponseStatus },
    };
    const err = new Error("Edge Function returned a non-2xx status code");
    err.name = "FunctionsHttpError";
    (err as unknown as { context: unknown }).context = response;
    return err;
  }

  // ATTACK 3 — canonical .status wins over the legacy nested .response.status.
  // FAILS ON REVERT to `error.context.response.status`.
  test("reads context.status (403), NOT the nested context.response.status (500)", async () => {
    const err = makeNestedContextError(403, 500, { error: "invite_email_mismatch" });
    const parsed = await parseFunctionsError(err);
    expect(parsed.status).toBe(403);
    expect(parsed.code).toBe("invite_email_mismatch");
    // The nested trap value must never leak through.
    expect(parsed.status).not.toBe(500);
  });

  // ATTACK 3b — the same through the real acceptBrandInvitation call site, so the
  // thrown BrandInvitationServiceError carries the canonical status/code.
  test("acceptBrandInvitation surfaces the canonical status through a nested-context error", async () => {
    const err = makeNestedContextError(410, 500, { error: "invite_expired" });
    invoke.mockResolvedValueOnce({ data: null, error: err } as never);
    let thrown: unknown;
    try {
      await acceptBrandInvitation("tok_x");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(BrandInvitationServiceError);
    expect((thrown as BrandInvitationServiceError).status).toBe(410);
    expect((thrown as BrandInvitationServiceError).code).toBe("invite_expired");
  });

  // ATTACK 3c — a body whose `error` is a non-string (hostile/garbage) must not
  // become the code; it falls to the generic "server" while keeping real status.
  test("a non-string body.error does not become the code (falls to server, real status kept)", async () => {
    const err = makeNestedContextError(500, 500, {
      error: { nested: "object-not-a-string" },
    });
    const parsed = await parseFunctionsError(err);
    expect(parsed.status).toBe(500);
    expect(parsed.code).toBe("server");
  });
});
