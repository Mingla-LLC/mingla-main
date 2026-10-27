/*
 * #2829 W7b — CI goldens, step 1: render every page of the two PUBLIC
 * fixtures (the neutral voyage fixture and the gögi-shaped atelier fixture,
 * invented content and flat placeholder media only) to static HTML documents
 * through the real SiteDocument. Step 2 (goldens.mjs) screenshots them in a
 * pinned browser image and compares with the committed goldens under the §7
 * thresholds.
 *
 * Writes only when GOLDENS_RENDER_DIR is set (npm run goldens); otherwise
 * the suite checks the page list without writing anything.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/config", () => ({ runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 9).toString("base64"), videoCdnHosts: [] }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { SiteDocument } from "../../src/components/v2/SiteDocument";
import { voyageSyntheticArtifact } from "../../src/contracts/voyageSynthetic.fixture";
import { w5EndedTrips } from "../../src/contracts/w5Content.fixture";
import { gogiV1Fixture } from "../../src/contracts/gogiV1.fixture";
import { upgradeV1ToV2 } from "../../src/contracts/generated/upgradeV1ToV2.ts";
import type { ArtifactV2 } from "../../src/contracts/generated/artifactV2.ts";
import { offeringCard, offeringFilters, type LiveOfferings } from "../../src/lib/offeringCards";
import { resolveSitePath, sitePages, type ArtifactPage } from "../../src/lib/pageRouting";
import type { FormsContext } from "../../src/lib/siteForms";

const NOW = new Date("2026-10-26T12:00:00Z");
const forms = { renderedAt: 1_760_000_000_000, signature: "stamp", enquiries: "available", preview: false, notice: null } as unknown as FormsContext;

export type GoldenPage = { design: string; name: string; path: string };

function pagePaths(artifact: ArtifactV2): Array<{ name: string; path: string }> {
  const out = sitePages(artifact).filter((page) => page.enabled).map((page) => ({ name: page.path === "" ? "home" : page.path.replace(/\//g, "_"), path: page.path }));
  const destination = artifact.collections?.destinations?.[0];
  if (destination && artifact.routes.destinations !== undefined) out.push({ name: "destination", path: `${artifact.routes.destinations}/${destination.slug}` });
  const story = artifact.collections?.stories?.[0];
  if (story && artifact.routes.stories !== undefined) out.push({ name: "story", path: artifact.routes.stories ? `${artifact.routes.stories}/${story.slug}` : story.slug });
  out.push({ name: "404", path: "this-page-does-not-exist" });
  return out;
}

async function live(artifact: ArtifactV2): Promise<LiveOfferings> {
  const offerings = w5EndedTrips();
  const cards = new Map();
  for (const offering of offerings) cards.set(offering.id, await offeringCard(artifact.site_id, offering, NOW, "en"));
  return { source: "live", offerings, cards, now: NOW, filters: offeringFilters(undefined) };
}

async function documentFor(artifact: ArtifactV2, path: string): Promise<string> {
  const resolved = resolveSitePath(artifact, path);
  const page = resolved.kind === "page" || resolved.kind === "entry" ? (resolved.page as ArtifactPage) : undefined;
  const entry = resolved.kind === "entry" ? resolved.entry : undefined;
  const body = renderToStaticMarkup(
    <SiteDocument artifact={artifact} page={page} entry={entry} live={await live(artifact)} forms={forms} nonce="golden" notFound={resolved.kind === "not_found"} />,
  );
  return `<!doctype html><html lang="${artifact.language}" data-design="${artifact.design.key}" data-motion="${artifact.tokens.motion}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>golden</title></head><body>${body}</body></html>\n`;
}

const FIXTURES: Array<[string, () => ArtifactV2]> = [
  ["voyage", voyageSyntheticArtifact],
  ["atelier", () => upgradeV1ToV2(gogiV1Fixture())],
];

describe("#2829 W7b CI goldens — render", () => {
  it("renders every page of both fixtures", async () => {
    const dir = process.env.GOLDENS_RENDER_DIR;
    const manifest: GoldenPage[] = [];
    for (const [design, make] of FIXTURES) {
      const artifact = make();
      for (const { name, path } of pagePaths(artifact)) {
        const html = await documentFor(artifact, path);
        expect(html).toContain(`data-design="${design}"`);
        manifest.push({ design, name, path });
        if (dir) {
          mkdirSync(resolve(dir, design), { recursive: true });
          writeFileSync(resolve(dir, design, `${name}.html`), html);
        }
      }
    }
    expect(manifest.filter((page) => page.design === "voyage").length).toBeGreaterThanOrEqual(11);
    if (dir) writeFileSync(resolve(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  });
});
