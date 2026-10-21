#!/usr/bin/env node
// MINGLA-INVARIANT: I-PROPOSED-3827-SHEET-TOP-INSET-AND-OPAQUE-CARD | issue #3827 | Every Sheet reserves the same top band on every platform (the handle on phones, SHEET_TOP_INSET on the wide-desktop card) and the desktop card paints an opaque base so nothing beneath shows through.
/**
 * issue #3827 — every Host sheet has room above its first line and hides what
 * is beneath it, on every platform, because the shared primitive says so.
 * Invariant: I-PROPOSED-3827-SHEET-TOP-INSET-AND-OPAQUE-CARD.
 *
 * WHAT BROKE, AND WHY A GATE.
 *
 * `Sheet` renders as a bottom sheet on phones and narrow web (SheetMobile.tsx)
 * and as a centred card on wide desktop web (Sheet.web.tsx). The bottom sheet
 * reserves a 24pt band at its top with the drag handle; the desktop card had
 * no handle and reserved nothing, so on host.usemingla.com the "New link"
 * title sat flush on the card's top border, and so did the first line of every
 * other sheet that relied on the handle for its top room. The card's fill was
 * also the translucent glass rgba, so a picker opened over a form (Tickets →
 * Add ticket type → Visibility) showed the form's text through its options,
 * while narrow web had been made opaque by ORCH-1207.
 *
 * The fix is in the primitive, so no consumer has to know where it renders:
 *
 * REQUIRE (comments stripped before matching):
 *   S1. SheetMobile.tsx exports `SHEET_TOP_INSET = HANDLE_REGION_HEIGHT` (the
 *       one number for the top band) and still renders the drag handle
 *       (`styles.handleWrap`), which is how the bottom sheet reserves it.
 *   S2. Sheet.web.tsx imports SHEET_TOP_INSET from "./SheetMobile", has a style
 *       `paddingTop: SHEET_TOP_INSET`, and applies that style to the desktop
 *       card body (`styles.cardBody, ... styles.<inset style>`).
 *   S3. SheetMobile.tsx exports WEB_OPAQUE_BACKGROUND as a 6-digit hex (no
 *       alpha), and Sheet.web.tsx imports it and paints it as an
 *       absolute-fill base inside the desktop card.
 *
 * DOES NOT CATCH, stated rather than implied:
 *   - a consumer that pads its own header to zero with a NEGATIVE margin;
 *   - a consumer that passes a translucent `panelBackground` (brand fills are
 *     solid by contract, ORCH-1186);
 *   - the rendered result: the jest suite
 *     `issue_3827_desktop_sheet_inset_and_opaque.implementor.test.tsx` mounts
 *     the desktop card and checks the padding and the base.
 *
 * `--self-test` drives the pure core with fixtures: the compliant pair passes
 * and each single regression is caught.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MOBILE = "mingla-business/src/components/ui/SheetMobile.tsx";
const WEB = "mingla-business/src/components/ui/Sheet.web.tsx";

// ---- pure core ----------------------------------------------------------

/** Remove // and block comments, leaving string and template literals alone. */
export function stripComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const two = src.slice(i, i + 2);
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (two === "//") {
      const end = src.indexOf("\n", i);
      i = end === -1 ? src.length : end;
    } else if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/**
 * @param {{ mobile: string | null, web: string | null }} input raw sources
 * @returns {string[]} violations
 */
export function check(input) {
  const violations = [];
  if (input.mobile === null) return [`S1 ${MOBILE} is missing`];
  if (input.web === null) return [`S2 ${WEB} is missing`];
  const mobile = stripComments(input.mobile);
  const web = stripComments(input.web);

  // S1
  if (!/export\s+const\s+SHEET_TOP_INSET\s*=\s*HANDLE_REGION_HEIGHT\s*;/.test(mobile)) {
    violations.push("S1 SheetMobile.tsx no longer exports SHEET_TOP_INSET = HANDLE_REGION_HEIGHT");
  }
  if (!/style=\{styles\.handleWrap\}/.test(mobile)) {
    violations.push("S1 SheetMobile.tsx no longer renders the drag handle that reserves the top band");
  }

  // S2
  const importBlock = /import\s*\{([^}]*)\}\s*from\s*["']\.\/SheetMobile["']/.exec(web);
  const imported = importBlock === null ? "" : importBlock[1];
  if (!/\bSHEET_TOP_INSET\b/.test(imported)) {
    violations.push('S2 Sheet.web.tsx does not import SHEET_TOP_INSET from "./SheetMobile"');
  }
  const insetStyle = /\n\s*(\w+)\s*:\s*\{\s*paddingTop\s*:\s*SHEET_TOP_INSET\s*,?\s*\}/.exec(web);
  if (insetStyle === null) {
    violations.push("S2 Sheet.web.tsx has no style `{ paddingTop: SHEET_TOP_INSET }`");
  } else {
    const applied = new RegExp(`style=\\{\\[\\s*styles\\.cardBody\\s*,[^\\]]*styles\\.${insetStyle[1]}\\b`).test(web);
    if (!applied) {
      violations.push(`S2 Sheet.web.tsx does not apply styles.${insetStyle[1]} to the desktop card body (styles.cardBody)`);
    }
  }

  // S3
  const hex = /export\s+const\s+WEB_OPAQUE_BACKGROUND\s*=\s*["']([^"']*)["']/.exec(mobile);
  if (hex === null) {
    violations.push("S3 SheetMobile.tsx does not export WEB_OPAQUE_BACKGROUND");
  } else if (!/^#[0-9a-fA-F]{6}$/.test(hex[1])) {
    violations.push(`S3 WEB_OPAQUE_BACKGROUND is "${hex[1]}", not an opaque 6-digit hex`);
  }
  if (!/\bWEB_OPAQUE_BACKGROUND\b/.test(imported)) {
    violations.push('S3 Sheet.web.tsx does not import WEB_OPAQUE_BACKGROUND from "./SheetMobile"');
  }
  const baseStyle = /\n\s*(\w+)\s*:\s*\{\s*backgroundColor\s*:\s*WEB_OPAQUE_BACKGROUND\s*,?\s*\}/.exec(web);
  if (baseStyle === null) {
    violations.push("S3 Sheet.web.tsx has no style `{ backgroundColor: WEB_OPAQUE_BACKGROUND }`");
  } else if (!new RegExp(`StyleSheet\\.absoluteFill\\s*,\\s*styles\\.${baseStyle[1]}\\b`).test(web)) {
    violations.push(`S3 Sheet.web.tsx does not paint styles.${baseStyle[1]} as an absolute-fill base in the desktop card`);
  }
  return violations;
}

// ---- self-test ----------------------------------------------------------
if (process.argv.includes("--self-test")) {
  const mobile = [
    "const HANDLE_REGION_HEIGHT = 2 * (spacing.sm + 2) + 4;",
    "export const SHEET_TOP_INSET = HANDLE_REGION_HEIGHT;",
    'export const WEB_OPAQUE_BACKGROUND = "#16181b";',
    "const X = () => (<View style={styles.handleWrap}><View style={styles.handle} /></View>);",
  ].join("\n");
  const web = [
    'import {\n  Sheet as MobileSheet,\n  SHEET_TOP_INSET,\n  WEB_OPAQUE_BACKGROUND,\n  type SheetProps,\n} from "./SheetMobile";',
    "const Card = () => (<View>",
    "  <View style={[StyleSheet.absoluteFill, styles.opaqueBase]} pointerEvents=\"none\" />",
    "  <View style={[styles.cardBody, competition ? null : styles.cardBodyInset]}>{children}</View>",
    "</View>);",
    "const styles = StyleSheet.create({",
    "  cardBody: { flexShrink: 1 },",
    "  opaqueBase: {\n    backgroundColor: WEB_OPAQUE_BACKGROUND,\n  },",
    "  cardBodyInset: {\n    paddingTop: SHEET_TOP_INSET,\n  },",
    "});",
  ].join("\n");
  const cases = [
    ["the compliant pair passes", { mobile, web }, 0],
    ["S1 the inset no longer derives from the handle", { mobile: mobile.replace("= HANDLE_REGION_HEIGHT;", "= 0;"), web }, 1],
    ["S1 the handle is gone", { mobile: mobile.replace("style={styles.handleWrap}", "style={styles.other}"), web }, 1],
    ["S2 the inset import is gone", { mobile, web: web.replace("  SHEET_TOP_INSET,\n", "") }, 1],
    ["S2 the inset style is deleted (the original bug)", { mobile, web: web.replace("  cardBodyInset: {\n    paddingTop: SHEET_TOP_INSET,\n  },\n", "") }, 1],
    ["S2 the inset style exists but the body no longer uses it", { mobile, web: web.replace("competition ? null : styles.cardBodyInset", "null") }, 1],
    ["S2 a commented-out application does not count", { mobile, web: web.replace("<View style={[styles.cardBody, competition ? null : styles.cardBodyInset]}>", "{/* <View style={[styles.cardBody, styles.cardBodyInset]}> */}<View style={[styles.cardBody]}>") }, 1],
    ["S3 the opaque colour gains alpha", { mobile: mobile.replace('"#16181b"', '"rgba(20, 22, 26, 0.92)"'), web }, 1],
    ["S3 the opaque base is not painted (the see-through picker)", { mobile, web: web.replace("[StyleSheet.absoluteFill, styles.opaqueBase]", "[styles.opaqueBase]") }, 1],
    ["S3 the opaque import is gone", { mobile, web: web.replace("  WEB_OPAQUE_BACKGROUND,\n", "") }, 1],
    ["a missing file fails", { mobile: null, web }, 1],
  ];
  const failures = [];
  for (const [label, input, expected] of cases) {
    const got = check(input);
    if (got.length !== expected) {
      failures.push(`${label}: expected ${expected} violation(s), got ${got.length}: ${JSON.stringify(got)}`);
    }
  }
  if (stripComments('a // x\nb /* y */ c "//z"') !== 'a \nb  c "//z"') {
    failures.push("stripComments does not strip comments and keep string literals");
  }
  if (failures.length > 0) {
    console.error("#3827 sheet-top-inset-and-opaque self-test FAIL:");
    for (const failure of failures) console.error("  - " + failure);
    process.exit(1);
  }
  console.log(`#3827 sheet-top-inset-and-opaque self-test PASS (${cases.length} cases)`);
  process.exit(0);
}

// ---- plain run ----------------------------------------------------------
const read = (rel) => {
  const abs = path.join(ROOT, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
};
const violations = check({ mobile: read(MOBILE), web: read(WEB) });
if (violations.length > 0) {
  console.error("#3827 sheet-top-inset-and-opaque FAIL:");
  for (const violation of violations) console.error("  - " + violation);
  process.exit(1);
}
console.log("#3827 sheet-top-inset-and-opaque PASS (SheetMobile.tsx + Sheet.web.tsx)");
