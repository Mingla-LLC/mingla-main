/**
 * #948 W4 [web-skip-download] — implementor unit proof for the invite-funnel
 * signal helpers (SPEC §4.1 / §9).
 *
 * These pin the pure readers + writer that gate the web bank-connect screen's
 * invite-only Back-hide + Skip reveal. The decision helper `decideBankFirstInviteNext`
 * is intentionally NOT exercised here — its bare-href contract stays pinned by
 * its own W3 tests, and this feature appends the signal at the call site.
 *
 * FAILS ON REVERT: the writer + param constants live in bankFirstPartnerInvite.ts
 * (loaded by the eager accept route), the exact-match reader in
 * inviteFunnelSignal.ts (loaded only by the lazy /connect body) — split for the
 * ORCH-1083 __common budget. Delete any of them and this suite fails to
 * import/compile and every case below goes red.
 */

import {
  INVITE_FUNNEL_PARAM,
  INVITE_FUNNEL_VALUE,
  withInviteFunnelParam,
} from "../bankFirstPartnerInvite";
import { isInviteFunnelValue } from "../inviteFunnelSignal";

describe("#948 W4 — invite-funnel signal constants", () => {
  test("the param name is `from` and the value is `invite` (the redirect contract)", () => {
    expect(INVITE_FUNNEL_PARAM).toBe("from");
    expect(INVITE_FUNNEL_VALUE).toBe("invite");
  });
});

describe("#948 W4 — withInviteFunnelParam (the redirect writer)", () => {
  test("appends `?from=invite` to a bare connect path (no existing query)", () => {
    expect(withInviteFunnelParam("/brand/x/connect")).toBe(
      "/brand/x/connect?from=invite",
    );
  });

  test("appends `&from=invite` when a query already exists (?-safe → &)", () => {
    expect(withInviteFunnelParam("/brand/x/connect?provider=stripe")).toBe(
      "/brand/x/connect?provider=stripe&from=invite",
    );
  });

  test("preserves an encodeURIComponent-ed brandId segment verbatim", () => {
    // Mirrors decideBankFirstInviteNext's output for a nasty brandId.
    const bare = "/brand/brand%20%2F%20adversarial%20%23948/connect";
    expect(withInviteFunnelParam(bare)).toBe(`${bare}?from=invite`);
  });
});

describe("#948 W4 — isInviteFunnelValue (the exact-match reader)", () => {
  test("`invite` (string) → true", () => {
    expect(isInviteFunnelValue("invite")).toBe(true);
  });

  test("`[invite]` (first array value) → true", () => {
    expect(isInviteFunnelValue(["invite"])).toBe(true);
    expect(isInviteFunnelValue(["invite", "ignored"])).toBe(true);
  });

  test("undefined → false", () => {
    expect(isInviteFunnelValue(undefined)).toBe(false);
  });

  test("EXACT match, not substring: `invitee` → false", () => {
    // The airtight no-regression guard: a superstring must NOT trip the gate.
    expect(isInviteFunnelValue("invitee")).toBe(false);
  });

  test("any other value → false (`dashboard`, empty string, empty array)", () => {
    expect(isInviteFunnelValue("dashboard")).toBe(false);
    expect(isInviteFunnelValue("")).toBe(false);
    expect(isInviteFunnelValue([])).toBe(false);
    expect(isInviteFunnelValue(["dashboard"])).toBe(false);
  });
});
