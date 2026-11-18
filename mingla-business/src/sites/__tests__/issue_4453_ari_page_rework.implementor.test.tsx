/**
 * #4453 m11 rework — the editor side of "Add a page with Ari":
 *   - P2-2 (spec v2.1 §3.2-§3.3, SC-AP-Web): the editor's preview page menu tags a
 *     Draft page from Ari "Draft", and Ari's questions show over the preview frame,
 *     read from the owner's own Pages data (never from a preview artifact);
 *   - P3-3: with SITES_ARI_ADD_PAGE off, the Draft page card has no Save (Core
 *     would refuse it): the questions are read-only;
 *   - P3-4: Escape closes the add-a-page sheets on web (top-most overlay only).
 * FAILS ON REVERT: drop the tag, the overlay, the flag-off branch or the Escape hook.
 */
import React from "react";
import { readFileSync } from "fs";
import { join } from "path";

type Node = { type: unknown; props: Record<string, unknown>; children: unknown[] };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => { root: { findAll: (p: (n: Node) => boolean) => Node[] }; unmount: () => void };
  act: (callback: () => Promise<void> | void) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPages = {
  pages: [
    { id: "p-home", path: "", title: "Home", enabled: true },
    {
      id: "p-hire", path: "private-hire", title: "Private hire", enabled: false, origin: "ari", ari_draft: true,
      owner_questions: [{ key: "capacity", question: "How many guests can a private hire take?", block_index: 1, field_path: "caption" }],
    },
  ],
};
jest.mock("../contentApi", () => ({ useSitePages: () => ({ data: mockPages }) }));
jest.mock("../../components/sites/website/preview/ScaledPreviewFrame", () => ({ ScaledPreviewFrame: "ScaledPreviewFrame" }));
jest.mock("../../components/sites/website/WebsiteIcon", () => ({ WebsiteIcon: () => null }));

// eslint-disable-next-line import/first
import { SitePreviewPanel } from "../../components/sites/website/preview/SitePreviewPanel";
// eslint-disable-next-line import/first
import { useWebEscapeClose } from "../../components/ui/useWebEscapeClose";

const textOf = (root: { findAll: (p: (n: Node) => boolean) => Node[] }): string =>
  root.findAll((n) => n.type === "Text").map((n) => n.children.filter((c) => typeof c === "string").join("")).join("\n");

describe("#4453 m11 rework the editor preview (P2-2)", () => {
  const grant = {
    kind: "ready" as const,
    previewUrl: "https://studio.example/preview?token=t",
    siteId: "s1",
    pages: [{ path: "", title: "Home" }, { path: "private-hire", title: "Private hire", draft_by_ari: true as const }],
  };
  const mount = async () => {
    let r!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      r = TestRenderer.create(
        <SitePreviewPanel grant={grant} preference={{ device: "desktop" } as never} onPreference={() => undefined} purpose="p" onOpenFullScreen={() => undefined} />,
      );
    });
    return r;
  };

  it("the page menu tags the Draft page from Ari, and only it", async () => {
    const r = await mount();
    expect(r.root.findAll((n) => n.props.testID === "preview-page-private-hire-tag").length).toBeGreaterThan(0);
    expect(r.root.findAll((n) => n.props.testID === "preview-page-/-tag")).toHaveLength(0);
    expect(textOf(r.root)).toContain("Draft");
  });

  it("Ari's questions show over the frame only on the Draft page", async () => {
    const r = await mount();
    expect(r.root.findAll((n) => n.props.testID === "preview-ari-overlay")).toHaveLength(0);
    const tab = r.root.findAll((n) => n.props.testID === "preview-page-private-hire" && typeof n.props.onPress === "function")[0]!;
    await TestRenderer.act(async () => { (tab.props.onPress as () => void)(); });
    expect(r.root.findAll((n) => n.props.testID === "preview-ari-overlay").length).toBeGreaterThan(0);
    const text = textOf(r.root);
    expect(text).toContain("Ari needs this");
    expect(text).toContain("How many guests can a private hire take?");
    expect(text).toContain("Only you see these questions.");
  });
});

describe("#4453 m11 rework Pages (P3-3, P3-4)", () => {
  const pages = readFileSync(join(__dirname, "../../components/sites/website/sections/PagesSection.tsx"), "utf8");

  it("flag off: the Draft card's questions are read-only (no field, no Save)", () => {
    expect(pages).toContain("<AriDraftPageCard key={`ari-${row.id}`} row={row} readOnly={readOnly} ariAddPage={ariAddPage} />");
    expect(pages).toMatch(/\{!ariAddPage \? questions\.map\(\(question\) => \(\s*<Text key=\{question\.key\}/);
  });

  it("every add-a-page sheet closes on Escape on web", () => {
    expect(pages.match(/useWebEscapeClose\(/g)?.length).toBe(3);
  });
});

describe("#4453 m11 rework useWebEscapeClose (P3-4)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Platform } = require("react-native") as { Platform: { OS: string } };
  const listeners = new Set<(e: { key: string }) => void>();
  const original = Platform.OS;
  beforeAll(() => {
    Platform.OS = "web";
    (globalThis as { document?: unknown }).document = {
      addEventListener: (_t: string, l: (e: { key: string }) => void) => listeners.add(l),
      removeEventListener: (_t: string, l: (e: { key: string }) => void) => listeners.delete(l),
    };
  });
  afterAll(() => {
    Platform.OS = original;
    delete (globalThis as { document?: unknown }).document;
  });
  const Probe = ({ visible, onClose }: { visible: boolean; onClose: () => void }) => {
    useWebEscapeClose(visible, onClose);
    return null;
  };

  it("Escape closes the open sheet; only the top-most one when two are open; nothing when closed", async () => {
    const lower = jest.fn();
    const upper = jest.fn();
    let r!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      r = TestRenderer.create(<><Probe visible onClose={lower} /><Probe visible onClose={upper} /><Probe visible={false} onClose={jest.fn()} /></>);
    });
    await TestRenderer.act(async () => { for (const l of [...listeners]) l({ key: "Escape" }); });
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
    await TestRenderer.act(async () => { for (const l of [...listeners]) l({ key: "Enter" }); });
    expect(upper).toHaveBeenCalledTimes(1);
    await TestRenderer.act(async () => { r.unmount(); });
    expect(listeners.size).toBe(0);
  });
});
