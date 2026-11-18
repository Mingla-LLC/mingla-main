/*
 * #4453 — "Rebuild my pages". Once a site existed, Build was never offered
 * again, so an owner could not get Ari's composed pages back (found live on
 * Gameland Lagos, 2026-11-18: after switching to Pop, no path in Host re-ran
 * the composer). The draft-ready screen now offers it to whoever may manage
 * the site; Core re-checks the rank and the approved plan.
 */
import { canRebuildPages } from "../setupStatus";

describe("#4453 Rebuild my pages is offered", () => {
  it("to a manager with the lock free on a running site", () => {
    expect(canRebuildPages({ canManage: true, lockHeldByOther: false, paused: false })).toBe(true);
    expect(canRebuildPages({ canManage: true, lockHeldByOther: false, paused: undefined })).toBe(true);
  });

  it("never while a teammate holds the setup lock", () => {
    expect(canRebuildPages({ canManage: true, lockHeldByOther: true, paused: false })).toBe(false);
  });

  it("never to someone who can't manage the site, or on a paused site", () => {
    expect(canRebuildPages({ canManage: false, lockHeldByOther: false, paused: false })).toBe(false);
    expect(canRebuildPages({ canManage: undefined, lockHeldByOther: false, paused: false })).toBe(false);
    expect(canRebuildPages({ canManage: true, lockHeldByOther: false, paused: true })).toBe(false);
  });
});
