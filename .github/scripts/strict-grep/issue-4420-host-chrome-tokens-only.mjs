#!/usr/bin/env node
// MINGLA-INVARIANT: I-HOST-CHROME-TOKENS-ONLY | issue #4420 | Host chrome takes every colour from designSystem.ts and every blur from ui/Material.tsx: no colour literal and no expo-blur import anywhere else in mingla-business/{app,src}.
/**
 * issue #4420 — Graphite Glass: one token file, one glass owner.
 * Invariant: I-HOST-CHROME-TOKENS-ONLY.
 *
 * WHY. Before #4420 the Host app carried ~1,300 raw colour literals in ~350
 * files and five copy-pasted per-file `FALLBACK_BACKGROUND` constants, which is
 * how Android ended up "too transparent" and how every screen drifted. The
 * redesign moves every colour into `src/constants/designSystem.ts` and every
 * blur into `src/components/ui/Material.tsx`. This gate keeps it that way.
 *
 * RULE, over `mingla-business/{app,src}/**\/*.{ts,tsx}` minus tests
 * (`__tests__/`, `*.test.*`), `__styleguide.tsx` and `.d.ts` files, with
 * comments stripped first:
 *   C1. no colour literal: a hex (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`),
 *       `rgb(` / `rgba(` / `hsl(` / `hsla(`, or a named colour as the string
 *       value of `color | backgroundColor | borderColor | tintColor |
 *       shadowColor` (`transparent` is not a colour choice and is allowed);
 *   C2. no `expo-blur` import or require.
 *
 * ALLOWLIST: `COLOUR_ALLOWLIST` below, one reviewed entry per path (relative
 * to mingla-business/; a trailing `/` covers a folder), each with the reason
 * its colours are CONTENT rather than chrome. An entry whose path no longer
 * exists fails the plain run, so the list cannot rot. C2 (expo-blur) is
 * allowed in src/components/ui/Material.tsx only.
 *
 * MODES. Since #4420 wave 6 the gate ENFORCES by default: any offender exits
 * 1. `ISSUE_4420_REPORT=1` prints the same report and exits 0 (local triage
 * only; CI never sets it). `--json` prints the report as JSON.
 *
 * DOES NOT CATCH, stated rather than implied: a colour built at runtime from
 * numbers (`\`rgb${...}\`` assembled piecewise), a colour imported from a
 * package outside mingla-business, or a named colour assigned to a prop other
 * than the five above. Content colours that arrive as data (host theme, photo)
 * are out of scope by design.
 *
 * `--self-test` drives the pure core with fixtures: a planted hex literal and an
 * expo-blur import both fire, the allowlist passes, tests and comments are
 * ignored, and enforce mode turns offenders into a non-zero exit.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd().endsWith("mingla-business") ? path.resolve(process.cwd(), "..") : process.cwd();
const BUSINESS = "mingla-business";
const SCAN_DIRS = ["app", "src"];

/** Reviewed content-colour allowlist (#4420 wave 6). Every entry says why. */
export const COLOUR_ALLOWLIST_ENTRIES = [
  { path: "src/constants/designSystem.ts", reason: "the token file itself (palette, plus the trafficAnalytics, ariPalette and brandMarks content palettes)" },
  { path: "src/components/ui/Material.tsx", reason: "the one glass owner; reads materials, no literals of its own beyond the recipe" },
  { path: "src/components/theme/", reason: "host theme presets and the theme editor: the host's own colours are content" },
  { path: "src/services/offeringTheme.ts", reason: "host offering themes: content" },
  { path: "src/utils/buttonAccentContrast.ts", reason: "contrast maths on host-chosen colours" },
  { path: "src/components/marketing/ComposerV2/composerChipHtml.ts", reason: "email-body HTML: inline CSS that ships inside the sent email, where design tokens do not exist" },
  { path: "src/components/marketing/EmailPreviewPane.tsx", reason: "renders the email body exactly as a recipient's mail client paints it (white mail canvas)" },
  { path: "src/components/marketing/ComposerV2/ComposerV2Editor.tsx", reason: "the <hr> it inserts is email-body HTML (inline CSS sent to recipients)" },
  { path: "src/components/auth/BusinessWelcomeScreen.tsx", reason: "the welcome video veil, Apple button and caption shadows are pinned by the #2052 welcome-video contract" },
  { path: "src/components/brand/BrandProfileView.tsx", reason: "the cover gradient is built from the brand's own coverHue (data)" },
  { path: "src/components/sites/website/sections/DesignSection.tsx", reason: "an example colour code inside host-facing copy (\"Try something like #89cff0\")" },
  { path: "src/sites/designMoods.ts", reason: "#4453 mood presets: the colours of the owner's WEBSITE (content sent to the site as its look), never Host chrome; proven readable by src/sites/__tests__/issue_4453_ws_moods" },
  { path: "src/components/event/useBusinessRsvpPhoneField.tsx", reason: "the field error colour is chosen against the host theme's foreground (host-theme content)" },
  { path: "src/components/orders/OrderListCard.tsx", reason: "the buyer avatar tile hue is generated from the buyer's name (data)" },
  { path: "src/utils/brandGroupThreadModel.ts", reason: "the brand tile hues are generated from the brand id (data)" },
  { path: "src/analytics/ConsentBanner.web.tsx", reason: "the analytics/privacy bar is out of #4420 scope by rule, and its CSS is a verbatim mirror of server/publicPrivacyRuntime.js pinned by #922/#4318" },
  { path: "src/components/ui/UpdateLaunchBoundary.tsx", reason: "the launch-failure screen is a byte twin of app-mobile's (only the services path may differ), pinned by the #2107 structural contract; it paints before the app's tokens can be trusted" },
  { path: "src/screens/ari/AriRenditionGalleryScreen.tsx", reason: "local dev rendition review tool (production redirect), excluded from the redesign" },
];
export const COLOUR_ALLOWLIST = COLOUR_ALLOWLIST_ENTRIES.map((entry) => entry.path);
export const BLUR_ALLOWLIST = ["src/components/ui/Material.tsx"];

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

/** Is `rel` (relative to mingla-business/) inside the scanned surface? */
export function isScanned(rel) {
  if (!/\.(ts|tsx)$/.test(rel) || /\.d\.ts$/.test(rel)) return false;
  if (!SCAN_DIRS.some((dir) => rel.startsWith(`${dir}/`))) return false;
  if (/(^|\/)__tests__\//.test(rel) || /\.test\.(ts|tsx)$/.test(rel)) return false;
  if (/(^|\/)__styleguide\.tsx$/.test(rel)) return false;
  return true;
}

const allowed = (rel, list) => list.some((entry) => (entry.endsWith("/") ? rel.startsWith(entry) : rel === entry));

// A hex colour: 3, 4, 6 or 8 hex digits after `#`, not preceded by a word char
// or `&` (HTML entities), not followed by another hex/word char.
const HEX = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w])/g;
const FUNC = /\b(?:rgba?|hsla?)\(/g;
const NAMED = [
  "white", "black", "red", "green", "blue", "gray", "grey", "orange", "yellow", "purple", "pink",
  "brown", "cyan", "magenta", "silver", "gold", "navy", "teal", "maroon", "olive", "lime", "aqua",
  "fuchsia", "indigo", "violet", "beige", "coral", "crimson", "salmon", "tomato", "khaki",
  "lavender", "turquoise", "tan", "plum", "orchid", "ivory", "darkgray", "darkgrey", "lightgray",
  "lightgrey", "dimgray", "dimgrey", "whitesmoke", "gainsboro",
];
const NAMED_PROP = new RegExp(
  `\\b(?:color|backgroundColor|borderColor|tintColor|shadowColor)\\s*[:=]\\s*\\{?\\s*["'\`](${NAMED.join("|")})["'\`]`,
  "gi",
);
const BLUR_IMPORT = /(?:from\s*["']expo-blur["']|require\(\s*["']expo-blur["']\s*\)|import\(\s*["']expo-blur["']\s*\))/g;

const count = (re, s) => (s.match(re) || []).length;

/**
 * Hex matches, minus issue references. An all-decimal match (`#4420`, `#123`)
 * is a colour only when it sits where a colour value sits: right after a
 * quote, `(`, `,` or `:` (optionally one space). `"[#4304] retry"` and
 * `toward #4420` are not colours; `"#000"` and `color: #111` are.
 */
const countHex = (code) => {
  let n = 0;
  for (const m of code.matchAll(HEX)) {
    if (/^#\d+$/.test(m[0])) {
      // #4420 wave 6: "(#4238 W6-5)" in prose is an issue ref, so `(` no
      // longer counts as a colour position for an all-decimal match.
      const before = code.slice(Math.max(0, m.index - 2), m.index);
      if (!/(?:["'`,:]|[,:] )$/.test(before)) continue;
    }
    n += 1;
  }
  return n;
};

/**
 * Comment removal that survives apostrophes in JSX text: drop JSX comments and
 * whole-line comments first, then run the string-aware stripper.
 */
const stripAll = (src) =>
  stripComments(
    src
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
      .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
      .replace(/^\s*\/\/.*$/gm, ""),
  );

/**
 * @param {string} rel path relative to mingla-business/
 * @param {string} src raw source
 * @returns {{ colours: number, blur: number }} offending occurrences
 */
export function checkFile(rel, src) {
  const code = stripAll(src);
  const colours = allowed(rel, COLOUR_ALLOWLIST)
    ? 0
    : countHex(code) + count(FUNC, code) + count(NAMED_PROP, code);
  const blur = allowed(rel, BLUR_ALLOWLIST) ? 0 : count(BLUR_IMPORT, code);
  return { colours, blur };
}

/** Group key for the report: the first two path segments (e.g. `src/components/event`). */
export function folderOf(rel) {
  const parts = rel.split("/");
  if (parts[0] === "src" && parts[1] === "components" && parts.length > 3) return parts.slice(0, 3).join("/");
  return parts.slice(0, Math.min(2, parts.length - 1)).join("/");
}

/**
 * @param {Array<[string, string]>} files [rel, src] pairs
 */
export function scan(files) {
  const offenders = [];
  for (const [rel, src] of files) {
    if (!isScanned(rel)) continue;
    const result = checkFile(rel, src);
    if (result.colours > 0 || result.blur > 0) offenders.push({ file: rel, ...result });
  }
  const byFolder = {};
  for (const o of offenders) {
    const key = folderOf(o.file);
    byFolder[key] ??= { files: 0, colours: 0, blur: 0 };
    byFolder[key].files += 1;
    byFolder[key].colours += o.colours;
    byFolder[key].blur += o.blur;
  }
  return {
    files: offenders.length,
    colours: offenders.reduce((n, o) => n + o.colours, 0),
    blur: offenders.reduce((n, o) => n + o.blur, 0),
    byFolder,
    offenders,
  };
}

/** Enforce unless ISSUE_4420_REPORT=1 (wave 6: enforcing is the default). */
export function enforceFromEnv(env) {
  return env.ISSUE_4420_REPORT !== "1";
}

/** Exit status for a report: 0 in report mode, 1 when enforcing and anything offends. */
export function exitCode(report, enforce) {
  return enforce && (report.colours > 0 || report.blur > 0) ? 1 : 0;
}

// ---- self-test ----------------------------------------------------------
if (process.argv.includes("--self-test")) {
  const failures = [];
  const expectCheck = (label, rel, src, want) => {
    const got = isScanned(rel) ? checkFile(rel, src) : { colours: 0, blur: 0 };
    if (got.colours !== want.colours || got.blur !== want.blur) {
      failures.push(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
  };
  const screen = "src/components/event/EventCard.tsx";
  expectCheck("a planted hex literal fires", screen, 'const s = { backgroundColor: "#16181b" };', { colours: 1, blur: 0 });
  expectCheck("a short hex fires", "app/(tabs)/home.tsx", "const c = '#fff';", { colours: 1, blur: 0 });
  expectCheck("an rgba() fires", screen, 'const c = "rgba(20, 22, 26, 0.92)";', { colours: 1, blur: 0 });
  expectCheck("an hsla() fires", screen, "const c = `hsla(20, 72%, 64%, 0.45)`;", { colours: 1, blur: 0 });
  expectCheck("a named colour on a colour prop fires", screen, '<Icon color="white" />; const s = { borderColor: "black" };', { colours: 2, blur: 0 });
  expectCheck("transparent is allowed", screen, 'const s = { backgroundColor: "transparent" };', { colours: 0, blur: 0 });
  expectCheck("an expo-blur import fires", screen, 'import { BlurView } from "expo-blur";', { colours: 0, blur: 1 });
  expectCheck("an expo-blur require fires", screen, 'const { BlurView } = require("expo-blur");', { colours: 0, blur: 1 });
  expectCheck("tokens pass", screen, "import { color } from '../../constants/designSystem';\nconst s = { color: color.text1 };", { colours: 0, blur: 0 });
  expectCheck("an issue number in a comment is not a colour", screen, "// toward #4420 and #fff\n/* rgba(0,0,0,1) */ const a = 1;", { colours: 0, blur: 0 });
  expectCheck("an HTML entity is not a colour", screen, 'const s = "&#123;";', { colours: 0, blur: 0 });
  expectCheck("an issue ref in a string is not a colour", screen, 'console.warn("[#4304] retry"); const s = "see #4420 now";', { colours: 0, blur: 0 });
  expectCheck("a parenthesised issue ref in a string is not a colour", screen, 'const s = "measurement is OFF (#4238 W6-5).";', { colours: 0, blur: 0 });
  expectCheck("a hex after ( still fires", screen, 'const s = mix("#ff0000", 1);', { colours: 1, blur: 0 });
  expectCheck("an email-body HTML file is allow-listed", "src/components/marketing/ComposerV2/composerChipHtml.ts", 'const css = "color:#111";', { colours: 0, blur: 0 });
  expectCheck("a non-allow-listed sibling still fires", "src/components/marketing/ComposerV2/Other.tsx", 'const css = "color:#111";', { colours: 1, blur: 0 });
  expectCheck("a digit-only hex in a colour position fires", screen, 'const s = { color: "#000", c: `color: #111;` };', { colours: 2, blur: 0 });
  expectCheck("a JSX comment after an apostrophe is still a comment", screen, "<Text>Don't go</Text>{/* #4238 — rgba(0,0,0,1) */}\n  // can't #fff", { colours: 0, blur: 0 });
  expectCheck("designSystem.ts is allow-listed", "src/constants/designSystem.ts", 'const p = "#0f0f11"; const q = "rgba(0,0,0,.5)";', { colours: 0, blur: 0 });
  expectCheck("Material.tsx may import expo-blur", "src/components/ui/Material.tsx", 'import { BlurView } from "expo-blur";', { colours: 0, blur: 0 });
  expectCheck("a theme preset is content", "src/components/theme/ThemeColourTab.tsx", 'const c = "#ff0000";', { colours: 0, blur: 0 });
  expectCheck("another ui file may NOT import expo-blur", "src/components/ui/GlassChrome.tsx", 'import { BlurView } from "expo-blur";', { colours: 0, blur: 1 });
  expectCheck("tests are out of scope", "src/components/ui/__tests__/x.test.tsx", 'const c = "#fff"; import "expo-blur";', { colours: 0, blur: 0 });
  expectCheck("the styleguide is out of scope", "app/__styleguide.tsx", 'const c = "#fff";', { colours: 0, blur: 0 });
  expectCheck(".d.ts is out of scope", "src/types/x.d.ts", 'declare const c: "#fff";', { colours: 0, blur: 0 });

  const report = scan([
    [screen, 'const a = "#fff"; import { BlurView } from "expo-blur";'],
    ["src/constants/designSystem.ts", 'const p = "#000";'],
    ["app/event/[id].tsx", "const s = 'rgba(0,0,0,0.5)';"],
  ]);
  if (report.files !== 2 || report.colours !== 2 || report.blur !== 1) {
    failures.push(`scan totals wrong: ${JSON.stringify({ files: report.files, colours: report.colours, blur: report.blur })}`);
  }
  if (report.byFolder["src/components/event"]?.colours !== 1 || report.byFolder["app/event"]?.colours !== 1) {
    failures.push(`folder grouping wrong: ${JSON.stringify(report.byFolder)}`);
  }
  for (const entry of COLOUR_ALLOWLIST_ENTRIES) {
    if (typeof entry.reason !== "string" || entry.reason.trim().length < 12) failures.push(`allowlist entry ${entry.path} has no reviewed reason`);
  }
  if (new Set(COLOUR_ALLOWLIST).size !== COLOUR_ALLOWLIST.length) failures.push("allowlist has a duplicate path");
  if (enforceFromEnv({}) !== true) failures.push("the gate must enforce by default (no env)");
  if (enforceFromEnv({ ISSUE_4420_REPORT: "1" }) !== false) failures.push("ISSUE_4420_REPORT=1 must switch to report mode");
  if (exitCode(report, false) !== 0) failures.push("report mode must exit 0 even with offenders");
  if (exitCode(report, true) !== 1) failures.push("enforce mode must exit 1 with offenders");
  if (exitCode(scan([]), true) !== 0) failures.push("enforce mode must exit 0 when clean");
  if (stripComments('a // x\nb /* y */ c "//z"') !== 'a \nb  c "//z"') {
    failures.push("stripComments does not strip comments and keep string literals");
  }

  if (failures.length > 0) {
    console.error("#4420 host-chrome-tokens-only self-test FAIL:");
    for (const failure of failures) console.error("  - " + failure);
    process.exit(1);
  }
  console.log("#4420 host-chrome-tokens-only self-test PASS (35 cases)");
  process.exit(0);
}

// ---- plain run ----------------------------------------------------------
const walk = (absDir, relDir, out) => {
  if (!fs.existsSync(absDir)) return;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const abs = path.join(absDir, entry.name);
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) walk(abs, rel, out);
    else if (isScanned(rel)) out.push([rel, fs.readFileSync(abs, "utf8")]);
  }
};

const files = [];
for (const dir of SCAN_DIRS) walk(path.join(ROOT, BUSINESS, dir), dir, files);
if (files.length === 0) {
  console.error(`#4420 host-chrome-tokens-only FAIL: no source found under ${BUSINESS}/{${SCAN_DIRS.join(",")}} (wrong working directory?)`);
  process.exit(1);
}
const report = scan(files);
const enforce = enforceFromEnv(process.env);
const staleAllowlist = COLOUR_ALLOWLIST.filter((entry) => !fs.existsSync(path.join(ROOT, BUSINESS, entry)));
if (staleAllowlist.length > 0) {
  console.error(`#4420 host-chrome-tokens-only FAIL: allowlist entries no longer exist: ${staleAllowlist.join(", ")}`);
  process.exit(1);
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ enforce, scanned: files.length, ...report }, null, 2));
  process.exit(exitCode(report, enforce));
}

const folders = Object.entries(report.byFolder).sort((a, b) => b[1].colours + b[1].blur - (a[1].colours + a[1].blur));
const lines = folders.map(([folder, v]) => `    ${String(v.colours).padStart(5)} colour  ${String(v.blur).padStart(2)} blur  ${String(v.files).padStart(4)} files  ${folder}`);
const summary = `${report.colours} colour literal(s) and ${report.blur} expo-blur import(s) in ${report.files} of ${files.length} scanned files`;

if (exitCode(report, enforce) !== 0) {
  console.error(`#4420 host-chrome-tokens-only FAIL: ${summary}`);
  console.error("  Use color/edge/scrim tokens from constants/designSystem.ts and <Material> for any blur.");
  for (const line of lines) console.error(line);
  process.exit(1);
}
if (report.files === 0) {
  console.log(`#4420 host-chrome-tokens-only PASS: 0 offenders in ${files.length} scanned files${enforce ? " (enforcing)" : ""}`);
} else {
  console.log(`#4420 host-chrome-tokens-only REPORT (ISSUE_4420_REPORT=1, not enforced): ${summary}`);
  for (const line of lines) console.log(line);
}
