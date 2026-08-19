/**
 * issue #2333 [online-event-publish] — TESTER adversarial client suite. NEW FILE.
 *
 * DIFFERENT ANGLE FROM `issue2333OnlinePublishGuards.happy.test.ts`, which proves the
 * three S4 pieces work on the inputs they were designed for: the customer's exact maps
 * link, a handful of known map hosts, five real conferencing links, a bare guard token
 * and a PostgREST envelope.
 *
 * This file attacks the EDGES of those same three pieces:
 *
 *   Y-1  the map deny-list's HOST PARSER — regional Google TLDs, a trailing-dot FQDN,
 *        userinfo before the host, and a look-alike domain. A deny-list is only as good
 *        as its host normaliser, and every one of these is a real URL a browser resolves.
 *   Y-2  the deny-list must not be an ALLOW-list in disguise (Seth, OQ-2). Eighteen
 *        genuine joining links — self-hosted Jitsi, regional providers, livestream
 *        hosts, and two adversarial paths that MENTION maps — must all pass untouched.
 *   Y-3  the map-deny COPY on the hybrid branch, which shares the same link field.
 *   Y-4  `describeUnmappedPublishGuard`'s token-shape boundaries, exactly at the
 *        `{2,63}` quantifier edges, plus the substring misfire in the guard normaliser.
 *   Y-5  I-2333-UNMAPPED-SERVER-GUARD-NEVER-INVITES-RETRY applied to the EDIT path.
 *        The invariant says "No publish/EDIT error path in mingla-business may render
 *        copy that invites a retry for a server-raised guard it does not recognise."
 *
 * EXPECTED STATE AT THE TIME OF WRITING: Y-1 (two evasions), Y-3 and Y-5 FAIL. Each is
 * a contract this issue's own SPEC or DRAFT invariants declare, so they are written as
 * hard assertions rather than as documentation of a defect.
 *
 * FAILS-ON-REVERT (delete the fix, do not comment it out):
 *   * delete the `isMapLocationUrl` arm from `validateWhere` → every Y-1 denial
 *     assertion and the Y-3 setup go red.
 *   * delete `UNMAPPED_GUARD_TOKEN_SHAPE`'s anchors (`^`/`$`) from paidPublishGuards →
 *     Y-4's "must NOT be named" cases go red, because an unanchored test matches a
 *     token embedded in a hostile string.
 */

import {
  describeUnmappedPublishGuard,
  normalizeProviderNeutralPaidPublishGuardReason,
} from "../paidPublishGuards";
import { validateStep } from "../draftEventValidation";
import type { DraftEvent } from "../../store/draftEventStore";
import { readFileSync } from "fs";
import { join } from "path";

const whereDraft = (onlineUrl: string, format = "online"): DraftEvent =>
  ({
    format,
    venueName: null,
    address: null,
    city: null,
    onlineUrl,
  }) as unknown as DraftEvent;

const messages = (onlineUrl: string, format = "online"): string[] =>
  validateStep(2, whereDraft(onlineUrl, format)).map((e) => e.message);

/** The S4d copy, matched on its distinguishing clause rather than the whole string. */
const MAP_DENY = /map location, not a joining link/i;
const deniedAsMap = (url: string, format = "online"): boolean =>
  messages(url, format).some((m) => MAP_DENY.test(m));

describe("issue #2333 Y-1 — the map deny-list's host parser (tester)", () => {
  // Control: the exact link the reporting customer pasted. If this ever stops being
  // denied, nothing else in this describe block means anything.
  it("still denies the reporting customer's link (control)", () => {
    expect(deniedAsMap("https://maps.app.goo.gl/Qr8MotQCkTcSw7bp8?g_st=ic")).toBe(true);
  });

  it("denies a scheme-less and an UPPERCASE spelling of the same host", () => {
    expect(deniedAsMap("maps.app.goo.gl/xyz")).toBe(true);
    expect(deniedAsMap("HTTPS://MAPS.APP.GOO.GL/XYZ")).toBe(true);
  });

  it("reads the HOST, not a substring — userinfo cannot smuggle a map host past it", () => {
    // Browsers resolve this to maps.app.goo.gl; `zoom.us` is only the username.
    expect(deniedAsMap("https://zoom.us@maps.app.goo.gl/x")).toBe(true);
    // The mirror image: the real host is zoom.us, so this must NOT be denied.
    expect(deniedAsMap("https://maps.app.goo.gl@zoom.us/j/1")).toBe(false);
    // A look-alike registrable domain is not a map host.
    expect(deniedAsMap("https://maps.app.goo.gl.evil.example.com/x")).toBe(false);
  });

  it("denies a REGIONAL Google Maps host with no /maps path", () => {
    // The SPEC's deny-list is written `maps.google.*`. The implementation lists only the
    // literal `maps.google.com`, so every other Google TLD falls through to the
    // /maps-path rule — and `https://maps.google.co.uk/?q=London` has no /maps path.
    // This is a real, browser-resolvable Google Maps URL shape.
    expect(deniedAsMap("https://maps.google.co.uk/?q=London")).toBe(true);
    expect(deniedAsMap("https://maps.google.de/?q=Berlin")).toBe(true);
  });

  it("denies a fully-qualified (trailing-dot) map host", () => {
    // `maps.app.goo.gl.` is the FQDN form of the same host and resolves identically.
    // Neither `host === suffix` nor `host.endsWith("." + suffix)` matches it.
    expect(deniedAsMap("https://maps.app.goo.gl./x")).toBe(true);
  });

  it("keeps denying the hosts the SPEC named explicitly", () => {
    for (const u of [
      "https://www.google.com/maps/place/Lagos",
      "https://goo.gl/maps/abc",
      "https://maps.google.com/?q=Lagos",
      "https://www.google.com.ng/maps/place/X",
      "https://maps.apple.com/?ll=6.5,3.3",
      "https://beta.maps.apple.com/?ll=6.5,3.3",
      "https://what3words.com/filled.count.soap",
      "https://w3w.co/filled.count.soap",
      "https://www.openstreetmap.org/#map=5/1/1",
      "https://waze.com/ul?ll=6.5,3.3",
    ]) {
      expect([u, deniedAsMap(u)]).toEqual([u, true]);
    }
  });
});

describe("issue #2333 Y-2 — a DENY-list, never an allow-list (Seth, OQ-2) (tester)", () => {
  it("lets every genuine joining link through untouched", () => {
    // Seth's OQ-2 decision: "Explicitly NOT an allow-list of video providers — an
    // allow-list silently rejects self-hosted and regional tools we did not anticipate,
    // which trades this dead end for a new one." Self-hosted, regional and livestream
    // hosts are the ones an allow-list would have killed, so they carry the weight here.
    const legitimate = [
      "https://zoom.us/j/123456789",
      "https://us02web.zoom.us/j/1?pwd=x",
      "zoom.us/j/123",
      "https://meet.google.com/abc-defg-hij",
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x",
      "https://whereby.com/mingla",
      "https://meet.jit.si/MinglaExhibition",
      "https://meet.mycompany.co.uk/room-42",
      "https://vk.com/call/xyz",
      "https://meeting.tencent.com/dm/abc",
      "https://webinar.ru/session/1",
      "https://www.youtube.com/live/abcdef",
      "https://twitch.tv/minglahq",
      "https://discord.gg/abcdef",
      "https://app.livestorm.co/p/xyz",
      "https://event.webinarjam.com/go/live/1",
      // Two adversarial paths that MENTION maps but are not map links. A substring
      // implementation would reject both; the host parser must not.
      "https://meet.google.com/maps-team-sync",
      "https://meet.example.com/google.com/maps-review",
    ];
    for (const u of legitimate) {
      expect([u, deniedAsMap(u)]).toEqual([u, false]);
    }
  });

  it("produces NO validation error at all for a plain valid joining link", () => {
    expect(messages("https://meet.jit.si/MinglaExhibition")).toEqual([]);
  });
});

describe("issue #2333 Y-3 — the map-deny copy on the HYBRID branch (tester)", () => {
  it("fires on the hybrid branch, which shares the same link field", () => {
    expect(deniedAsMap("https://maps.app.goo.gl/x", "hybrid")).toBe(true);
  });

  it("does not tell a HYBRID host to go and choose Hybrid", () => {
    // The LOCKED copy ends "...go back to Step 1 and choose In person or Hybrid."
    // On the online branch that is a true instruction. On the hybrid branch the host is
    // ALREADY on Hybrid, so the copy names the state they are in as the remedy — the
    // same class of untrue instruction that EditPublishedScreen's `city_required` arm
    // was fixed for in S4c.
    const copy = messages("https://maps.app.goo.gl/x", "hybrid").find((m) =>
      MAP_DENY.test(m),
    );
    expect(copy).toBeDefined();
    expect(copy).not.toMatch(/choose In person or Hybrid/i);
  });

  it("leaves the in_person branch alone — it renders no link field", () => {
    expect(deniedAsMap("https://maps.app.goo.gl/x", "in_person")).toBe(false);
  });
});

describe("issue #2333 Y-4 — unmapped-guard token shape, at the quantifier edges (tester)", () => {
  const spy = () => jest.spyOn(console, "error").mockImplementation(() => {});

  it("names a token at the SHORT boundary and refuses one below it", () => {
    const s = spy();
    try {
      // /^[a-z][a-z0-9_]{2,63}$/ — three characters is the shortest legal token.
      expect(describeUnmappedPublishGuard("abc")).toContain('"abc"');
      // Two characters is one short, so it must degrade to the honest fallback.
      expect(describeUnmappedPublishGuard("ab")).not.toContain('"ab"');
      expect(describeUnmappedPublishGuard("ab")).toMatch(/your draft is saved/i);
    } finally {
      s.mockRestore();
    }
  });

  it("names a 64-character token and refuses a 65-character one", () => {
    const s = spy();
    try {
      const at64 = "a" + "b".repeat(63);
      const at65 = "a" + "b".repeat(64);
      expect(at64).toHaveLength(64);
      expect(at65).toHaveLength(65);
      expect(describeUnmappedPublishGuard(at64)).toContain(at64);
      expect(describeUnmappedPublishGuard(at65)).not.toContain(at65);
    } finally {
      s.mockRestore();
    }
  });

  it("refuses to echo anything that is not a bare lowercase token", () => {
    const s = spy();
    try {
      for (const hostile of [
        "City_Required", // uppercase
        "city-required", // hyphen
        "city required", // space
        "cityـrequired", // U+0640 ARABIC TATWEEL, not an underscore
        "<b>city_required</b>",
        "city_required; DROP TABLE events",
      ]) {
        const out = describeUnmappedPublishGuard(hostile);
        expect([hostile, out.includes(hostile)]).toEqual([hostile, false]);
        expect(out).toMatch(/your draft is saved/i);
      }
    } finally {
      s.mockRestore();
    }
  });

  it("never invites a retry, on either branch", () => {
    const s = spy();
    try {
      expect(describeUnmappedPublishGuard("some_new_guard")).not.toMatch(/try again/i);
      expect(describeUnmappedPublishGuard("")).not.toMatch(/try again/i);
      expect(describeUnmappedPublishGuard(null)).not.toMatch(/try again/i);
      expect(describeUnmappedPublishGuard("x".repeat(4096))).not.toMatch(/try again/i);
    } finally {
      s.mockRestore();
    }
  });

  it("logs a trace for EVERY branch, including the ones it refuses to quote", () => {
    const s = spy();
    try {
      describeUnmappedPublishGuard("<b>bad</b>");
      describeUnmappedPublishGuard("good_token");
      expect(s).toHaveBeenCalledTimes(2);
    } finally {
      s.mockRestore();
    }
  });

  it("does not mistake an unrelated constraint name for the city guard", () => {
    // `normalizeProviderNeutralPaidPublishGuardReason` is a SUBSTRING contract, so any
    // server string that merely CONTAINS the token is routed to the Where step. A
    // constraint whose NAME embeds the token sends the host to a field that has nothing
    // to do with the failure.
    expect(
      normalizeProviderNeutralPaidPublishGuardReason(
        'new row violates check constraint "chk_no_city_required_v2"',
      ),
    ).toBeNull();
  });
});

describe("issue #2333 Y-5 — I-2333-UNMAPPED-SERVER-GUARD-NEVER-INVITES-RETRY covers the EDIT path (tester)", () => {
  const read = (rel: string): string =>
    readFileSync(join(__dirname, "..", "..", rel), "utf8");
  /** Executable lines only — the fix's own prose explains the retry lie. */
  const code = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("EditPublishedScreen does not invite a retry for an unrecognised server guard", () => {
    // The invariant's Rule names publish AND edit paths. EditPublishedScreen's terminal
    // `else` — the one an unrecognised code actually lands on — reads
    //   "Couldn't save your changes. Tap to try again."
    // That is the identical class bug S4b removed from EventCreatorWizard, and it is
    // reachable TODAY: once 20270422001972 is applied, business_patch_event_taxonomy
    // returns `permission denied for function business_patch_event_taxonomy` to every
    // authenticated caller, which no arm in this chain recognises.
    const editor = code(read("components/event/EditPublishedScreen.tsx"));
    const terminalFallback = editor.match(
      /:\s*"(Couldn't save your changes[^"]*)"/,
    );
    expect(terminalFallback?.[1] ?? "").not.toMatch(/try again/i);
  });

  it("the unmapped-guard describer is the single owner of that copy", () => {
    // Once fixed, the edit path should route through the same tested helper the wizard
    // uses, rather than growing a third hand-written string.
    const editor = code(read("components/event/EditPublishedScreen.tsx"));
    expect(editor).toContain("describeUnmappedPublishGuard");
  });
});
