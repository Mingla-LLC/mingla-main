/**
 * ORCH-1382 (#917) — T-19 / SC-11: `openExternal` must open EXACTLY ONE
 * navigation. This is the BEHAVIORAL proof; the CI gate
 * (orch-1381-open-external-no-double-nav.mjs) is the structural one.
 *
 * ─── THE BUG, LIVE ON PRODUCTION UNTIL THIS COMMIT ─────────────────────────
 *     const win = window.open(dest, '_blank', 'noopener,noreferrer')
 *     if (!win) window.location.assign(dest)
 *
 * Per the HTML spec, `noopener` (and `noreferrer`, which IMPLIES it) force
 * window.open to return `null` EVEN ON SUCCESS. `!win` was therefore ALWAYS
 * true → a tab opened AND the origin page navigated away, on every single tap.
 *
 * ─── WHY THIS TEST IS SHAPED THIS WAY (the decorative-guard lesson) ────────
 * ORCH-1381 shipped this exact bug past TWO GREEN GATES because they asserted
 * TOKEN PRESENCE (`window.location.assign(` appears in the file) rather than
 * BEHAVIOUR. A presence check for an error path CANNOT distinguish "handles the
 * error" from "is permanently IN the error path".
 *
 * So the fake Window below REPRODUCES THE SPEC'S CONTRACT: `open()` returns a
 * real window handle on success ONLY when no opener-nulling feature string was
 * passed, and `null` whenever `noopener`/`noreferrer` is present — exactly like
 * a real browser. That makes the test capable of FAILING on the shipped bug,
 * which is the whole point.
 *
 * ─── WHY IT MATTERS BEYOND THE TAP ────────────────────────────────────────
 * This opener sits behind `SeeWhosGoingGate.tsx:273`, whose ACTIVE contract
 * I-PROPOSED-1342-GATE-NEVER-NAMES-NEVER-REDIRECTS states the page "STAYS
 * MOUNTED, never a redirect". The bug violated that invariant while the
 * invariant read GREEN.
 */

import { openExternal } from "../guestFunnelLink";

/** A fake Window honouring the real HTML-spec null-on-success contract. */
function makeFakeWindow() {
  const opened: Array<{ dest: string; target: string; features?: string }> = [];
  const assigned: string[] = [];
  const popupHandle: { opener: unknown } = { opener: {} };

  const w = {
    open: (dest: string, target: string, features?: string) => {
      opened.push({ dest, target, features });
      // THE CONTRACT: any opener-severing feature string nulls the return, even
      // though the tab DID open. Case-insensitive — browsers are.
      if (features !== undefined && /no(opener|referrer)/i.test(features)) {
        return null;
      }
      return popupHandle;
    },
    location: {
      assign: (dest: string) => {
        assigned.push(dest);
      },
    },
  } as unknown as Window;

  return { w, opened, assigned, popupHandle };
}

/** A fake Window whose popup is genuinely BLOCKED (open always returns null). */
function makeBlockedWindow() {
  const assigned: string[] = [];
  const w = {
    open: () => null,
    location: {
      assign: (dest: string) => {
        assigned.push(dest);
      },
    },
  } as unknown as Window;
  return { w, assigned };
}

const DEST = "https://biz.usemingla.com/ZSCW?pid=business_web&c=brand_invite_accept";

describe("ORCH-1382 openExternal — T-19 / SC-11: exactly ONE navigation", () => {
  it("THE FIX — a successful open does NOT also navigate the origin page away", () => {
    const { w, opened, assigned } = makeFakeWindow();

    openExternal(DEST, w);

    expect(opened).toHaveLength(1);
    expect(opened[0].dest).toBe(DEST);
    expect(opened[0].target).toBe("_blank");
    // SC-11 / the ORCH-1381 trap: location.assign MUST NOT have been called.
    // On the shipped code this array had exactly one entry — every tap.
    expect(assigned).toEqual([]);
  });

  it("passes NO feature string — the thing that nulled the return (both tokens absent)", () => {
    const { w, opened } = makeFakeWindow();

    openExternal(DEST, w);

    expect(opened[0].features).toBeUndefined();
    // Belt and braces: neither token, in any case.
    expect(/no(opener|referrer)/i.test(opened[0].features ?? "")).toBe(false);
  });

  it("severs win.opener = null — the noopener SECURITY property survives its removal", () => {
    const { w, popupHandle } = makeFakeWindow();

    openExternal(DEST, w);

    // Reverse tabnabbing remains impossible: the popup cannot reach back.
    expect(popupHandle.opener).toBeNull();
  });

  it("a GENUINELY blocked popup still navigates — no dead tap, no silent failure", () => {
    const { w, assigned } = makeBlockedWindow();

    openExternal(DEST, w);

    // The fallback is legitimate and must survive: this is the else-branch only.
    expect(assigned).toEqual([DEST]);
  });

  it("REGRESSION SENTINEL — the shipped shape would double-navigate against this same fake", () => {
    // Proves the fake is capable of catching the bug (i.e. this suite is NOT
    // decorative). This is the ORIGINAL code, verbatim, run against the same
    // window contract the fix is tested with.
    const { w, opened, assigned } = makeFakeWindow();

    const shippedOpenExternal = (dest: string, win: Window): void => {
      const handle = win.open(dest, "_blank", "noopener,noreferrer");
      if (!handle) win.location.assign(dest);
    };
    shippedOpenExternal(DEST, w);

    // A tab opened…
    expect(opened).toHaveLength(1);
    // …AND the origin page navigated away. Both. Every tap. That is the bug.
    expect(assigned).toEqual([DEST]);
  });

  it("REGRESSION SENTINEL — the HALF-FIX ('noreferrer' alone) double-navigates identically", () => {
    const { w, assigned } = makeFakeWindow();

    const halfFixed = (dest: string, win: Window): void => {
      const handle = win.open(dest, "_blank", "noreferrer");
      if (!handle) win.location.assign(dest);
    };
    halfFixed(DEST, w);

    // Dropping ONLY noopener changes nothing — this is why the gate bans both.
    expect(assigned).toEqual([DEST]);
  });

  it("is a no-op outside a browser (SSR safety) rather than throwing", () => {
    expect(() => openExternal(DEST, undefined)).not.toThrow();
  });
});
