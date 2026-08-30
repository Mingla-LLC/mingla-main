import fs from "node:fs";
import path from "node:path";
import {
  studioExchangeUrl,
} from "../../services/brandSitesService";
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

  it("uses the fixed auth-session callback for both native platforms", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "app/brand/[id]/website.tsx"),
      "utf8",
    );
    expect(source).toContain(
      'const RETURN_URL = "mingla-business://website-return";',
    );
    expect(source).toContain(
      'Platform.OS === "web" ? "web" : "native"',
    );
    expect(source).toContain("WebBrowser.openAuthSessionAsync(url, RETURN_URL)");
  });
});
