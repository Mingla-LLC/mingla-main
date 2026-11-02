/*
 * #3355 bug 21 -- a call to action with no body printed an empty paragraph
 * on Atelier (and on the v1 restaurant renderer it mirrors). The band now
 * prints the paragraph only when there is text; with text it is unchanged.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RestaurantV1 } from "../../components/RestaurantV1";
import { upgradeV1ToV2 } from "../../contracts/generated/upgradeV1ToV2.ts";
import { gogiV1Fixture } from "../../contracts/gogiV1.fixture";
import { sitePages } from "../../lib/pageRouting";
import { AtelierPage } from "./AtelierPage";

function atelierWith(block: Record<string, unknown>): string {
  const artifact = upgradeV1ToV2(gogiV1Fixture());
  (artifact.pages[0]!.blocks as Array<Record<string, unknown>>).push(block);
  return renderToStaticMarkup(<AtelierPage artifact={artifact} page={sitePages(artifact)[0]} />);
}

function v1With(block: Record<string, unknown>): string {
  const artifact = gogiV1Fixture();
  (artifact.pages[0]!.blocks as Array<Record<string, unknown>>).push(block);
  return renderToStaticMarkup(<RestaurantV1 artifact={artifact} page={sitePages(artifact)[0]} />);
}

const section = (html: string, heading: string): string => {
  const at = html.indexOf(`<h2>${heading}</h2>`);
  expect(at).toBeGreaterThan(-1);
  return html.slice(at, html.indexOf("</section>", at));
};

describe("#3355 call-to-action body", () => {
  for (const [name, render] of [["atelier", atelierWith], ["v1", v1With]] as const) {
    it(`${name}: no body, no empty paragraph`, () => {
      for (const body of [undefined, "", "   "]) {
        const html = render({ type: "cta", heading: "Small groups, long tables", ...(body === undefined ? {} : { body }), label: "Reserve", href: "/trips" });
        const cta = section(html, "Small groups, long tables");
        expect(cta).not.toMatch(/<p>\s*<\/p>/);
        expect(cta).not.toContain("<p>");
      }
    });

    it(`${name}: the owner's words show as the paragraph`, () => {
      const html = render({ type: "cta", heading: "Small groups, long tables", body: "Couples who like slow mornings", label: "Reserve", href: "/trips" });
      expect(section(html, "Small groups, long tables")).toContain("<p>Couples who like slow mornings</p>");
    });
  }
});
