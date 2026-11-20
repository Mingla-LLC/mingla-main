/**
 * #4514 (decision 11, contract C3): brand form links belong to the EXPLORER
 * app; until it opens them, the web page offers "Open in the Explorer app".
 * The Host app serves a `/form` route (so #2180 T-7 lists the segment in
 * SERVED_ROUTE_SEGMENTS), but it must never CLAIM form links: no universal
 * link (AASA) component and no Android intent filter for `/form`.
 *
 * FAILS-ON-REVERT: adding a `/form` component to the Host app's AASA entry or
 * a `/form` pathPrefix to app.json turns this red.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const HOST_APP_ID = "782KVMY869.com.sethogieva.minglabusiness";

describe("#4514 the Host app does not claim brand form links", () => {
  it("the Host app's AASA entry has no /form component", () => {
    const aasa = JSON.parse(
      fs.readFileSync(path.join(ROOT, "public/.well-known/apple-app-site-association"), "utf8"),
    ) as { applinks: { details: { appIDs: string[]; components: { "/": string }[] }[] } };
    const host = aasa.applinks.details.filter((d) => d.appIDs.includes(HOST_APP_ID));
    expect(host.length).toBeGreaterThan(0);
    for (const d of host) {
      for (const c of d.components) expect(c["/"]).not.toMatch(/^\/form(\/|$|\*)/);
    }
  });

  it("app.json's Android intent filters claim no /form path", () => {
    const raw = fs.readFileSync(path.join(ROOT, "app.json"), "utf8");
    const json = JSON.parse(raw) as { expo: { android?: { intentFilters?: { data?: unknown }[] } } };
    const filters = json.expo.android?.intentFilters ?? [];
    expect(filters.length).toBeGreaterThan(0);
    const data = JSON.stringify(filters.map((f) => f.data ?? null));
    expect(data).not.toMatch(/"path(Prefix|Pattern)?":"\/form/);
  });

  it("the /form segment is served (a link handed to the app routes to the page, never claims it)", () => {
    const src = fs.readFileSync(path.join(ROOT, "app/+native-intent.tsx"), "utf8");
    expect(src).toMatch(/\n  "form",\n/);
    expect(fs.existsSync(path.join(ROOT, "app/form"))).toBe(true);
  });
});
