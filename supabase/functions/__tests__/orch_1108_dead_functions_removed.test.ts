// ORCH-1108 — delete 3 confirmed-dead AI edge functions (backend-only).
//
// Forensics (Mingla_Artifacts/reports/INVESTIGATE_OPENAI_ANTHROPIC_DEPRECATION_AND_LOGO.md)
// proved these 3 edge functions have ZERO invokers anywhere — no client
// `functions.invoke`, no edge-to-edge call, no cron. `score-place-photo-aesthetics`
// was superseded by the Gemini intelligence-trial. ORCH-1108 deletes the dirs
// and the `[functions.ai-reason]` config block.
//
// Happy-path regression (implementor-owned). The tester adds the adversarial
// angle separately. These assertions FAIL ON REVERT of the deletion:
//   (a) the 3 function directories do NOT exist on disk;
//   (b) a grep across app-mobile / mingla-business / mingla-admin /
//       supabase/functions finds ZERO callers — no
//       functions.invoke("<name>") and no fetch to /functions/v1/<name>.
//
// Restoring any deleted dir re-introduces its index.ts, so (a) fails. A real
// caller (invoke/fetch) re-appearing fails (b). Historical COMMENTS that merely
// mention the names (admin-seed-places, run-place-intelligence-trial, migration
// COMMENTs) are context, not callers, and are explicitly NOT matched here.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const DEAD_FUNCTIONS = [
  "generate-ai-summary",
  "ai-reason",
  "score-place-photo-aesthetics",
] as const;

// Resolve the repo root from this test file's location:
//   <root>/supabase/functions/__tests__/this-file.ts  ->  <root>
const THIS_DIR = new URL(".", import.meta.url).pathname;
const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

function dirExists(path: string): boolean {
  try {
    return Deno.statSync(path).isDirectory;
  } catch (_e) {
    return false;
  }
}

function dirExistsIfPresent(path: string): boolean {
  try {
    return Deno.statSync(path).isDirectory;
  } catch (_e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// (a) The 3 function directories must NOT exist.
// ---------------------------------------------------------------------------
Deno.test("ORCH-1108 (a): the 3 dead function directories are deleted", () => {
  for (const name of DEAD_FUNCTIONS) {
    const dir = `${REPO_ROOT}supabase/functions/${name}`;
    assertEquals(
      dirExists(dir),
      false,
      `Dead function dir still exists: supabase/functions/${name} — ORCH-1108 must delete it`,
    );
  }
});

// ---------------------------------------------------------------------------
// (b) No caller anywhere: no functions.invoke("<name>") and no fetch to
//     /functions/v1/<name> across the four code roots.
// ---------------------------------------------------------------------------

// Recursively collect source files under a root, skipping deps + the dead dirs
// themselves (they're deleted anyway) and this very test file.
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".expo",
  "ios",
  "android",
  "__tests__",
]);
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function collectSourceFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    let entries: Deno.DirEntry[];
    try {
      entries = [...Deno.readDirSync(dir)];
    } catch (_e) {
      return; // root may not exist in a partial checkout — treat as no callers
    }
    for (const entry of entries) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile && SOURCE_EXT.test(entry.name)) {
        out.push(full);
      }
    }
  }
  walk(root);
  return out;
}

// A caller is: functions.invoke("<name>") / .invoke('<name>') / .invoke(`<name>`)
// OR a fetch/URL to /functions/v1/<name>. Quote-flavor agnostic.
function callerRegexesFor(name: string): RegExp[] {
  const n = name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  return [
    new RegExp(`\\.invoke\\(\\s*["'\`]${n}["'\`]`),
    new RegExp(`/functions/v1/${n}\\b`),
  ];
}

Deno.test("ORCH-1108 (b): zero invoke/fetch callers across the four roots", () => {
  const roots = [
    `${REPO_ROOT}app-mobile`,
    `${REPO_ROOT}mingla-business`,
    `${REPO_ROOT}mingla-admin`,
    `${REPO_ROOT}supabase/functions`,
  ];

  const offenders: string[] = [];
  for (const root of roots) {
    for (const file of collectSourceFiles(root)) {
      let text: string;
      try {
        text = Deno.readTextFileSync(file);
      } catch (_e) {
        continue;
      }
      for (const name of DEAD_FUNCTIONS) {
        for (const re of callerRegexesFor(name)) {
          if (re.test(text)) {
            offenders.push(`${file} :: ${name} (${re})`);
          }
        }
      }
    }
  }

  assert(
    offenders.length === 0,
    `Found live caller(s) of a deleted function — ORCH-1108 expects ZERO:\n${
      offenders.join("\n")
    }`,
  );
});

// ---------------------------------------------------------------------------
// Guard: config.toml must not declare a [functions.<dead>] block.
// ---------------------------------------------------------------------------
Deno.test("ORCH-1108 (c): config.toml has no block for any deleted function", () => {
  const configPath = `${REPO_ROOT}supabase/config.toml`;
  const config = Deno.readTextFileSync(configPath);
  for (const name of DEAD_FUNCTIONS) {
    const block = `[functions.${name}]`;
    assert(
      !config.includes(block),
      `config.toml still declares ${block} — ORCH-1108 must remove it`,
    );
  }
  // Sanity: the test file located the repo root correctly.
  assert(THIS_DIR.length > 0 && dirExistsIfPresent(`${REPO_ROOT}supabase`));
});
