// Issue #3429 REWORK-2 implementor proof — R-5.
//
// `agent-turn-control` is the Ari turn control plane: status, cancel, retry.
// It used to parse and shape-check the request body BEFORE it looked at the
// Authorization header, so an unauthenticated holder of the public anon key
// could tell a malformed body (400 BAD_REQUEST) from an unauthenticated caller
// (401 UNAUTHENTICATED) and map the function's request shape without ever
// presenting a real identity. The control plane now resolves the caller before
// it touches the body, and these assertions pin that ordering.
//
// The source is read COMMENT-STRIPPED, so the prose above — which names every
// token these assertions look for — cannot satisfy a single one of them.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const FUNCTIONS = new URL("../../", import.meta.url).pathname;

function read(relative: string): string {
  return stripComments(Deno.readTextFileSync(`${FUNCTIONS}${relative}`));
}

/** First index of `needle`, or -1. Throws if the seam is gone entirely. */
function seam(source: string, needle: string, label: string): number {
  const index = source.indexOf(needle);
  assert(index >= 0, `${label} is missing from the shipped source`);
  return index;
}

Deno.test("#3429 R2 R-5: agent-turn-control resolves the caller before it reads the body", () => {
  const source = read("agent-turn-control/index.ts");
  const bearerCheck = seam(
    source,
    'authHeader?.startsWith("Bearer ")',
    "the Authorization header check",
  );
  const getUser = seam(source, "auth.getUser(", "the getUser resolution");
  const bodyParse = seam(source, "request.json()", "the body parse");
  const shapeCheck = seam(
    source,
    "UUID_PATTERN.test(",
    "the client_turn_id shape check",
  );

  assert(
    bearerCheck < bodyParse,
    `the Authorization header is checked at ${bearerCheck} but the body is parsed at ${bodyParse}`,
  );
  assert(
    getUser < bodyParse,
    `getUser resolves at ${getUser} but the body is parsed at ${bodyParse}`,
  );
  assert(
    getUser < shapeCheck,
    `getUser resolves at ${getUser} but the body is shape-checked at ${shapeCheck}`,
  );
  // The 401 the header check returns must come BEFORE the first 400, so an
  // unauthenticated caller can never observe a body-shaped response.
  const firstUnauthenticated = seam(
    source,
    'response(401, { code: "UNAUTHENTICATED" })',
    "the 401",
  );
  const firstBadRequest = seam(
    source,
    'response(400, { code: "BAD_REQUEST" })',
    "the 400",
  );
  assert(
    firstUnauthenticated < firstBadRequest,
    `the first 400 (${firstBadRequest}) is reachable before the first 401 (${firstUnauthenticated})`,
  );
});

Deno.test("#3429 R2 R-5: the resolved identity, not just the header, gates the body", () => {
  const source = read("agent-turn-control/index.ts");
  // `getUser` is asynchronous, so checking the header is not enough on its own:
  // the caller's identity must be RESOLVED — the point after which a 401 is no
  // longer possible — before anything reads the request body.
  const resolvedIdentity = seam(
    source,
    "const userId = userData.user.id;",
    "the resolved caller identity",
  );
  const bodyParse = seam(source, "request.json()", "the body parse");
  assert(
    resolvedIdentity < bodyParse,
    `the identity resolves at ${resolvedIdentity} but the body is parsed at ${bodyParse}`,
  );
});
