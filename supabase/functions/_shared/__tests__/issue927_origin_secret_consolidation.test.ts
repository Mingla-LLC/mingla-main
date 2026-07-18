/**
 * ISSUE-927 Part 1 — origin-URL secret consolidation (4 same-digest names → 1).
 *
 * The secret store is at its hard 100-slot cap. Four names carry ONE digest:
 * BUSINESS_WEB_ORIGIN (canonical) = MINGLA_BUSINESS_WEB_URL =
 * MINGLA_PUBLIC_APP_ORIGIN = MINGLA_PUBLIC_WEB_BASE_URL. Every reader of the
 * latter three now reads BUSINESS_WEB_ORIGIN FIRST with its old name as the
 * fallback — behavior is identical whether or not the old secrets still
 * exist, so the orchestrator's post-merge deletion is safely decoupled.
 *
 * This suite pins:
 *   1. RESOLUTION ORDER (runtime) — the one importable reader
 *      (defaultVenuePublicUrl) proves BUSINESS_WEB_ORIGIN wins when both are
 *      set, the old name still resolves when the canonical one is unset, and
 *      the hardcoded default is last.
 *   2. RESOLUTION ORDER (source) — every consolidated read site reads
 *      BUSINESS_WEB_ORIGIN before its old name inside the same expression.
 *   3. NO BARE OLD-NAME READS — a sweep over supabase/functions/ asserts no
 *      Deno.env.get("<old name>") exists anywhere WITHOUT a preceding
 *      BUSINESS_WEB_ORIGIN read in the same statement. A new bare read would
 *      break the day the old secrets are deleted.
 *
 * Run: deno test --allow-env --allow-read supabase/functions/_shared/__tests__/issue927_origin_secret_consolidation.test.ts
 */

import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { defaultVenuePublicUrl } from "../email/claimApprovedEmail.ts";

const OLD_NAMES = [
  "MINGLA_BUSINESS_WEB_URL",
  "MINGLA_PUBLIC_APP_ORIGIN",
  "MINGLA_PUBLIC_WEB_BASE_URL",
] as const;

const CANONICAL = "BUSINESS_WEB_ORIGIN";

/** file → the old name(s) its consolidated read must fall back to. */
const CONSOLIDATED_READERS: Record<string, readonly string[]> = {
  "../../invite-brand-member/index.ts": ["MINGLA_BUSINESS_WEB_URL"],
  "../../invite-scanner/index.ts": ["MINGLA_BUSINESS_WEB_URL"],
  "../../ticket-confirmation-dispatch/index.ts": ["MINGLA_BUSINESS_WEB_URL"],
  "../email/claimApprovedEmail.ts": ["MINGLA_BUSINESS_WEB_URL"],
  "../../marketing-send/index.ts": ["MINGLA_PUBLIC_APP_ORIGIN"],
  "../../ticket-checkout-create/index.ts": ["MINGLA_PUBLIC_WEB_BASE_URL"],
  "../../rsvp-contribution-create/index.ts": ["MINGLA_PUBLIC_WEB_BASE_URL"],
  "../../venue-reservation-create/index.ts": ["MINGLA_PUBLIC_WEB_BASE_URL"],
};

function readSource(relPath: string): Promise<string> {
  return Deno.readTextFile(new URL(relPath, import.meta.url));
}

function withEnv(
  values: Record<string, string | null>,
  fn: () => void,
): void {
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

// ── 1. Runtime resolution order (the importable reader) ───────────────────────

Deno.test("927-P1: BUSINESS_WEB_ORIGIN wins when both names are set", () => {
  withEnv({
    [CANONICAL]: "https://canonical.example",
    MINGLA_BUSINESS_WEB_URL: "https://legacy.example",
  }, () => {
    assertEquals(
      defaultVenuePublicUrl("velvet-lounge"),
      "https://canonical.example/b/velvet-lounge",
    );
  });
});

Deno.test("927-P1: the old name still resolves while the canonical one is unset (deletion decoupled)", () => {
  withEnv({
    [CANONICAL]: null,
    MINGLA_BUSINESS_WEB_URL: "https://legacy.example",
  }, () => {
    assertEquals(
      defaultVenuePublicUrl("velvet-lounge"),
      "https://legacy.example/b/velvet-lounge",
    );
  });
});

Deno.test("927-P1: with neither set, the hardcoded canonical default holds", () => {
  withEnv({
    [CANONICAL]: null,
    MINGLA_BUSINESS_WEB_URL: null,
  }, () => {
    assertEquals(
      defaultVenuePublicUrl("velvet-lounge"),
      "https://business.usemingla.com/b/velvet-lounge",
    );
  });
});

// ── 2. Source-level resolution order at every consolidated read site ──────────

Deno.test("927-P1: every consolidated reader reads BUSINESS_WEB_ORIGIN before its old name", async () => {
  for (const [relPath, oldNames] of Object.entries(CONSOLIDATED_READERS)) {
    const src = await readSource(relPath);
    for (const oldName of oldNames) {
      // The consolidated expression: Deno.env.get("BUSINESS_WEB_ORIGIN") ??
      // <anything> Deno.env.get("<old name>") within a short window (same
      // expression — comments/whitespace tolerated, statements not).
      const pattern = new RegExp(
        `Deno\\.env\\.get\\("${CANONICAL}"\\)\\s*\\?\\?[\\s\\S]{0,200}?Deno\\.env\\.get\\("${oldName}"\\)`,
      );
      assert(
        pattern.test(src),
        `${relPath}: expected the consolidated read Deno.env.get("${CANONICAL}") ?? … Deno.env.get("${oldName}")`,
      );
    }
  }
});

// ── 3. Sweep: no bare old-name read survives anywhere in supabase/functions ───

async function* walkTs(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      yield* walkTs(path);
    } else if (entry.isFile && entry.name.endsWith(".ts")) {
      yield path;
    }
  }
}

Deno.test("927-P1: no Deno.env.get of an old origin name without the canonical-first fallback", async () => {
  const functionsRoot = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
  const thisFile = new URL(import.meta.url).pathname;
  const offenders: string[] = [];
  for await (const path of walkTs(functionsRoot)) {
    if (path === thisFile) continue;
    const src = await Deno.readTextFile(path);
    for (const oldName of OLD_NAMES) {
      const readRe = new RegExp(`Deno\\.env\\.get\\("${oldName}"\\)`, "g");
      let match: RegExpExecArray | null;
      while ((match = readRe.exec(src)) !== null) {
        // The 250 chars before the old-name read must contain the canonical
        // read followed by `??` — i.e. the old name only ever appears as the
        // fallback arm of the consolidated expression.
        const windowBefore = src.slice(Math.max(0, match.index - 250), match.index);
        const consolidated = new RegExp(
          `Deno\\.env\\.get\\("${CANONICAL}"\\)\\s*\\?\\?`,
        );
        if (!consolidated.test(windowBefore)) {
          offenders.push(`${path} — bare Deno.env.get("${oldName}")`);
        }
      }
    }
  }
  assertEquals(
    offenders,
    [],
    `Bare old-origin-name reads found (these break when the duplicate secrets are deleted):\n${
      offenders.join("\n")
    }`,
  );
});
