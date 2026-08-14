/**
 * ISSUE-927 QA — TESTER ADVERSARIAL suite #1 (origin-secret consolidation,
 * RUNTIME resolution order for ALL 8 reader sites).
 *
 * Different angle than the implementor's suite (which runs runtime on the ONE
 * importable reader and source-regex on the other 7): this suite EXECUTES the
 * exact shipped resolution expression of EVERY consolidated read site under
 * live env permutations. The expression text is extracted verbatim from the
 * shipped file (comments stripped, nothing re-typed), so a source edit that
 * reorders the chain fails HERE at runtime, not just in a regex.
 *
 * Per-site proof matrix:
 *   (a) BUSINESS_WEB_ORIGIN + old name both set → the canonical value wins.
 *   (b) only the old name set → the fallback still resolves (deletion decoupled
 *       — the orchestrator may delete the 3 duplicate secrets post-redeploy).
 *   (c) neither set → the site's own default (or undefined for the fail-close
 *       readers, whose 500 web_base_url_missing guard is asserted intact).
 *   (d) ticket-confirmation-dispatch ONLY: PUBLIC_BUYER_BASE_URL set → the
 *       deliberate per-surface override beats BOTH origin names.
 *
 * Plus the importable reader (defaultVenuePublicUrl) at full-function runtime
 * with a hostile trailing-slash + slug-encoding angle the implementor's tests
 * do not cover.
 *
 * Run: deno test --allow-env --allow-read supabase/functions/_shared/__tests__/issue927_tester_origin_runtime.test.ts
 */

import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { defaultVenuePublicUrl } from "../email/claimApprovedEmail.ts";

const CANONICAL = "BUSINESS_WEB_ORIGIN";
const OVERRIDE = "PUBLIC_BUYER_BASE_URL";

interface ReaderSite {
  relPath: string;
  oldName: string;
  /** The hardcoded default literal, or null for the fail-close readers. */
  defaultLiteral: string | null;
  /** Site carries the PUBLIC_BUYER_BASE_URL per-surface override prefix. */
  hasBuyerOverride: boolean;
  /** Fail-close sites must keep their named 500 guard. */
  failCloseErrorToken: string | null;
}

const SITES: ReaderSite[] = [
  {
    relPath: "../../invite-brand-member/index.ts",
    oldName: "MINGLA_BUSINESS_WEB_URL",
    defaultLiteral: "https://host.usemingla.com",
    hasBuyerOverride: false,
    failCloseErrorToken: null,
  },
  {
    relPath: "../../invite-scanner/index.ts",
    oldName: "MINGLA_BUSINESS_WEB_URL",
    defaultLiteral: "https://host.usemingla.com",
    hasBuyerOverride: false,
    failCloseErrorToken: null,
  },
  {
    relPath: "../../ticket-confirmation-dispatch/index.ts",
    oldName: "MINGLA_BUSINESS_WEB_URL",
    defaultLiteral: "https://host.usemingla.com",
    hasBuyerOverride: true,
    failCloseErrorToken: null,
  },
  {
    relPath: "../email/claimApprovedEmail.ts",
    oldName: "MINGLA_BUSINESS_WEB_URL",
    defaultLiteral: "https://host.usemingla.com",
    hasBuyerOverride: false,
    failCloseErrorToken: null,
  },
  {
    relPath: "../../marketing-send/index.ts",
    oldName: "MINGLA_PUBLIC_APP_ORIGIN",
    defaultLiteral: "https://mingla.app",
    hasBuyerOverride: false,
    failCloseErrorToken: null,
  },
  {
    relPath: "../../ticket-checkout-create/index.ts",
    oldName: "MINGLA_PUBLIC_WEB_BASE_URL",
    defaultLiteral: null,
    hasBuyerOverride: false,
    failCloseErrorToken: "web_base_url_missing",
  },
  {
    relPath: "../../rsvp-contribution-create/index.ts",
    oldName: "MINGLA_PUBLIC_WEB_BASE_URL",
    defaultLiteral: null,
    hasBuyerOverride: false,
    failCloseErrorToken: "web_base_url_missing",
  },
  {
    relPath: "../../venue-reservation-create/index.ts",
    oldName: "MINGLA_PUBLIC_WEB_BASE_URL",
    defaultLiteral: null,
    hasBuyerOverride: false,
    failCloseErrorToken: "web_base_url_missing",
  },
];

function readSource(relPath: string): Promise<string> {
  return Deno.readTextFile(new URL(relPath, import.meta.url));
}

/**
 * Extracts the exact shipped resolution expression around the (unique)
 * canonical read: optional `Deno.env.get("PUBLIC_BUYER_BASE_URL") ??` prefix,
 * the canonical read, `?? Deno.env.get("<old>")`, optional `?? "<literal>"`.
 * Comments are stripped; the expression is otherwise the file's own text.
 */
function extractResolutionExpression(src: string, site: ReaderSite): string {
  const marker = `Deno.env.get("${CANONICAL}")`;
  const first = src.indexOf(marker);
  assert(first >= 0, `${site.relPath}: canonical read not found`);
  assertEquals(
    src.indexOf(marker, first + 1),
    -1,
    `${site.relPath}: canonical read must appear exactly once`,
  );

  // Window: up to 250 chars before (to catch the buyer override) and 400
  // after (fallback + default literal live within a few lines).
  const before = src.slice(Math.max(0, first - 250), first);
  const after = src.slice(first, first + 400);

  let expr = "";
  if (site.hasBuyerOverride) {
    const prefixMatch = before.match(
      /Deno\.env\.get\("PUBLIC_BUYER_BASE_URL"\)\s*\?\?\s*$/,
    );
    assert(
      prefixMatch,
      `${site.relPath}: expected the PUBLIC_BUYER_BASE_URL override IMMEDIATELY before the canonical read`,
    );
    expr += `Deno.env.get("${OVERRIDE}") ?? `;
  } else {
    assert(
      !/PUBLIC_BUYER_BASE_URL/.test(before),
      `${site.relPath}: unexpected buyer-override prefix`,
    );
  }

  // The shipped ISSUE-927 comments all PRECEDE the read, so the forward
  // window is comment-free — match the chain on the raw text (a naive
  // comment-stripper would eat the `//` inside the URL string literals).
  const cleaned = after;
  const chainRe = site.defaultLiteral === null
    ? new RegExp(
      `Deno\\.env\\.get\\("${CANONICAL}"\\)\\s*\\?\\?\\s*Deno\\.env\\.get\\("${site.oldName}"\\)`,
    )
    : new RegExp(
      `Deno\\.env\\.get\\("${CANONICAL}"\\)\\s*\\?\\?\\s*Deno\\.env\\.get\\("${site.oldName}"\\)\\s*\\?\\?\\s*"${
        site.defaultLiteral.replace(/[/.]/g, (c) => "\\" + c)
      }"`,
    );
  const chain = cleaned.match(chainRe);
  assert(
    chain,
    `${site.relPath}: the shipped text does not carry the consolidated chain ${chainRe}`,
  );
  expr += chain[0];
  return expr;
}

/** Evaluates the extracted (shipped) expression under a controlled env. */
function runShippedExpression(
  expr: string,
  env: Record<string, string | null>,
): unknown {
  const names = [CANONICAL, OVERRIDE, ...SITES.map((s) => s.oldName)];
  const saved = new Map<string, string | undefined>();
  for (const name of new Set(names)) {
    saved.set(name, Deno.env.get(name));
    Deno.env.delete(name);
  }
  for (const [name, value] of Object.entries(env)) {
    if (value !== null) Deno.env.set(name, value);
  }
  try {
    return new Function(`return (${expr});`)();
  } finally {
    for (const [name, value] of saved.entries()) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

for (const site of SITES) {
  Deno.test(`927-QA origin runtime: ${site.relPath} — canonical wins, fallback holds, default/fail-close intact`, async () => {
    const src = await readSource(site.relPath);
    const expr = extractResolutionExpression(src, site);

    // (a) Both set → the canonical value wins.
    assertEquals(
      runShippedExpression(expr, {
        [CANONICAL]: "https://canonical.qa927.example",
        [site.oldName]: "https://legacy.qa927.example",
      }),
      "https://canonical.qa927.example",
      `${site.relPath}: canonical must win over ${site.oldName}`,
    );

    // (b) Only the old name → fallback resolves (deletion decoupled).
    assertEquals(
      runShippedExpression(expr, { [site.oldName]: "https://legacy.qa927.example" }),
      "https://legacy.qa927.example",
      `${site.relPath}: old-name fallback must hold while the duplicate secret still exists`,
    );

    // (c) Neither → the site's own default, or undefined for fail-close sites.
    const neither = runShippedExpression(expr, {});
    if (site.defaultLiteral !== null) {
      assertEquals(neither, site.defaultLiteral, `${site.relPath}: hardcoded default changed`);
    } else {
      assertEquals(neither, undefined, `${site.relPath}: fail-close reader must yield undefined`);
      assert(
        site.failCloseErrorToken !== null && src.includes(site.failCloseErrorToken),
        `${site.relPath}: the ${site.failCloseErrorToken} fail-close guard must survive the consolidation`,
      );
      // The guard must sit in the same surface block as the read (within
      // 400 chars — it is the next statement in every shipped reader).
      const readAt = src.indexOf(`Deno.env.get("${CANONICAL}")`);
      const guardAt = src.indexOf(site.failCloseErrorToken!, readAt);
      assert(
        guardAt > readAt && guardAt - readAt < 400,
        `${site.relPath}: the fail-close guard is no longer adjacent to the consolidated read`,
      );
    }

    // (d) The ticket-confirmation-dispatch per-surface override beats BOTH.
    if (site.hasBuyerOverride) {
      assertEquals(
        runShippedExpression(expr, {
          [OVERRIDE]: "https://buyer-override.qa927.example",
          [CANONICAL]: "https://canonical.qa927.example",
          [site.oldName]: "https://legacy.qa927.example",
        }),
        "https://buyer-override.qa927.example",
        "PUBLIC_BUYER_BASE_URL must beat both origin names",
      );
      // And the override alone (canonical + old deleted) still wins outright.
      assertEquals(
        runShippedExpression(expr, {
          [OVERRIDE]: "https://buyer-override.qa927.example",
        }),
        "https://buyer-override.qa927.example",
      );
    }
  });
}

// ── The importable reader at FULL-function runtime — hostile inputs ───────────

function withEnv(values: Record<string, string | null>, fn: () => void): void {
  const saved = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(values)) {
    saved.set(name, Deno.env.get(name));
    if (value === null) Deno.env.delete(name);
    else Deno.env.set(name, value);
  }
  try {
    fn();
  } finally {
    for (const [name, value] of saved.entries()) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

Deno.test("927-QA origin runtime: defaultVenuePublicUrl — canonical-first survives trailing slashes + a hostile slug", () => {
  withEnv({
    [CANONICAL]: "https://canonical.qa927.example///",
    MINGLA_BUSINESS_WEB_URL: "https://legacy.qa927.example",
  }, () => {
    // Trailing slashes on the CANONICAL value are stripped exactly as they
    // were on the old name (the .replace() rides the whole chain).
    assertEquals(
      defaultVenuePublicUrl("velvet lounge/../x"),
      "https://canonical.qa927.example/b/velvet%20lounge%2F..%2Fx",
    );
  });
});

Deno.test("927-QA origin runtime: defaultVenuePublicUrl — old name alone still fully functional (deletion decoupled at function level)", () => {
  withEnv({
    [CANONICAL]: null,
    MINGLA_BUSINESS_WEB_URL: "https://legacy.qa927.example/",
  }, () => {
    assertEquals(
      defaultVenuePublicUrl("velvet-lounge"),
      "https://legacy.qa927.example/b/velvet-lounge",
    );
  });
});
