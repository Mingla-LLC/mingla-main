/**
 * #2830 adversarial — attacks a DIFFERENT angle from the happy suite.
 *
 * The happy suite proves the route delegates. This one proves the two things
 * that actually made the buttons dead in production, at the `window.open`
 * boundary itself, against a fake Window that reproduces browser behaviour:
 *
 *  1. NO FEATURE STRING may reach `window.open`. Either `noopener` or
 *     `noreferrer` makes it return null and open nothing — the ORCH-1381
 *     null-return trap. Production was calling
 *     `window.open(url, "_blank", "noopener")`.
 *  2. A GENUINELY BLOCKED popup must still reach the destination. Studio and
 *     Preview open after awaiting a network mutation, so transient activation
 *     is spent and a blocker may refuse whatever the feature string says. A
 *     refusal must degrade to a same-tab navigation, never a dead tap.
 *
 * The "no second opener in the route" rule moved to the #2830 strict-grep gate:
 * I-PROPOSED-1047 is right that a source-text pin in a jest file rots on every
 * refactor, and a structural rule about the module graph belongs in an additive
 * gate. This file keeps only what it can actually EXERCISE.
 */
import { openExternal } from "../../services/guestFunnelLink";

const URL_UNDER_TEST = "https://studio.sites.usemingla.com/preview?token=t";

function fakeWindow(opts: { blocked: boolean }) {
  const calls: unknown[][] = [];
  const assigned: string[] = [];
  const opened = { opener: {} as unknown };
  return {
    calls,
    assigned,
    opened,
    win: {
      open: (...args: unknown[]) => {
        calls.push(args);
        return opts.blocked ? null : opened;
      },
      location: { assign: (dest: string) => assigned.push(dest) },
    } as unknown as Window,
  };
}

describe("#2830 window.open boundary", () => {
  it("passes NO feature string — the ORCH-1381 null-return trap", () => {
    const w = fakeWindow({ blocked: false });
    openExternal(URL_UNDER_TEST, w.win);
    expect(w.calls).toHaveLength(1);
    const args = w.calls[0];
    expect(args[0]).toBe(URL_UNDER_TEST);
    expect(args[1]).toBe("_blank");
    // The production defect, stated as an assertion: a third argument at all.
    expect(args).toHaveLength(2);
    expect(JSON.stringify(args)).not.toMatch(/noopener|noreferrer/);
  });

  it("still severs opener, so dropping the feature string costs no security", () => {
    const w = fakeWindow({ blocked: false });
    openExternal(URL_UNDER_TEST, w.win);
    expect(w.opened.opener).toBeNull();
  });

  it("a blocked popup navigates this tab instead of dying silently", () => {
    const w = fakeWindow({ blocked: true });
    openExternal(URL_UNDER_TEST, w.win);
    expect(w.assigned).toEqual([URL_UNDER_TEST]);
  });

});
