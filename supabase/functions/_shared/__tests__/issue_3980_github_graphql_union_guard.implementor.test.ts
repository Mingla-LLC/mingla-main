// Issue #3980 synced program, Wave 2 rework 2 — lesson guard for GitHub
// GraphQL unions.
//
// The b70f9953d follow query selected `repository { nameWithOwner }` directly
// on issueOrPullRequest, which returns the IssueOrPullRequest UNION. GitHub
// refused the whole request ("Selections can't be made directly on unions"),
// so every follow batch failed while every fake-GitHub test stayed green.
//
// This guard parses every GitHub GraphQL document #3980 sends (each
// this.graphql(`...`) literal in productAvengers.ts, and the built follow
// query) and asserts: on a known union field (issueOrPullRequest,
// fieldValueByName, field), and on any field whose selection holds an
// "... on X" fragment, nothing but __typename is selected directly; every
// other field sits inside an inline fragment. It also proves the guard
// flags the b70f9953d query exactly where GitHub's real answer did.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildFollowQuery } from "../productAvengers.ts";

const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));
const FIX = new URL("fixtures/issue_3980_follow_query/", import.meta.url);
const fixture = (name: string) => Deno.readTextFileSync(new URL(name, FIX));

/** Fields that return a union in GitHub's schema, as these queries use them. */
const UNION_FIELDS = new Set(["issueOrPullRequest", "fieldValueByName", "field"]);

type Tok = { t: "name" | "punct" | "string" | "number"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/[\s,]/.test(ch)) { i++; continue; }
    if (ch === "#") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (src.startsWith("...", i)) { out.push({ t: "punct", v: "..." }); i += 3; continue; }
    if ("{}():$!=[]@".includes(ch)) { out.push({ t: "punct", v: ch }); i++; continue; }
    if (ch === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      out.push({ t: "string", v: src.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    const name = /^[_A-Za-z][_0-9A-Za-z]*/.exec(src.slice(i));
    if (name) { out.push({ t: "name", v: name[0] }); i += name[0].length; continue; }
    const num = /^-?\d+(\.\d+)?/.exec(src.slice(i));
    if (num) { out.push({ t: "number", v: num[0] }); i += num[0].length; continue; }
    throw new Error(`unexpected character ${JSON.stringify(ch)} at ${i}`);
  }
  return out;
}

/**
 * Every place a field other than __typename is selected directly on a union
 * field or on a field whose selection holds an inline fragment, as
 * "<path>: <field>", where <path> names each field by its alias when it has
 * one (GitHub reports errors by alias too).
 */
function unionViolations(doc: string): string[] {
  const toks = tokenize(doc);
  let p = 0;
  const peek = () => toks[p];
  const take = (v?: string) => {
    const t = toks[p++];
    if (!t || (v !== undefined && t.v !== v)) throw new Error(`expected ${v ?? "a token"}, got ${t?.v ?? "the end"}`);
    return t;
  };
  const skipBalanced = (open: string, close: string) => {
    let depth = 0;
    do {
      const t = take();
      if (t.v === open) depth++;
      else if (t.v === close) depth--;
    } while (depth > 0);
  };
  const skipDirectives = () => {
    while (peek()?.v === "@") { take("@"); take(); if (peek()?.v === "(") skipBalanced("(", ")"); }
  };
  const violations: string[] = [];

  // Reads one selection set; returns nothing, records violations.
  const selectionSet = (path: string, parentName: string | null) => {
    take("{");
    const direct: string[] = [];
    let fragments = 0;
    while (peek() && peek().v !== "}") {
      if (peek().v === "...") {
        take("...");
        if (peek()?.v === "on") {
          take("on");
          const type = take().v;
          skipDirectives();
          selectionSet(`${path} ... on ${type}`, null);
          fragments++;
        } else {
          take(); // a named fragment spread: not a direct field
          skipDirectives();
        }
        continue;
      }
      let name = take().v;
      const label = name;
      if (peek()?.v === ":") { take(":"); name = take().v; }
      if (peek()?.v === "(") skipBalanced("(", ")");
      skipDirectives();
      direct.push(name);
      if (peek()?.v === "{") selectionSet(path ? `${path}.${label}` : label, name);
    }
    take("}");
    if (parentName !== null && (UNION_FIELDS.has(parentName) || fragments > 0)) {
      for (const f of direct) if (f !== "__typename") violations.push(`${path}: ${f}`);
    }
  };

  // Operation header: "query" / "mutation", an optional name and variables.
  if (peek()?.t === "name") {
    take();
    if (peek()?.t === "name") take();
    if (peek()?.v === "(") skipBalanced("(", ")");
    skipDirectives();
  }
  selectionSet("", null);
  assertEquals(p, toks.length, "one operation per document");
  return violations;
}

/** Every GitHub GraphQL document productAvengers.ts sends. */
function productAvengersDocuments(): { where: string; doc: string }[] {
  const src = read("supabase/functions/_shared/productAvengers.ts");
  const literals = [...src.matchAll(/this\.graphql\(\s*`([^`]*)`/g)].map((m, i) => ({ where: `this.graphql #${i + 1}`, doc: m[1] }));
  // Every this.graphql( call carries a literal the guard reads.
  assertEquals(literals.length, (src.match(/this\.graphql\(/g) ?? []).length, "every this.graphql( call is a literal the guard parses");
  // The only other GraphQL body is the follow query built by buildFollowQuery.
  const bodies = src.match(/JSON\.stringify\(\{ query\b[^}]*\}/g) ?? [];
  assertEquals(bodies.sort(), ["JSON.stringify({ query, variables }", "JSON.stringify({ query: buildFollowQuery(wanted) }"].sort(),
    "GraphQL leaves this file only through graphql() and the follow batch");
  return [...literals, { where: "buildFollowQuery", doc: buildFollowQuery([3980, 3991, 9_999_999]) }];
}

Deno.test("#3980 guard: no GitHub GraphQL document selects a field directly on a union", () => {
  const docs = productAvengersDocuments();
  assert(docs.length >= 6, `found ${docs.length} documents`);
  for (const { where, doc } of docs) assertEquals(unionViolations(doc), [], where);
});

Deno.test("#3980 guard: it flags the b70f9953d follow query exactly where GitHub refused it", () => {
  const found = unionViolations(fixture("b70f_query.graphql"));
  assertEquals(found, ["repository.n3980: repository", "repository.n3991: repository"]);
  // GitHub's real answer to that query (recorded 2026-10-20): the same two aliases, the same field.
  const answer = JSON.parse(fixture("b70f_answer.json"));
  assertEquals(answer.data, undefined, "GitHub refused the whole request");
  const refused = (answer.errors as { path: string[]; extensions: { code: string } }[])
    .map((e) => `${e.path.slice(1, -1).join(".")}: ${e.path.at(-1)} (${e.extensions.code})`);
  assertEquals(refused, ["repository.n3980: repository (selectionMismatch)", "repository.n3991: repository (selectionMismatch)"]);
});

Deno.test("#3980 guard: the fixed query passes, and GitHub answered it with data", () => {
  const recorded = fixture("rework2_query.graphql").trim();
  assertEquals(recorded, buildFollowQuery([3980, 3991, 9_999_999]), "the recorded query is the one the code builds");
  assertEquals(unionViolations(recorded), []);
  const answer = JSON.parse(fixture("rework2_answer.json"));
  assert(answer.data?.repository, "GitHub answered with data");
  assertEquals((answer.errors ?? []).map((e: { type: string }) => e.type), ["NOT_FOUND"], "only the number that does not exist");
});

Deno.test("#3980 guard: it catches the mistake on any union or fragment parent, and allows __typename", () => {
  assertEquals(unionViolations("query { node(id: \"x\") { id ... on ProjectV2 { title } } }"), ["node: id"]);
  assertEquals(unionViolations("query { a: fieldValueByName(name: \"S\") { name } }"), ["a: name"]);
  assertEquals(unionViolations("query { r { i: issueOrPullRequest(number: 1) { __typename ... on Issue { title } } } }"), []);
  assertEquals(unionViolations("query { x { nodes { __typename id ... on A { b } } } }"), ["x.nodes: id"]);
  assertEquals(unionViolations("query($n: Int!) { r(n: $n) { plain { a b } } }"), []);
});

Deno.test("#3980 guard: the other GitHub callers #3980 touches send no GraphQL of their own", () => {
  const bridges = read("supabase/functions/_shared/opsBridges.ts");
  assert(!/api\.github\.com\/graphql|\bquery\s*\{|\bmutation\s*[({]/.test(bridges), "opsBridges.ts reads GitHub through ProductAvengersClient only");
  for (const f of ["lib.mjs", "record.mjs", "pr-links.mjs"]) {
    const src = read(`.github/scripts/release-records/${f}`);
    assert(!/graphql/i.test(src), `${f} uses the REST API only`);
  }
});
