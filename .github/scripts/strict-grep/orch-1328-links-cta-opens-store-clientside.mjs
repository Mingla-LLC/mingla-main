#!/usr/bin/env node
/**
 * ORCH-1328 [links-cta-soft-nav-blank-page] → ORCH-1399 → #4318 [links city week calendar].
 *
 * HISTORY. ORCH-1328 (amended by ORCH-1381 and ORCH-1399) pinned the per-tab
 * CTA of the old two-tab /links page: a real anchor to the attributed OneLink,
 * opened on the tap, never a soft navigation and never a store literal. #4318
 * replaced the page with the city week calendar, where EVERY banner and strip is
 * a hand-off. The file keeps its name and MANIFEST row (gate count and self-test
 * ratchets unchanged); the invariant is carried forward to the new page.
 *
 * Invariant: I-4318-LINKS-HANDOFF-THROUGH-SEAM (the ORCH-1328 contract, widened).
 *
 * Over mingla-marketing/components/marketing/links-experience.tsx (comment-stripped)
 * REQUIRE:
 *   1. the device is read at tap time: detectClientPlatform( .
 *   2. every destination is resolved by lib/links-handoff.ts (resolveLinksHandoff(
 *      and linksTargetHrefs( ), which sits on the #4137 device seam.
 *   3. every hand-off anchor carries data-cta-phone-href={phoneHref}, so a phone tap
 *      made before hydration still gets the attributed OneLink (boot script, #4137).
 *   4. a computer opens a sheet in the page: `handoff.action === 'sheet'` with
 *      event.preventDefault() (the page stays mounted, ORCH-1328's invariant).
 *   5. a new-tab hand-off carries rel="noopener" with its target="_blank".
 *   6. the taps are tracked: links_banner_tapped and links_strip_opened.
 * Over mingla-marketing/lib/links-handoff.ts REQUIRE: it imports the seam
 * ('./cta-destination') and never './store-links'.
 *
 * BAN on the page: next/link / <Link (no soft navigation), window.open(, an import
 * of lib/store-links (URL constants live behind the seam), and any store, OneLink
 * or host-web literal (apps.apple.com, play.google.com, go.usemingla.com,
 * biz.usemingla.com, host.usemingla.com).
 *
 * --self-test injects fixtures (compliant → pass; each violation → fire; a banned
 * token inside a COMMENT is stripped and still passes).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const TARGET = "mingla-marketing/components/marketing/links-experience.tsx";
const HANDOFF = "mingla-marketing/lib/links-handoff.ts";

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const BANNED = [
  { re: /from\s+['"]next\/link['"]/, why: "imports next/link — a hand-off must never soft-navigate" },
  { re: /<Link[\s/>]/, why: "renders a next/link <Link> — a hand-off must never soft-navigate" },
  { re: /window\.open\(/, why: "inlines window.open — hand-offs are real anchors" },
  { re: /from\s+['"]@\/lib\/store-links['"]/, why: "imports lib/store-links directly — URL constants live behind the #4137 seam" },
  { re: /apps\.apple\.com|play\.google\.com/, why: "hardcodes a store literal" },
  { re: /go\.usemingla\.com|biz\.usemingla\.com/, why: "hardcodes a OneLink literal" },
  { re: /host\.usemingla\.com/, why: "hardcodes the host web literal" },
];

/** JSX opening tags `<tag …>`, brace-aware (an `=>` inside `{…}` does not end the tag). */
function openingTags(src, tag) {
  const out = [];
  const re = new RegExp(`<${tag}\\s`, "g");
  let m;
  while ((m = re.exec(src)) !== null) {
    let depth = 0;
    let i = m.index + 1;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

function checkPage(rawSrc, failures) {
  const src = stripComments(rawSrc);
  if (!/detectClientPlatform\(/.test(src)) {
    failures.push(`${TARGET}: the hand-off must read the device at tap time via detectClientPlatform().`);
  }
  if (!/resolveLinksHandoff\(/.test(src) || !/linksTargetHrefs\(/.test(src)) {
    failures.push(`${TARGET}: every destination must come from lib/links-handoff.ts (resolveLinksHandoff( + linksTargetHrefs().`);
  }
  const anchors = openingTags(src, "a");
  const handoffAnchors = anchors.filter((a) => /onTap\(/.test(a));
  if (handoffAnchors.length < 2) {
    failures.push(`${TARGET}: the banners and strips must be real <a> anchors handled by onTap(.`);
  }
  for (const a of handoffAnchors) {
    if (!/data-cta-phone-href=\{phoneHref\}/.test(a)) {
      failures.push(`${TARGET}: a hand-off anchor is missing data-cta-phone-href={phoneHref} (pre-hydration phone taps): ${a.replace(/\s+/g, " ").slice(0, 80)}…`);
    }
    if (/target=\{newTab \? '_blank'/.test(a) && !/rel=\{newTab \? 'noopener'/.test(a)) {
      failures.push(`${TARGET}: a new-tab hand-off anchor is missing rel="noopener": ${a.replace(/\s+/g, " ").slice(0, 80)}…`);
    }
  }
  if (!/handoff\.action === 'sheet'/.test(src) || !/event\.preventDefault\(\)/.test(src)) {
    failures.push(`${TARGET}: a computer tap must open a sheet in the page (handoff.action === 'sheet' + event.preventDefault()).`);
  }
  for (const event of ["links_banner_tapped", "links_strip_opened"]) {
    if (!src.includes(`'${event}'`)) failures.push(`${TARGET}: missing the ${event} capture.`);
  }
  for (const { re, why } of BANNED) {
    if (re.test(src)) failures.push(`${TARGET}: ${why}.`);
  }
}

function checkHandoff(rawSrc, failures) {
  const src = stripComments(rawSrc);
  if (!/from '\.\/cta-destination'/.test(src)) {
    failures.push(`${HANDOFF}: must resolve its destinations through './cta-destination' (the #4137 device seam).`);
  }
  if (/from '\.\/store-links'/.test(src)) {
    failures.push(`${HANDOFF}: must not import './store-links' — URL constants stay behind the seam.`);
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (page, handoff = "import { resolveCtaDestinations } from './cta-destination'") => {
    const f = [];
    checkPage(page, f);
    checkHandoff(handoff, f);
    return f;
  };

  const good = `
import { detectClientPlatform } from '@/lib/device-platform'
import { linksTargetHrefs, resolveLinksHandoff } from '@/lib/links-handoff'
const onTap = (target, event) => {
  const device = detectClientPlatform()
  const handoff = resolveLinksHandoff(target, device, src)
  captureMarketing(target.type === 'banner' ? 'links_banner_tapped' : 'links_strip_opened', {})
  if (handoff.action === 'sheet') { event.preventDefault(); return }
}
const hrefFor = (t) => linksTargetHrefs(t, src)
const strip = <a href={href} data-cta-phone-href={phoneHref} target={newTab ? '_blank' : undefined} rel={newTab ? 'noopener' : undefined} onClick={(event) => onTap(target, event)}>x</a>
const banner = <a href={href} data-cta-phone-href={phoneHref} onClick={(event) => onTap(target, event)}>y</a>
const social = <a href={s.href} target="_blank" rel="noopener">z</a>
`;
  const fixed = good.replace(
    "captureMarketing(target.type === 'banner' ? 'links_banner_tapped' : 'links_strip_opened', {})",
    "captureMarketing('links_banner_tapped', {}); captureMarketing('links_strip_opened', {})",
  );
  if (run(fixed).length !== 0) selfFailures.push("compliant page wrongly flagged: " + JSON.stringify(run(fixed)));

  const cases = [
    ["device not read at tap time", fixed.replace("detectClientPlatform()", "'ios'").replace("import { detectClientPlatform } from '@/lib/device-platform'", "")],
    ["destination re-derived on the page", fixed.replace(/resolveLinksHandoff\(/g, "guess(")],
    ["phone href dropped from a strip", fixed.replace("data-cta-phone-href={phoneHref} target", "target")],
    ["new-tab anchor without rel", fixed.replace(" rel={newTab ? 'noopener' : undefined}", "")],
    ["computer tap navigates away", fixed.replace("event.preventDefault(); ", "")],
    ["analytics dropped", fixed.replace("captureMarketing('links_strip_opened', {})", "")],
    ["soft navigation", fixed + "\nimport Link from 'next/link'\nconst l = <Link href=\"/download\">x</Link>\n"],
    ["store literal", fixed + "\nconst s = 'https://apps.apple.com/app/id6760440898'\n"],
    ["OneLink literal", fixed + "\nconst s = 'https://go.usemingla.com/w36m'\n"],
    ["host literal", fixed + "\nconst s = 'https://host.usemingla.com'\n"],
    ["store-links imported on the page", fixed + "\nimport { APP_STORE_URL } from '@/lib/store-links'\n"],
  ];
  for (const [name, page] of cases) {
    if (run(page).length === 0) selfFailures.push(`${name} not flagged`);
  }
  if (run(fixed, "import { APP_STORE_URL } from './store-links'").length === 0) {
    selfFailures.push("links-handoff bypassing the seam not flagged");
  }
  const commented = fixed + "\n// no apps.apple.com, go.usemingla.com or next/link here any more\n";
  if (run(commented).length !== 0) selfFailures.push("commented banned tokens wrongly flagged (comment-strip broken)");

  if (selfFailures.length) {
    console.error("ORCH-1328/#4318 links hand-off self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(`ORCH-1328/#4318 links hand-off self-test PASS (${cases.length + 3}/${cases.length + 3} cases).`);
  process.exit(0);
}

// ---- Live mode
const failures = [];
for (const [rel, check] of [[TARGET, checkPage], [HANDOFF, checkHandoff]]) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    console.error(`ORCH-1328/#4318 FAIL — target not found at ${rel}.`);
    process.exit(1);
  }
  check(fs.readFileSync(abs, "utf8"), failures);
}
if (failures.length > 0) {
  console.error(
    "ORCH-1328/#4318 (I-4318-LINKS-HANDOFF-THROUGH-SEAM) FAIL — every /links banner and strip\n" +
      "must be a real anchor resolved through lib/links-handoff.ts and the #4137 seam, carry its\n" +
      "phone href for pre-hydration taps, open a sheet on a computer, and never soft-navigate or\n" +
      "hardcode a store, OneLink or host URL.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log("ORCH-1328/#4318 PASS — every /links hand-off is a real anchor through the #4137 seam, with its phone href, a computer sheet and no hardcoded destination.");
