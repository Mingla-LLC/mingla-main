/*
 * #4453 website workspace (build contract D) — the private preview route:
 * where the section list comes from, who gets it, and what the bridge may do
 * under the preview's real Content-Security-Policy.
 *
 *   - The owner's preview reads the list Studio stores beside the preview
 *     artifact and marks the page's sections; the bridge is mounted on a page
 *     of sections AND on an offering page.
 *   - Any failure reading the list means the page renders exactly as before.
 *   - A share link, the public site and the plan preview never read it.
 *   - The policy stays strict (nonce + strict-dynamic, no inline script), the
 *     bridge needs nothing the policy forbids, and the origins it talks to are
 *     the origins allowed to frame the preview.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const { headers, loadPreviewArtifact, sharedPreviewForRequest, readPrivateObject } = vi.hoisted(() => ({
  headers: vi.fn(),
  loadPreviewArtifact: vi.fn(),
  sharedPreviewForRequest: vi.fn(),
  readPrivateObject: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers }));
vi.mock("next/navigation", () => ({ usePathname: () => "/preview", notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("../../lib/config", () => ({ runtimeConfig: () => ({ mode: "production", artifactBucket: "artifact-bucket", runtimeHmac: Buffer.alloc(32, 9).toString("base64"), videoCdnHosts: [] }) }));
vi.mock("../../lib/publication", () => ({ requestHost: () => "brand.sites.usemingla.com", resolveHostSite: async () => ({ site_id: "s", brand_id: "b", hostname: "brand.sites.usemingla.com" }) }));
vi.mock("../../lib/previewArtifact", async (original) => ({ ...(await original<typeof import("../../lib/previewArtifact")>()), loadPreviewArtifact }));
vi.mock("../../lib/shareLinks", () => ({ SHARE_TOKEN: /^[A-Za-z0-9_-]{43}$/, sharedPreviewForRequest }));
vi.mock("../../lib/pageExtras", () => ({ loadPageExtras: async () => ({}) }));
vi.mock("../../lib/storageReader", () => ({ readPrivateObject }));
// The bridge draws nothing on the server; here it prints what it was given so the mount can be read.
vi.mock("../../components/PreviewBridge", () => ({
  PreviewBridge: (props: { localMode: boolean; pagePath: string; sections: unknown[] }) => <i data-test-bridge={JSON.stringify(props)} />,
}));

import { voyageSyntheticArtifact } from "../../contracts/voyageSynthetic.fixture";
import { buildPreviewSections } from "../../contracts/generated/previewSections.ts";
import { buildCsp, frameAncestorsFor } from "../../lib/csp";
import { MINGLA_BUSINESS_ORIGIN, MINGLA_STUDIO_ORIGIN } from "../../lib/origins";
import { parsePreviewArtifactKey } from "../../lib/previewArtifact";
import { loadPreviewSectionIds } from "../../lib/previewSections";
import { previewParentAllowed } from "../../lib/previewTokens";
import { galleryArtifact } from "../../designs/shared/galleryDesigns.fixture";
import { sitePages } from "../../lib/pageRouting";
import type { SiteArtifact } from "../../lib/siteArtifact";
import PreviewPage from "./page";
import SharedPreviewPage from "./share/[token]/page";

const SITE = "aaaaaaaa-1111-4111-8111-111111111111";
const PREVIEW_ID = `preview-${"c".repeat(32)}`;
const DIGEST = "d".repeat(64);
const KEY = `publications/${SITE}/${PREVIEW_ID}/${DIGEST}.json`;
const SECTIONS_KEY = `publications/${SITE}/${PREVIEW_ID}/${DIGEST}.sections`;
const TOKEN = "T".repeat(43);
const MARKER = /(?:<!-- -->)?\n\t\n/g;

const asPreview = (artifact: unknown) => ({ ...(artifact as Record<string, unknown>), site_id: SITE, publication_id: PREVIEW_ID }) as unknown as SiteArtifact;
const ids = (count: number, tag = "a") => Array.from({ length: count }, (_, index) => `${tag}${String(index).padStart(23, "0")}`);
const stored = (body: unknown, status = 200) => readPrivateObject.mockImplementation(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
const team = async (artifact: SiteArtifact, path: string) => {
  loadPreviewArtifact.mockResolvedValue(artifact);
  return renderToString(await PreviewPage({ searchParams: Promise.resolve({ k: KEY, path }) }) as ReactElement);
};
const bridgeProps = (html: string) => [...html.matchAll(/data-test-bridge="([^"]*)"/g)].map((match) => JSON.parse(match[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, "&")) as { localMode: boolean; pagePath: string; sections: Array<{ id: string; type: string }> });

beforeEach(() => {
  vi.clearAllMocks();
  headers.mockResolvedValue(new Headers({ "x-nonce": "bm9uY2U=" }));
});

describe("#4453 D: the owner's preview marks its sections from Studio's list", () => {
  it.each([["haven (gallery page)", () => asPreview(galleryArtifact("haven"))], ["voyage (its own page)", () => asPreview(voyageSyntheticArtifact())]])(
    "%s: every block gets a marker and the bridge gets the ids in block order",
    async (_name, make) => {
      const artifact = make();
      const home = sitePages(artifact).find((page) => page.path === "")!;
      const about = sitePages(artifact).find((page) => page.path !== "" && page.enabled && page.blocks.length > 0)!;
      const homeIds = ids(home.blocks.length);
      homeIds[1] = ""; // a section Studio gave no id for
      stored(buildPreviewSections(DIGEST, [{ path: "", ids: homeIds }, { path: about.path, ids: ids(about.blocks.length, "b") }]));
      const html = await team(artifact, "");
      expect(readPrivateObject).toHaveBeenCalledWith("artifact-bucket", SECTIONS_KEY, "no-store");
      expect(html.match(MARKER)).toHaveLength(home.blocks.length);
      expect(bridgeProps(html)).toEqual([{
        localMode: false,
        pagePath: "",
        sections: home.blocks.map((block, index) => ({ id: homeIds[index], type: block.type })),
      }]);
      // Another page of the same preview reads its own entry.
      const aboutHtml = await team(artifact, about.path);
      expect(bridgeProps(aboutHtml)[0]).toMatchObject({ pagePath: about.path, sections: about.blocks.map((block, index) => ({ id: ids(about.blocks.length, "b")[index], type: block.type })) });
      // The ids are in the DOM only through the bridge: the page's own markup never carries them.
      expect(html.replace(/data-test-bridge="[^"]*"/g, "")).not.toContain(homeIds[0]);
    },
  );

  it("no list, an older Studio, a failed read or a list that does not fit: the page is exactly the page", async () => {
    const artifact = asPreview(galleryArtifact("haven"));
    const home = sitePages(artifact).find((page) => page.path === "")!;
    stored(buildPreviewSections(DIGEST, [{ path: "", ids: ids(home.blocks.length) }]));
    const marked = await team(artifact, "");
    const cases: Array<[string, () => void]> = [
      ["no object", () => stored("", 404)],
      ["storage failing", () => readPrivateObject.mockRejectedValue(new Error("STORAGE_UNAVAILABLE"))],
      ["not JSON", () => stored("<html>")],
      ["another artifact's list", () => stored(buildPreviewSections("e".repeat(64), [{ path: "", ids: ids(home.blocks.length) }]))],
      ["a list of the wrong length", () => stored(buildPreviewSections(DIGEST, [{ path: "", ids: ids(home.blocks.length - 1) }]))],
      ["no entry for this page", () => stored(buildPreviewSections(DIGEST, [{ path: "about", ids: ids(home.blocks.length) }]))],
      ["too large", () => stored(`{"v":1,"artifact_digest":"${DIGEST}","pages":{"":[]},"pad":"${"x".repeat(300_000)}"}`)],
    ];
    let plain: string | null = null;
    for (const [name, arrange] of cases) {
      arrange();
      const html = await team(artifact, "");
      expect(html, name).not.toMatch(MARKER);
      expect(bridgeProps(html), name).toEqual([{ localMode: false, pagePath: "", sections: [] }]);
      plain ??= html;
      expect(html, name).toBe(plain);
    }
    // And the marked page is that same page plus the markers (and the bridge's list).
    // React's generated ids are renumbered by a marker (opaque labels); everything else is compared as it is.
    const strip = (html: string) => {
      const names = new Map<string, string>();
      return html.replace(MARKER, "").replace(/data-test-bridge="[^"]*"/g, "").replace(/_R_[A-Za-z0-9]*_/g, (id) => names.get(id) ?? (names.set(id, `_R_${names.size}_`), names.get(id)!));
    };
    expect(strip(marked)).toBe(strip(plain!));
  });

  it("the loader asks only for the object beside a preview artifact, and never throws", async () => {
    const parsed = parsePreviewArtifactKey(KEY)!;
    stored(buildPreviewSections(DIGEST, [{ path: "", ids: ids(2) }]));
    expect(await loadPreviewSectionIds(parsed, { path: "", blocks: [{}, {}] })).toEqual(ids(2));
    // A page with no blocks has nothing to mark: nothing is read.
    readPrivateObject.mockClear();
    expect(await loadPreviewSectionIds(parsed, { path: "", blocks: [] })).toBeNull();
    expect(readPrivateObject).not.toHaveBeenCalled();
    // A key that is not a preview artifact (it cannot get here, and still): nothing is read.
    expect(await loadPreviewSectionIds({ ...parsed, key: `publications/${SITE}/00000000-0000-4000-8000-000000000001/${DIGEST}.json` }, { path: "", blocks: [{}] })).toBeNull();
    expect(readPrivateObject).not.toHaveBeenCalled();
  });
});

describe("#4453 D: nobody but the owner's preview gets section marks", () => {
  it("a share link of the same preview never reads the list and carries no mark", async () => {
    const artifact = asPreview(galleryArtifact("haven"));
    const home = sitePages(artifact).find((page) => page.path === "")!;
    stored(buildPreviewSections(DIGEST, [{ path: "", ids: ids(home.blocks.length) }]));
    sharedPreviewForRequest.mockResolvedValue({ artifact, key: KEY, expiresAt: null });
    const html = renderToString(await SharedPreviewPage({ params: Promise.resolve({ token: TOKEN }), searchParams: Promise.resolve({ path: "" }) }) as ReactElement);
    expect(readPrivateObject).not.toHaveBeenCalled();
    expect(html).not.toMatch(MARKER);
    expect(html).not.toContain("data-test-bridge");
    expect(html).not.toContain("data-mingla-section");
  });

  it("only the owner's preview route loads the list or the bridge", () => {
    const root = resolve(process.cwd(), "src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|\/generated\//.test(full)) files.push(full);
      }
    };
    walk(root);
    const users = (needle: RegExp) => files.filter((file) => needle.test(readFileSync(file, "utf8"))).map((file) => file.slice(root.length + 1)).sort();
    expect(users(/\bloadPreviewSectionIds\(/)).toEqual(["app/preview/page.tsx", "lib/previewSections.ts"]);
    expect(users(/<PreviewBridge\b/)).toEqual(["app/preview/page.tsx"]);
    expect(users(/\bstartPreviewBridge\(/)).toEqual(["components/PreviewBridge.tsx", "lib/previewBridge.ts"]);
    // `previewSectionIds` is set in one place (the owner's preview) and read by the three page components.
    expect(users(/previewSectionIds:/)).toEqual(["app/preview/page.tsx"]);
    expect(users(/current\.previewSectionIds\b/)).toEqual(["designs/atelier/AtelierPage.tsx", "designs/shared/GalleryPage.tsx", "designs/voyage/VoyagePage.tsx"]);
  });

  it("the bridge is mounted on an offering page too (no sections, still answers the workspace)", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/preview/page.tsx"), "utf8");
    const detail = source.slice(source.indexOf('if (detailed?.kind === "detail")'), source.indexOf('if (resolved.kind !== "page" && resolved.kind !== "entry") notFound();'));
    expect(detail).toContain("<PreviewBridge localMode={previewLocalMode()} pagePath={previewPath} sections={[]} />");
    expect(source.match(/<PreviewBridge\b/g)).toHaveLength(2);
    // The old colours-only bridge is gone: one bridge answers every message.
    expect(source).not.toContain("PreviewTokenBridge");
  });
});

describe("#4453 D: the preview's Content-Security-Policy stays strict and the bridge fits inside it", () => {
  const policy = (csp: string, name: string) => csp.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";

  it("scripts need the request's nonce (strict-dynamic); no inline script, no eval, on the preview as on the public site", () => {
    for (const pathname of ["/preview", "/"]) {
      const script = policy(buildCsp({ nonce: "bm9uY2U=", pathname }), "script-src");
      expect(script).toBe("script-src 'self' 'nonce-bm9uY2U=' 'strict-dynamic'");
      expect(script).not.toContain("unsafe-inline");
      expect(script).not.toContain("unsafe-eval");
    }
    const csp = buildCsp({ nonce: "n", pathname: "/preview" });
    expect(policy(csp, "connect-src")).toBe("connect-src 'self'");
    expect(policy(csp, "base-uri")).toBe("base-uri 'none'");
    expect(policy(csp, "object-src")).toBe("object-src 'none'");
  });

  it("the bridge adds no script, no stylesheet and no markup: it needs nothing the policy forbids", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/previewBridge.ts"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const forbidden of [
      "innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "setAttribute(\"style\"", "cssText",
      "createElement(\"script\")", "createElement(\"style\")", "createElement(\"link\")", "createElement(\"iframe\")", "fetch(", "XMLHttpRequest", "import(",
    ]) expect(source, forbidden).not.toContain(forbidden);
    // Only these elements are ever created, and every style goes through the style object.
    expect([...source.matchAll(/createElement\("([a-z]+)"\)/g)].map((match) => match[1]).sort()).toEqual(["button", "div", "div", "div", "div", "div"]);
    // It never posts to every origin.
    expect(source).not.toMatch(/postMessage\([^)]*["'`]\*["'`]/);
    expect(source).toContain("win.parent.postMessage(message, origin)");
    const component = readFileSync(resolve(process.cwd(), "src/components/PreviewBridge.tsx"), "utf8");
    expect(component).toContain("return null;");
    expect(component).not.toContain("dangerouslySetInnerHTML");
  });

  it("the origins the bridge talks to are exactly the origins that may frame the preview", () => {
    const allowed = (origin: string, localMode = false) => previewParentAllowed(origin, { localMode });
    const ancestors = frameAncestorsFor("/preview").split(" ");
    expect(ancestors).toEqual(["'self'", MINGLA_BUSINESS_ORIGIN, MINGLA_STUDIO_ORIGIN]);
    for (const origin of ancestors.slice(1)) expect(allowed(origin)).toBe(true);
    const vercel = "https://mingla-business-git-4453-abc.vercel.app";
    expect(frameAncestorsFor("/preview", { frameAncestor: vercel })).toContain(vercel);
    expect(allowed(vercel)).toBe(true);
    expect(frameAncestorsFor("/preview", { frameAncestor: "https://evil.example" })).not.toContain("evil.example");
    expect(allowed("https://evil.example")).toBe(false);
    expect(frameAncestorsFor("/preview", { localMode: true })).toContain("http://localhost:*");
    expect(allowed("http://localhost:8081", true)).toBe(true);
    expect(allowed("http://localhost:8081")).toBe(false);
    // Every other page may not be framed at all, so the bridge has no one to talk to there.
    expect(frameAncestorsFor("/")).toBe("'none'");
    expect(frameAncestorsFor(`/preview/share/${TOKEN}`)).toBe("'none'");
  });
});
