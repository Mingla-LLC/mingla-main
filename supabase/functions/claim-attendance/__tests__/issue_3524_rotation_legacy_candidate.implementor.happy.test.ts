// issue #3524 — A CLAIM ALWAYS CARRIES A SECOND CANDIDATE.
//
// WHY THIS FILE EXISTS. An order can be holding TWO digests at once: two callers
// arm the same order — the confirmation email and the buyer's own confirmation
// screen — and the one that arms second carries the outgoing digest into the
// row's second slot instead of dropping it, so both links stay redeemable. The
// database only compares that second slot when the caller supplies a legacy
// candidate. If a handler sends `p_legacy_proof_digest: null`, the preserved
// link is never compared and the whole preservation is inert.
//
// So this suite drives the REAL handlers with a REAL Request and reads what they
// ACTUALLY sent to the database, for every shape the pepper ring can take. A
// source grep could not see this: "legacyProof" appearing in the file says
// nothing about the value that left it.
//
// It also pins the arm that already existed — with a previous reader, the legacy
// candidate is still that reader's digest — so this file cannot be satisfied by
// collapsing the ring to one secret.
//
// Run:
//   deno test --import-map=supabase/functions/claim-attendance/__tests__/_importmap.test.json \
//     --allow-read --allow-env --allow-net \
//     supabase/functions/claim-attendance/__tests__/issue_3524_rotation_legacy_candidate.implementor.happy.test.ts

import {
  getCapturedHandler,
  resetCapturedHandler,
} from "../../_shared/__tests__/_serveShim.ts";
import {
  bytesToPostgresHex,
  decodeOrderClaimToken,
  hmacOrderClaimDigest,
} from "../../_shared/attendanceClaim.ts";

type Handler = (req: Request) => Response | Promise<Response>;
type RpcLog = { name: string; args: Record<string, unknown> }[];

const UUID_EVENT = "11111111-1111-4111-8111-111111111111";
const UUID_SOURCE = "22222222-2222-4222-8222-222222222222";
const UUID_USER = "33333333-3333-4333-8333-333333333333";
const TOKEN = "A".repeat(43);

const GOVERNED_PEPPER = "issue-3524-governed-bundle-pepper";
const DIRECT_PEPPER = "issue-3524-direct-legacy-pepper";
const BUNDLE = JSON.stringify({ ATTENDANCE_CLAIM_PEPPER: GOVERNED_PEPPER });

const PEPPER_ENV_KEYS = ["AD_CONVERSION_TOKENS", "ATTENDANCE_CLAIM_PEPPER"];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** The hex a handler is expected to send for a token read under one pepper. */
async function expectedDigest(token: string, pepper: string): Promise<string> {
  const raw = decodeOrderClaimToken(token);
  assert(raw !== null, "the fixture token must decode");
  return bytesToPostgresHex(await hmacOrderClaimDigest(raw, pepper));
}

/**
 * Stand the edge environment up around a handler, invoke it once, and hand back
 * every RPC it actually made. `pepperEnv` is the ONLY thing that varies between
 * the cases below, so what changes in the log is attributable to the ring.
 *
 * An RPC the handler makes that is not stubbed is a failure, never a silent
 * default.
 */
async function invoke(
  modulePath: string,
  request: Request,
  rpcResults: Record<string, unknown>,
  pepperEnv: Record<string, string>,
): Promise<{ response: Response; rpcs: RpcLog }> {
  const originalFetch = globalThis.fetch;
  const saved: Record<string, string | undefined> = {};
  const setEnv = (key: string, value: string) => {
    saved[key] = Deno.env.get(key);
    Deno.env.set(key, value);
  };
  setEnv("SUPABASE_URL", "https://fixture.supabase.co");
  setEnv("SUPABASE_ANON_KEY", "fixture-anon-key");
  setEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
  // Absent keys are REMOVED, not blanked: "no previous reader" is a state the
  // production environment can really be in, and a leftover value from another
  // test in the same process would quietly turn this case into a different one.
  for (const key of PEPPER_ENV_KEYS) {
    saved[key] = Deno.env.get(key);
    if (key in pepperEnv) Deno.env.set(key, pepperEnv[key]);
    else Deno.env.delete(key);
  }

  const rpcs: RpcLog = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    if (url.pathname === "/auth/v1/user") {
      return Response.json({
        id: UUID_USER,
        aud: "authenticated",
        role: "authenticated",
        app_metadata: {},
        user_metadata: {},
        created_at: new Date(0).toISOString(),
      });
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.slice("/rest/v1/rpc/".length);
      const args = (await req.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      rpcs.push({ name, args });
      if (!(name in rpcResults)) {
        throw new Error(`the handler called an unstubbed RPC: ${name}`);
      }
      return Response.json(rpcResults[name]);
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      return Response.json([]);
    }
    throw new Error(`unexpected dependency: ${url.pathname}`);
  }) as typeof fetch;

  try {
    resetCapturedHandler();
    await import(`${modulePath}?legacyCandidate=${crypto.randomUUID()}`);
    const handler = getCapturedHandler() as Handler | null;
    assert(handler !== null, `serve() captured no handler from ${modulePath}`);
    const response = await handler(request);
    await response.clone().text();
    return { response, rpcs };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
    resetCapturedHandler();
  }
}

const CLAIM = "../index.ts";
const HANDOFF = "../../attendance-claim-handoff/index.ts";

const claimRequest = (): Request =>
  new Request("https://fixture.functions/claim-attendance", {
    method: "POST",
    headers: {
      authorization: "Bearer caller-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      version: 1,
      kind: "order",
      eventId: UUID_EVENT,
      sourceId: UUID_SOURCE,
      token: TOKEN,
    }),
  });

const handoffRequest = (): Request =>
  new Request("https://fixture.functions/attendance-claim-handoff", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      version: 1,
      kind: "order",
      eventId: UUID_EVENT,
      sourceId: UUID_SOURCE,
      token: TOKEN,
    }),
  });

const admitted = {
  attemptId: "44444444-4444-4444-8444-444444444444",
  allowed: true,
};
const claimStubs = {
  begin_attendance_claim_attempt: admitted,
  claim_attendance_internal_v2: { result: "invalid" },
};
const testOpts = { sanitizeOps: false, sanitizeResources: false };

function claimArgs(rpcs: RpcLog, name: string): Record<string, unknown> {
  const call = rpcs.find((entry) => entry.name === name);
  assert(call !== undefined, `the handler never called ${name}`);
  return call.args;
}

// ── claim-attendance: the phone rail ────────────────────────────────────────

Deno.test({
  ...testOpts,
  name:
    "#3524 with no previous reader the claim still carries a legacy candidate",
  fn: async () => {
    const { rpcs } = await invoke(CLAIM, claimRequest(), claimStubs, {
      AD_CONVERSION_TOKENS: BUNDLE,
    });
    const args = claimArgs(rpcs, "claim_attendance_internal_v2");
    const governed = await expectedDigest(TOKEN, GOVERNED_PEPPER);

    assert(
      args.p_current_proof_digest === governed,
      "the active candidate is the token read under the current pepper",
    );
    assert(
      args.p_legacy_proof_digest !== null &&
        args.p_legacy_proof_digest !== undefined,
      "a claim must ALWAYS carry a second candidate: an order can be holding a " +
        "previously issued digest, and the database compares that slot only " +
        "when one is supplied. Sending null makes the preserved link " +
        "unredeemable and leaves the rest of the fix inert.",
    );
    assert(
      args.p_legacy_proof_digest === governed,
      "and with a single reader that candidate is the same digest, because the " +
        "preserved digest was minted under this same pepper. Got " +
        String(args.p_legacy_proof_digest),
    );
  },
});

Deno.test({
  ...testOpts,
  name: "#3524 a previous reader is still read, and is still its own digest",
  fn: async () => {
    // The arm #2979 built. Never weakened: where two peppers exist, the second
    // candidate is the OTHER pepper's digest, which is the only thing that can
    // verify a proof minted before the cutover.
    const { rpcs } = await invoke(CLAIM, claimRequest(), claimStubs, {
      AD_CONVERSION_TOKENS: BUNDLE,
      ATTENDANCE_CLAIM_PEPPER: DIRECT_PEPPER,
    });
    const args = claimArgs(rpcs, "claim_attendance_internal_v2");

    assert(
      args.p_current_proof_digest ===
        await expectedDigest(TOKEN, GOVERNED_PEPPER),
      "the current reader is the governed one",
    );
    assert(
      args.p_legacy_proof_digest === await expectedDigest(TOKEN, DIRECT_PEPPER),
      "and the legacy candidate is the PREVIOUS reader's digest",
    );
    assert(
      args.p_legacy_proof_digest !== args.p_current_proof_digest,
      "two readers must produce two different candidates",
    );
  },
});

Deno.test({
  ...testOpts,
  name: "#3524 the single-direct-secret state keeps supplying its own verifier",
  fn: async () => {
    // No bundle at all: the direct secret is both readers, which is the
    // compatibility state #2979 shipped. Asserted here so the broader rule
    // cannot be mistaken for a replacement of it.
    const { rpcs } = await invoke(CLAIM, claimRequest(), claimStubs, {
      ATTENDANCE_CLAIM_PEPPER: DIRECT_PEPPER,
    });
    const args = claimArgs(rpcs, "claim_attendance_internal_v2");
    const direct = await expectedDigest(TOKEN, DIRECT_PEPPER);

    assert(
      args.p_current_proof_digest === direct,
      "the direct secret is current",
    );
    assert(
      args.p_legacy_proof_digest === direct,
      "and it is the only legacy verifier there has ever been",
    );
  },
});

// ── attendance-claim-handoff: the desktop rail ──────────────────────────────

Deno.test({
  ...testOpts,
  name: "#3524 the desktop sheet supplies the same second candidate",
  fn: async () => {
    // The sheet re-verifies the SAME token against the SAME row. If it sent no
    // legacy candidate it would refuse a link the phone accepts, which is the
    // desktop half of the same defect.
    const { rpcs } = await invoke(HANDOFF, handoffRequest(), {
      mint_attendance_claim_handoff: { result: "invalid" },
    }, { AD_CONVERSION_TOKENS: BUNDLE });
    const args = claimArgs(rpcs, "mint_attendance_claim_handoff");
    const governed = await expectedDigest(TOKEN, GOVERNED_PEPPER);

    assert(
      args.p_current_proof_digest === governed,
      "the sheet reads the token under the current pepper",
    );
    assert(
      args.p_legacy_proof_digest === governed,
      "and it carries a second candidate for the same reason the phone does. " +
        "Got " + String(args.p_legacy_proof_digest),
    );
    assert(
      args.p_code_digest !== args.p_current_proof_digest,
      "the code it mints is its own credential, never the claim token",
    );
  },
});

Deno.test({
  ...testOpts,
  name:
    "#3524 the desktop sheet still reads a previous pepper when there is one",
  fn: async () => {
    const { rpcs } = await invoke(HANDOFF, handoffRequest(), {
      mint_attendance_claim_handoff: { result: "invalid" },
    }, {
      AD_CONVERSION_TOKENS: BUNDLE,
      ATTENDANCE_CLAIM_PEPPER: DIRECT_PEPPER,
    });
    const args = claimArgs(rpcs, "mint_attendance_claim_handoff");

    assert(
      args.p_legacy_proof_digest === await expectedDigest(TOKEN, DIRECT_PEPPER),
      "the previous reader is preserved on this rail too",
    );
  },
});

// ── attendance-claim-identity: nothing to extend ────────────────────────────

Deno.test({
  ...testOpts,
  name:
    "#3524 the identity rail carries no proof at all, so it needs no candidate",
  fn: async () => {
    // Stated as a test rather than left as an assumption: the sign-in sweep
    // never presents a digest. It matches verified identifiers and the SQL it
    // calls reads the order's OWN stored digests, so there is no candidate for
    // it to supply and no rotation for it to miss.
    const identity = await Deno.readTextFile(
      new URL("../../attendance-claim-identity/index.ts", import.meta.url),
    );
    assert(
      !identity.includes("p_legacy_proof_digest") &&
        !identity.includes("p_current_proof_digest"),
      "the identity rail must not start presenting proofs",
    );
    assert(
      !identity.includes("resolveAttendanceClaimPepperRing") &&
        !identity.includes("hmacOrderClaimDigest"),
      "it reads no pepper and computes no digest",
    );
    assert(
      identity.includes(
        'admin.rpc(\n      "claim_attendance_by_verified_identity"',
      ),
      "it claims by verified identity, which resolves the order's own digests",
    );
  },
});
