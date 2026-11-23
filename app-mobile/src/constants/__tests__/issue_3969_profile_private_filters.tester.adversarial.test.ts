// @ts-nocheck — Deno-runtime source-contract suite; app-mobile's tsc sweep has no Deno globals.
// MINGLA-INVARIANT: I-3969-PROFILE-NO-PRIVATE-FILTERS | issue #3969 | No client query on profiles filters, orders or matches on a column outside PUBLIC_PROFILE_COLUMNS; once only public columns are readable, such a query is refused even when it selects public columns.
//
// Issue #3969 Step 2 — tester adversarial suite.
//
// The implementor's guard checks the columns a profiles query SELECTS. A
// query can also break (and leak, by enumeration) through its FILTERS: under
// a column grant, `WHERE email = ...` needs read access to `email`, so a
// `.from("profiles").select("id").eq("email", x)` is refused with 42501 just
// like a `select("email")`. This suite scans the same three apps for filter,
// order and match calls on profiles chains and fails on any private column.
//
// FAILS-ON-REVERT (verified against f7769e7a26): the add-friend email
// `.ilike("email", ...)`, the pre-sign-in Google email `.ilike("email", ...)`,
// the board invite `.eq("email", ...)` and the admin coach-mark reset
// `.eq("email", ...)` each fail here.

import { PUBLIC_PROFILE_COLUMNS } from "../profileColumns.ts";

const repoRoot = new URL("../../../../", import.meta.url);
const PUBLIC = new Set<string>(PUBLIC_PROFILE_COLUMNS);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

const SOURCE_ROOTS = [
  "app-mobile/src",
  "app-mobile/app",
  "mingla-business/src",
  "mingla-business/app",
  "mingla-admin/src",
];

async function walk(dir: URL, rel: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = Deno.readDir(dir);
  } catch {
    return;
  }
  try {
    for await (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name.startsWith(".")) continue;
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory) await walk(new URL(`${entry.name}/`, dir), childRel, out);
      else if (entry.isFile && /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) && !/\.(test|spec)\.[a-z]+$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        out.push(childRel);
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
}

// Filter / order / match methods whose first argument is a column name.
const COLUMN_METHODS = "eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|containedBy|order|textSearch|match|not|filter";

interface Violation {
  file: string;
  line: number;
  detail: string;
}

/** The chain text that belongs to one `.from("profiles")` call. */
function chainAfter(source: string, start: number): string {
  const stops = [source.indexOf(";", start), source.indexOf(".from(", start), start + 900].filter((i) => i >= 0);
  return source.slice(start, Math.min(...stops));
}

export function scanFilters(file: string, raw: string): Violation[] {
  const source = stripComments(raw);
  const violations: Violation[] = [];
  const fromRe = /\.from\(\s*(["'`])profiles\1\s*\)/g;
  for (let m = fromRe.exec(source); m; m = fromRe.exec(source)) {
    const chain = chainAfter(source, m.index + m[0].length);
    const line = source.slice(0, m.index).split("\n").length;
    const callRe = new RegExp(`\\.(${COLUMN_METHODS})\\(\\s*(["'\`])([^"'\`]+)\\2`, "g");
    for (let c = callRe.exec(chain); c; c = callRe.exec(chain)) {
      const column = c[3].trim().split(/[.\s(]/)[0];
      if (!PUBLIC.has(column)) violations.push({ file, line, detail: `.${c[1]}("${c[3]}") filters on ${column}` });
    }
    // `.match({ col: v })` and `.or("col.eq.v,...")` name columns differently.
    const matchObj = /\.match\(\s*\{([^}]*)\}/.exec(chain);
    if (matchObj) {
      for (const key of matchObj[1].split(",").map((p) => p.split(":")[0].trim().replace(/["'`]/g, "")).filter(Boolean)) {
        if (!PUBLIC.has(key)) violations.push({ file, line, detail: `.match({ ${key} }) filters on ${key}` });
      }
    }
    const orCall = /\.or\(\s*(["'`])([^"'`]+)\1/.exec(chain);
    if (orCall) {
      for (const part of orCall[2].split(",")) {
        const key = part.trim().split(".")[0];
        if (key && !PUBLIC.has(key)) violations.push({ file, line, detail: `.or("${part.trim()}") filters on ${key}` });
      }
    }
  }
  return violations;
}

Deno.test("#3969 adversarial: the filter scanner catches the shapes it guards (self-test)", () => {
  const cases: Array<[string, boolean]> = [
    [`supabase.from("profiles").select("id").eq("email", e).maybeSingle();`, true],
    [`supabase.from('profiles').select('id, username').ilike('email', e);`, true],
    [`supabase.from("profiles").select("id").order("birthday");`, true],
    [`supabase.from("profiles").select("id").not("phone", "is", null);`, true],
    [`supabase.from("profiles").select("id").match({ email: e });`, true],
    [`supabase.from("profiles").select("id").or("email.eq.x,username.eq.y");`, true],
    [`supabase.from("profiles").update({ bio }).eq("location", x);`, true],
    [`supabase.from("profiles").select("id, display_name").in("id", ids);`, false],
    [`supabase.from("profiles").select("id").ilike("display_name", q).limit(5);`, false],
    [`supabase.from("profiles").update(u).eq("id", id).is("first_name", null);`, false],
    [`supabase.from("profiles").select("id").eq("username", u);`, false],
  ];
  for (const [code, shouldFlag] of cases) {
    const flagged = scanFilters("self-test", code).length > 0;
    assert(flagged === shouldFlag, `filter scanner ${shouldFlag ? "missed" : "wrongly flagged"}: ${code}`);
  }
});

Deno.test("#3969 adversarial: no client profiles query filters on a private column", async () => {
  const files: string[] = [];
  for (const root of SOURCE_ROOTS) await walk(new URL(`${root}/`, repoRoot), root, files);
  assert(files.length > 500, `source scan found only ${files.length} files — wrong root?`);
  const violations: Violation[] = [];
  let chains = 0;
  for (const file of files) {
    const raw = await Deno.readTextFile(new URL(file, repoRoot));
    if (!/\.from\(\s*["'`]profiles["'`]\s*\)/.test(raw)) continue;
    chains += 1;
    violations.push(...scanFilters(file, raw));
  }
  assert(chains > 30, `expected the scan to see the known profile queries, saw ${chains} files`);
  assert(
    violations.length === 0,
    `profiles queries that filter on private columns (refused once only public columns are readable):\n${
      violations.map((v) => `  ${v.file}:${v.line} ${v.detail}`).join("\n")
    }`,
  );
});
