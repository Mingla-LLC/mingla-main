#!/usr/bin/env node
/**
 * ORCH-1223 [footer re-mount] — the cleaned marketing footer must stay MOUNTED
 * on BOTH public surfaces. This guards against the exact ORCH-1053 failure mode:
 * a silent un-mount that drops Privacy/Terms/Support from the live site.
 *
 * Invariant I-PROPOSED-1223-FOOTER-MOUNTED (DRAFT until ORCH-1223 CLOSE):
 *   - mingla-marketing/app/(explorer)/layout.tsx MUST import `Footer` from
 *     '@/components/marketing/footer' AND render `<Footer surface="explorer" ...>`.
 *   - mingla-marketing/app/organisers/layout.tsx MUST import `Footer` from
 *     '@/components/marketing/footer' AND render `<Footer surface="organiser" ...>`.
 *
 * Re-mount supersedes ORCH-1053's "footer removed per operator" (Seth 2026-06-22:
 * the store launch needs visible Privacy/Terms/Support links). If a future change
 * silently removes either mount, this gate fails CI.
 *
 * Comment-stripped before matching, so a commented-out `<Footer .../>` or import
 * does NOT satisfy the gate. Mirrors the modular self-tested gate pattern (sibling:
 * i-proposed-1223-footer-links-resolve.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const EXPLORER_LAYOUT = "mingla-marketing/app/(explorer)/layout.tsx";
const ORGANISER_LAYOUT = "mingla-marketing/app/organisers/layout.tsx";
const FOOTER_MODULE = "@/components/marketing/footer";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

// Strip line + block comments and JSX `{/* ... */}` so commented-out mounts/imports
// never satisfy the gate. (JSX comments are `{/* */}` => the `/* */` block-strip
// removes the inner content; we also drop bare line comments.)
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * A layout file satisfies the mount invariant iff (after comment-stripping) it:
 *   1. imports `Footer` from the canonical footer module, and
 *   2. renders `<Footer surface="<expected>" ...>` (single or double quotes).
 */
const evaluateLayout = ({ label, code, surface }) => {
  const failures = [];
  const src = stripComments(code);

  // import { Footer } from '@/components/marketing/footer'
  // (allow other named imports alongside, any quote style, optional `type`).
  const importRe = new RegExp(
    `import\\s*\\{[^}]*\\bFooter\\b[^}]*\\}\\s*from\\s*(['"\`])${FOOTER_MODULE.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    )}\\1`,
  );
  if (!importRe.test(src)) {
    failures.push(
      `${label}: missing \`import { Footer } from '${FOOTER_MODULE}'\` — footer is un-mounted (ORCH-1053 failure mode). I-PROPOSED-1223-FOOTER-MOUNTED.`,
    );
  }

  // <Footer surface="explorer" ...>  (literal surface prop, single/double quote).
  const renderRe = new RegExp(
    `<Footer\\b[^>]*\\bsurface\\s*=\\s*(['"])${surface}\\1`,
  );
  if (!renderRe.test(src)) {
    failures.push(
      `${label}: missing \`<Footer surface="${surface}" .../>\` render — footer is un-mounted (ORCH-1053 failure mode). I-PROPOSED-1223-FOOTER-MOUNTED.`,
    );
  }
  return failures;
};

// --- self-test fixtures (run with --self-test) ----------------------------
const SELF_TEST = process.argv.includes("--self-test");

if (SELF_TEST) {
  // GOOD: both import + render present (mirrors the re-mounted layouts).
  const GOOD_EXPLORER = `
    import { GlassNav } from '@/components/marketing/glass-nav'
    import { Footer } from '@/components/marketing/footer'
    export default function ExplorerLayout({ children }) {
      return (<><GlassNav /><main id="main">{children}</main><Footer surface="explorer" /></>)
    }
  `;
  const GOOD_ORGANISER = `
    import { GlassNav } from '@/components/marketing/glass-nav'
    import { Footer } from '@/components/marketing/footer'
    export default function OrganiserLayout({ children }) {
      return (<div><GlassNav /><main id="main">{children}</main><Footer surface="organiser" /></div>)
    }
  `;

  // BAD_A: import present but the render was deleted (silent un-mount).
  const BAD_NO_RENDER = `
    import { Footer } from '@/components/marketing/footer'
    export default function ExplorerLayout({ children }) {
      return (<><main id="main">{children}</main></>)
    }
  `;

  // BAD_B: the render exists only inside a JSX comment (the ORCH-1053 pattern).
  const BAD_COMMENTED = `
    export default function OrganiserLayout({ children }) {
      return (<div>
        {/* ORCH-1053 — footer removed per operator. <Footer surface="organiser" /> */}
        <main id="main">{children}</main>
      </div>)
    }
  `;

  // BAD_C: wrong surface literal (explorer layout rendering organiser footer).
  const BAD_WRONG_SURFACE = `
    import { Footer } from '@/components/marketing/footer'
    export default function ExplorerLayout({ children }) {
      return (<><main id="main">{children}</main><Footer surface="organiser" /></>)
    }
  `;

  const goodE = evaluateLayout({ label: "explorer", code: GOOD_EXPLORER, surface: "explorer" });
  const goodO = evaluateLayout({ label: "organiser", code: GOOD_ORGANISER, surface: "organiser" });
  const badNoRender = evaluateLayout({ label: "explorer", code: BAD_NO_RENDER, surface: "explorer" });
  const badCommented = evaluateLayout({ label: "organiser", code: BAD_COMMENTED, surface: "organiser" });
  const badWrong = evaluateLayout({ label: "explorer", code: BAD_WRONG_SURFACE, surface: "explorer" });

  const ok =
    goodE.length === 0 &&
    goodO.length === 0 &&
    badNoRender.length >= 1 &&
    badCommented.length >= 1 &&
    badWrong.length >= 1;

  if (!ok) {
    console.error("ORCH-1223 footer-mounted SELF-TEST failed:", {
      goodE,
      goodO,
      badNoRender,
      badCommented,
      badWrong,
    });
    process.exit(1);
  }
  console.log("ORCH-1223 footer-mounted gate self-test passed.");
  process.exit(0);
}

const targets = [
  { label: EXPLORER_LAYOUT, abs: join(root, EXPLORER_LAYOUT), surface: "explorer" },
  { label: ORGANISER_LAYOUT, abs: join(root, ORGANISER_LAYOUT), surface: "organiser" },
];

const failures = [];
for (const t of targets) {
  if (!existsSync(t.abs)) {
    failures.push(`${t.label}: expected marketing layout not found — cannot verify footer mount.`);
    continue;
  }
  failures.push(
    ...evaluateLayout({ label: t.label, code: readFileSync(t.abs, "utf8"), surface: t.surface }),
  );
}

if (failures.length > 0) {
  console.error("ORCH-1223 footer-mounted gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-1223 footer-mounted gate passed.");
