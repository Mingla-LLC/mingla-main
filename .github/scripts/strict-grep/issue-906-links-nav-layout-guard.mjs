#!/usr/bin/env node
/**
 * issue #906 [links-nav-layout-guard] — shared STRUCTURAL guard for the
 * `/links` no-scroll layout + the marketing glass-nav layout invariants.
 *
 * Enforces:
 *   - I-905-LINKS-CONSENT-BANNER-SUPPRESSED   (families A1 + A2, shared with #905)
 *   - I-PROPOSED-906-NAV-ONE-ACTION-BELOW-SM  (family A3)
 *   - I-PROPOSED-906-NAV-LOGO-DIMENSIONS-PINNED (family A4)
 *
 * HONEST-PROXY FRAMING (read this before "fixing" a false-flag):
 *   This is a class-A static gate. It locks the source-level MECHANISM the four
 *   layout invariants depend on — the exact Tailwind classes and the wiring
 *   site — NOT the rendered pixels. It CANNOT measure real scroll height or
 *   z-order overlap. A layout break that leaves every guarded literal intact
 *   (e.g. a padding/`gap` change that eats the 375x667 headroom) will PASS.
 *   That residual is exactly what a deferred Playwright @375x667 layer (real
 *   `scrollHeight<=clientHeight` + `elementFromPoint` unobstruction) would
 *   cover; it was explicitly deferred by Seth as a net-new CI infra class and
 *   is OUT OF SCOPE here. This structural gate is the mandatory floor.
 *
 *   BRITTLE-BY-DESIGN: a legitimate semantic-equivalent refactor
 *   (`overflow-hidden`->`overflow-clip`, or `h-20`->`h-[80px]`) WILL false-flag
 *   and force a matching, deliberate gate update. That is the accepted price of
 *   a literal lock — update this gate on purpose, never delete it.
 *
 * ASSERT-PRESENT semantics (this is what makes it fails-on-revert): each
 * required literal MUST be found in the COMMENT-STRIPPED source of its target
 * file. A missing (reverted) literal collects a violation and the gate exits 1
 * naming the file:line it protects + the missing token. (Inverse of issue-957's
 * assert-absent.)
 *
 * COMMENT-STRIPPING IS LOAD-BEARING, not ornamental. In the real targets the
 * guarded tokens ALSO appear inside line and JSX-block comments — e.g.
 * `h-[100svh]`, `overflow-hidden`, `100dvh` sit in the `//` docblock at
 * links-experience.tsx:313-315, and `shrink-0` sits in comments at
 * glass-nav.tsx:156/:203. If comments were NOT stripped, deleting the live
 * className token would still match the commented copy and the gate would
 * PASS on a real revert — a decorative gate. `stripComments()` removes `//`
 * line comments, block comments, AND JSX block comments (string/template-literal
 * aware) so a token surviving only in a comment can NEVER satisfy an assertion.
 *
 * Whitespace/order tolerant: assertions are token/regex presence in the
 * stripped file, never line-exact strings — Tailwind class order is not
 * load-bearing. Where two tokens must co-occur inside one class string a
 * bounded regex (`[^'"]*`, which cannot cross a quote) is used so the pair is
 * proven in ONE className, not smeared across the file.
 *
 * Target files (READ-ONLY here — #906 edits NO mingla-marketing/ source):
 *   A1  mingla-marketing/components/marketing/links-experience.tsx
 *   A2a mingla-marketing/lib/consent-banner-visibility.ts
 *   A2b mingla-marketing/components/marketing/consent-banner.tsx
 *   A3  mingla-marketing/components/marketing/glass-nav.tsx
 *   A4  mingla-marketing/components/marketing/glass-nav.tsx
 *
 * `--self-test` proves the gate flags AND passes correctly: exactly 8 cases =
 * for EACH of the 4 families, one clean-source PASS + one violated-source FLAG.
 *
 * Exit codes: 0 clean, 1 violation, 2 script error / missing target.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the repo root from THIS script's location
// (.github/scripts/strict-grep/ -> up three levels) so the gate runs
// identically from CI (repo-root cwd) and from any nested cwd.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, "..", "..", "..");

/**
 * String/template-literal-aware comment stripper. Removes `//` line comments,
 * `/* *\/` block comments (multi-line), AND JSX `{/* *\/}` comments (the block
 * strip catches the inner `/* *\/`). `//` and `/*` inside a string or template
 * literal are preserved (they are not comments). Newlines are kept so a stripped
 * source keeps roughly the same shape.
 *
 * @param {string} src
 * @returns {string} comment-free source
 */
export function stripComments(src) {
  let out = "";
  const n = src.length;
  let state = "code"; // code | line | block | single | double | template
  for (let i = 0; i < n; i++) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : "";
    if (state === "code") {
      if (c === "/" && c2 === "/") { state = "line"; i++; continue; }
      if (c === "/" && c2 === "*") { state = "block"; i++; continue; }
      if (c === "'") { state = "single"; out += c; continue; }
      if (c === '"') { state = "double"; out += c; continue; }
      if (c === "`") { state = "template"; out += c; continue; }
      out += c;
      continue;
    }
    if (state === "line") {
      if (c === "\n") { state = "code"; out += c; }
      continue; // drop everything else on the comment line
    }
    if (state === "block") {
      if (c === "*" && c2 === "/") { state = "code"; i++; continue; }
      if (c === "\n") out += c; // preserve line count only
      continue;
    }
    // string / template states — copy verbatim, honor backslash escapes
    out += c;
    if (c === "\\") { if (i + 1 < n) { out += src[i + 1]; i++; } continue; }
    if (state === "single" && c === "'") state = "code";
    else if (state === "double" && c === '"') state = "code";
    else if (state === "template" && c === "`") state = "code";
  }
  return out;
}

// ---------------------------------------------------------------- assertions

// Each check: id, the file:line it protects, a human description, and a regex
// that must be PRESENT in the comment-stripped source. Bounded `[^'"]*` runs
// cannot cross a quote, so a co-occurrence assertion proves the pair lives in
// ONE className string.

const A1_CHECKS = [
  { id: "A1a", protects: "links-experience.tsx:317 <main> className",
    desc: "`h-[100svh]` single dynamic-viewport height", re: /h-\[100svh\]/ },
  { id: "A1b", protects: "links-experience.tsx:317 <main> className",
    desc: "`overflow-hidden` no-scrollbar guard", re: /overflow-hidden/ },
  { id: "A1c", protects: "links-experience.tsx:319 inline style",
    desc: "inline `height: '100dvh'`", re: /height:\s*['"]100dvh['"]/ },
  { id: "A1d", protects: "links-experience.tsx:332 content column",
    desc: "`min-h-0` + `flex-1` co-occurring in one className (fit-to-viewport band)",
    re: /\bmin-h-0\b[^'"]*\bflex-1\b|\bflex-1\b[^'"]*\bmin-h-0\b/ },
];

const A2A_CHECKS = [
  { id: "A2a", protects: "consent-banner-visibility.ts:21 SUPPRESSED_CONSENT_ROUTES",
    desc: "`/links` is a member of the SUPPRESSED_CONSENT_ROUTES SSOT",
    re: /SUPPRESSED_CONSENT_ROUTES\s*=\s*\[[^\]]*['"]\/links['"][^\]]*\]/ },
];

const A2B_CHECKS = [
  { id: "A2b-pathname", protects: "consent-banner.tsx:104 usePathname read",
    desc: "`usePathname` pathname read", re: /usePathname/ },
  { id: "A2b-call", protects: "consent-banner.tsx:141 visible gate",
    desc: "`shouldRenderConsentBanner(` CALL AND-ed into `visible` (the call form, not a bare import)",
    re: /shouldRenderConsentBanner\(/ },
];

const A3_CHECKS = [
  { id: "A3", protects: "glass-nav.tsx:247 useWeb pill",
    desc: "`hidden … sm:inline-flex` (one action below sm; bounded so the :188 `hidden md:block` surface toggle cannot satisfy it)",
    re: /hidden\b[^'"]*\bsm:inline-flex\b/ },
];

const A4_CHECKS = [
  { id: "A4a", protects: "glass-nav.tsx:168 logo wrapper",
    desc: "logo wrapper `inline-flex … shrink-0` anti-squash guard",
    re: /inline-flex[^'"]*\bshrink-0\b/ },
  { id: "A4b", protects: "glass-nav.tsx:174 business lockup",
    desc: "business lockup `h-20 w-20` (current literal — NOT the historical #892 `84px`)",
    re: /\bh-20\b[^'"]*\bw-20\b/ },
  { id: "A4c", protects: "glass-nav.tsx:181 explorer wordmark",
    desc: "explorer wordmark `h-7 w-auto`", re: /\bh-7\b[^'"]*\bw-auto\b/ },
];

/**
 * The real-run targets. Each entry pins one file's check set. A2 spans two
 * files (visibility SSOT + the component wiring site), so it appears twice.
 */
export const TARGETS = [
  { family: "A1", rel: "mingla-marketing/components/marketing/links-experience.tsx", checks: A1_CHECKS },
  { family: "A2", rel: "mingla-marketing/lib/consent-banner-visibility.ts", checks: A2A_CHECKS },
  { family: "A2", rel: "mingla-marketing/components/marketing/consent-banner.tsx", checks: A2B_CHECKS },
  { family: "A3", rel: "mingla-marketing/components/marketing/glass-nav.tsx", checks: A3_CHECKS },
  { family: "A4", rel: "mingla-marketing/components/marketing/glass-nav.tsx", checks: A4_CHECKS },
];

/**
 * Pure, testable core. Comment-strip `content`, then assert every required
 * literal in `checks` is PRESENT. Returns a list of rich violation messages
 * (empty = clean). The tester's adversarial fixture imports this + stripComments.
 *
 * @param {string} rel      the file label (for the message)
 * @param {string} content  the FULL file bytes read as a JS string
 * @param {{id:string,protects:string,desc:string,re:RegExp}[]} checks
 * @returns {string[]} violations
 */
export function assertFile(rel, content, checks) {
  const stripped = stripComments(content);
  const violations = [];
  for (const chk of checks) {
    if (!chk.re.test(stripped)) {
      violations.push(
        `${rel} — MISSING ${chk.id}: expected ${chk.desc} (protects ${chk.protects}). ` +
          `This literal is load-bearing for the #906 layout invariant; its absence (a revert) fails the gate. ` +
          `If this was an intentional semantic-equivalent refactor, update issue-906-links-nav-layout-guard.mjs deliberately.`,
      );
    }
  }
  return violations;
}

// ---------------------------------------------------------------- self-test

// For each family: a set of file-groups with a clean source (all literals
// present -> 0 violations) and a violated source (exactly one literal reverted
// -> >= 1 violation). 4 families x { clean PASS, violated FLAG } = 8 cases.
const SELF_TEST_FAMILIES = [
  {
    family: "A1",
    groups: [
      {
        checks: A1_CHECKS,
        clean:
          `<main className="relative flex h-[100svh] flex-col overflow-hidden px-5" style={{ height: '100dvh' }}>\n` +
          `  <div className="relative z-10 flex w-full min-h-0 flex-1 flex-col">x</div>\n</main>`,
        // `overflow-hidden` removed from the LIVE className; it survives ONLY in
        // the JSX comment below -> comment-strip must FLAG this (proves A1b is
        // fails-on-revert, not decorative).
        violated:
          `<main className="relative flex h-[100svh] flex-col px-5" style={{ height: '100dvh' }}>\n` +
          `  {/* overflow-hidden was here — reverted out of the live className above */}\n` +
          `  <div className="relative z-10 flex w-full min-h-0 flex-1 flex-col">x</div>\n</main>`,
      },
    ],
  },
  {
    family: "A2",
    groups: [
      {
        checks: A2A_CHECKS,
        clean: `export const SUPPRESSED_CONSENT_ROUTES = ['/links'] as const`,
        // `/links` dropped from the SSOT -> the banner would paint over the CTAs.
        violated: `export const SUPPRESSED_CONSENT_ROUTES = [] as const`,
      },
      {
        checks: A2B_CHECKS,
        clean:
          `const pathname = usePathname()\n` +
          `const visible = decision === 'pending' && shouldRenderConsentBanner(pathname)`,
        // A2 is violated via A2a above; keep A2b clean so the violated case
        // proves a family-level flag from a single reverted mechanism.
        violated:
          `const pathname = usePathname()\n` +
          `const visible = decision === 'pending' && shouldRenderConsentBanner(pathname)`,
      },
    ],
  },
  {
    family: "A3",
    groups: [
      {
        checks: A3_CHECKS,
        clean: `className: 'hidden whitespace-nowrap sm:inline-flex',`,
        // `sm:inline-flex` dropped (second action now shows <=412px). The bare
        // `hidden md:block` surface toggle must NOT satisfy A3 -> must FLAG.
        violated:
          `<div className="hidden md:block"><SurfaceToggle /></div>\n` +
          `className: 'whitespace-nowrap inline-flex',`,
      },
    ],
  },
  {
    family: "A4",
    groups: [
      {
        checks: A4_CHECKS,
        clean:
          `className="inline-flex shrink-0 items-center gap-2"\n` +
          `className="h-20 w-20 select-none"\nclassName="h-7 w-auto select-none"`,
        // logo `shrink-0` removed (the 30px-squash regression class).
        violated:
          `className="inline-flex items-center gap-2"\n` +
          `className="h-20 w-20 select-none"\nclassName="h-7 w-auto select-none"`,
      },
    ],
  },
];

if (process.argv.includes("--self-test")) {
  const misses = [];
  let caseCount = 0;

  for (const fam of SELF_TEST_FAMILIES) {
    // clean-source PASS
    caseCount++;
    {
      const v = fam.groups.flatMap((g) => assertFile(`${fam.family}-clean`, g.clean, g.checks));
      if (v.length !== 0) {
        misses.push(`${fam.family} clean-source WRONGLY FLAGGED (${v.length}): ${v.join(" | ")}`);
      }
    }
    // violated-source FLAG
    caseCount++;
    {
      const v = fam.groups.flatMap((g) => assertFile(`${fam.family}-violated`, g.violated, g.checks));
      if (v.length === 0) {
        misses.push(`${fam.family} violated-source NOT flagged — the gate is DECORATIVE for this family.`);
      }
    }
  }

  if (caseCount !== 8) {
    misses.push(`expected exactly 8 self-test cases (4 families x 2), ran ${caseCount}.`);
  }

  if (misses.length) {
    console.error("issue-906 links-nav-layout-guard self-test FAIL:");
    misses.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "issue-906 links-nav-layout-guard self-test PASS " +
      "(8/8 cases: 4 families x {clean-source PASS, violated-source FLAG}).",
  );
  process.exit(0);
}

// ---------------------------------------------------------------- real run

const failures = [];
for (const t of TARGETS) {
  const abs = path.join(root, t.rel);
  if (!fs.existsSync(abs)) {
    console.error(
      `issue-906 links-nav-layout-guard script error: target file ${t.rel} ` +
        `not found at ${abs}. Refusing to pass vacuously (exit 2).`,
    );
    process.exit(2);
  }
  const content = fs.readFileSync(abs, "utf8");
  failures.push(...assertFile(t.rel, content, t.checks));
}

if (failures.length > 0) {
  console.error(
    "issue-906 links-nav-layout-guard FAIL — a guarded layout literal was reverted:\n  " +
      failures.join("\n  ") +
      "\n\nSee docs/INVARIANT_REGISTRY.md I-905-LINKS-CONSENT-BANNER-SUPPRESSED, " +
      "I-PROPOSED-906-NAV-ONE-ACTION-BELOW-SM, I-PROPOSED-906-NAV-LOGO-DIMENSIONS-PINNED.",
  );
  process.exit(1);
}

console.log(
  `issue-906 links-nav-layout-guard PASS — asserted ${TARGETS.reduce((n, t) => n + t.checks.length, 0)} ` +
    `layout literals across ${new Set(TARGETS.map((t) => t.rel)).size} marketing files ` +
    `(A1 no-scroll, A2 CTA-unobstruction, A3 nav one-action <=sm, A4 logo dimensions).`,
);
