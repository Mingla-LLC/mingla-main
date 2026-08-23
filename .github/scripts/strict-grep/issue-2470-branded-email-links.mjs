#!/usr/bin/env node
// #2470 [marketing emails carry raw supabase.co links] — the class guard.
//
// Enforces I-PROPOSED-2470-BRANDED-EMAIL-LINK-IS-THE-DEFAULT:
//
//   A link that goes out in a marketing email MUST default to a Mingla-owned
//   origin. Neither builder may fall back to a raw
//   `…supabase.co/functions/v1/marketing-*` URL, and the marketing app MUST
//   carry the rewrite that makes the branded origin resolve.
//
// WHY THIS EXISTS. The branded origin already existed. Both builders read
// `MINGLA_TRACKING_LINK_ORIGIN` / `MINGLA_UNSUBSCRIBE_LINK_ORIGIN` and fell back
// to the Supabase function endpoint when unset — reasoning, fairly, that a link
// which resolves beats a link that does not. But neither variable was EVER
// provisioned. Neither name appears in supabase/secrets.manifest.json. So for
// the entire life of the marketing hub, every brand's email went out carrying
//
//   https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/marketing-track-click/<id>
//
// against a `<brandSlug>@usemingla.com` From address. A link domain that shares
// nothing with the sender domain is a standard Promotions/Spam signal, and to a
// recipient it reads as phishing. The We Go Again Exhibition brand reported it
// on 2026-08-23 as "which is so strange" — they were looking at an unsubscribe
// link, the one link in a marketing email a person has to trust on sight.
//
// THE BUG CLASS, WHICH IS THE POINT: a fallback nobody configures away IS the
// production path. "Ship the safe value, let operators opt into the good one"
// inverts in practice, because nobody opts in. Every occurrence of this shape
// is a silent, permanent regression that no type, test or green CI run can see
// — the missing half is an env var that does not exist.
//
// This is why the fix is a hardcoded default and NOT two new secrets. The first
// attempt at #2470 registered them in the manifest and the secret-budget audit
// correctly rejected it (87 -> 89 user-managed against a 100 cap). Spending two
// of thirteen remaining slots to keep the bug class alive was the wrong trade
// twice over.
//
// WHAT IT WOULD HAVE CAUGHT. Run against any commit before this one, this gate
// fails on both builders: each ends `getTrackingLinkOrigin` /
// `getUnsubscribeOrigin` with a template literal building a
// `/functions/v1/marketing-*` URL from SUPABASE_URL.
//
// The env override is deliberately still ALLOWED — non-production projects need
// it. What is forbidden is the raw endpoint being what production falls back to.
//
// Modes:
//   node issue-2470-branded-email-links.mjs              — enforce
//   node issue-2470-branded-email-links.mjs --self-test  — prove it detects

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

const TRACKING_BUILDER = "supabase/functions/_shared/marketingEmailRender.ts";
const UNSUBSCRIBE_BUILDER = "supabase/functions/marketing-send/index.ts";
const MARKETING_CONFIG = "mingla-marketing/next.config.ts";
const OPT_OUT_PAGE = "mingla-marketing/app/unsubscribe/page.tsx";

/** A raw Supabase functions URL for a marketing link builder. */
const RAW_MARKETING_ENDPOINT = /functions\/v1\/marketing-(?:track-click|unsubscribe)/;
/** The branded origins, and the rewrites that must serve them. */
const BRANDED_ORIGIN = /https:\/\/usemingla\.com\/(?:m|unsubscribe)\b/;

/**
 * Strip block comments and whole-line `//` / ` *` comments.
 *
 * This gate MUST read code, not prose. Its own subject matter is a URL, so the
 * comment that explains the rule necessarily quotes the string the rule bans —
 * and the first live run of this gate duly failed on its own documentation.
 * Same trap #2462 hit (`eventType.filter.audit.test.ts` matched a comment block
 * 200 lines above the function it meant to inspect) and the same one #2160
 * documents for ORCH-0963's C4 check. A guard that reads comments punishes
 * people for explaining themselves.
 *
 * Deliberately conservative: only whole-line comments and block comments go.
 * A trailing `// …` after code is left alone rather than risk cutting a `//`
 * inside a string literal, which is where every URL in these files lives.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(?:\/\/|\*)/.test(l))
    .join("\n");
}

/**
 * Pure checker so --self-test drives fixtures without touching the repo.
 * `files` is a plain { repoRelativePath: sourceText } map.
 */
export function analyze(files) {
  const violations = [];
  const get = (p) => (files[p] === undefined ? "" : stripComments(files[p]));

  for (const builder of [TRACKING_BUILDER, UNSUBSCRIBE_BUILDER]) {
    const src = get(builder);
    if (!src) {
      violations.push(`${builder}: builder is missing — cannot verify its link origin.`);
      continue;
    }
    if (RAW_MARKETING_ENDPOINT.test(src)) {
      violations.push(
        `${builder}: builds a raw supabase.co marketing link. The branded ` +
          `origin must be the DEFAULT, not an env var somebody has to set — ` +
          `that is exactly how every email shipped a bare cloud hostname.`,
      );
    }
    if (!BRANDED_ORIGIN.test(src)) {
      violations.push(
        `${builder}: no https://usemingla.com/... default found. The link ` +
          `domain must match the <slug>@usemingla.com sender domain.`,
      );
    }
  }

  // A branded origin that nothing serves is worse than the raw one: it 404s.
  const config = get(MARKETING_CONFIG);
  for (const [route, target] of [
    ["/m/:trackingId", "marketing-track-click/:trackingId"],
    ["/unsubscribe/:token", "marketing-unsubscribe/:token"],
  ]) {
    if (!config.includes(`source: '${route}'`) || !config.includes(target)) {
      violations.push(
        `${MARKETING_CONFIG}: no rewrite serving ${route} -> ${target}. ` +
          `Without it the branded link resolves to a 404.`,
      );
    }
  }

  // The tokenised rewrite must not swallow the human-facing opt-out form.
  if (files[OPT_OUT_PAGE] === undefined) {
    violations.push(
      `${OPT_OUT_PAGE}: the manual opt-out page is gone. /unsubscribe must ` +
        `keep rendering for someone who has no token.`,
    );
  }

  return violations;
}

function readRepo() {
  const files = {};
  for (const p of [TRACKING_BUILDER, UNSUBSCRIBE_BUILDER, MARKETING_CONFIG, OPT_OUT_PAGE]) {
    const abs = path.join(REPO_ROOT, p);
    if (fs.existsSync(abs)) files[p] = fs.readFileSync(abs, "utf8");
  }
  return files;
}

function selfTest() {
  const good = {
    [TRACKING_BUILDER]:
      'const BRANDED_TRACKING_LINK_ORIGIN = "https://usemingla.com/m";\n' +
      'Deno.env.get("MINGLA_TRACKING_LINK_ORIGIN");',
    [UNSUBSCRIBE_BUILDER]:
      'const BRANDED_UNSUBSCRIBE_LINK_ORIGIN = "https://usemingla.com/unsubscribe";',
    [MARKETING_CONFIG]:
      "{ source: '/m/:trackingId', destination: `${f}/marketing-track-click/:trackingId` },\n" +
      "{ source: '/unsubscribe/:token', destination: `${f}/marketing-unsubscribe/:token` },",
    [OPT_OUT_PAGE]: "export default function UnsubscribePage() {}",
  };
  const failures = [];

  if (analyze(good).length) {
    failures.push(`GOOD tree wrongly flagged: ${analyze(good).join("; ")}`);
  }

  // BAD 1 — the exact pre-fix shape: fall back to the raw endpoint.
  const revert = {
    ...good,
    [TRACKING_BUILDER]:
      "return `${supabaseUrl}/functions/v1/marketing-track-click`;",
  };
  if (!analyze(revert).some((v) => v.includes("raw supabase.co"))) {
    failures.push("BAD1 (reverted tracking origin) not detected");
  }

  // BAD 2 — branded origin kept, but nothing serves it. Silent 404s.
  const noRewrite = { ...good, [MARKETING_CONFIG]: "// rewrites removed" };
  if (!analyze(noRewrite).some((v) => v.includes("404"))) {
    failures.push("BAD2 (branded origin with no rewrite) not detected");
  }

  // BAD 3 — the tokenised rewrite swallowed the manual opt-out page.
  const noPage = { ...good };
  delete noPage[OPT_OUT_PAGE];
  if (!analyze(noPage).some((v) => v.includes("manual opt-out page"))) {
    failures.push("BAD3 (opt-out page removed) not detected");
  }

  if (failures.length) {
    console.error(`#2470 SELF-TEST FAILED:\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("#2470 self-test PASS (1 good tree, 3 fail-closed cases).");
}

function liveRun() {
  const violations = analyze(readRepo());
  if (violations.length) {
    console.error(
      `#2470 I-PROPOSED-2470-BRANDED-EMAIL-LINK-IS-THE-DEFAULT FAILED — ` +
        `${violations.length} violation(s):\n  - ${violations.join("\n  - ")}`,
    );
    process.exit(1);
  }
  console.log(
    "#2470 OK — both marketing link builders default to a Mingla-owned origin, " +
      "both branded routes are served by a rewrite, and the manual opt-out page " +
      "still renders.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) selfTest();
  else liveRun();
}
