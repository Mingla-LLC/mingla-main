#!/usr/bin/env node
/**
 * ORCH-1399 [links-src-tracking-getapp-stack] — OneLink health probe.
 *
 * ── WHY THIS EXISTS (the risk ORCH-1399 introduced, stated honestly) ─────────────
 * Before ORCH-1399 every install CTA on the marketing site pointed at a PLAIN store
 * URL. A plain store URL cannot go "Pending" — Apple and Google serve it forever. The
 * CTAs had no third-party runtime dependency.
 *
 * ORCH-1399 routes EVERY install CTA (both apps, all platforms, /links + nav + hero +
 * /business/download) through an AppsFlyer OneLink, because that is the only way to
 * attribute an install to the bio it came from — and it is also what removes the
 * intermediate Play web page. Seth accepted that trade explicitly: "everything works
 * now and it's fixed… I want to track where people are coming from especially as we
 * just started out to know which platforms are performing."
 *
 * The cost of that trade: **every install CTA now depends on AppsFlyer serving a 301.**
 * The blast radius widened from "Android business only" to "every install CTA, both
 * apps, all platforms". This is not theoretical — COMMS-0101 recorded exactly that
 * failure mode in the same week (an app's AppsFlyer status went Pending and its
 * OneLink served `200 "app unavailable"` instead of a 301). And it fails SILENTLY:
 * the link still resolves, the page still renders, nothing throws. Nobody finds out
 * until installs quietly stop.
 *
 * This probe is the smoke detector for that. It is cheap insurance, not a feature.
 *
 * ── THE RETRY IS THE WHOLE DESIGN, NOT A NICETY ─────────────────────────────────
 * These endpoints have a MEASURED ~1-in-8 false-failure rate (a healthy OneLink
 * intermittently answers 200 instead of 301 — observed live at SPEC time: the raw
 * business domain returned 200 on attempt 1 then 301 on attempts 2 and 3). A
 * single-shot probe would therefore false-alarm ~12.5% of every run.
 *
 * An alert that cries wolf gets muted, and a muted alert is worse than no alert —
 * it is the ILLUSION of monitoring. So this probe alerts ONLY when EVERY attempt
 * fails:
 *
 *     attempts | P(false alert) at a 12.5% flake rate
 *     ---------|-------------------------------------
 *        1     | 12.5%      ← unusable, would page constantly
 *        3     | 0.195%     ← the dispatch's floor
 *        5     | 0.0031%    ← chosen (≈1 false alert per 32,000 runs)
 *
 * Conversely a REAL outage (a Pending app) fails 5/5 deterministically, so real
 * breakage is still caught on the first scheduled run. Retries cost us nothing but a
 * few seconds; a muted alert costs us the entire install funnel.
 *
 * ── IT ALSO CATCHES A CROSSED ONELINK IN PRODUCTION ─────────────────────────────
 * Each OneLink must resolve to its OWN app's package. If biz.usemingla.com ever
 * resolves to `com.mingla.app.v2`, business owners are installing the consumer app —
 * a silent, total attribution loss that CI cannot see (CI checks our source; this
 * checks what AppsFlyer actually serves). That is treated as CRITICAL, not a flake,
 * and is NOT retried away: a crossed resolution is reported even if a later attempt
 * looks healthy.
 *
 * Usage:  node scripts/probe-onelink-health.mjs
 * Exit:   0 = healthy · 1 = at least one OneLink unhealthy (the workflow then opens
 *         a GitHub Issue tagged `onelink-outage`).
 */

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

/** Alert only if ALL of these fail. See the retry table in the docblock. */
const ATTEMPTS = 5;
const BACKOFF_MS = [0, 1000, 2000, 4000, 8000];
const TIMEOUT_MS = 15000;

/**
 * The contract each OneLink must satisfy, per ORCH-1346 (one branded domain = one
 * template) and ORCH-1399 H-2 (never crossed).
 */
const TARGETS = [
  {
    name: 'Explorer (consumer)',
    url: 'https://go.usemingla.com/w36m',
    expectPackage: 'com.mingla.app.v2',
    crossedPackage: 'com.sethogieva.minglabusiness',
    surfaces: '/links Explorer tab, nav "Get the app"',
  },
  {
    name: 'Business',
    url: 'https://biz.usemingla.com/ZSCW',
    expectPackage: 'com.sethogieva.minglabusiness',
    crossedPackage: 'com.mingla.app.v2',
    surfaces: '/links Business tab, business nav, organiser hero, /business/download',
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One attempt. Returns the raw observation — no judgement, so the caller can
 * distinguish "flaked" from "crossed".
 */
async function attempt(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual', // we want to SEE the 301, not follow it
      headers: { 'User-Agent': ANDROID_UA },
      signal: ctrl.signal,
    });
    return { status: res.status, location: res.headers.get('location') ?? '', error: null };
  } catch (err) {
    return { status: 0, location: '', error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function probe(target) {
  const observations = [];
  let crossed = null;

  for (let i = 0; i < ATTEMPTS; i++) {
    if (BACKOFF_MS[i]) await sleep(BACKOFF_MS[i]);
    const obs = await attempt(target.url);
    observations.push(obs);

    const is301 = obs.status === 301 || obs.status === 302;
    const isMarket = obs.location.startsWith('market://');
    const hasOwnPackage = obs.location.includes(target.expectPackage);
    const hasWrongPackage = obs.location.includes(target.crossedPackage);

    console.log(
      `  attempt ${i + 1}/${ATTEMPTS}: ${obs.status || 'ERR'} -> ${obs.location.slice(0, 96) || obs.error || '(empty)'}`,
    );

    // CROSSED is never a flake — record it even if a later attempt is healthy.
    if (isMarket && hasWrongPackage) {
      crossed = obs.location;
      break;
    }
    // Healthy → stop early. This is the whole point of retrying.
    if (is301 && isMarket && hasOwnPackage) {
      return { ok: true, attemptsUsed: i + 1, observations, crossed: null };
    }
  }
  return { ok: false, attemptsUsed: observations.length, observations, crossed };
}

async function main() {
  console.log('ORCH-1399 OneLink health probe — Android UA, alert only if ALL attempts fail.\n');
  const failures = [];

  for (const target of TARGETS) {
    console.log(`${target.name}: ${target.url}`);
    const result = await probe(target);

    if (result.crossed !== null) {
      console.log(`  CRITICAL — CROSSED\n`);
      failures.push(
        `**${target.name}** (${target.url}) — **CROSSED ONELINK (CRITICAL)**\n` +
          `Resolved to \`${result.crossed}\`, which is the WRONG APP (expected package \`${target.expectPackage}\`).\n` +
          `Every visitor to ${target.surfaces} is installing the wrong app right now, and BOTH apps' ` +
          `attribution is being poisoned. This is NOT a flake — check the AppsFlyer OneLink template ` +
          `mapping immediately (ORCH-1346: one branded domain = one template).`,
      );
      continue;
    }

    if (result.ok) {
      console.log(`  HEALTHY (301 -> market:// ${target.expectPackage}) after ${result.attemptsUsed} attempt(s)\n`);
      continue;
    }

    const detail = result.observations
      .map((o, i) => `  ${i + 1}. ${o.status || 'ERR'} -> ${o.location || o.error || '(empty)'}`)
      .join('\n');
    console.log(`  UNHEALTHY after ${ATTEMPTS}/${ATTEMPTS} attempts\n`);
    failures.push(
      `**${target.name}** (${target.url}) — no \`301 -> market://\` in **${ATTEMPTS}/${ATTEMPTS}** attempts.\n` +
        `At the observed ~1-in-8 flake rate, ${ATTEMPTS} consecutive failures is a ~0.003% false alarm — ` +
        `treat this as REAL.\n\nObservations:\n${detail}\n\n` +
        `**Impact:** every install CTA on ${target.surfaces} is dead or degraded — the store app will not ` +
        `open directly, and installs are not being attributed.\n` +
        `**Most likely cause:** the app's AppsFlyer status flipped to Pending (this exact failure was ` +
        `recorded in COMMS-0101). **Fix:** AppsFlyer dashboard -> My Apps -> Refresh Status, then re-run ` +
        `this workflow.`,
    );
  }

  if (failures.length > 0) {
    console.error('ONELINK PROBE FAIL:\n');
    console.error(failures.join('\n\n'));
    // The workflow reads this file to build the GitHub Issue body.
    const fs = await import('node:fs');
    fs.writeFileSync('/tmp/onelink-probe-failure.md', failures.join('\n\n'));
    process.exit(1);
  }

  console.log('ALL ONELINKS HEALTHY — both 301 -> market:// with the correct package, never crossed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('ONELINK PROBE ERROR — the probe itself failed:', err);
  process.exit(1);
});
