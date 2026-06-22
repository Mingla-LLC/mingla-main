#!/usr/bin/env node
/**
 * ORCH-1225 [careers pill + footer link] — the careers site lives at the
 * `career.usemingla.com` SUBDOMAIN (META-ORCH-1222 apex guard 404s
 * `usemingla.com/careers/*`), so EVERY link from the main marketing site to
 * careers MUST be the ABSOLUTE external URL `https://career.usemingla.com`.
 *
 * Invariant I-PROPOSED-1225-CAREERS-LINKS (DRAFT until ORCH-1225 CLOSE):
 *   (a) the explorer hero (mingla-marketing/components/sections/explorer-home/
 *       hero.tsx) contains a "Career" chip whose href is the absolute
 *       `https://career.usemingla.com`.
 *   (b) the business footer (mingla-marketing/components/marketing/footer.tsx)
 *       contains a "Careers" link whose href is the same absolute URL.
 *
 * Removing EITHER link (or downgrading it to a relative `/careers`, which would
 * 404 on the apex) breaks CI. Comment-stripped so a commented-out reference
 * never satisfies the gate.
 *
 * Mirrors the modular self-tested gate pattern (siblings: i-proposed-1223-*,
 * i-proposed-1224-business-route.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HERO =
  "mingla-marketing/components/sections/explorer-home/hero.tsx";
const FOOTER = "mingla-marketing/components/marketing/footer.tsx";
const CAREERS_URL = "https://career.usemingla.com";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

// Strip line + block comments so commented-out references never satisfy/trip.
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Collect every `{ href, label }` pair (in either prop order) from a chip /
 * link source, regardless of intervening props (mobileOnly, external, …).
 * Returns [{ href, label }].
 */
const extractHrefLabelPairs = (code) => {
  const pairs = [];
  // href: '...'  ... label: '...'   (href before label)
  const reA =
    /href:\s*(['"`])([^'"`]+)\1[\s\S]{0,160}?label:\s*(['"`])([^'"`]+)\3/g;
  // label: '...' ... href: '...'    (label before href)
  const reB =
    /label:\s*(['"`])([^'"`]+)\1[\s\S]{0,160}?href:\s*(['"`])([^'"`]+)\3/g;
  let m;
  while ((m = reA.exec(code)) !== null) {
    pairs.push({ href: m[2], label: m[4] });
  }
  while ((m = reB.exec(code)) !== null) {
    pairs.push({ href: m[4], label: m[2] });
  }
  return pairs;
};

/**
 * @param expectedLabel the chip/link label we require ("Career" hero / "Careers" footer)
 * @returns string[] failures
 */
const evaluate = ({ heroCode, footerCode }) => {
  const failures = [];

  const heroPairs = extractHrefLabelPairs(stripComments(heroCode));
  const heroHit = heroPairs.some(
    (p) => p.label === "Career" && p.href === CAREERS_URL,
  );
  if (!heroHit) {
    failures.push(
      `${HERO}: expected a "Career" chip with href '${CAREERS_URL}' (absolute careers subdomain — a relative '/careers' 404s on the apex). I-PROPOSED-1225-CAREERS-LINKS.`,
    );
  }

  const footerPairs = extractHrefLabelPairs(stripComments(footerCode));
  const footerHit = footerPairs.some(
    (p) => p.label === "Careers" && p.href === CAREERS_URL,
  );
  if (!footerHit) {
    failures.push(
      `${FOOTER}: expected a "Careers" link with href '${CAREERS_URL}' (absolute careers subdomain). I-PROPOSED-1225-CAREERS-LINKS.`,
    );
  }

  return failures;
};

// --- self-test fixtures (run with --self-test) ----------------------------
const SELF_TEST = process.argv.includes("--self-test");

if (SELF_TEST) {
  // GOOD: both links present at the absolute URL (mirrors the shipped fix).
  const GOOD_HERO = `
    const SITE_CHIPS = [
      { href: '/business', label: 'Business', mobileOnly: true },
      { href: 'https://career.usemingla.com', label: 'Career', external: true },
      { href: '/support', label: 'Support' },
    ]
  `;
  const GOOD_FOOTER = `
    const organiserColumns = [
      { title: 'Company', links: [
        { href: 'https://career.usemingla.com', label: 'Careers', external: true },
      ] },
      { title: 'Legal', links: [{ href: '/privacy-policy', label: 'Privacy' }] },
    ]
  `;

  // BAD_HERO_REMOVED: the Career chip is gone.
  const BAD_HERO_REMOVED = `
    const SITE_CHIPS = [
      { href: '/business', label: 'Business', mobileOnly: true },
      { href: '/support', label: 'Support' },
    ]
  `;
  // BAD_HERO_RELATIVE: downgraded to a relative '/careers' (would 404 on apex).
  const BAD_HERO_RELATIVE = `
    const SITE_CHIPS = [
      { href: '/careers', label: 'Career' },
    ]
  `;
  // BAD_FOOTER_REMOVED: the Careers link is gone.
  const BAD_FOOTER_REMOVED = `
    const organiserColumns = [
      { title: 'Legal', links: [{ href: '/privacy-policy', label: 'Privacy' }] },
    ]
  `;
  // BAD_FOOTER_COMMENTED: the Careers link is only commented out.
  const BAD_FOOTER_COMMENTED = `
    const organiserColumns = [
      { title: 'Company', links: [
        // { href: 'https://career.usemingla.com', label: 'Careers', external: true },
      ] },
    ]
  `;

  const goodFails = evaluate({ heroCode: GOOD_HERO, footerCode: GOOD_FOOTER });
  const badHeroRemoved = evaluate({ heroCode: BAD_HERO_REMOVED, footerCode: GOOD_FOOTER });
  const badHeroRelative = evaluate({ heroCode: BAD_HERO_RELATIVE, footerCode: GOOD_FOOTER });
  const badFooterRemoved = evaluate({ heroCode: GOOD_HERO, footerCode: BAD_FOOTER_REMOVED });
  const badFooterCommented = evaluate({ heroCode: GOOD_HERO, footerCode: BAD_FOOTER_COMMENTED });

  const ok =
    goodFails.length === 0 &&
    badHeroRemoved.length >= 1 &&
    badHeroRelative.length >= 1 &&
    badFooterRemoved.length >= 1 &&
    badFooterCommented.length >= 1;

  if (!ok) {
    console.error("ORCH-1225 careers-links SELF-TEST failed:", {
      goodFails,
      badHeroRemoved,
      badHeroRelative,
      badFooterRemoved,
      badFooterCommented,
    });
    process.exit(1);
  }
  console.log("ORCH-1225 careers-links gate self-test passed.");
  process.exit(0);
}

const heroAbs = join(root, HERO);
const footerAbs = join(root, FOOTER);

const failures = [];

if (!existsSync(heroAbs)) {
  failures.push(`${HERO}: expected explorer hero not found.`);
}
if (!existsSync(footerAbs)) {
  failures.push(`${FOOTER}: expected marketing footer not found.`);
}

if (failures.length === 0) {
  const heroCode = readFileSync(heroAbs, "utf8");
  const footerCode = readFileSync(footerAbs, "utf8");
  failures.push(...evaluate({ heroCode, footerCode }));
}

if (failures.length > 0) {
  console.error("ORCH-1225 careers-links gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-1225 careers-links gate passed.");
