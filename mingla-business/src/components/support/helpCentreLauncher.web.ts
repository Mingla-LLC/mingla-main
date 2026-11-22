/**
 * #4420 — "Browse all help videos" on web: the Help Centre opens in a NEW tab
 * and the app (and the Ari chat in it) stays where it is.
 *
 * #4420 rework 3 (QA P3-3): this used to call `openExternal`, whose
 * popup-blocked fallback assigns the current location (right for the buyer
 * funnel, where any navigation beats a dead tap). When the browser refused
 * the new tab, the fallback replaced the app with the Help Centre. Here a
 * refused tab rejects instead, and the Support column shows its plain
 * "couldn't open" line; the app is never navigated away.
 *
 * `w` is injectable for tests. Outside a browser it rejects.
 */
export async function openHelpCentre(
  url: string,
  w: Window | undefined = typeof window === "undefined" ? undefined : window,
): Promise<void> {
  if (w === undefined) throw new Error("help_centre_unavailable");
  // No feature string: "noopener" would make open() return null on success.
  const opened = w.open(url, "_blank");
  if (!opened) throw new Error("help_centre_blocked");
  opened.opener = null;
}
