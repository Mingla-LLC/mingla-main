/*
 * #2829 W7b — what the travel pilot's pixel parity needed, as contracts:
 *  - pictures carry extra renditions (`variants`: 400×300 and 768×576 crops,
 *    1600 wide) that the contract checks name by name, URL by URL and key by
 *    key; voyage offers them as `srcset`, one per width, with the count-aware
 *    grid sizes; a picture without them keeps its single URL;
 *  - the candidate probe checks every rendition file against its own digest;
 *  - "Trips we've run" lists only the owner's picked rows when there are any;
 *  - the contact form shows the owner's name and email hints;
 *  - running prose may say "Usage data: …" while script and data URLs stay
 *    refused.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { readPrivateObject } = vi.hoisted(() => ({ readPrivateObject: vi.fn() }));
vi.mock("../../lib/storageReader", () => ({ readPrivateObject }));
vi.mock("../../lib/config", () => ({ runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 9).toString("base64"), videoCdnHosts: [] }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { VoyagePage } from "./VoyagePage";
import { gridSizes, srcSetFor } from "./parts";
import { voyageSyntheticArtifact } from "../../contracts/voyageSynthetic.fixture";
import { W5, w5EndedTrips } from "../../contracts/w5Content.fixture";
import { assertArtifactV2, type ArtifactV2 } from "../../contracts/generated/artifactV2.ts";
import { historyLedger, ledgerDepartureCount } from "../../contracts/generated/history.ts";
import { assertRichText } from "../../contracts/generated/richText.ts";
import { verifyCandidateMedia } from "../../app/api/internal/candidate-probe/route";
import { sha256 } from "../../lib/crypto";
import { offeringCard, offeringFilters, type LiveOfferings } from "../../lib/offeringCards";
import { resolveSitePath, type ArtifactPage } from "../../lib/pageRouting";
import type { FormsContext } from "../../lib/siteForms";

const NOW = new Date("2026-10-26T12:00:00Z");
const D = (c: string) => c.repeat(64);
const forms = { renderedAt: 1_760_000_000_000, signature: "stamp", enquiries: "available", preview: false, notice: null } as unknown as FormsContext;

function withVariants(artifact: ArtifactV2): ArtifactV2 {
  const media = artifact.media.find((item) => item.object_key.endsWith(".webp"))!;
  const prefix = media.object_key.slice(0, media.object_key.lastIndexOf("/"));
  media.variants = [
    { name: "c400", url: `/media/${media.id}/c400.webp`, width: 400, height: 300, integrity: D("4"), object_key: `${prefix}/c400.webp` },
    { name: "c768", url: `/media/${media.id}/c768.webp`, width: 768, height: 576, integrity: D("7"), object_key: `${prefix}/c768.webp` },
    { name: "w1600", url: `/media/${media.id}/w1600.webp`, width: 1600, height: 1200, integrity: D("6"), object_key: `${prefix}/w1600.webp` },
  ];
  return artifact;
}

async function render(artifact: ArtifactV2, path: string) {
  const offerings = w5EndedTrips();
  const cards = new Map();
  for (const offering of offerings) cards.set(offering.id, await offeringCard(artifact.site_id, offering, NOW, "en"));
  const live: LiveOfferings = { source: "live", offerings, cards, now: NOW, filters: offeringFilters(undefined) };
  const resolved = resolveSitePath(artifact, path);
  const page = resolved.kind === "page" || resolved.kind === "entry" ? (resolved.page as ArtifactPage) : undefined;
  return renderToStaticMarkup(<VoyagePage artifact={artifact} page={page} live={live} forms={forms} nonce="n" notFound={false} />);
}

describe("#2829 W7b picture renditions", () => {
  it("the contract accepts a picture's renditions and refuses a wrong name, URL, key or a repeat", () => {
    const good = withVariants(voyageSyntheticArtifact());
    expect(() => assertArtifactV2(good)).not.toThrow();
    const refuse = (mutate: (variants: Array<Record<string, unknown>>) => void) => {
      const artifact = structuredClone(good);
      mutate(artifact.media.find((item) => item.variants)!.variants as unknown as Array<Record<string, unknown>>);
      expect(() => assertArtifactV2(artifact)).toThrow("ARTIFACT_MEDIA_MISMATCH");
    };
    refuse((variants) => { variants[0]!.name = "c999"; });
    refuse((variants) => { variants[0]!.url = "/media/00000000-0000-4000-8000-000000000000/c400.webp"; });
    refuse((variants) => { variants[0]!.object_key = String(variants[0]!.object_key).replace(/^approved\/[^/]+/, "approved/00000000-0000-4000-8000-000000000000"); });
    refuse((variants) => { variants[1] = { ...variants[0]! }; });
    refuse((variants) => { variants[0]!.integrity = "not-a-digest"; });
  });

  it("voyage offers them as srcset, once per width, and keeps one URL without them", () => {
    const artifact = withVariants(voyageSyntheticArtifact());
    const media = artifact.media.find((item) => item.variants)!;
    expect(srcSetFor(artifact, media.url)).toBe(`/media/${media.id}/c400.webp 400w, /media/${media.id}/c768.webp 768w, /media/${media.id}/w1600.webp 1600w`);
    media.variants![2]!.width = 768; // an upload smaller than 1600: never listed twice
    expect(srcSetFor(artifact, media.url)).toBe(`/media/${media.id}/c400.webp 400w, /media/${media.id}/c768.webp 768w`);
    const plain = voyageSyntheticArtifact();
    expect(srcSetFor(plain, plain.media[0]!.url)).toBeUndefined();
    expect(gridSizes(1)).toBe("(min-width: 1240px) 1160px, 92vw");
    expect(gridSizes(2)).toBe("(min-width: 1240px) 570px, (min-width: 640px) 46vw, 92vw");
    expect(gridSizes(5)).toBe("(min-width: 1240px) 373px, (min-width: 1024px) 31vw, (min-width: 640px) 46vw, 92vw");
  });

  it("the cover photograph carries the srcset in the page", async () => {
    const artifact = withVariants(voyageSyntheticArtifact());
    const media = artifact.media.find((item) => item.variants)!;
    const pages = artifact.pages.filter((page) => JSON.stringify(page.blocks).includes(media.url));
    expect(pages.length).toBeGreaterThan(0);
    const html = await render(artifact, pages[0]!.path);
    expect(html).toContain(`srcSet="/media/${media.id}/c400.webp 400w`);
  });

  it("the candidate probe refuses a rendition whose bytes are not its digest", async () => {
    const bytes = new TextEncoder().encode("rendition");
    const digest = await sha256(bytes);
    readPrivateObject.mockImplementation(async () => new Response(bytes));
    const site = "00000000-0000-4000-8000-000000000001";
    const id = "00000000-0000-4000-8000-000000000002";
    const base = { id, url: `/media/${id}/1440.webp`, alt: "", width: 1440, height: 960, integrity: digest, object_key: `approved/${site}/${id}/${D("a")}/1440.webp` };
    expect(await verifyCandidateMedia([{ ...base, variants: [{ name: "c400", url: `/media/${id}/c400.webp`, width: 400, height: 300, integrity: digest, object_key: `approved/${site}/${id}/${D("a")}/c400.webp` }] }], "approved")).toEqual({ ok: true });
    expect(await verifyCandidateMedia([{ ...base, variants: [{ name: "c400", url: `/media/${id}/c400.webp`, width: 400, height: 300, integrity: D("f"), object_key: `approved/${site}/${id}/${D("a")}/c400.webp` }] }], "approved"))
      .toEqual({ ok: false, reason: "digest_mismatch", object_key: `approved/${site}/${id}/${D("a")}/c400.webp` });
  });
});

describe("#2829 W7b ledger and form", () => {
  it("lists only the owner's picked rows when there are any", async () => {
    const all = historyLedger(w5EndedTrips(), NOW, { kind: "trip" });
    const picked = historyLedger(w5EndedTrips(), NOW, { kind: "trip", offering_ids: [{ id: W5.tripEnded1 }] });
    expect(ledgerDepartureCount(all)).toBeGreaterThan(1);
    expect(ledgerDepartureCount(picked)).toBe(1);
    expect(historyLedger(w5EndedTrips(), NOW, { kind: "trip", offering_ids: [] })).toEqual(all);
    const artifact = voyageSyntheticArtifact();
    const page = artifact.pages.find((row) => row.blocks.some((block) => block.type === "offering_history"))!;
    const block = page.blocks.find((row) => row.type === "offering_history") as Record<string, unknown>;
    block.offering_ids = [{ id: W5.tripEnded1 }];
    delete block.series;
    const html = await render(artifact, page.path);
    expect(html).toMatch(/history__count tnum">1</);
  });

  it("shows the owner's name and email hints in the contact form", async () => {
    const artifact = voyageSyntheticArtifact();
    const page = artifact.pages.find((row) => row.blocks.some((block) => block.type === "contact_form"))!;
    const block = page.blocks.find((row) => row.type === "contact_form") as Record<string, unknown>;
    block.name_placeholder = "Fixture name hint";
    block.email_placeholder = "Fixture email hint";
    expect(() => assertArtifactV2(artifact)).not.toThrow();
    const html = await render(artifact, page.path);
    expect(html).toContain('placeholder="Fixture name hint"');
    expect(html).toContain('placeholder="Fixture email hint"');
  });
});

describe("#2829 W7b prose", () => {
  const doc = (text: string) => ({ type: "doc", children: [{ type: "paragraph", children: [{ type: "text", text }] }] });
  it("allows 'Usage data: …' in running prose and still refuses script and data URLs", () => {
    expect(() => assertRichText(doc("Usage data: the pages you visit."))).not.toThrow();
    expect(() => assertRichText(doc("Device Data: IP address and browser."))).not.toThrow();
    for (const bad of ["data:text/html,<b>x</b>", "see javascript:alert(1)", "<script>x</script>", "blob:https://x", "file:///etc/passwd"]) {
      expect(() => assertRichText(doc(bad)), bad).toThrow("ARTIFACT_RICH_TEXT_MISMATCH");
    }
  });
});
