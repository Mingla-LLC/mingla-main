/*
 * #4572 item 13 — the "Private preview · not live" strip was hidden under
 * Maison's fixed header on /preview. Both owner preview pages now draw the
 * share page's 32 px strip (sticky, z 100) and push every design's fixed
 * header below it, exactly as the share page does. No design stylesheet is
 * edited (they are immutable: a change is a new version file).
 * FAILS-ON-REVERT: without PREVIEW_STRIP_CSS / PREVIEW_BANNER_STYLE on the
 * pages, the source assertions fail.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PREVIEW_BANNER_STYLE, PREVIEW_BANNER_TEXT, PREVIEW_STRIP_CSS, SHARED_BANNER_STYLE } from "../../lib/sharedBanner";

/*
 * SHA-256 of every immutable design stylesheet as it stood when #4572 landed
 * (identical to origin/main at 8b971e1ba0). The strip fix lives in
 * PREVIEW_STRIP_CSS, so none of these bytes may move. A real design change is a
 * NEW version file (e.g. maison/2.css), which leaves this list untouched. No git
 * ref is needed, so the check holds in a shallow CI clone.
 */
const IMMUTABLE_DESIGN_SHEETS: Readonly<Record<string, string>> = {
  "_shared/blocks-1.css": "981741fe8474ff29bba2bed1fa9eaa9c4abc89475a00470edcbaaf490969b7cf",
  "_shared/blocks-2.css": "91ef8736c915547780fd35450de3406a81e1746b4c2e9383030797a23b8800f4",
  "_shared/detail-1.css": "97823175c327d2da899f57e4799b6dd04b6498814853ea4b16a84e9d317bf83a",
  "atelier/1.css": "4b91944d30cc68ff7bf32f8c3b9af40c032aecea95d4b0a4e80efb98c3a55648",
  "grid/1.css": "924a4158b332945cac68a89b8c848ac10de830a161a88ad24ed7b560d59f3328",
  "grid/options-1.css": "bc7f349ac36ead737f370f5b1ce856deff79c4f72bc2bd1ff20a3131110f35bd",
  "haven/1.css": "7cf3cf8dea0ddfe72be77818fe4a4036eedc4e2ea4c47efc40aaa0f0e1391d38",
  "journal/1.css": "5c26b091d09043df5e84aa06538db009d2d70af39e9d4e4b4827846caf359237",
  "legacy-v1.css": "7d68932c2a517e3c7588f868029fb206b3fd008bcd6f431ce312bf61a0d677dd",
  "maison/1.css": "4b2cde8eba9d281f45169585627de61cd186e32dbc6b8671ea4f7683c1f9bd1a",
  "nocturne/1.css": "92f3cfad163c60b7bc50c81a6e714621d9d11aa4e7de5d93e0eff34b283488c7",
  "pop/1.css": "6827776e322c92ceb46db8646ca7c40c3d882f21818fd9eff3fb610c939e6bfb",
  "pulse/1.css": "b7b2ebe1c2ff9c34affe2438a4b854b8f90128c89665411f00a7973b709992cc",
  "sunset/1.css": "70e90b788d75f15595c77d3b6ec05584906fa02316462294fec7718c3de5215b",
  "terra/1.css": "59eee03f6eb04f04c13db6c6a89b0a8b3e2954fd865afb35ed63230dfa7b3d1b",
  "voyage/1.css": "48d58df18cfe2b2e27a8659c5b3678ff1508dfb56d1d945f3bad0f6712d54a1c",
};

const src = (file: string) => fs.readFileSync(path.join(process.cwd(), "src/app", file), "utf8");

describe("#4572 item 13 — the preview strip sits above the site header", () => {
  it("one strip style for every preview page, pinned above fixed headers", () => {
    expect(SHARED_BANNER_STYLE).toBe(PREVIEW_BANNER_STYLE);
    expect(PREVIEW_BANNER_STYLE).toMatchObject({ position: "sticky", top: 0, zIndex: 100, height: 32, whiteSpace: "nowrap", textOverflow: "ellipsis" });
    expect(PREVIEW_STRIP_CSS).toContain("[data-preview] :is(.mg-hd,.site-header,.v-header){top:32px !important}");
    expect(PREVIEW_BANNER_TEXT).toBe("Private preview · not live");
  });

  it("/preview (both page shapes) and /plan-preview draw the strip with the page nonce", () => {
    const preview = src("preview/page.tsx");
    expect(preview.match(/<style nonce=\{[^}]+\}>\{PREVIEW_STRIP_CSS\}<\/style>/g)).toHaveLength(2);
    expect(preview.match(/style=\{PREVIEW_BANNER_STYLE\}/g)).toHaveLength(2);
    const plan = src("plan-preview/page.tsx");
    expect(plan).toMatch(/<style nonce=\{[^}]+\}>\{PREVIEW_STRIP_CSS\}<\/style>/);
    expect(plan).toContain("style={PREVIEW_BANNER_STYLE}");
  });

  it("no immutable design stylesheet is edited (pinned digests, no git ref)", () => {
    const root = path.join(process.cwd(), "public/designs");
    const pinned = Object.keys(IMMUTABLE_DESIGN_SHEETS);
    expect(pinned.length).toBeGreaterThanOrEqual(16);
    for (const rel of pinned) {
      const bytes = fs.readFileSync(path.join(root, rel));
      expect({ rel, sha256: createHash("sha256").update(bytes).digest("hex") }).toEqual({ rel, sha256: IMMUTABLE_DESIGN_SHEETS[rel] });
    }
  });
});
