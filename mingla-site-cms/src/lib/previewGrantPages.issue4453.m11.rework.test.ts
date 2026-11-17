/*
 * #4453 m11 rework (spec v2.1 §3.3, SC-AP-Web) — the owner's preview grant lists
 * a Draft page from Ari, marked `draft_by_ari`, so the editor's page menu can
 * tag it "Draft". Owner pages carry no mark; other disabled pages stay out.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/config", () => ({ cmsConfig: () => ({ artifactBucket: "artifact-bucket" }) }));

import { previewGrantPages } from "../endpoints/sitesEndpoints";

describe("#4453 m11 rework previewGrantPages", () => {
  const docs = [
    { id: "home", slug: "", title: "Home", enabled: true },
    { id: "about", slug: "about", title: "About", enabled: true },
    { id: "off", slug: "old", title: "Old page", enabled: false },
    { id: "hire", slug: "private-hire", title: "Private hire", enabled: false, ari_draft: true },
  ];
  const paths = new Map([["home", ""], ["about", "about"], ["off", "old"], ["hire", "private-hire"]]);

  it("lists the Draft page from Ari with the mark, and leaves other disabled pages out", () => {
    expect(previewGrantPages(docs, paths)).toEqual([
      { path: "", title: "Home" },
      { path: "about", title: "About" },
      { path: "private-hire", title: "Private hire", draft_by_ari: true },
    ]);
  });

  it("an owner page (published, no Draft mark) carries no mark", () => {
    const published = docs.map((doc) => (doc.id === "hire" ? { ...doc, enabled: true, ari_draft: false } : doc));
    expect(previewGrantPages(published, paths).find((page) => page.path === "private-hire")).toEqual({ path: "private-hire", title: "Private hire" });
  });
});
