/**
 * issue #2101 [named-buyer checkout] — the append-only implementor guard for
 * the three-family admission in the ONE `?next=` validator.
 *
 * Contract: original SPEC + Amendments 1-7. This file exercises Amendment 5
 * §A5.4 items 1-6 (Trip / Experience), Amendment 6 §A6.4 items 8-15 (Event),
 * and Amendment 7 §A7.3 item 16 (the true `sanitizeNextRoute` consumer set and
 * ORCH-1404 non-interference).
 *
 * FAILS ON REVERT. Deleting any one of the three public-family admissions makes
 * THAT family's canonical happy path RED while the other two stay GREEN.
 * Weakening the structural, segment-safe or dot-segment checks makes the
 * hostile matrices RED. Restoring the exact tuple is GREEN.
 *
 * Everything here runs against the REAL shipped module, the REAL canonical path
 * helpers and the REAL WHATWG `URL` parser. The historical ORCH-1373 / 1375 /
 * 1404 suites are NOT touched and run unchanged alongside this file.
 */
import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

// The canonical path helpers read the business web origin at module load. Same
// stub the existing publicUrls suite uses — the helpers themselves are REAL.
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL: "https://host.usemingla.com",
      },
    },
  },
}));

import {
  NEXT_ROUTE_ALLOWLIST,
  sanitizeNextRoute,
} from "../nextRoute";
import {
  eventPublicPath,
  experiencePublicPath,
  tripPublicPath,
} from "../../constants/publicUrls";

const ORIGIN = "https://host.usemingla.com";
const BUSINESS_ROOT = path.resolve(__dirname, "../../..");

/** Full auth round trip: capture validates, consume re-validates. */
const roundTrip = (value: string): { captured: string | null; consumed: string | null } => {
  const captured = sanitizeNextRoute(value);
  const consumed = captured === null ? null : sanitizeNextRoute(captured);
  return { captured, consumed };
};

/** What `/auth?next=` carries, then what the framework hands back decoded. */
const throughAuthQuery = (path_: string): string => {
  const href = `/auth?next=${encodeURIComponent(path_)}`;
  const parsed = new URL(href, ORIGIN);
  return parsed.searchParams.get("next") ?? "";
};

const sameOriginNoCredentials = (accepted: string): URL => {
  const url = new URL(accepted, ORIGIN);
  expect(url.origin).toBe(ORIGIN);
  expect(url.username).toBe("");
  expect(url.password).toBe("");
  return url;
};

describe("issue #2101 — canonical helpers produce the exact public paths (A5.4 1-2, A6.4 8)", () => {
  test("tripPublicPath yields /t/acme/bali and survives capture + consume byte-identically", () => {
    const canonical = tripPublicPath({ brandSlug: "acme", tripSlug: "bali" });
    expect(canonical).toBe("/t/acme/bali");
    const carried = throughAuthQuery(canonical);
    expect(carried).toBe(canonical);
    const { captured, consumed } = roundTrip(carried);
    expect(captured).toBe(canonical);
    expect(consumed).toBe(canonical);
  });

  test("experiencePublicPath yields /exp/acme/sunset-sail and survives the same round trip", () => {
    const canonical = experiencePublicPath({
      brandSlug: "acme",
      experienceSlug: "sunset-sail",
    });
    expect(canonical).toBe("/exp/acme/sunset-sail");
    const carried = throughAuthQuery(canonical);
    expect(carried).toBe(canonical);
    const { captured, consumed } = roundTrip(carried);
    expect(captured).toBe(canonical);
    expect(consumed).toBe(canonical);
  });

  test("eventPublicPath yields /e/acme/launch-party and survives the same round trip", () => {
    const canonical = eventPublicPath({
      brandSlug: "acme",
      eventSlug: "launch-party",
    });
    expect(canonical).toBe("/e/acme/launch-party");
    const carried = throughAuthQuery(canonical);
    expect(carried).toBe(canonical);
    const { captured, consumed } = roundTrip(carried);
    expect(captured).toBe(canonical);
    expect(consumed).toBe(canonical);
  });
});

describe("issue #2101 — legitimate percent-encoded slug bytes survive (A5.4 3, A6.4 9)", () => {
  test.each([
    ["trip", tripPublicPath({ brandSlug: "acme", tripSlug: "évènement" })],
    [
      "experience",
      experiencePublicPath({ brandSlug: "acme", experienceSlug: "évènement" }),
    ],
    ["event", eventPublicPath({ brandSlug: "acme", eventSlug: "évènement" })],
  ])("%s keeps its safe raw representation with no decode/re-encode corruption", (
    _family,
    canonical,
  ) => {
    expect(canonical).toContain("%C3%A9v%C3%A8nement");
    const { captured, consumed } = roundTrip(throughAuthQuery(canonical));
    expect(captured).toBe(canonical);
    expect(consumed).toBe(canonical);
    const url = sameOriginNoCredentials(canonical);
    expect(url.pathname).toBe(canonical);
  });
});

describe("issue #2101 — hostile matrix, all three families (A5.4 4, A6.4 10)", () => {
  const hostileFor = (head: string): unknown[] => [
    // head-escape / protocol-relative
    "//evil.com",
    "  //evil.com",
    "/\\evil.com",
    `${head}\\evil.com`,
    // scheme
    `javascript:${head}/a`,
    `data:text/html,${head}/a`,
    `https://evil.example${head}/acme/launch-party`,
    // encoded and double-encoded slash at the head
    "%2f%2fevil.com",
    "/%252f%252fevil.com",
    // dot-segment traversal, literal and encoded, aimed at the organiser shell
    `${head}/../event/abc/edit`,
    `${head}/%2e%2e/event/abc/edit`,
    `${head}/./acme/launch-party`,
    // malformed percent-encoding
    `${head}/%ZZ`,
    `${head}/%`,
    // non-string and empty
    [`${head}/a`, `${head}/b`],
    null,
    undefined,
    "",
    "   ",
    // overlength
    `${head}/${"x".repeat(2100)}`,
  ];

  test.each([["/t"], ["/exp"], ["/e"]])(
    "every hostile %s value returns null",
    (head) => {
      for (const value of hostileFor(head)) {
        expect(
          sanitizeNextRoute(value as string | string[] | null | undefined),
        ).toBeNull();
      }
    },
  );
});

describe("issue #2101 — prefix confusion in both directions (A5.4 5, A6.4 11)", () => {
  test.each([
    "/trip",
    "/trips",
    "/experience",
    "/experiences",
    "/event",
    "/event/",
    "/events",
    "/events/x",
    "/t-evil",
    "/exp-evil",
    "/e-evil",
    "/t.evil",
    "/exp.evil",
    "/e.evil",
    "/e_evil",
    "/eventcreate",
    "/E/acme/x",
  ])("%s is rejected", (value) => {
    expect(sanitizeNextRoute(value)).toBeNull();
  });

  test("/event/create is still accepted BECAUSE OF ITS OWN registry entry, not the /e family", () => {
    expect(sanitizeNextRoute("/event/create")).toBe("/event/create");
    expect(sanitizeNextRoute("/event/create/x")).toBe("/event/create/x");
    // Causal proof: the five-entry registry alone already admits it, with the
    // same segment-safe rule the validator uses.
    const admittedByRegistryAlone = NEXT_ROUTE_ALLOWLIST.some(
      (prefix) =>
        "/event/create" === prefix || "/event/create".startsWith(`${prefix}/`),
    );
    expect(admittedByRegistryAlone).toBe(true);
    // And the /e family cannot reach it in the other direction.
    expect("/event/create".startsWith("/e/")).toBe(false);
  });

  test("organiser /event/{uuid}/* routes are NOT admitted by any family", () => {
    const uuid = "0f4d5b1e-3f2a-4a1c-9d0b-8e7c6a5b4d3f";
    for (const suffix of ["", "/edit", "/reconciliation", "/group-chat"]) {
      expect(sanitizeNextRoute(`/event/${uuid}${suffix}`)).toBeNull();
    }
  });

  test("segment-safe matching, not bare startsWith — a reverted /e rule reds this", () => {
    // If `/e` matching degraded to a bare startsWith, "/event" and "/e-evil"
    // would both be accepted. They must stay null.
    expect(sanitizeNextRoute("/event")).toBeNull();
    expect(sanitizeNextRoute("/e-evil")).toBeNull();
    expect(sanitizeNextRoute("/e/acme/launch-party")).toBe("/e/acme/launch-party");
  });
});

describe("issue #2101 — accepted-and-harmless classes are ACCEPTED, with same-origin proof (A6.4 12, A7.4 T5)", () => {
  const acceptedCases: Array<[string, string]> = [
    ["  /e/acme/launch-party  ", "/e/acme/launch-party"],
    ["/e/a%2Fb", "/e/a%2Fb"],
    ["/e/a\\b", "/e/a\\b"],
    ["/e/a\tb", "/e/a\tb"],
    ["/e//evil.com", "/e//evil.com"],
    ["/e/a?next=//evil.com", "/e/a?next=//evil.com"],
    ["/e/a#//evil.com", "/e/a#//evil.com"],
  ];

  test.each(acceptedCases)("%j is accepted as %j and stays same-origin under the real URL parser", (
    input,
    expected,
  ) => {
    const accepted = sanitizeNextRoute(input);
    expect(accepted).toBe(expected);
    const url = sameOriginNoCredentials(accepted as string);
    expect(url.pathname.startsWith("/e/")).toBe(true);
  });

  test("bare family roots /e and /e/ are the deliberate accepted shape (A6.4 13)", () => {
    expect(sanitizeNextRoute("/e")).toBe("/e");
    expect(sanitizeNextRoute("/e/")).toBe("/e/");
    expect(sameOriginNoCredentials("/e").pathname).toBe("/e");
    expect(sameOriginNoCredentials("/e/").pathname).toBe("/e/");
  });

  test("every accepted /t and /exp value also resolves same-origin (A5.4 6)", () => {
    for (const value of ["/t/acme/bali", "/exp/acme/sunset-sail"]) {
      const accepted = sanitizeNextRoute(value);
      expect(accepted).toBe(value);
      const url = sameOriginNoCredentials(accepted as string);
      expect(url.pathname).toBe(value);
    }
  });
});

describe("issue #2101 — per-family revert isolation (A6.4 15)", () => {
  test("each family's canonical happy path is independently asserted", () => {
    // Deleting ONE admission from the internal tuple reds exactly one of these
    // three expectations and leaves the other two green.
    expect(sanitizeNextRoute("/t/acme/bali")).toBe("/t/acme/bali");
    expect(sanitizeNextRoute("/exp/acme/sunset-sail")).toBe(
      "/exp/acme/sunset-sail",
    );
    expect(sanitizeNextRoute("/e/acme/launch-party")).toBe(
      "/e/acme/launch-party",
    );
  });

  test("a revert that restores today's behaviour makes the Event happy path RED", () => {
    // Pre-#2101 the validator returned null for every /e value. This assertion
    // is the exact tripwire for that revert.
    expect(sanitizeNextRoute("/e/acme/launch-party")).not.toBeNull();
  });
});

describe("issue #2101 — the exported five-entry registry is untouched (A6.5 1)", () => {
  test("NEXT_ROUTE_ALLOWLIST still contains exactly the five workflow entries", () => {
    expect([...NEXT_ROUTE_ALLOWLIST].sort()).toEqual([
      "/accept-brand-invitation",
      "/accept-scanner-invitation",
      "/brand",
      "/event/create",
      "/rsvp/create",
    ]);
    expect(NEXT_ROUTE_ALLOWLIST).toHaveLength(5);
  });

  test("the public-offering tuple lives in the same module and is NOT exported", () => {
    const source = readFileSync(
      path.join(BUSINESS_ROOT, "src/utils/nextRoute.ts"),
      "utf8",
    );
    expect(source).toContain("PUBLIC_OFFERING_NEXT_ROUTE_PREFIXES");
    expect(source).not.toContain("export const PUBLIC_OFFERING_NEXT_ROUTE_PREFIXES");
    // One decision owner: the tuple is consumed only inside isAllowlistedPath.
    const uses = source.split("PUBLIC_OFFERING_NEXT_ROUTE_PREFIXES").length - 1;
    expect(uses).toBe(2); // the declaration and the single consumption site
  });
});

describe("issue #2101 A7.3 item 16 — the true sanitizeNextRoute consumer set", () => {
  const CONSUMERS: Array<[string, number]> = [
    ["app/auth/index.tsx", 3],
    ["app/auth/callback.tsx", 1],
    ["app/accept-brand-invitation.tsx", 1],
  ];

  test("exactly three consumer files with exactly five call sites", () => {
    let total = 0;
    for (const [rel, expected] of CONSUMERS) {
      const source = readFileSync(path.join(BUSINESS_ROOT, rel), "utf8");
      const calls = source.match(/sanitizeNextRoute\(/g) ?? [];
      expect([rel, calls.length]).toEqual([rel, expected]);
      total += calls.length;
    }
    expect(total).toBe(5);
  });

  test("no consumer validates a next target outside sanitizeNextRoute", () => {
    for (const [rel] of CONSUMERS) {
      const source = readFileSync(path.join(BUSINESS_ROOT, rel), "utf8");
      // No second sanitizer, no raw redirect to an unvalidated candidate. A
      // doc-comment MENTION of the registry is fine; importing or reading it
      // (a parallel decision path) is not.
      expect(source).not.toMatch(/NEXT_ROUTE_ALLOWLIST\s*[.[]/);
      expect(source).not.toMatch(/import[^;]*NEXT_ROUTE_ALLOWLIST/);
      expect(source).not.toContain("PUBLIC_OFFERING_NEXT_ROUTE_PREFIXES");
    }
  });

  test("buildSwitchAccountResume's hardcoded candidate is admitted by the FIVE-entry registry alone", () => {
    const source = readFileSync(
      path.join(BUSINESS_ROOT, "app/accept-brand-invitation.tsx"),
      "utf8",
    );
    // The pinned ACTIVE invariant I-PROPOSED-1404-WRONG-ACCOUNT-RECOVERABLE:
    // the target must pass the ONE validator, with a bare "/auth" fallback.
    expect(source).toContain("/accept-brand-invitation?token=");
    expect(source).toContain("sanitizeNextRoute(candidate)");
    expect(source).toContain('"/auth"');

    // Causal byte-identity proof: the candidate is matched ONLY by the existing
    // five-entry registry, so the three-family admission cannot change its
    // outcome in either direction.
    const candidate = "/accept-brand-invitation?token=abc123";
    const admittedByRegistryAlone = NEXT_ROUTE_ALLOWLIST.some(
      (prefix) =>
        "/accept-brand-invitation" === prefix ||
        "/accept-brand-invitation".startsWith(`${prefix}/`),
    );
    expect(admittedByRegistryAlone).toBe(true);
    expect(sanitizeNextRoute(candidate)).toBe(candidate);
    for (const family of ["/t", "/exp", "/e"]) {
      expect(candidate.startsWith(`${family}/`)).toBe(false);
    }
  });

  test("no /t, /exp or /e value can be produced by the accept-invitation resume", () => {
    const source = readFileSync(
      path.join(BUSINESS_ROOT, "app/accept-brand-invitation.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/["'`]\/t\//);
    expect(source).not.toMatch(/["'`]\/exp\//);
    expect(source).not.toMatch(/["'`]\/e\//);
  });

  test("a malformed token candidate falls back to bare /auth through the same validator", () => {
    // The exact fallback semantics buildSwitchAccountResume relies on.
    expect(sanitizeNextRoute("/accept-brand-invitation?token=%E0%A4%A")).toBeNull();
  });
});
