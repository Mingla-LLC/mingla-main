import fs from "node:fs";
import path from "node:path";
import {
  studioExchangeUrl,
} from "../../services/brandSitesService";
import {
  openStudioHandoff,
  STUDIO_NATIVE_RETURN_URL,
  studioReturnSurface,
} from "../studioHandoff";
import { brandWebsiteReturnPath } from "../studioReturn";

const BRAND_ID = "00000000-0000-4000-8000-000000000002";
const SITE_ID = "00000000-0000-4000-8000-000000000001";

describe("#2830 Studio native/web return", () => {
  it("adds only a closed return-surface enum to the one-time exchange", () => {
    const exchange = {
      site_id: SITE_ID,
      code: "opaque-code",
      destination: "studio" as const,
      expires_at: "2026-08-30T12:00:00Z",
    };
    expect(studioExchangeUrl(exchange, "web")).toContain(
      "&return_surface=web",
    );
    expect(studioExchangeUrl(exchange, "native")).toContain(
      "&return_surface=native",
    );
    expect(studioExchangeUrl(exchange, "native")).not.toContain("redirect=");
  });

  it("lands only at the validated brand Website workspace", () => {
    expect(brandWebsiteReturnPath(BRAND_ID)).toBe(
      `/brand/${BRAND_ID}/website`,
    );
    expect(brandWebsiteReturnPath("https://attacker.invalid")).toBeNull();
    expect(brandWebsiteReturnPath("../../admin")).toBeNull();
  });

  it("executes the fixed auth-session callback on iOS and Android", async () => {
    expect(studioReturnSurface("web")).toBe("web");
    expect(studioReturnSurface("ios")).toBe("native");
    expect(studioReturnSurface("android")).toBe("native");

    const openWeb = jest.fn(async () => undefined);
    const openNative = jest.fn(async () => undefined);
    const bindings = { openWeb, openNative };
    await openStudioHandoff("https://studio.example/exchange", "native", bindings);
    expect(openNative).toHaveBeenCalledWith(
      "https://studio.example/exchange",
      STUDIO_NATIVE_RETURN_URL,
    );
    expect(openWeb).not.toHaveBeenCalled();

    await openStudioHandoff("https://studio.example/exchange", "web", bindings);
    expect(openWeb).toHaveBeenCalledWith("https://studio.example/exchange");
    expect(openNative).toHaveBeenCalledTimes(1);
  });

  it("routes Website previews through the fixed handoff instead of an opaque redirect call", () => {
    const route = fs.readFileSync(
      path.resolve(__dirname, "../../../app/brand/[id]/website.tsx"),
      "utf8",
    );
    expect(route).toContain("openStudioHandoff(\n        grant.preview_url");
    expect(route).toContain("openNative: WebBrowser.openAuthSessionAsync");
    expect(route).not.toMatch(
      /WebBrowser\.openAuthSessionAsync\s*\(\s*grant\.preview_url/,
    );
    expect(route).not.toContain("STUDIO_NATIVE_RETURN_URL");
  });
});
