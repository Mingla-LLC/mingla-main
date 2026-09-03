import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import { RestaurantV1 } from "./RestaurantV1";
import { homePage } from "../lib/pageRouting";
import { assertRestaurantArtifact } from "../contracts/artifact";
import type { RestaurantArtifact } from "../contracts/artifact";

/**
 * #2830 -- the hero video, and the rules it must obey.
 *
 * gogi's own hero is a looping video, so parity needs one. What it must never
 * become is a page whose headline is invisible until 4MB arrives, or motion
 * pushed at somebody who asked their operating system for less of it.
 */
const U = (n: number) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, "0")}`;
const artifact = {
  schema_version: 1,
  site_id: U(1), brand_id: U(2), publication_id: U(3),
  renderer_key: "restaurant-website-v1", renderer_version: 1,
  source_revision_id: U(4), source_digest: "a".repeat(64),
  generated_at: "2026-09-03T00:00:00Z",
  pages: [{ role: "home", slug: "home", title: "Home", enabled: true,
    nav_label: "Home", nav_order: 0, blocks: [
      { type: "hero", heading: "Where Lagos comes to eat", subheading: "sub",
        media_url: `/media/${U(9)}/1440.webp`,
        video_url: `/media/${U(8)}/video.mp4`, ctas: [] }] }],
  navigation: { page_roles: ["home"] },
  footer: { address: "69 Admiralty Way", legal_text: "c 2026", links: [] },
  site_settings: { display_name: "gogi", seo: { canonical_url: "https://gogi.sites.usemingla.com" } },
  media: [
    { id: U(9), url: `/media/${U(9)}/1440.webp`, alt: "", width: 1440, height: 960,
      integrity: "b".repeat(64), object_key: `approved/${U(1)}/${U(9)}/${"b".repeat(64)}/1440.webp` },
    { id: U(8), url: `/media/${U(8)}/video.mp4`, alt: "", width: 0, height: 0,
      integrity: "c".repeat(64), object_key: `approved/${U(1)}/${U(8)}/${"c".repeat(64)}/master.mp4` },
  ],
  commercial_references: [],
} as unknown as RestaurantArtifact;

const html = () =>
  renderToStaticMarkup(<RestaurantV1 artifact={artifact} page={homePage(artifact)!} />);
const hero = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/HeroVideo.tsx"), "utf8");
const css = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/styles.css"), "utf8");

describe("#2830 hero video", () => {
  it("the POSTER is server-rendered, so the headline never waits on the video", () => {
    const out = html();
    expect(out).toContain("background-image");
    expect(out).toContain("1440.webp");
    expect(out).toContain("Where Lagos comes to eat");
  });

  it("does NOT mount a video during server render", () => {
    // The client decides whether motion is allowed at all, so nothing about
    // the video reaches a visitor who never runs the script.
    expect(html()).not.toContain("<video");
  });

  it("mounts nothing at all for prefers-reduced-motion, not a paused video", () => {
    expect(hero).toContain('"(prefers-reduced-motion: reduce)"');
    expect(hero).toContain("if (!query || query.matches) return;");
    expect(hero).toContain("if (!allowed) return null;");
  });

  it("skips the download on a metered connection", () => {
    expect(hero).toContain("saveData");
  });

  it("is silent, unfocusable and hidden from assistive technology", () => {
    expect(hero).toContain("muted");
    expect(hero).toContain('aria-hidden="true"');
    expect(hero).toContain("tabIndex={-1}");
    expect(hero).toContain("playsInline");
    expect(hero).not.toContain("controls");
  });

  it("the video sits under the copy and over the poster", () => {
    expect(css).toContain(".hero-video");
    expect(css).toContain("object-fit: cover");
    expect(css).toContain(".hero > div { z-index: 2; }");
  });

  it("a video WITHOUT a poster is refused by the contract", () => {
    const bad = JSON.parse(JSON.stringify(artifact));
    delete bad.pages[0].blocks[0].media_url;
    expect(() => assertRestaurantArtifact(bad)).toThrow();
  });

  it("a hero with only a poster is perfectly valid", () => {
    const stillOnly = JSON.parse(JSON.stringify(artifact));
    stillOnly.pages[0].blocks[0].video_url = null;
    expect(() => assertRestaurantArtifact(stillOnly)).not.toThrow();
  });

  it("refuses an unsafe video href", () => {
    const bad = JSON.parse(JSON.stringify(artifact));
    bad.pages[0].blocks[0].video_url = "javascript:alert(1)";
    expect(() => assertRestaurantArtifact(bad)).toThrow();
  });

  it("a video media reference is integrity-checked exactly like an image", () => {
    const bad = JSON.parse(JSON.stringify(artifact));
    bad.media[1].integrity = "not-a-digest";
    expect(() => assertRestaurantArtifact(bad)).toThrow();
  });

  it("a video reference cannot escape its tenant's key prefix", () => {
    const bad = JSON.parse(JSON.stringify(artifact));
    bad.media[1].object_key = `approved/${U(77)}/${U(8)}/x/master.mp4`;
    expect(() => assertRestaurantArtifact(bad)).toThrow();
  });

  it("an IMAGE still must declare real dimensions", () => {
    const bad = JSON.parse(JSON.stringify(artifact));
    bad.media[0].width = 0;
    expect(() => assertRestaurantArtifact(bad)).toThrow();
  });
});
