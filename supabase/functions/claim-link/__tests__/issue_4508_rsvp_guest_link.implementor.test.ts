import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ClaimLinkDeps,
  createClaimLinkHandler,
  parseClaimLinkBody,
} from "../index.ts";

// MINGLA-INVARIANT: I-4508-GUEST-LINK-CLAIM | issue #4508 | claim-link's RSVP guest operations: resolve shows only the inviter, event and last four digits (plus the rsvp_guest OneLink); "This isn't me" releases without sign-in, rate-limited per IP, and tells the inviter in-app; claim needs a signed-in account and returns phone_unproved, never the pass, when that account has not proved the invited number.
//
// fails-on-revert: removing the rsvp_guest_* branch makes every case answer
// 400 invalid.

const PEPPER = {
  bytes: new Uint8Array(32).fill(8),
  format: "hex" as const,
  fingerprint: "test",
};
const USER_ID = "45080000-0000-4000-8000-0000000000aa";
const CODE = "ABCDEFGHJK";

type Rpc = ClaimLinkDeps["rpc"];

function request(body: Record<string, unknown>, auth = true): Request {
  return new Request("https://project.supabase.co/functions/v1/claim-link", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: "Bearer user-token" } : {}),
    },
    body: JSON.stringify(body),
  });
}

function deps(
  rpc: Rpc,
  overrides: Partial<ClaimLinkDeps> = {},
): ClaimLinkDeps {
  return {
    rpc,
    pepper: () => Promise.resolve(PEPPER),
    userId: () => Promise.resolve(USER_ID),
    sendEmail: () => Promise.resolve(true),
    createEmailUser: () => Promise.resolve(true),
    magicLinkToken: () => Promise.resolve("token"),
    ...overrides,
  };
}

function recordingRpc(answers: Record<string, unknown>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rpc: Rpc = (name, args) => {
    calls.push({ name, args });
    if (name === "pg_venue_order_rate_limit_hit") {
      return Promise.resolve({
        data: { allowed: answers.allowed !== false },
        error: null,
      });
    }
    if (name in answers) {
      return Promise.resolve({ data: answers[name], error: null });
    }
    return Promise.resolve({
      data: null,
      error: { message: `unexpected ${name}` },
    });
  };
  return { rpc, calls };
}

Deno.test("the body parser accepts exactly the three guest operations", () => {
  assert(parseClaimLinkBody({ op: "rsvp_guest_resolve", code: CODE }));
  assert(parseClaimLinkBody({ op: "rsvp_guest_release", code: CODE }));
  assert(
    parseClaimLinkBody({ op: "rsvp_guest_claim", code: CODE, name: "Gus" }),
  );
  assertEquals(
    parseClaimLinkBody({ op: "rsvp_guest_release", code: CODE, phone: "+1" }),
    null,
  );
  assertEquals(
    parseClaimLinkBody({
      op: "rsvp_guest_claim",
      code: CODE,
      name: "x".repeat(121),
    }),
    null,
  );
});

Deno.test("resolve: inviter, event, last four and the rsvp_guest OneLink", async () => {
  const { rpc, calls } = recordingRpc({
    rsvp_guest_resolve: {
      status: "open",
      inviterName: "Ada O.",
      phoneLast4: "4502",
      event: { title: "Rooftop Night" },
    },
  });
  const res = await createClaimLinkHandler(
    deps(rpc, { userId: () => Promise.resolve(null) }),
  )(
    request({ op: "rsvp_guest_resolve", code: CODE.toLowerCase() }, false),
  );
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.inviterName, "Ada O.");
  assertEquals(body.phoneLast4, "4502");
  assert(
    String(body.appLink?.oneLink).includes(
      `deep_link_value=rsvp_guest&deep_link_sub1=${CODE}`,
    ),
    body.appLink?.oneLink,
  );
  const call = calls.find((c) => c.name === "rsvp_guest_resolve");
  assertEquals(call?.args, { p_code: CODE, p_viewer: null });
});

Deno.test("release: no sign-in, per-IP limit, inviter told in-app", async () => {
  const notes: unknown[] = [];
  const { rpc, calls } = recordingRpc({
    rsvp_guest_release: {
      outcome: "released",
      inviterUserId: USER_ID,
      eventId: "45080000-1111-4111-8111-111111111111",
      eventTitle: "Rooftop Night",
      phoneLast4: "4777",
    },
  });
  const res = await createClaimLinkHandler(
    deps(rpc, {
      userId: () => Promise.resolve(null),
      notifyGuestReleased: (input) => {
        notes.push(input);
        return Promise.resolve();
      },
    }),
  )(request({ op: "rsvp_guest_release", code: CODE }, false));
  const body = await res.json();
  assertEquals([res.status, body.ok, body.outcome], [200, true, "released"]);
  assertEquals(notes.length, 1);
  assert(
    String(calls[0].args.p_scope_key).startsWith("cl_rsvp_guest_release:"),
    "rate-limited per IP",
  );
  const limited = recordingRpc({ allowed: false });
  const res2 = await createClaimLinkHandler(deps(limited.rpc))(
    request({ op: "rsvp_guest_release", code: CODE }, false),
  );
  assertEquals(res2.status, 429);
});

Deno.test("claim: signed in only; an unproved number never claims", async () => {
  const signedOut = recordingRpc({});
  const res0 = await createClaimLinkHandler(
    deps(signedOut.rpc, { userId: () => Promise.resolve(null) }),
  )(request({ op: "rsvp_guest_claim", code: CODE }, false));
  assertEquals(res0.status, 401);
  assert(
    !signedOut.calls.some((c) => c.name === "rsvp_guest_claim"),
    "no claim attempted",
  );

  const unproved = recordingRpc({
    rsvp_guest_claim: { outcome: "phone_unproved", phoneLast4: "4502" },
  });
  const res1 = await createClaimLinkHandler(deps(unproved.rpc))(
    request({ op: "rsvp_guest_claim", code: CODE }),
  );
  const b1 = await res1.json();
  assertEquals([res1.status, b1.ok, b1.outcome, b1.phoneLast4], [
    200,
    false,
    "phone_unproved",
    "4502",
  ]);

  const claimed = recordingRpc({
    rsvp_guest_claim: {
      outcome: "claimed",
      friendship: "connected",
      closeFriend: true,
    },
  });
  const res2 = await createClaimLinkHandler(deps(claimed.rpc))(
    request({ op: "rsvp_guest_claim", code: CODE, name: " Gus " }),
  );
  const b2 = await res2.json();
  assertEquals([b2.ok, b2.outcome, b2.closeFriend], [true, "claimed", true]);
  assertEquals(
    claimed.calls.find((c) => c.name === "rsvp_guest_claim")?.args,
    { p_user_id: USER_ID, p_code: CODE, p_name: "Gus" },
  );
});
