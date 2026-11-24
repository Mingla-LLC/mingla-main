// @ts-nocheck — Deno-runtime source-contract suite; app-mobile's tsc sweep has no Deno globals.
// MINGLA-INVARIANT: I-3969-PROFILE-PUBLIC-COLUMNS | issue #3969 | Explorer, Host and Admin read other people's profiles only through PUBLIC_PROFILE_COLUMNS; the own row comes from get_my_profile; writes to profiles return no row.
//
// Issue #3969 Step 2 — the source guard for the profile read split.
//
// Scans every non-test source file in app-mobile, mingla-business and
// mingla-admin. Every direct read of `profiles` (a `.from("profiles")` chain
// or a `profiles(...)` embed) may name only columns in PUBLIC_PROFILE_COLUMNS,
// never `*` and never an empty `.select()`. A write to `profiles` may not
// chain `.select()`. Raw REST calls to the table may not ask for rows back.
// There is no allowlist.
//
// FAILS-ON-REVERT: restoring any `select("*")` own-profile read, the email
// lookups in friends / sessions / boards, the `profiles (*)` board embed, the
// birthday / gender pairing read, the location read on the friend sheet, the
// Host phone / language reads, or an admin email read fails here.

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
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs)$/;

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
      if (entry.isDirectory) {
        await walk(new URL(`${entry.name}/`, dir), childRel, out);
      } else if (
        entry.isFile && SOURCE_EXT.test(entry.name) &&
        !/\.(test|spec)\.[a-z]+$/.test(entry.name) && !entry.name.endsWith(".d.ts")
      ) {
        out.push(childRel);
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
}

async function sourceFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const root of SOURCE_ROOTS) await walk(new URL(`${root}/`, repoRoot), root, files);
  assert(files.length > 500, `source scan found only ${files.length} files — wrong root?`);
  return files;
}

/** The first argument of a call starting at `open` (index of "("), raw. */
function firstArgument(source: string, open: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    } else if (ch === "," && depth === 1) return source.slice(open + 1, i);
  }
  return source.slice(open + 1);
}

/** Resolve a select argument to its column text, or null when it cannot be read. */
function selectText(arg: string, source: string): string | null {
  const trimmed = arg.trim();
  if (trimmed === "") return "*";
  const literal = /^(["'`])([\s\S]*)\1$/.exec(trimmed);
  if (literal) return literal[1] === "`" && literal[2].includes("${") ? null : literal[2];
  if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
    const decl = new RegExp(`(?:const|let)\\s+${trimmed}\\s*(?::[^=]+)?=\\s*(["'\`])([\\s\\S]*?)\\1`).exec(source);
    return decl ? decl[2] : null;
  }
  return null;
}

/** Column names named at the top level of a profiles select (embeds inside are ignored). */
function topLevelColumns(text: string): string[] {
  const columns: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      columns.push(current);
      current = "";
    } else if (depth === 0 && ch !== ")") current += ch;
  }
  columns.push(current);
  return columns
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .map((c) => c.replace(/^[\w]+\s*:\s*/, "").replace(/::\w+$/, "").trim());
}

function badColumns(text: string): string[] {
  return topLevelColumns(text).filter((c) => c === "*" || !PUBLIC.has(c));
}

interface Violation {
  file: string;
  line: number;
  detail: string;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function scanFile(file: string, raw: string): Violation[] {
  const source = stripComments(raw);
  const violations: Violation[] = [];

  // 1. `.from("profiles")` chains.
  const fromRe = /\.from\(\s*(["'`])profiles\1\s*\)/g;
  for (let m = fromRe.exec(source); m; m = fromRe.exec(source)) {
    const start = m.index + m[0].length;
    let end = source.length;
    const stops = [source.indexOf(";", start), source.indexOf(".from(", start), start + 900]
      .filter((i) => i >= 0);
    end = Math.min(...stops);
    const chain = source.slice(start, end);
    const selectAt = chain.search(/^\s*\.select\(|\.select\(/);
    const writeAt = chain.search(/\.(insert|update|upsert|delete)\(/);
    if (writeAt >= 0) {
      if (selectAt > writeAt) {
        violations.push({ file, line: lineOf(source, m.index), detail: "write chains .select() (must return nothing)" });
      }
      continue;
    }
    if (selectAt < 0) continue;
    const open = start + chain.indexOf("(", selectAt);
    const text = selectText(firstArgument(source, open), source);
    if (text === null) {
      violations.push({ file, line: lineOf(source, m.index), detail: "select columns are not a readable literal" });
      continue;
    }
    const bad = badColumns(text);
    if (bad.length > 0) {
      violations.push({ file, line: lineOf(source, m.index), detail: `select names ${bad.join(", ")}` });
    }
  }

  // 2. `profiles(...)` embeds inside any select string, including
  //    `alias:profiles!fk(...)` and `profiles:fk_column(...)`.
  const embedRe = /(?<![\w.])profiles(?:\s*![\w]+|\s*:\s*[\w]+)?\s*\(/g;
  for (let m = embedRe.exec(source); m; m = embedRe.exec(source)) {
    const before = source.slice(Math.max(0, m.index - 6), m.index);
    if (/\.from\($/.test(before) || /function\s*$/.test(before)) continue;
    const open = m.index + m[0].length - 1;
    // Only embeds inside a string literal / template: the char run must not be code.
    const lineStart = source.lastIndexOf("\n", m.index) + 1;
    const lineText = source.slice(lineStart, source.indexOf("\n", m.index));
    if (/^\s*(export\s+)?(async\s+)?function\b|=>/.test(lineText) && !/["'`]/.test(lineText)) continue;
    let depth = 0;
    let close = -1;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "(") depth += 1;
      if (source[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close < 0) continue;
    const inner = source.slice(open + 1, close);
    if (inner.includes("${")) {
      violations.push({ file, line: lineOf(source, m.index), detail: "profiles embed columns are not a readable literal" });
      continue;
    }
    const bad = badColumns(inner);
    if (bad.length > 0) {
      violations.push({ file, line: lineOf(source, m.index), detail: `profiles embed names ${bad.join(", ")}` });
    }
  }

  // 3. Raw REST to the table: never ask for rows back.
  if (/\/rest\/v1\/profiles\b/.test(source)) {
    if (/select\s*[:=]|return=representation/.test(source)) {
      violations.push({ file, line: lineOf(source, source.search(/\/rest\/v1\/profiles\b/)), detail: "raw REST profiles request asks for rows" });
    }
  }

  return violations;
}

Deno.test("#3969 the public column list is exactly the planned public grant", () => {
  assert(
    JSON.stringify([...PUBLIC_PROFILE_COLUMNS]) === JSON.stringify([
      "id", "display_name", "username", "first_name", "last_name", "avatar_url", "bio",
      "photos", "country", "visibility_mode", "show_activity", "share_location",
      "share_budget", "share_categories", "share_date_time", "active", "created_at",
      "updated_at",
    ]),
    "PUBLIC_PROFILE_COLUMNS changed — the planned server grant must change with it",
  );
  for (const privateColumn of ["email", "phone", "birthday", "gender", "location", "coach_mark_step", "preferred_language", "explorer_deleted_at"]) {
    assert(!PUBLIC.has(privateColumn), `${privateColumn} must stay private`);
  }
});

Deno.test("#3969 the scanner catches the shapes it guards (self-test)", () => {
  const cases: Array<[string, boolean]> = [
    [`supabase.from("profiles").select("*").eq("id", id);`, true],
    [`supabase.from('profiles').select('id, email').eq('id', id);`, true],
    [`supabase.from("profiles").select().eq("id", id);`, true],
    [`supabase.from("profiles").update(u).eq("id", id).select().single();`, true],
    [`supabase.from("x").select("*, profiles (*)");`, true],
    [`supabase.from("x").select("*, user:profiles!x_fkey(display_name, email)");`, true],
    [`supabase.from("x").select(\`a, profiles:user_id ( display_name, birthday )\`);`, true],
    [`const url = base + "/rest/v1/profiles?" + new URLSearchParams({ select: "*" });`, true],
    [`supabase.from("profiles").select("id, display_name, avatar_url").in("id", ids);`, false],
    [`supabase.from("profiles").update({ bio }).eq("id", id);`, false],
    [`const C = "id, username"; supabase.from("profiles").select(C).in("id", ids);`, false],
    [`supabase.rpc("get_my_profile").select("phone").maybeSingle();`, false],
    [`supabase.from("x").select("*, profiles (id, username, avatar_url)");`, false],
  ];
  for (const [code, shouldFlag] of cases) {
    const flagged = scanFile("self-test", code).length > 0;
    assert(flagged === shouldFlag, `scanner ${shouldFlag ? "missed" : "wrongly flagged"}: ${code}`);
  }
});

Deno.test("#3969 no client read of profiles names a private column or *", async () => {
  const violations: Violation[] = [];
  let fromChains = 0;
  for (const file of await sourceFiles()) {
    const raw = await Deno.readTextFile(new URL(file, repoRoot));
    if (!raw.includes("profiles")) continue;
    if (/\.from\(\s*["'`]profiles["'`]\s*\)/.test(raw)) fromChains += 1;
    violations.push(...scanFile(file, raw));
  }
  assert(fromChains > 30, `expected the scan to see the known profile reads, saw ${fromChains} files`);
  assert(
    violations.length === 0,
    `private profile reads found:\n${violations.map((v) => `  ${v.file}:${v.line} ${v.detail}`).join("\n")}`,
  );
});

Deno.test("#3969 people lookups go through the server and pass ids, not emails", async () => {
  const read = (path: string) => Deno.readTextFile(new URL(path, repoRoot)).then(stripComments);
  const access = await read("app-mobile/src/services/profileAccessService.ts");
  assert(access.includes('supabase.rpc("get_my_profile")'), "own-profile read must use get_my_profile");
  assert(access.includes('"issue_3969_resolve_person"'), "people lookup must use issue_3969_resolve_person");

  const friends = await read("app-mobile/src/hooks/useFriends.ts");
  assert(friends.includes("resolvePerson("), "add friend must resolve the person on the server");
  assert(!friends.includes("resolve_user_visibility_by_identifier"), "add friend must not use the email-returning lookup");

  for (const path of ["app-mobile/src/hooks/useSessionManagement.ts", "app-mobile/src/services/sessionMembershipService.ts"]) {
    const source = await read(path);
    assert(!source.includes("invitedUserEmail"), `${path} must send the invitee id only`);
  }
  assert((await read("app-mobile/src/hooks/useSessionManagement.ts")).includes("resolvePerson(username)"), "session invite resolves usernames on the server");
  assert((await read("app-mobile/src/services/boardService.ts")).includes("resolvePerson(userEmail)"), "board invite resolves emails on the server");

  const pairing = await read("app-mobile/src/services/pairingService.ts");
  assert(pairing.includes('"issue_3969_pair_partner_details"'), "pairing details come from the scoped server read");
  const friendSheet = await read("app-mobile/src/hooks/useFriendProfile.ts");
  assert(friendSheet.includes("'issue_3969_friend_profile'"), "friend sheet reads through the scoped server read");

  const friendsService = await read("app-mobile/src/services/friendsService.ts");
  const requestType = friendsService.slice(friendsService.indexOf("export interface FriendRequest"), friendsService.indexOf("export interface BlockedUser"));
  assert(!/\bemail\b/.test(requestType), "FriendRequest carries no email");

  const auth = await read("app-mobile/src/hooks/useAuthSimple.ts");
  assert(!/\.ilike\(\s*["']email["']/.test(auth), "no profile lookup by email before sign-in");
});

Deno.test("#3969 Host reads its own private fields through get_my_profile and hides empty roster emails", async () => {
  const read = (path: string) => Deno.readTextFile(new URL(path, repoRoot)).then(stripComments);
  assert((await read("mingla-business/src/hooks/useOwnProfilePhoneOnFile.ts")).includes('.rpc("get_my_profile")'), "Host phone read uses get_my_profile");
  assert((await read("mingla-business/src/i18n/index.ts")).includes('.rpc("get_my_profile")'), "Host language read uses get_my_profile");
  const panel = await read("mingla-business/src/components/messages/BrandGroupPeoplePanel.tsx");
  assert(/member\.email\.trim\(\)\.length > 0 \?/.test(panel), "the roster renders an email line only when there is one");
});

Deno.test("#3969 Admin reads emails through the admin contacts read", async () => {
  const read = (path: string) => Deno.readTextFile(new URL(path, repoRoot)).then(stripComments);
  const service = await read("mingla-admin/src/services/adminProfileContactsService.js");
  assert(service.includes('"issue_3969_admin_profile_contacts"'), "admin contacts service calls the admin read");
  for (const path of [
    "mingla-admin/src/components/CommandPalette.jsx",
    "mingla-admin/src/pages/SettingsPage.jsx",
    "mingla-admin/src/services/identityReadService.js",
    "mingla-admin/src/pages/EmailPage.jsx",
  ]) {
    assert((await read(path)).includes("adminProfileContactsService"), `${path} uses the admin contacts read`);
  }
  assert(
    (await read("mingla-admin/src/services/productAvengersService.js")).includes('"issue_3969_admin_profile_contacts"'),
    "reporter emails use the admin contacts read",
  );
});

Deno.test("#3969 every own-profile read is pinned to the expected user id", async () => {
  // get_my_profile follows whatever bearer the shared client holds, so an
  // unpinned read during an account switch could hand back the old account's
  // row. Every readMyProfile() / rpc("get_my_profile") chain must carry
  // .eq("id", ...) before it ends (the `;`).
  const unpinned: string[] = [];
  const probe = (file: string, raw: string): void => {
    const source = stripComments(raw);
    const re = /(readMyProfile\s*\(\s*\)|\.rpc\(\s*["']get_my_profile["']\s*\))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const end = source.indexOf(";", m.index);
      const chain = source.slice(m.index, end === -1 ? source.length : end);
      if (!/\.eq\(\s*["']id["']/.test(chain)) unpinned.push(`${file}:${lineOf(source, m.index)}`);
    }
  };
  probe("self-test", `const a = await readMyProfile().single();`);
  assert(unpinned.length === 1, "self-test: an unpinned read must be caught");
  unpinned.length = 0;
  probe("self-test", `const a = await readMyProfile()\n.eq("id", u)\n.single();`);
  assert(unpinned.length === 0, "self-test: a pinned read must pass");

  const files = await sourceFiles();
  for (const file of files) {
    if (file.endsWith("services/profileAccessService.ts")) continue;
    probe(file, await Deno.readTextFile(new URL(file, repoRoot)));
  }
  assert(unpinned.length === 0, `own-profile reads without .eq("id", ...): ${unpinned.join(", ")}`);
});
