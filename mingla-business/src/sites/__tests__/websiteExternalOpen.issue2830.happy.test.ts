/**
 * #2830 — the Website workspace's external opens must not go through
 * react-native-web's `Linking.openURL`, which calls
 * `window.open(url, "_blank", "noopener")`. Instrumenting the live production
 * page on 2026-09-03 recorded that exact call, returning null with no tab
 * opened, for Open Mingla Studio, Preview draft and View live website.
 *
 * FAILS ON REVERT: restore `openWeb: Linking.openURL` (or hand the live-site
 * action back to `Linking.openURL`) and the web assertions below fail, because
 * the mocked `Linking.openURL` receives the call that `openExternal` should.
 */
const openExternal = jest.fn<void, [string]>();
const openURL = jest.fn<Promise<boolean>, [string]>(async () => true);

jest.mock("../../services/guestFunnelLink", () => ({
  openExternal: (url: string) => openExternal(url),
}));
jest.mock("react-native", () => ({
  Platform: { OS: "web" },
  Linking: { openURL: (url: string) => openURL(url) },
}));

import { openWebsiteUrl } from "../websiteExternalOpen";

const STUDIO = "https://studio.sites.usemingla.com/mingla/exchange?code=abc";

beforeEach(() => {
  openExternal.mockClear();
  openURL.mockClear();
});

describe("#2830 Website workspace external opens", () => {
  it("routes a web open through openExternal, never Linking.openURL", async () => {
    await openWebsiteUrl(STUDIO, "web");
    expect(openExternal).toHaveBeenCalledWith(STUDIO);
    expect(openURL).not.toHaveBeenCalled();
  });

  it("leaves native on Linking.openURL — iOS and Android were never broken", async () => {
    await openWebsiteUrl(STUDIO, "ios");
    expect(openURL).toHaveBeenCalledWith(STUDIO);
    expect(openExternal).not.toHaveBeenCalled();

    openURL.mockClear();
    await openWebsiteUrl(STUDIO, "android");
    expect(openURL).toHaveBeenCalledWith(STUDIO);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("resolves on web so an awaiting caller is never left hanging", async () => {
    await expect(openWebsiteUrl(STUDIO, "web")).resolves.toBeUndefined();
  });
});
