/**
 * #4420 rework 3 (G7, QA P3-3): "Browse all help videos" on web opens the
 * Help Centre in a NEW tab and never replaces the app.
 *
 * FAILS-ON-REVERT: the old launcher called openExternal, whose popup-blocked
 * fallback assigns the current location: test 2 then sees the app navigated away
 * and no rejection.
 */
import { openHelpCentre } from "../helpCentreLauncher.web";

function fakeWindow(openResult: { opener: unknown } | null) {
  const open = jest.fn(() => openResult);
  const assign = jest.fn();
  const w = { open, location: { assign } } as unknown as Window;
  return { w, open, assign };
}

describe("#4420 Help Centre launcher (web)", () => {
  const url = "https://usemingla.com/help";

  test("1. opens the Help Centre in a new tab, with no opener", async () => {
    const tab = { opener: {} as unknown };
    const { w, open, assign } = fakeWindow(tab);
    await openHelpCentre(url, w);
    expect(open).toHaveBeenCalledWith(url, "_blank");
    expect(tab.opener).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  test("2. a refused tab rejects (the column shows its line) and the app is not navigated", async () => {
    const { w, open, assign } = fakeWindow(null);
    await expect(openHelpCentre(url, w)).rejects.toThrow("help_centre_blocked");
    expect(open).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });

  test("3. outside a browser it rejects", async () => {
    await expect(openHelpCentre(url, undefined)).rejects.toThrow("help_centre_unavailable");
  });
});
