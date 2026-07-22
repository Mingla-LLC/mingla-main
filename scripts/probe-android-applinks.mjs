#!/usr/bin/env node
/**
 * #1042 [android-signing-fingerprint-audit] — Android App Links health probe.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS THE ONLY CHECK HERE WORTH HAVING ─────────────
 *
 * The #1042 dispatch was right to doubt a CI gate that re-asserts a hardcoded
 * fingerprint: the authority lives in a Play Console screen CI cannot read, so such a
 * gate can only compare a copy against itself and print green while the value is
 * wrong. That is #1038's exact failure shape.
 *
 * This probe asserts nothing about correctness either. It asks an EXTERNAL AUTHORITY
 * a question this repository cannot answer about itself:
 *
 *     For every host that a Mingla app declares `autoVerify` against, does that
 *     host's Digital Asset Links statement list — as GOOGLE ITSELF resolves it —
 *     contain a statement for that app's package?
 *
 * That is a fact about the outside world. It changes when Vercel deploys, when
 * someone edits an AppsFlyer branded domain, when DNS moves, or when a CDN serves a
 * stale copy — none of which this repo controls or can see. TWO of the five hosts our
 * apps depend on (`go.usemingla.com`, `biz.usemingla.com`) are served entirely from
 * an AppsFlyer dashboard and have no repo representation at all.
 *
 * It went red the day #1042 F-4 was introduced: `go.usemingla.com` published NO
 * statement for `com.sethogieva.minglabusiness`, while the shipped Business build
 * autoVerified against it. On Android 11 and below the legacy verifier is
 * all-or-nothing across an app's autoVerify hosts, so that single missing statement
 * dropped `business.usemingla.com` App Links to `Status: ask` for every Play-installed
 * organiser on those devices. Nothing else told us. This is the thing that told us.
 * #1050 FIXED it at the source: the Business app now declares `biz.usemingla.com`
 * (its own vouching domain) and no longer declares `go.` at all, so the go.×business
 * pair is gone from what this probe reads (it goes green at PR merge; installed
 * organisers are fixed only by the next native build).
 *
 * This is `scripts/probe-onelink-health.mjs`'s pattern applied one layer down: that
 * probe checks whether the OneLink redirects; this one checks whether the app is
 * allowed to handle the link at all.
 *
 * ── FAILURE MODES, AND THE ASYMMETRY THAT IS THE WHOLE POINT (#1042 F-8) ────────
 *   FAIL  app declares a host that publishes NO statement for its package
 *         → the app's links are dead (or, on Android <=11, ALL its links are).
 *   FAIL  a repo-backed host publishes a SMALLER fingerprint set than the repo file
 *         → deploy drift: a stale Vercel deployment or a CDN serving an old copy.
 *   INFO  a host publishes a package no app declares
 *         → NOT a defect. A host may vouch for a package before the app declares it
 *           (e.g. a branded domain provisioned ahead of the native build that wires
 *           it). #1050 note: `biz.usemingla.com` is now DECLARED by the Business app,
 *           so it is a normal declared pair, not an informational one.
 *
 * ── THE RETRY IS THE DESIGN (inherited from probe-onelink-health.mjs) ───────────
 * Google's resolver and the CDNs behind these hosts flake. A single-shot probe would
 * false-alarm often enough to get muted, and a muted alert is worse than no alert —
 * it is the ILLUSION of monitoring. So the probe retries a host up to 5 times with
 * backoff and reports it unhealthy only if EVERY attempt is unhealthy. A REAL outage
 * (a missing statement, a bad deploy) fails 5/5 deterministically and is still caught
 * on the first scheduled run.
 *
 * ── KNOWN_FAILURES IS DELIBERATELY NARROW (AND NOW EMPTY) ───────────────────────
 * A scheduled probe that is born red gets ignored, so a real-but-not-repo-fixable
 * failure may be recorded as ONE explicit (host, package, kind) triple with an issue
 * reference — swallowing nothing else (another package on the same host, or a drift
 * on that same pair, still fails the run). Deleting an entry the moment its world is
 * fixed is that entry's acceptance test. #1050 did exactly that: F-4's entry
 * (go.usemingla.com × com.sethogieva.minglabusiness) is DELETED because the Business
 * app stopped declaring `go.` (it now declares its own vouching `biz.usemingla.com`),
 * so the list is empty. `go.` is consumer-only — do NOT re-add a business suppression.
 *
 * Usage:  node scripts/probe-android-applinks.mjs
 * Exit:   0 = every declared (host, package) resolves, modulo KNOWN_FAILURES
 *         1 = at least one unexpected failure (the workflow then opens a GitHub Issue)
 * Docs:   docs/runbooks/ANDROID_SIGNING_AND_DEEP_LINK_REGISTRY.md
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

const RESOLVER = "https://digitalassetlinks.googleapis.com/v1/statements:list";
const RELATION = "delegate_permission/common.handle_all_urls";

/** Alert only if ALL of these fail. Rationale in the docblock. */
const ATTEMPTS = 5;
const BACKOFF_MS = [0, 1000, 2000, 4000, 8000];
const TIMEOUT_MS = 15000;

const FAILURE_DETAIL_FILE = "/tmp/android-applinks-probe-failure.md";

/** App configs are the SOURCE OF TRUTH for the host list. Never hardcode hosts. */
const APP_CONFIGS = [
  { rel: "app-mobile/app.json", label: "Mingla Explorer" },
  { rel: "mingla-business/app.json", label: "Mingla Business" },
];

/**
 * Hosts whose `assetlinks.json` this repo serves. For these — and only these — the
 * published fingerprint set must be a SUPERSET of what the repo file declares.
 * The other hosts (`go.`, `biz.`) are AppsFlyer-served and have no repo file to
 * compare against; for them only the statement-exists check applies.
 */
const REPO_BACKED_HOSTS = {
  "usemingla.com": "mingla-marketing/public/.well-known/assetlinks.json",
  "www.usemingla.com": "mingla-marketing/public/.well-known/assetlinks.json",
  "business.usemingla.com": "mingla-business/public/.well-known/assetlinks.json",
};

/**
 * Expected-failing (host, package, kind) triples. Currently EMPTY.
 *
 * #1050 emptied this list. The sole entry — (go.usemingla.com,
 * com.sethogieva.minglabusiness, NO_STATEMENT), #1042 F-4 — is GONE because the
 * Business app no longer declares `go.` at all: mingla-business/app.json now
 * declares `biz.usemingla.com` (its OWN vouching branded domain) instead, so the
 * go.×business pair is never probed and the suppression had nothing left to
 * suppress. Deleting the entry the moment the declaration changed is exactly
 * #1042's acceptance test (the NOTE loop below) and the anti-decorative-guard rule.
 *
 * #1050 — do NOT re-add a go.×business suppression here. `go.` is CONSUMER-only;
 * re-declaring it in the Business config (and papering over it with a suppression)
 * re-breaks business.usemingla.com App Link verification on Android <=11.
 *
 * If a future real, not-repo-fixable failure needs suppressing, add ONE narrow
 * (host, package, kind) triple with its owning issue and a one-line reason —
 * `kind` is matched too, so a DRIFT failure on the same pair would still fire.
 */
const KNOWN_FAILURES = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── inputs ─────────────────────────────────────────────────────────────────────

/** @returns {{host:string, pkg:string, app:string}[]} every declared (host, package) pair */
function declaredPairs() {
  const pairs = [];
  for (const cfg of APP_CONFIGS) {
    const abs = path.join(REPO_ROOT, cfg.rel);
    const json = JSON.parse(fs.readFileSync(abs, "utf8"));
    const android = json?.expo?.android ?? {};
    const pkg = android.package;
    if (!pkg) throw new Error(`${cfg.rel}: expo.android.package is missing — cannot probe.`);
    for (const filter of android.intentFilters ?? []) {
      if (filter?.autoVerify !== true) continue;
      for (const d of filter.data ?? []) {
        if (d?.scheme !== "https" || typeof d.host !== "string") continue;
        if (!pairs.some((p) => p.host === d.host && p.pkg === pkg)) {
          pairs.push({ host: d.host, pkg, app: cfg.label });
        }
      }
    }
  }
  if (pairs.length === 0) {
    throw new Error(
      "VACUOUS — zero autoVerify https hosts discovered across both app configs. Both apps DO " +
        "declare App Links hosts, so an empty result means this probe stopped probing.",
    );
  }
  return pairs;
}

/** @returns {Map<string, string[]>} package -> fingerprints, as the repo file declares them */
function repoFingerprints(rel) {
  const abs = path.join(REPO_ROOT, rel);
  const entries = JSON.parse(fs.readFileSync(abs, "utf8"));
  const map = new Map();
  for (const e of entries) {
    const t = e?.target;
    if (t?.namespace === "android_app" && typeof t.package_name === "string") {
      map.set(t.package_name, Array.isArray(t.sha256_cert_fingerprints) ? t.sha256_cert_fingerprints : []);
    }
  }
  return map;
}

// ── resolver ───────────────────────────────────────────────────────────────────

/** One resolver call. Returns raw observation — no judgement. */
async function fetchStatements(host) {
  const url =
    `${RESOLVER}?source.web.site=${encodeURIComponent(`https://${host}`)}` +
    `&relation=${encodeURIComponent(RELATION)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      return { statements: null, error: `HTTP ${res.status} from Google's resolver` };
    }
    const body = await res.json();
    if (body?.errorCode) {
      return { statements: null, error: `resolver errorCode=${JSON.stringify(body.errorCode)}` };
    }
    return { statements: Array.isArray(body?.statements) ? body.statements : [], error: null };
  } catch (err) {
    return { statements: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Android statements published for `host`, folded to package -> Set(fingerprint). */
function foldAndroid(statements) {
  const byPackage = new Map();
  for (const st of statements) {
    const app = st?.target?.androidApp;
    if (!app?.packageName) continue;
    const fp = app?.certificate?.sha256Fingerprint;
    if (!byPackage.has(app.packageName)) byPackage.set(app.packageName, new Set());
    if (typeof fp === "string") byPackage.get(app.packageName).add(fp.toUpperCase());
  }
  return byPackage;
}

// ── evaluation ─────────────────────────────────────────────────────────────────

/**
 * All failures for one host, given one resolver observation.
 * @returns {{host:string, pkg:string, kind:string, message:string}[]}
 */
function evaluateHost(host, pairsForHost, published) {
  const out = [];
  const present = [...published.keys()];

  for (const pair of pairsForHost) {
    if (!published.has(pair.pkg)) {
      out.push({
        host,
        pkg: pair.pkg,
        kind: "NO_STATEMENT",
        message:
          `**${pair.app}** declares \`autoVerify\` on \`https://${host}\`, but Google's resolver returns ` +
          `**no statement** for \`${pair.pkg}\` on that host.\n` +
          `  Packages that ARE published there: ${present.length ? present.map((p) => `\`${p}\``).join(", ") : "_none_"}\n` +
          `  Effect: App Links for that host never verify. On Android 11 and below the legacy verifier is ` +
          `all-or-nothing across an app's autoVerify hosts, so **every** host that app declares can fail with it.`,
      });
    }
  }

  const repoRel = REPO_BACKED_HOSTS[host];
  if (repoRel) {
    const repo = repoFingerprints(repoRel);
    for (const [pkg, expected] of repo.entries()) {
      const live = published.get(pkg);
      if (!live) {
        out.push({
          host,
          pkg,
          kind: "DRIFT",
          message:
            `\`${repoRel}\` declares \`${pkg}\` for \`https://${host}\`, but the live host publishes **no ` +
            `statement at all** for it. The deployed file does not match the repo — a stale Vercel ` +
            `deployment, a failed deploy, or a CDN serving an old copy.`,
        });
        continue;
      }
      const missing = expected.filter((fp) => !live.has(fp.toUpperCase()));
      if (missing.length) {
        out.push({
          host,
          pkg,
          kind: "DRIFT",
          message:
            `\`https://${host}\` publishes a **smaller** fingerprint set for \`${pkg}\` than \`${repoRel}\` ` +
            `declares. Missing live: ${missing.map((m) => `\`${m}\``).join(", ")}\n` +
            `  This is DEPLOY DRIFT, not a config error — the repo is right and the world is stale. ` +
            `Check the latest Vercel production deployment for that project.`,
        });
      }
    }
  }

  return out;
}

/**
 * Packages a host publishes that no app declares — informational only (F-8).
 * Skipped for drift-only hosts: `www.usemingla.com` serves the apex's file and is
 * declared by no intent filter, so every package on it would be "undeclared" noise.
 */
function informational(host, pairsForHost, published, driftOnly) {
  if (driftOnly) return [];
  const declared = new Set(pairsForHost.map((p) => p.pkg));
  return [...published.keys()].filter((p) => !declared.has(p));
}

const knownFor = (f) =>
  KNOWN_FAILURES.find((k) => k.host === f.host && k.package === f.pkg && k.kind === f.kind);

// ── main ───────────────────────────────────────────────────────────────────────

async function probeHost(host, pairsForHost, driftOnly) {
  let last = { failures: [], info: [], error: null, published: new Map() };

  for (let i = 0; i < ATTEMPTS; i++) {
    if (BACKOFF_MS[i]) await sleep(BACKOFF_MS[i]);
    const obs = await fetchStatements(host);

    if (obs.error !== null) {
      console.log(`  attempt ${i + 1}/${ATTEMPTS}: resolver error — ${obs.error}`);
      last = {
        failures: [
          {
            host,
            pkg: "(all)",
            kind: "RESOLVER_ERROR",
            message: `Google's Digital Asset Links resolver could not be queried for \`https://${host}\`: ${obs.error}`,
          },
        ],
        info: [],
        error: obs.error,
        published: new Map(),
      };
      continue;
    }

    const published = foldAndroid(obs.statements);
    const failures = evaluateHost(host, pairsForHost, published);
    const info = informational(host, pairsForHost, published, driftOnly);
    console.log(
      `  attempt ${i + 1}/${ATTEMPTS}: ${obs.statements.length} statement(s), ` +
        `android packages: ${[...published.keys()].join(", ") || "(none)"}` +
        `${failures.length ? ` — ${failures.length} failure(s)` : " — OK"}`,
    );
    last = { failures, info, error: null, published };
    if (failures.length === 0) break; // healthy → stop early, that is the point of retrying
  }

  return last;
}

async function main() {
  console.log("#1042 Android App Links health probe — asks Google's resolver, not the repo.\n");

  const pairs = declaredPairs();
  const declaredHosts = [...new Set(pairs.map((p) => p.host))];
  // Repo-backed hosts that NO app declares are still probed — for deploy drift only.
  // `www.usemingla.com` is the live example: it serves mingla-marketing's file and is
  // reachable by users, but no intent filter names it, so a stale deployment there
  // would be invisible to the declared-pair loop.
  const driftOnlyHosts = Object.keys(REPO_BACKED_HOSTS).filter((h) => !declaredHosts.includes(h));
  const hosts = [...declaredHosts, ...driftOnlyHosts];

  console.log(
    `Declared autoVerify pairs (${pairs.length}) from app config:\n` +
      pairs.map((p) => `  ${p.host}  ->  ${p.pkg}  (${p.app})`).join("\n") +
      (driftOnlyHosts.length
        ? `\nRepo-backed hosts probed for deploy drift only: ${driftOnlyHosts.join(", ")}`
        : "") +
      "\n",
  );

  const realFailures = [];
  const knownHit = [];

  for (const host of hosts) {
    const driftOnly = driftOnlyHosts.includes(host);
    const pairsForHost = pairs.filter((p) => p.host === host);
    console.log(`https://${host}${driftOnly ? "  (drift check only)" : ""}`);
    const result = await probeHost(host, pairsForHost, driftOnly);

    for (const info of result.info) {
      console.log(
        `  INFO: publishes \`${info}\`, which no app declares for this host. Not a defect ` +
          `(#1042 F-8 — a host may vouch for a package no app declares, e.g. a domain provisioned ahead of a build).`,
      );
    }

    for (const f of result.failures) {
      const known = knownFor(f);
      if (known) {
        knownHit.push({ ...f, known });
        console.log(`  KNOWN-FAIL (#${known.issue}): ${f.kind} on ${f.pkg} — expected, not counted.`);
      } else {
        realFailures.push(f);
        console.log(`  FAIL: ${f.kind} on ${f.pkg}`);
      }
    }
    if (result.failures.length === 0) console.log("  HEALTHY");
    console.log("");
  }

  // A KNOWN_FAILURES entry that stopped firing means the world was fixed — say so
  // loudly so the entry gets deleted rather than rotting into a permanent excuse.
  for (const k of KNOWN_FAILURES) {
    const stillFailing = knownHit.some(
      (h) => h.host === k.host && h.pkg === k.package && h.kind === k.kind,
    );
    if (!stillFailing) {
      console.log(
        `NOTE: KNOWN_FAILURES entry (${k.host}, ${k.package}, ${k.kind}) did NOT fire — the ` +
          `underlying problem appears fixed. Delete the entry (that is #${k.issue}'s acceptance test).`,
      );
    }
  }

  if (realFailures.length > 0) {
    const detail = realFailures
      .map((f) => `### \`${f.host}\` — ${f.kind} (${f.pkg})\n\n${f.message}`)
      .join("\n\n");
    console.error(`\nANDROID APP LINKS PROBE FAIL — ${realFailures.length} unexpected failure(s):\n`);
    console.error(detail);
    try {
      fs.writeFileSync(FAILURE_DETAIL_FILE, detail);
    } catch {
      /* the workflow falls back to the run log */
    }
    process.exit(1);
  }

  console.log(
    `ALL DECLARED APP LINKS HOSTS HEALTHY` +
      (knownHit.length ? ` (${knownHit.length} known-failing pair(s) suppressed — see KNOWN_FAILURES)` : "") +
      ".",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("ANDROID APP LINKS PROBE ERROR — the probe itself failed:", err);
  process.exit(1);
});
