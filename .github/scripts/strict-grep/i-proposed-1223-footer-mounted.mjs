#!/usr/bin/env node
/**
 * ORCH-1223 [footer re-mount] — AMENDED by ORCH-1224, by #2902, and by #4339.
 *
 * #4339 SUPERSEDES THE EXPLORER HALF, NAMED HERE:
 *   old: the explorer home (app/(explorer)/**) MUST NOT mount a footer,
 *        because it was a one-viewport, non-scrolling deck hero (ORCH-1224,
 *        #3371).
 *   why: the #4339 redesign (approved design contract, spec §9) replaces that
 *        hero with a scrolling home that closes with the ONE canonical footer,
 *        like every other page. The explorer surface now MUST mount it too.
 *   also: the canonical footer moved into components/marketing/footer.tsx
 *        (<SiteFooter>); components/cutout/footer.tsx only delegates to it, so
 *        the Privacy/Terms check reads the canonical file, and the redesigned
 *        pages render it from components/site/{home,host}-page.tsx. The footer
 *        must carry NO "Privacy choices" text or link (#4339 §9/§10: the #4318
 *        bottom strip is the only privacy control).
 *
 * #2902 SUPERSEDES ONE ASSERTION, NAMED HERE:
 *   old: app/host/layout.tsx must import `Footer` from '@/components/marketing/
 *        footer' AND render `<Footer surface="organiser" ...>`.
 *   why: the Host surface now ships the #2902 design, which carries its own
 *        footer (`<CutoutFooter surface="host" />`) rendered by the page. The
 *        old marketing Footer is no longer mounted anywhere on that surface.
 *
 * What the invariant PROTECTS is unchanged and is now checked directly rather
 * than by proxy: the scrolling business surface must render a footer, and that
 * footer must carry visible Privacy and Terms links for the store launch. That
 * is a stronger check than the old one, which would have passed a `<Footer>`
 * with those links deleted.
 *
 * The MUST-NOT-MOUNT half is untouched, and now also forbids the new footer on
 * the explorer surface.
 *
 * The cleaned marketing footer must stay MOUNTED on the BUSINESS surface
 * (app/host/layout.tsx) and must NOT be mounted on the EXPLORER surface
 * (app/(explorer)/layout.tsx).
 *
 * Why the change (Seth 2026-06-22, ORCH-1224): the explorer (consumer) page is a
 * deliberate ONE-VIEWPORT non-scrolling hero (components/sections/explorer-home/
 * hero.tsx, h-[100svh]) with its own bottom pill row + popup modal sheets — a
 * footer there is dead weight below the fold. The business page DOES scroll and
 * still needs visible Privacy/Terms links for the store launch.
 *
 * Invariant I-PROPOSED-1223-FOOTER-MOUNTED (DRAFT until ORCH-1224 CLOSE):
 *   - mingla-marketing/app/host/layout.tsx MUST import `Footer` from
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

const EXPLORER_SOURCES = [
  "mingla-marketing/app/(explorer)/layout.tsx",
  "mingla-marketing/app/(explorer)/page.tsx",
  "mingla-marketing/components/site/home-page.tsx",
];
// The footer may be mounted by either the layout or the page, so the surface is
// read as a whole. A silent un-mount still fails; that is the ORCH-1053 mode.
const BUSINESS_SOURCES = [
  "mingla-marketing/app/host/layout.tsx",
  "mingla-marketing/app/host/page.tsx",
  "mingla-marketing/components/site/host-page.tsx",
];
// #4339: the canonical footer lives here; the Cutout footer delegates to it.
const FOOTER_COMPONENT = "mingla-marketing/components/marketing/footer.tsx";
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
const anyRenderRe = /<(?:Footer|CutoutFooter|SiteFooter)\b[^>]*\bsurface\s*=\s*['"][^'"]*['"]/;

/**
 * Business layout satisfies the MUST-MOUNT invariant iff (after comment-stripping)
 * it imports `Footer` AND renders `<Footer surface="organiser" ...>`.
 */
// Either footer counts as mounted: the legacy marketing one or the #2902 one.
// #4339: <SiteFooter> is the canonical one; the other two delegate to it.
const anyFooterMountRe = /<(?:Footer|CutoutFooter|SiteFooter)\b[^>]*\bsurface\s*=\s*['"][^'"]*['"]/;

const evaluateMustMount = ({ label, code }) => {
  const failures = [];
  const src = stripComments(code);
  if (!anyFooterMountRe.test(src)) {
    failures.push(
      `${label}: no <Footer .../> or <CutoutFooter .../> render — footer is un-mounted (ORCH-1053 failure mode). I-PROPOSED-1223-FOOTER-MOUNTED.`,
    );
  }
  return failures;
};

/**
 * The point of the mount: Privacy and Terms must be reachable from the business
 * surface. Checked on the footer component itself, so deleting the links fails
 * even while the mount survives.
 */
const evaluateLegalLinks = ({ label, code }) => {
  const failures = [];
  const src = stripComments(code);
  for (const [name, href] of [["Privacy", "/privacy-policy"], ["Terms", "/terms-of-service"]]) {
    if (!src.includes(href)) {
      failures.push(
        `${label}: footer does not link ${name} (${href}) — the store launch needs it visible. I-PROPOSED-1223-FOOTER-MOUNTED.`,
      );
    }
  }
  if (/privacy choices|privacy-choices|PrivacyChoices/i.test(src)) {
    failures.push(
      `${label}: footer carries a "Privacy choices" text or link — the #4318 bottom strip is the only privacy control (#4339 §9). I-PROPOSED-1223-FOOTER-MOUNTED.`,
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

  // The #2902 shape: the page mounts the design's own footer.
  const GOOD_BUSINESS_CUTOUT = `
    import { CutoutFooter } from '@/components/cutout'
    export default function HostPage() {
      return (<div><main id="main" /><CutoutFooter surface="host" /></div>)
    }
  `;
  const GOOD_FOOTER_LINKS = `
    const COLUMNS = [{ links: [
      { href: '/privacy-policy', label: 'Privacy' },
      { href: '/terms-of-service', label: 'Terms' },
    ] }]
  `;
  const BAD_FOOTER_LINKS_DROPPED = `
    const COLUMNS = [{ links: [{ href: '/support', label: 'Support' }] }]
  `;
  // A CutoutFooter on the explorer surface is forbidden too.
  const BAD_EXPLORER_CUTOUT = `
    import { CutoutFooter } from '@/components/cutout'
    export default function ExplorerPage() {
      return (<><main id="main" /><CutoutFooter surface="explorer" /></>)
    }
  `;

  // #4339: the redesigned explorer home mounts the canonical footer.
  const GOOD_EXPLORER_SITE = `
    import { SiteFooter } from '@/components/marketing/footer'
    export function HomePage() { return (<div><SiteFooter surface="explorer" /></div>) }
  `;
  const BAD_FOOTER_PRIVACY_CHOICES = `
    const COLUMNS = [{ links: [
      { href: '/privacy-policy', label: 'Privacy' },
      { href: '/terms-of-service', label: 'Terms' },
      { href: '/privacy-choices', label: 'Privacy choices' },
    ] }]
  `;

  const goodB = evaluateMustMount({ label: "business", code: GOOD_BUSINESS });
  const goodBCutout = evaluateMustMount({ label: "business", code: GOOD_BUSINESS_CUTOUT });
  const goodLinks = evaluateLegalLinks({ label: "footer", code: GOOD_FOOTER_LINKS });
  const badLinks = evaluateLegalLinks({ label: "footer", code: BAD_FOOTER_LINKS_DROPPED });
  const badChoices = evaluateLegalLinks({ label: "footer", code: BAD_FOOTER_PRIVACY_CHOICES });
  // Explorer now MUST mount (#4339): the old "forbidden" fixtures are the good ones,
  // and the footer-less shapes fail.
  const goodESite = evaluateMustMount({ label: "explorer", code: GOOD_EXPLORER_SITE });
  const goodECutout = evaluateMustMount({ label: "explorer", code: BAD_EXPLORER_CUTOUT });
  const goodERemount = evaluateMustMount({ label: "explorer", code: BAD_EXPLORER_REMOUNTED });
  const badE = evaluateMustMount({ label: "explorer", code: GOOD_EXPLORER });
  const badEC = evaluateMustMount({ label: "explorer", code: GOOD_EXPLORER_COMMENTED });
  const badBNoRender = evaluateMustMount({ label: "business", code: BAD_BUSINESS_NO_RENDER });
  const badBCommented = evaluateMustMount({ label: "business", code: BAD_BUSINESS_COMMENTED });
  // The retired must-not-mount check still recognises a SiteFooter render.
  const notMountSeesSite = evaluateMustNotMount({ label: "explorer", code: GOOD_EXPLORER_SITE });

  const ok =
    goodB.length === 0 &&
    goodBCutout.length === 0 &&
    goodLinks.length === 0 &&
    badLinks.length >= 2 &&
    badChoices.length === 1 &&
    goodESite.length === 0 &&
    goodECutout.length === 0 &&
    goodERemount.length === 0 &&
    badE.length >= 1 &&
    badEC.length >= 1 &&
    badBNoRender.length >= 1 &&
    badBCommented.length >= 1 &&
    notMountSeesSite.length >= 1;

  if (!ok) {
    console.error("ORCH-1223/1224 footer-mounted SELF-TEST failed:", {
      goodB,
      goodBCutout,
      goodLinks,
      badLinks,
      badChoices,
      goodESite,
      goodECutout,
      goodERemount,
      badE,
      badEC,
      badBNoRender,
      badBCommented,
    });
    process.exit(1);
  }
  console.log("ORCH-1223/1224 footer-mounted gate self-test passed.");
  process.exit(0);
}

const failures = [];

const readSurface = (relPaths, what) => {
  const parts = [];
  for (const rel of relPaths) {
    const abs = join(root, rel);
    if (existsSync(abs)) parts.push(readFileSync(abs, "utf8"));
  }
  if (parts.length === 0) {
    failures.push(`${relPaths.join(" / ")}: expected ${what} not found — cannot verify footer state.`);
    return null;
  }
  return parts.join("\n");
};

const businessCode = readSurface(BUSINESS_SOURCES, "business marketing surface");
if (businessCode !== null) {
  failures.push(...evaluateMustMount({ label: BUSINESS_SOURCES.join(" / "), code: businessCode }));
}

const explorerCode = readSurface(EXPLORER_SOURCES, "explorer marketing surface");
if (explorerCode !== null) {
  // #4339: the explorer surface now MUST mount the canonical footer too.
  failures.push(...evaluateMustMount({ label: EXPLORER_SOURCES.join(" / "), code: explorerCode }));
}

const footerAbs = join(root, FOOTER_COMPONENT);
if (!existsSync(footerAbs)) {
  failures.push(`${FOOTER_COMPONENT}: footer component not found — cannot verify Privacy/Terms links.`);
} else {
  failures.push(...evaluateLegalLinks({ label: FOOTER_COMPONENT, code: readFileSync(footerAbs, "utf8") }));
}

if (failures.length > 0) {
  console.error("ORCH-1223/1224 footer-mounted gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-1223/1224 footer-mounted gate passed.");
