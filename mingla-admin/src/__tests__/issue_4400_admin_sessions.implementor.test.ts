import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  INVITE_FAILED_MESSAGE,
  SESSION_ENDED_MESSAGE,
  readTeamInviteResult,
} from "../lib/teamInvite.js";

// #4400 — signing in on one browser must not sign the account out of the
// others, and Team invites must say "sign in again" when the sign-in ended.

const SRC = new URL("../", import.meta.url);

/** Drops block and line comments (a "//" inside a string such as a URL is kept). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

async function sourceFiles(dir: URL, out: string[] = []): Promise<string[]> {
  for await (const entry of Deno.readDir(dir)) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const child = new URL(entry.name + (entry.isDirectory ? "/" : ""), dir);
    if (entry.isDirectory) await sourceFiles(child, out);
    else if (/\.(jsx?|tsx?)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(child.pathname);
  }
  return out;
}

/** The innermost `const name = ...` / `function name` that encloses offset. */
function enclosingFunction(source: string, offset: number): string {
  const before = source.slice(0, offset);
  const matches = [...before.matchAll(/(?:const|function)\s+([A-Za-z0-9_]+)\s*=?\s*(?:useCallback\()?\s*async/g)];
  return matches.length ? matches[matches.length - 1][1] : "";
}

// @invariant admin-signin-never-ends-other-sessions (#4400): every supabase.auth.signOut in mingla-admin/src
// names scope "local"; the one exception is completeInviteSetup's scope "others". Enforced by this file.
Deno.test("every auth.signOut in mingla-admin/src names a scope; only completeInviteSetup uses others", async () => {
  const files = await sourceFiles(SRC);
  assert(files.length > 20, "expected to scan the admin source tree");
  const calls: { file: string; args: string; fn: string }[] = [];
  for (const file of files) {
    const source = stripComments(await Deno.readTextFile(file));
    for (const m of source.matchAll(/auth\.signOut\(([^)]*)\)/g)) {
      calls.push({ file: file.split("/src/").pop()!, args: m[1].trim(), fn: enclosingFunction(source, m.index!) });
    }
  }
  // Counted from the files, never a fixed number.
  assert(calls.length > 0, "expected at least one auth.signOut call");
  const unscoped = calls.filter((c) => !/scope\s*:/.test(c.args));
  assertEquals(unscoped, [], "every auth.signOut must name its scope (the default is global)");
  const global = calls.filter((c) => /scope\s*:\s*["']global["']/.test(c.args));
  assertEquals(global, [], "no auth.signOut may use scope global");
  const others = calls.filter((c) => /scope\s*:\s*["']others["']/.test(c.args));
  assertEquals(others.map((c) => `${c.file}:${c.fn}`), ["context/AuthContext.jsx:completeInviteSetup"]);
  const rest = calls.filter((c) => !others.includes(c));
  for (const c of rest) assertMatch(c.args, /scope\s*:\s*["']local["']/, `${c.file}:${c.fn}`);
});

Deno.test("verifyPassword, rejectSession and Sign out end this browser only", async () => {
  const auth = stripComments(await Deno.readTextFile(new URL("context/AuthContext.jsx", SRC)));
  for (const name of ["const rejectSession", "const verifyPassword", "const signOut = useCallback(async"] /* #4423: stable callbacks */) {
    const start = auth.indexOf(name);
    assert(start >= 0, name);
    const body = auth.slice(start, start + 2500);
    assertMatch(body, /auth\.signOut\(\{ scope: "local" \}\)/, name);
  }
  assertMatch(auth, /const endSession = useCallback\(\(notice\) => rejectSession\(notice\)/);
  assertMatch(auth.slice(auth.indexOf("const value = useMemo(")), /endSession,/); // #4423: the provider value is memoised
});

const httpError = (status: number, body: unknown, name = "FunctionsHttpError") => ({
  name,
  context: new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
});

Deno.test("readTeamInviteResult reads every answer honestly", async () => {
  assertEquals(await readTeamInviteResult({ data: null, error: httpError(401, { ok: false, code: "not_authenticated" }) }), { outcome: "session" });
  assertEquals(await readTeamInviteResult({ data: null, error: httpError(403, { ok: false, code: "not_authenticated" }) }), { outcome: "session" });
  // Tester (#4400): admin-team-invite has verify_jwt = true, so the gateway can answer the 401 itself,
  // with a body that is not the function's own. HTTP 401 alone must still mean "sign in again".
  assertEquals(await readTeamInviteResult({ data: null, error: httpError(401, { code: 401, message: "Invalid JWT" }) }), { outcome: "session" });
  assertEquals(await readTeamInviteResult({ data: null, error: httpError(401, { code: "UNAUTHORIZED_INVALID_JWT_FORMAT", message: "x" }) }), { outcome: "session" });
  assertEquals(await readTeamInviteResult({ data: null, error: httpError(401, "") }), { outcome: "session" });
  assertEquals(await readTeamInviteResult({ data: null, error: httpError(400, { ok: false, code: "bad_request" }) }), { outcome: "refused", code: "bad_request" });
  assertEquals(await readTeamInviteResult({ data: null, error: httpError(500, "<!doctype html>oops") }), { outcome: "failed" });
  assertEquals(await readTeamInviteResult({ data: null, error: { name: "FunctionsRelayError", context: new Response("", { status: 502 }) } }), { outcome: "failed" });
  assertEquals(await readTeamInviteResult({ data: null, error: { name: "FunctionsFetchError", context: new TypeError("Failed to fetch") } }), { outcome: "unreachable" });
  assertEquals(await readTeamInviteResult({ thrown: true }), { outcome: "unreachable" });
  assertEquals(await readTeamInviteResult({ data: { ok: false, code: "forbidden" }, error: null }), { outcome: "refused", code: "forbidden" });
  assertEquals((await readTeamInviteResult({ data: { ok: true, email_sent: false }, error: null })).outcome, "not_sent");
  assertEquals((await readTeamInviteResult({ data: { ok: true, email_sent: true }, error: null })).outcome, "sent");
});

Deno.test("approved copy", () => {
  assertEquals(SESSION_ENDED_MESSAGE, "Your sign-in ended. Sign in again.");
  assertEquals(INVITE_FAILED_MESSAGE, "Couldn't send the invite. Something went wrong. Try again.");
});

Deno.test("Admin → Team invites use the shared reading and end the session on 401", async () => {
  const page = stripComments(await Deno.readTextFile(new URL("pages/AdminPage.jsx", SRC)));
  assertMatch(page, /import \{[^}]*readTeamInviteResult[^}]*\} from "\.\.\/lib\/teamInvite"/);
  assert(!page.includes('if (fnError || !data) return { outcome: "unreachable" }'), "the old inline mapping is gone");
  const send = page.slice(page.indexOf("const sendInvite = async"), page.indexOf("const markRowInUse"));
  assertMatch(send, /invokeWithRefresh\(TEAM_INVITE_FUNCTION/);
  assertMatch(send, /readTeamInviteResult\(/);
  assert(!send.includes("supabase.functions.invoke"), "sendInvite goes through invokeWithRefresh");
  const toast = page.slice(page.indexOf("const toastInviteFailure"), page.indexOf("const toastNotSent"));
  assertMatch(toast, /result\.outcome === "session"[\s\S]*endSession\(SESSION_ENDED_MESSAGE\)/);
  assertMatch(toast, /result\.outcome === "failed"[\s\S]*INVITE_FAILED_MESSAGE/);
  assertMatch(page, /const \{ access, endSession \} = useAuth\(\);/);
});
