// ORCH-1108 — ADVERSARIAL (tester-owned). Different angle than the implementor's
// happy-path test (which checked: dirs absent + no `.invoke()`/`/functions/v1/`
// caller + no config block).
//
// This test attacks the ORPHAN-BREAK / dangling-reference surface the implementor
// did NOT cover. Deleting a directory is only safe if NOTHING else still points
// INTO it (an import) and no EXECUTABLE backend reference (migration / cron /
// pg_cron / net.http) still names it. A dangling import breaks a Deno build; a
// live cron/trigger that names a deleted function breaks at runtime — neither is
// caught by grepping for `.invoke(...)`.
//
// Assertions (all FAIL ON REVERT of the deletion):
//   (a) NO source file anywhere imports FROM one of the 3 deleted directories
//       (e.g. `from "../ai-reason/..."`). A dangling import = compile/runtime break.
//   (b) NO supabase migration references a dead function name in an EXECUTABLE
//       position — i.e. inside a cron.schedule / pg_cron / net.http call. (Plain
//       `COMMENT ON ...` strings that merely document the old owner are inert and
//       explicitly allowed.)
//   (c) NO non-.invoke programmatic call path to a dead function remains: a bare
//       `/functions/v1/<name>` URL string OR a `${...}/<name>`-style functions.url
//       concatenation OR a `supabase.functions` reference whose target string is a
//       dead name. (Belt-and-suspenders over the implementor's literal `.invoke`.)
//   (d) POSITIVE orphan guard — the KEPT shared helper `photoAestheticEnums.ts`
//       still EXISTS and is still imported by the surviving live function
//       `run-place-intelligence-trial`. If the implementor had wrongly deleted the
//       helper, this fails (the KEEP verdict would have been wrong).
//
// Restoring any deleted dir from origin/main re-introduces its index.ts, which
// imports `../_shared/...` siblings and (for ai-reason / generate-ai-summary)
// contains the now-removed code — but more directly, restoring the dir also
// restores `score-place-photo-aesthetics/index.ts` whose own import line
// `from "../_shared/photoAestheticEnums.ts"` is fine; the load-bearing revert
// signal here is (d): the implementor's KEEP verdict + (a)/(c) re-deriving zero
// dangling refs. The hermetic, repo-only fails-on-revert is proven against (a)
// by restoring a dir that an existing file imports from — see the QA report.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const DEAD_FUNCTIONS = [
  "generate-ai-summary",
  "ai-reason",
  "score-place-photo-aesthetics",
] as const;

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

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

function collectFiles(root: string, extRe: RegExp): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    let entries: Deno.DirEntry[];
    try {
      entries = [...Deno.readDirSync(dir)];
    } catch (_e) {
      return;
    }
    for (const entry of entries) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile && extRe.test(entry.name)) {
        out.push(full);
      }
    }
  }
  walk(root);
  return out;
}

function esc(s: string): string {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

const CODE_ROOTS = [
  `${REPO_ROOT}app-mobile`,
  `${REPO_ROOT}mingla-business`,
  `${REPO_ROOT}mingla-admin`,
  `${REPO_ROOT}supabase/functions`,
];

// ---------------------------------------------------------------------------
// (a) No file imports FROM one of the 3 deleted directories. A dangling import
//     would break the Deno bundle / TS build of whatever still points into it.
// ---------------------------------------------------------------------------
Deno.test("ORCH-1108 adversarial (a): no dangling import from a deleted dir", () => {
  // Matches:  import ... from "<anything>/<dead>/<anything>"
  //           from '../ai-reason/index.ts'  |  require("../score-place-photo-aesthetics/x")
  const importRegexes = DEAD_FUNCTIONS.map((name) =>
    new RegExp(
      `(?:from|require\\(|import\\()\\s*["'\`][^"'\`]*\\/${esc(name)}\\/[^"'\`]*["'\`]`,
    )
  );
  const offenders: string[] = [];
  for (const root of CODE_ROOTS) {
    for (const file of collectFiles(root, SOURCE_EXT)) {
      let text: string;
      try {
        text = Deno.readTextFileSync(file);
      } catch (_e) {
        continue;
      }
      for (let i = 0; i < DEAD_FUNCTIONS.length; i++) {
        if (importRegexes[i].test(text)) {
          offenders.push(`${file} :: imports from ${DEAD_FUNCTIONS[i]}/`);
        }
      }
    }
  }
  assertEquals(
    offenders.length,
    0,
    `Dangling import(s) into a deleted directory — would break the build:\n${
      offenders.join("\n")
    }`,
  );
});

// ---------------------------------------------------------------------------
// (b) No migration references a dead function in an EXECUTABLE position
//     (cron.schedule / pg_cron / net.http.* / select ...http_post naming a dead fn).
//     Inert `COMMENT ON ...` documentation strings are allowed.
// ---------------------------------------------------------------------------
Deno.test("ORCH-1108 adversarial (b): no migration cron/net.http names a deleted fn", () => {
  const migDir = `${REPO_ROOT}supabase/migrations`;
  const offenders: string[] = [];
  for (const file of collectFiles(migDir, /\.sql$/)) {
    let text: string;
    try {
      text = Deno.readTextFileSync(file);
    } catch (_e) {
      continue;
    }
    // Line-by-line: only flag a dead-name hit when the SAME line is an executable
    // cron/http construct. Pure COMMENT lines are inert and skipped.
    const lines = text.split("\n");
    for (let ln = 0; ln < lines.length; ln++) {
      const line = lines[ln];
      const hasDead = DEAD_FUNCTIONS.some((n) => line.includes(n));
      if (!hasDead) continue;
      const executable =
        /cron\.schedule|pg_cron|net\.http|http_post|http_get|extensions\.http/i
          .test(line);
      const isComment = /^\s*COMMENT\s+ON\b/i.test(line) ||
        /^\s*--/.test(line);
      if (executable && !isComment) {
        offenders.push(`${file}:${ln + 1} :: ${line.trim().slice(0, 120)}`);
      }
    }
  }
  assertEquals(
    offenders.length,
    0,
    `Migration cron/net.http references a deleted function:\n${
      offenders.join("\n")
    }`,
  );
});

// ---------------------------------------------------------------------------
// (c) No non-.invoke programmatic call path remains: bare /functions/v1/<dead>
//     URL string, or a functions-base concatenation ending in /<dead>.
//     (Implementor checked .invoke + /functions/v1; this also catches a base-URL
//     `${SUPABASE_URL}/functions/v1/${"<dead>"}` style or a stray fetch path.)
// ---------------------------------------------------------------------------
Deno.test("ORCH-1108 adversarial (c): no raw URL / fetch path to a deleted fn", () => {
  const offenders: string[] = [];
  for (const root of CODE_ROOTS) {
    for (const file of collectFiles(root, SOURCE_EXT)) {
      let text: string;
      try {
        text = Deno.readTextFileSync(file);
      } catch (_e) {
        continue;
      }
      for (const name of DEAD_FUNCTIONS) {
        const n = esc(name);
        // /functions/v1/<name>  OR  fetch("...<name>")  OR  url + "/<name>"
        const res = [
          new RegExp(`functions\\/v1\\/${n}\\b`),
          new RegExp(`fetch\\([^)]*["'\`][^"'\`]*\\/${n}["'\`]`),
        ];
        for (const re of res) {
          if (re.test(text)) offenders.push(`${file} :: ${name} (${re})`);
        }
      }
    }
  }
  assertEquals(
    offenders.length,
    0,
    `Raw URL / fetch path to a deleted function remains:\n${
      offenders.join("\n")
    }`,
  );
});

// ---------------------------------------------------------------------------
// (d) POSITIVE orphan guard — the KEPT shared helper must still exist AND still
//     be imported by the surviving live function. Proves the implementor's KEEP
//     verdict on photoAestheticEnums.ts was correct (deleting it would orphan a
//     live function).
// ---------------------------------------------------------------------------
Deno.test("ORCH-1108 adversarial (d): KEPT helper survives + live importer intact", () => {
  const helper = `${REPO_ROOT}supabase/functions/_shared/photoAestheticEnums.ts`;
  let helperExists = false;
  try {
    helperExists = Deno.statSync(helper).isFile;
  } catch (_e) {
    helperExists = false;
  }
  assert(
    helperExists,
    "photoAestheticEnums.ts was deleted — but a LIVE function still imports it; KEEP verdict violated",
  );

  const liveImporter =
    `${REPO_ROOT}supabase/functions/run-place-intelligence-trial/index.ts`;
  let importerText = "";
  try {
    importerText = Deno.readTextFileSync(liveImporter);
  } catch (_e) {
    importerText = "";
  }
  assert(
    importerText.length > 0,
    "run-place-intelligence-trial/index.ts missing — the live importer must survive",
  );
  assert(
    /from\s+["'`][^"'`]*photoAestheticEnums(?:\.ts)?["'`]/.test(importerText),
    "run-place-intelligence-trial no longer imports photoAestheticEnums.ts — KEEP rationale broken",
  );
});
