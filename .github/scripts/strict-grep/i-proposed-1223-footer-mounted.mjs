#!/usr/bin/env node
/**
 * ORCH-1223 [footer re-mount] — AMENDED by ORCH-1224.
 *
 * The cleaned marketing footer must stay MOUNTED on the BUSINESS surface
 * (app/business/layout.tsx) and must NOT be mounted on the EXPLORER surface
 * (app/(explorer)/layout.tsx).
 *
 * Why the change (Seth 2026-06-22, ORCH-1224): the explorer (consumer) page is a
 * deliberate ONE-VIEWPORT non-scrolling hero (components/sections/explorer-home/
 * hero.tsx, h-[100svh]) with its own bottom pill row + popup modal sheets — a
 * footer there is dead weight below the fold. The business page DOES scroll and
 * still needs visible Privacy/Terms links for the store launch.
 *
 * Invariant I-PROPOSED-1223-FOOTER-MOUNTED (DRAFT until ORCH-1224 CLOSE):
 *   - mingla-marketing/app/business/layout.tsx MUST import `Footer` from
 *     '@/components/marketing/footer' AND render `<Footer surface="organiser" ...>`.
 *   - mingla-marketing/app/(explorer)/layout.tsx MUST NOT mount a footer
 *     (no `<Footer .../>` render after comment-stripping). It returns to its
 *     pre-ORCH-1223 GlassNav + <main> shape.
 *
 * This guards BOTH failure modes: a silent un-mount on business (the ORCH-1053
 * pattern that drops Privacy/Terms from the live business page), AND a stray
 * re-mount on explorer (the ORCH-1223 over-reach this gate now forbids).
 *
 * Comment-stripped before matching, so a commented-out `<Footer .../>` or import
 * does NOT count either way. Mirrors the modular self-tested gate pattern.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const EXPLORER_LAYOUT = "mingla-marketing/app/(explorer)/layout.tsx";
const BUSINESS_LAYOUT = "mingla-marketing/app/business/layout.tsx";
const FOOTER_MODULE = "@/components/marketing/footer";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

// Strip line + block comments and JSX `{/* ... */}` so commented-out mounts/imports
// never satisfy (or trip) the gate. (JSX comments are `{/* */}` => the `/* */` block-strip
// removes the inner content; we also drop bare line comments.)
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const FOOTER_MODULE_RE = FOOTER_MODULE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const importRe = new RegExp(
  `import\\s*\\{[^}]*\\bFooter\\b[^}]*\\}\\s*from\\s*(['"\`])${FOOTER_MODULE_RE}\\1`,
);
// any `<Footer surface="..." ...>` render (used for the MUST-NOT-MOUNT check too).
const anyRenderRe = /<Footer\b[^>]*\bsurface\s*=\s*['"][^'"]*['"]/;

/**
 * Business layout satisfies the MUST-MOUNT invariant iff (after comment-stripping)
 * it imports `Footer` AND renders `<Footer surface="organiser" ...>`.
 */
const evaluateMustMount = ({ label, code, surface }) => {
  const failures = [];
  const src = stripComments(code);

  if (!importRe.test(src)) {
    failures.push(
      `${label}: missing \`import { Footer } from '${FOOTER_MODULE}'\` — footer is un-mounted (ORCH-1053 failure mode). I-PROPOSED-1223-FOOTER-MOUNTED.`,
    );
  }
  const renderRe = new RegExp(`<Footer\\b[^>]*\\bsurface\\s*=\\s*(['"])${surface}\\1`);
  if (!renderRe.test(src)) {
    failures.push(
      `${label}: missing \`<Footer surface="${surface}" .../>\` render — footer is un-mounted (ORCH-1053 failure mode). I-PROPOSED-1223-FOOTER-MOUNTED.`,
    );
  }
  return failures;
};

/**
 * Explorer layout satisfies the MUST-NOT-MOUNT invariant iff (after comment-stripping)
 * it renders NO `<Footer surface="..." ...>`. (A bare import is tolerated only if
 * unused, but to keep it simple we flag any live <Footer/> render.)
 */
const evaluateMustNotMount = ({ label, code }) => {
  const failures = [];
  const src = stripComments(code);
  if (anyRenderRe.test(src)) {
    failures.push(
      `${label}: renders a <Footer .../> — explorer must NOT mount a footer (ORCH-1224: explorer is a one-viewport hero). I-PROPOSED-1223-FOOTER-MOUNTED.`,
    );
  }
  return failures;
};

// --- self-test fixtures (run with --self-test) ----------------------------
const SELF_TEST = process.argv.includes("--self-test");

if (SELF_TEST) {
  // GOOD business: import + organiser render present (mirrors the moved layout).
  const GOOD_BUSINESS = `
    import { GlassNav } from '@/components/marketing/glass-nav'
    import { Footer } from '@/components/marketing/footer'
    export default function BusinessLayout({ children }) {
      return (<div><GlassNav /><main id="main">{children}</main><Footer surface="organiser" /></div>)
    }
  `;
  // GOOD explorer: NO footer render (pre-ORCH-1223 shape, restored by ORCH-1224).
  const GOOD_EXPLORER = `
    import { GlassNav } from '@/components/marketing/glass-nav'
    export default function ExplorerLayout({ children }) {
      return (<><GlassNav /><main id="main">{children}</main></>)
    }
  `;
  // GOOD explorer with a commented-out footer (the ORCH-1224 doc comment) still passes.
  const GOOD_EXPLORER_COMMENTED = `
    import { GlassNav } from '@/components/marketing/glass-nav'
    export default function ExplorerLayout({ children }) {
      return (<><GlassNav />{/* no footer: <Footer surface="explorer" /> removed ORCH-1224 */}<main id="main">{children}</main></>)
    }
  `;

  // BAD business: import present but the render was deleted (silent un-mount).
  const BAD_BUSINESS_NO_RENDER = `
    import { Footer } from '@/components/marketing/footer'
    export default function BusinessLayout({ children }) {
      return (<div><main id="main">{children}</main></div>)
    }
  `;
  // BAD business: the render exists only inside a JSX comment (ORCH-1053 pattern).
  const BAD_BUSINESS_COMMENTED = `
    export default function BusinessLayout({ children }) {
      return (<div>
        {/* ORCH-1053 — footer removed per operator. <Footer surface="organiser" /> */}
        <main id="main">{children}</main>
      </div>)
    }
  `;
  // BAD explorer: a footer was (re)mounted on the explorer surface (forbidden by ORCH-1224).
  const BAD_EXPLORER_REMOUNTED = `
    import { Footer } from '@/components/marketing/footer'
    export default function ExplorerLayout({ children }) {
      return (<><main id="main">{children}</main><Footer surface="explorer" /></>)
    }
  `;

  const goodB = evaluateMustMount({ label: "business", code: GOOD_BUSINESS, surface: "organiser" });
  const goodE = evaluateMustNotMount({ label: "explorer", code: GOOD_EXPLORER });
  const goodEC = evaluateMustNotMount({ label: "explorer", code: GOOD_EXPLORER_COMMENTED });
  const badBNoRender = evaluateMustMount({ label: "business", code: BAD_BUSINESS_NO_RENDER, surface: "organiser" });
  const badBCommented = evaluateMustMount({ label: "business", code: BAD_BUSINESS_COMMENTED, surface: "organiser" });
  const badERemount = evaluateMustNotMount({ label: "explorer", code: BAD_EXPLORER_REMOUNTED });

  const ok =
    goodB.length === 0 &&
    goodE.length === 0 &&
    goodEC.length === 0 &&
    badBNoRender.length >= 1 &&
    badBCommented.length >= 1 &&
    badERemount.length >= 1;

  if (!ok) {
    console.error("ORCH-1223/1224 footer-mounted SELF-TEST failed:", {
      goodB,
      goodE,
      goodEC,
      badBNoRender,
      badBCommented,
      badERemount,
    });
    process.exit(1);
  }
  console.log("ORCH-1223/1224 footer-mounted gate self-test passed.");
  process.exit(0);
}

const failures = [];

const businessAbs = join(root, BUSINESS_LAYOUT);
if (!existsSync(businessAbs)) {
  failures.push(`${BUSINESS_LAYOUT}: expected business marketing layout not found — cannot verify footer mount.`);
} else {
  failures.push(
    ...evaluateMustMount({ label: BUSINESS_LAYOUT, code: readFileSync(businessAbs, "utf8"), surface: "organiser" }),
  );
}

const explorerAbs = join(root, EXPLORER_LAYOUT);
if (!existsSync(explorerAbs)) {
  failures.push(`${EXPLORER_LAYOUT}: expected explorer marketing layout not found — cannot verify footer absence.`);
} else {
  failures.push(
    ...evaluateMustNotMount({ label: EXPLORER_LAYOUT, code: readFileSync(explorerAbs, "utf8") }),
  );
}

if (failures.length > 0) {
  console.error("ORCH-1223/1224 footer-mounted gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-1223/1224 footer-mounted gate passed.");
