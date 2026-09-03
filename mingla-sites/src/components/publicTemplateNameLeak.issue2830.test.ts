import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #2830 — Mingla's internal template name must never render on a CUSTOMER'S
 * OWN public website.
 *
 * It shipped as the hero eyebrow AND the footer eyebrow of every published
 * site, so a member of the public visiting gogi.sites.usemingla.com read
 * "Restaurant Website v1" above the restaurant's own name. A third copy sat in
 * the preview iframe's title, where only screen readers heard it.
 *
 * DELIBERATELY NARROW. `docs/runbooks/MINGLA_SITES_PILOT.md` names "Restaurant
 * Website v1" as APPROVED customer-facing copy — but the customer there is the
 * BRAND OWNER inside Studio and the Website workspace, not the public visitor
 * on the brand's own domain. So this pins the PUBLIC renderer only; the
 * `renderer:` API field and the Studio chrome keep the name on purpose.
 */
const read = (relative: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relative), "utf8");

describe("#2830 public output carries no Mingla template name", () => {
  it("the public renderer never prints it", () => {
    expect(read("src/components/RestaurantV1.tsx")).not.toContain(
      "Restaurant Website v1",
    );
  });

  it("no eyebrow element survives in the hero or the footer", () => {
    const src = read("src/components/RestaurantV1.tsx");
    expect(src).not.toContain('<p className="eyebrow">Restaurant Website v1</p>');
  });

  it("the brand's own display name is still what the footer leads with", () => {
    const src = read("src/components/RestaurantV1.tsx");
    expect(src).toContain(
      '<footer className="footer"><div><strong>{artifact.site_settings.display_name}</strong>',
    );
  });
});
