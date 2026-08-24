// #2539 [brand avatar renders square instead of clipped to a circle] —
// implementor happy-path regression (append-only). SPEC §9 RT-3, T-1..T-6.
//
// WHAT BROKE. `styles.avatar` carried `shadowOpacity/shadowRadius/shadowOffset`
// and `Avatar` added `shadowColor`, and that whole set went to a
// react-native-web `<Image>`. RNW hoists shadow* on an Image into
// `filter: drop-shadow()` on its inner picture layer; WebKit gives a filtered
// child its own composited layer and clips it to a RECTANGLE, discarding the
// ancestor's `border-radius`. The avatar rendered as a full square photo
// painted over its own round orange ring, in Safari only.
//
// WHY THIS TEST IS STRUCTURAL, NOT A COMPUTED-STYLE ASSERTION. Every computed
// style read as intended on the broken code — `border-radius: 30px`,
// `overflow: hidden`, the lot. A test that asserts resolved style values passes
// on the bug. So this pins the MECHANISM: which element the shadow props reach.
// (Source-as-text, mirroring orch_1155_brand_redesign.test.tsx and
// publicMenu.render.test.tsx — this package has no RTL/react-test-renderer
// overlay under the default node/ts-jest config, and any `*.render.test.tsx`
// name is excluded from that config by mingla-business/jest.config.cjs.)
//
// fails-on-revert: restoring `shadowOpacity: 0.26` / `shadowRadius: 18` /
// `shadowOffset` to `styles.avatar`, or `shadowColor` to `avatarStyle`, fails
// T-1; deleting the glow wrapper fails T-2/T-3/T-5. Verified by TRUE LINE
// DELETION (not a comment-out) — see the implementation report.
//
// The primary guard for this defect is the always-on strict-grep class gate
// `.github/scripts/strict-grep/issue-2539-rnw-image-filter-clip.mjs` (batch:A,
// runs on every PR); this file is a supplement to it, never a substitute.
//
// !! NOT YET CI-WIRED. `mingla-business/jest.config.cjs` has rootDir =
// mingla-business, so NOTHING under `packages/**/__tests__` is swept by the
// default suite — the sibling suites in this directory reach CI only because
// `mingla-business/jest.issue679.cfg.cjs` names them one by one in `testMatch`
// and `.github/ci-batch/MANIFEST.json` registers that workflow. The #2539 SPEC
// allowlist contains neither file, so wiring this suite would be an
// out-of-allowlist edit; it is raised as a stop-and-amend in the implementation
// report instead of being done silently. Until it is wired, run it with:
//
//   cd mingla-business && npx jest --config jest.issue679.cfg.cjs --runInBand \
//     --testMatch '**/__tests__/issue_2539_avatar_clip_and_glow.test.tsx'

import fs from "fs";
import path from "path";

const brandPage = fs.readFileSync(
  path.join(__dirname, "..", "PublicBrandPage.tsx"),
  "utf8",
);
const themePalette = fs.readFileSync(
  path.join(__dirname, "..", "..", "offering-rendering", "themePalette.ts"),
  "utf8",
);
const offeringIndex = fs.readFileSync(
  path.join(__dirname, "..", "..", "offering-rendering", "index.ts"),
  "utf8",
);

const SHADOW_PROPS = [
  "shadowColor",
  "shadowOpacity",
  "shadowOffset",
  "shadowRadius",
] as const;

/** Slice from `startToken` through the brace/bracket group that follows it. */
function blockAfter(src: string, startToken: string, opener: "{" | "["): string {
  const start = src.indexOf(startToken);
  if (start < 0) throw new Error(`token not found in PublicBrandPage.tsx: ${startToken}`);
  const open = src.indexOf(opener, start + startToken.length);
  if (open < 0) throw new Error(`no "${opener}" after: ${startToken}`);
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === opener) depth += 1;
    else if (src[i] === closer) {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced ${opener} after: ${startToken}`);
}

/** Strip line + block comments so prose naming a prop never satisfies a check. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Everything from `const Avatar` to the next top-level component declaration. */
const avatarSource = stripComments(
  brandPage.slice(
    brandPage.indexOf("const Avatar: React.FC<"),
    brandPage.indexOf("const SocialLinksRow"),
  ),
);
/** `styles.avatar`'s own style body. */
// NOTE the token deliberately stops BEFORE the `{`: `blockAfter` searches for
// the opener AFTER the token, so a token ending in `{` would skip past this
// block and return `avatarInitial`'s body instead. (It did, on the first run.)
const stylesAvatar = stripComments(
  blockAfter(stripComments(brandPage), "\n  avatar:", "{"),
);
/** The style array handed to the <Image> / initials <View>. */
const avatarStyleArray = blockAfter(avatarSource, "const avatarStyle =", "[");
/** The glow wrapper's style object. */
const glowStyleObject = blockAfter(avatarSource, "const glowStyle", "{");

describe("#2539 brand avatar — round clip survives WebKit, glow renders", () => {
  test("T-1 the <Image>'s resolved style carries NO shadow*/filter prop, and IS rounded", () => {
    // The <Image> resolves exactly styles.avatar + the avatarStyle inline object.
    for (const prop of SHADOW_PROPS) {
      expect(stylesAvatar).not.toMatch(new RegExp(`(^|[\\s,{])${prop}\\s*:`));
      expect(avatarStyleArray).not.toMatch(new RegExp(`(^|[\\s,{])${prop}\\s*:`));
    }
    expect(avatarStyleArray).not.toMatch(/(^|[\s,{])filter\s*:/);
    // …and no filter-producing PROP on the element either.
    const imageTag = avatarSource.slice(
      avatarSource.indexOf("<Image"),
      avatarSource.indexOf("/>", avatarSource.indexOf("<Image")),
    );
    expect(imageTag).not.toMatch(/\btintColor\s*=/);
    expect(imageTag).not.toMatch(/\bblurRadius\s*=/);
    // The round crop itself is still there — this is not "fixed" by unrounding.
    expect(avatarStyleArray).toMatch(/borderRadius:\s*size\s*\/\s*2/);
    expect(stylesAvatar).toMatch(/overflow:\s*"hidden"/);
    // The <Image> is the element the style array is handed to.
    expect(imageTag).toMatch(/style=\{avatarStyle\}/);
  });

  test("T-2 ONE glow wrapper wraps BOTH branches — photo <Image> and initials <View>", () => {
    const returned = avatarSource.slice(avatarSource.indexOf("return ("));
    const openWrapper = returned.indexOf("<View style={glowStyle}>");
    const closeWrapper = returned.lastIndexOf("</View>");
    expect(openWrapper).toBeGreaterThanOrEqual(0);
    const inside = returned.slice(openWrapper, closeWrapper);
    // both branches live inside the single wrapper
    expect(inside).toContain("<Image");
    expect(inside).toContain("styles.avatarInitial");
    expect(inside).toMatch(/brand\.photo !== undefined && brand\.photo\.length > 0 \?/);
    // the wrapper is the OUTERMOST node the component returns
    expect(returned.indexOf("<View style={glowStyle}>")).toBeLessThan(returned.indexOf("<Image"));
    // the initials <View> itself carries no shadow — it uses the same avatarStyle
    expect(inside).toMatch(/<View style=\{avatarStyle\}>/);
  });

  test("T-3 wrapper contract: exactly the avatar's box, no overflow, no backgroundColor", () => {
    expect(glowStyleObject).toMatch(/(^|[\s,{])width:\s*size\s*,/);
    expect(glowStyleObject).toMatch(/(^|[\s,{])height:\s*size\s*,/);
    expect(glowStyleObject).toMatch(/(^|[\s,{])borderRadius:\s*size\s*\/\s*2\s*,/);
    // Either would defeat the fix: overflow re-clips the glow away, a
    // backgroundColor paints an opaque square behind the round avatar.
    expect(glowStyleObject).not.toMatch(/(^|[\s,{])overflow\s*:/);
    expect(glowStyleObject).not.toMatch(/(^|[\s,{])backgroundColor\s*:/);
    // The wrapper stays a plain layout box — no second accessible node.
    const wrapperTag = avatarSource.slice(
      avatarSource.indexOf("<View style={glowStyle}"),
      avatarSource.indexOf(">", avatarSource.indexOf("<View style={glowStyle}")) + 1,
    );
    expect(wrapperTag).not.toMatch(/accessibility/i);
    expect(wrapperTag).not.toMatch(/\brole=/);
  });

  test("T-4 both call sites go through the same Avatar — default 84 and the 60px sticky panel", () => {
    expect(avatarSource).toMatch(/size = 84/);
    expect(brandPage).toContain("<Avatar brand={brand} palette={palette} />");
    expect(brandPage).toContain("<Avatar brand={brand} palette={palette} size={60} />");
    // Both sizes derive the wrapper box from `size`, so T-1..T-3 hold at both.
    expect(glowStyleObject).toMatch(/width:\s*size/);
    expect(avatarStyleArray).toMatch(/width:\s*size/);
  });

  test("T-5 glow fidelity: boxShadow array form, offsetY 10, blur 18, alpha 0.26 of the accent", () => {
    const boxShadow = blockAfter(glowStyleObject, "boxShadow:", "[");
    expect(boxShadow).toMatch(/offsetX:\s*0\s*,/);
    expect(boxShadow).toMatch(/offsetY:\s*10\s*,/);
    expect(boxShadow).toMatch(/blurRadius:\s*18\s*,/);
    expect(boxShadow).toMatch(/spreadDistance:\s*0\s*,/);
    expect(boxShadow).toMatch(/color:\s*hexToRgba\(palette\.accent,\s*0\.26\)/);
    // boxShadow, never shadow*: the array form is what RNW maps to a real CSS
    // box-shadow on a View and what RN 0.81 Fabric honours through a clip.
    for (const prop of SHADOW_PROPS) {
      expect(glowStyleObject).not.toMatch(new RegExp(`(^|[\\s,{])${prop}\\s*:`));
    }
    // hexToRgba must be a real, imported export — not a local re-definition.
    expect(brandPage).toMatch(/^\s*hexToRgba,$/m);
    expect(brandPage).not.toMatch(/const hexToRgba\s*=/);
    expect(themePalette).toMatch(/export const hexToRgba = \(hex: string, alpha: number\): string =>/);
    expect(offeringIndex).toMatch(/^\s*hexToRgba,$/m);
  });

  test("T-6 exactly one accessible node still carries the avatar label", () => {
    const labels = avatarSource.match(/accessibilityLabel=/g) ?? [];
    expect(labels).toHaveLength(1);
    const imageTag = avatarSource.slice(
      avatarSource.indexOf("<Image"),
      avatarSource.indexOf("/>", avatarSource.indexOf("<Image")),
    );
    expect(imageTag).toMatch(/accessibilityLabel=\{`\$\{brand\.displayName\} avatar`\}/);
  });

  test("the protective comment naming the mechanism stays with styles.avatar", () => {
    // A future author deleting this is the exact failure mode that shipped the
    // bug: the props look harmless and the reason lives only in an issue.
    const raw = brandPage.slice(
      brandPage.indexOf("#2539 — NO shadow* here"),
      brandPage.indexOf("  avatar: {"),
    );
    expect(raw).toContain("react-native-web");
    expect(raw).toContain("filter");
    expect(raw).toContain("RECTANGLE");
  });
});
