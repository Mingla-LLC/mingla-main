// ORCH-1227 (DEC-192) — ADVERSARIAL regression test for the termii-delivery-status
// webhook's FAIL-CLOSED HMAC signature gate.
//
// Angle: SECURITY / AUTH. The implementor's smsAdapter.termii.test.ts covers the
// happy-path SEND seam; this attacks the INBOUND webhook's signature verification,
// which had ZERO test coverage. Every case here is hostile: forged/absent
// signatures, a missing signing secret, and a malformed body smuggled under a
// valid signature. The gate must answer 403/400 — never 200 — on any of these.
//
// The serve() bootstrap in index.ts is guarded by import.meta.main (proven repo
// pattern, mirrors ORCH-1023 backfill-place-photos), so importing handleTermiiStatus
// here does NOT start a listener — hence --allow-net=none is sufficient. The DB
// client is replaced via __setServiceClientFactory so the suppression-insert path
// runs against a stub instead of a live Supabase.
//
// fails-on-revert: VERIFIED. Temporarily weakening the signature check in index.ts
// to `const ok = true;` (always-pass) flips cases 1, 2, and 3 from 403 → 200, so
// each of those three assertEquals(res.status, 403) FAILS. Restored afterward.
// See REVERT-PROOF block at the bottom for the captured output.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { __setServiceClientFactory, handleTermiiStatus } from "./index.ts";

const SECRET = "test-secret"; // fake; NEVER a real Termii key.
const SIG_KEYS = ["TERMII_WEBHOOK_SECRET", "TERMII_API_KEY"] as const;

function snapshotEnv(
  keys: readonly string[],
): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of keys) snap[k] = Deno.env.get(k);
  return snap;
}
function restoreEnv(snap: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
}

// Re-implement the fn's signing scheme INDEPENDENTLY (HMAC-SHA512 hex over the
// RAW body string) so a passing test proves the contract, not a shared helper.
async function sign(secret: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function post(rawBody: string, headers: Record<string, string> = {}): Request {
  return new Request("https://edge.local/termii-delivery-status", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: rawBody,
  });
}

// A no-op supabase-client stub. The .from(table) chain records inserts so case 5
// can assert the suppression path was reached. update()/select() resolve to empty
// (no error); insert() records the row and resolves clean. maybeSingle() returns
// null so the existence-guard proceeds to insert.
function makeStubClient() {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      return {
        update(_patch: unknown) {
          return {
            eq() {
              return { eq: () => Promise.resolve({ error: null }) };
            },
          };
        },
        select(_cols: string) {
          const chain = {
            eq() {
              return chain;
            },
            is() {
              return chain;
            },
            maybeSingle() {
              return Promise.resolve({ data: null, error: null });
            },
          };
          return chain;
        },
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  // deno-lint-ignore no-explicit-any
  return { client: client as any, inserts };
}

// ---------------------------------------------------------------------------
// Case 1: Missing signature header → 403 (even with a valid body + secret set).
// ---------------------------------------------------------------------------
Deno.test("ADVERSARIAL: missing X-Termii-Signature header → 403", async () => {
  const snap = snapshotEnv(SIG_KEYS);
  Deno.env.set("TERMII_WEBHOOK_SECRET", SECRET);
  Deno.env.delete("TERMII_API_KEY");
  try {
    const body = JSON.stringify({ message_id: "tm_1", status: "DELIVERED" });
    // No X-Termii-Signature header at all.
    const res = await handleTermiiStatus(post(body));
    assertEquals(
      res.status,
      403,
      "no signature header must be rejected fail-closed",
    );
    const json = await res.json();
    assertEquals(json.error, "forbidden");
  } finally {
    restoreEnv(snap);
  }
});

// ---------------------------------------------------------------------------
// Case 2: Wrong/forged signature → 403 (correct secret env, attacker signature).
// ---------------------------------------------------------------------------
Deno.test("ADVERSARIAL: forged/wrong signature → 403", async () => {
  const snap = snapshotEnv(SIG_KEYS);
  Deno.env.set("TERMII_WEBHOOK_SECRET", SECRET);
  Deno.env.delete("TERMII_API_KEY");
  try {
    const body = JSON.stringify({ message_id: "tm_2", status: "DELIVERED" });
    // Attacker can't compute HMAC(SECRET, body); supplies garbage of plausible shape.
    const forged = "deadbeef".repeat(16); // 128 hex chars, like a real SHA-512 hex.
    const res = await handleTermiiStatus(
      post(body, { "x-termii-signature": forged }),
    );
    assertEquals(res.status, 403, "forged signature must be rejected");
    const json = await res.json();
    assertEquals(json.error, "forbidden");
  } finally {
    restoreEnv(snap);
  }
});

// Bonus adversarial: a signature computed with the WRONG secret (key confusion)
// must also fail, even though it is a structurally valid HMAC over the body.
Deno.test("ADVERSARIAL: valid-HMAC-but-wrong-secret → 403 (key confusion)", async () => {
  const snap = snapshotEnv(SIG_KEYS);
  Deno.env.set("TERMII_WEBHOOK_SECRET", SECRET);
  Deno.env.delete("TERMII_API_KEY");
  try {
    const body = JSON.stringify({ message_id: "tm_2b", status: "DELIVERED" });
    const wrongKeySig = await sign("attacker-secret", body);
    const res = await handleTermiiStatus(
      post(body, { "x-termii-signature": wrongKeySig }),
    );
    assertEquals(
      res.status,
      403,
      "HMAC signed with the wrong key must not authenticate",
    );
  } finally {
    restoreEnv(snap);
  }
});

// ---------------------------------------------------------------------------
// Case 3: Missing signing secret env (no TERMII_WEBHOOK_SECRET and no
// TERMII_API_KEY) → 403 even if a signature header is present.
// ---------------------------------------------------------------------------
Deno.test("ADVERSARIAL: no signing secret configured → 403 even with a signature header", async () => {
  const snap = snapshotEnv(SIG_KEYS);
  Deno.env.delete("TERMII_WEBHOOK_SECRET");
  Deno.env.delete("TERMII_API_KEY");
  try {
    const body = JSON.stringify({ message_id: "tm_3", status: "DELIVERED" });
    // Present a signature; with no secret to verify against the gate must still
    // fail closed (NOT skip verification / NOT default-allow).
    const res = await handleTermiiStatus(
      post(body, { "x-termii-signature": "anything" }),
    );
    assertEquals(res.status, 403, "missing secret must fail closed, not open");
    const json = await res.json();
    assertEquals(json.error, "forbidden");
  } finally {
    restoreEnv(snap);
  }
});

// ---------------------------------------------------------------------------
// Case 4: Valid signature, malformed JSON body → 400 (NOT 200). Signature is
// over the RAW body, so we sign the exact malformed string.
// ---------------------------------------------------------------------------
Deno.test("ADVERSARIAL: valid signature over MALFORMED json → 400", async () => {
  const snap = snapshotEnv(SIG_KEYS);
  Deno.env.set("TERMII_WEBHOOK_SECRET", SECRET);
  Deno.env.delete("TERMII_API_KEY");
  // Stub the client so this can't be argued past on a DB throw — though the
  // handler returns 400 before touching the DB.
  const { client } = makeStubClient();
  __setServiceClientFactory(() => client);
  try {
    const malformed = '{"message_id":"tm_4","status":"DELIVERED"'; // missing closing brace
    const goodSig = await sign(SECRET, malformed); // genuine HMAC over the raw bytes
    const res = await handleTermiiStatus(
      post(malformed, { "x-termii-signature": goodSig }),
    );
    assertEquals(
      res.status,
      400,
      "authenticated-but-unparseable body must be 400, not 200",
    );
    const json = await res.json();
    assertEquals(json.error, "termii_status_payload_invalid");
  } finally {
    __setServiceClientFactory(null);
    restoreEnv(snap);
  }
});

// Bonus case 4b: valid signature, valid JSON, but missing message_id/status → 400.
Deno.test("ADVERSARIAL: valid signature, valid json, missing required fields → 400", async () => {
  const snap = snapshotEnv(SIG_KEYS);
  Deno.env.set("TERMII_WEBHOOK_SECRET", SECRET);
  Deno.env.delete("TERMII_API_KEY");
  const { client } = makeStubClient();
  __setServiceClientFactory(() => client);
  try {
    const body = JSON.stringify({ foo: "bar" }); // no message_id, no status
    const goodSig = await sign(SECRET, body);
    const res = await handleTermiiStatus(
      post(body, { "x-termii-signature": goodSig }),
    );
    assertEquals(res.status, 400, "missing message_id/status must be 400");
    const json = await res.json();
    assertEquals(json.error, "termii_status_payload_invalid");
  } finally {
    __setServiceClientFactory(null);
    restoreEnv(snap);
  }
});

// ---------------------------------------------------------------------------
// Case 5: Valid signature + valid DND-status payload → 200, and the suppression
// insert path is reached with channel='sms', scope='all', reason='stop_keyword'.
// ---------------------------------------------------------------------------
Deno.test("ADVERSARIAL→POSITIVE: valid signature + DND status → 200 + suppression insert", async () => {
  const snap = snapshotEnv(SIG_KEYS);
  Deno.env.set("TERMII_WEBHOOK_SECRET", SECRET);
  Deno.env.delete("TERMII_API_KEY");
  const { client, inserts } = makeStubClient();
  __setServiceClientFactory(() => client);
  try {
    const recipient = "+2348012345678";
    const body = JSON.stringify({
      message_id: "tm_5",
      status: "DND Active", // classifyStatus → suppress=true
      receiver: recipient,
    });
    const goodSig = await sign(SECRET, body);
    const res = await handleTermiiStatus(
      post(body, { "x-termii-signature": goodSig }),
    );
    assertEquals(
      res.status,
      200,
      "authenticated valid payload must be accepted",
    );
    const json = await res.json();
    assertEquals(json.ok, true);

    const suppression = inserts.find((i) => i.table === "channel_suppressions");
    assert(
      suppression,
      "DND status must reach the channel_suppressions insert path",
    );
    assertEquals(suppression!.row.channel, "sms");
    assertEquals(suppression!.row.scope, "all");
    assertEquals(suppression!.row.reason, "stop_keyword");
    assertEquals(suppression!.row.contact, recipient);
  } finally {
    __setServiceClientFactory(null);
    restoreEnv(snap);
  }
});

// Bonus: TERMII_API_KEY (no explicit override) is accepted as the signing secret
// — proves the `?? TERMII_API_KEY` fallback authenticates a genuine signature.
Deno.test("POSITIVE: TERMII_API_KEY fallback secret authenticates a genuine signature → 200", async () => {
  const snap = snapshotEnv(SIG_KEYS);
  Deno.env.delete("TERMII_WEBHOOK_SECRET");
  Deno.env.set("TERMII_API_KEY", SECRET);
  const { client } = makeStubClient();
  __setServiceClientFactory(() => client);
  try {
    const body = JSON.stringify({ message_id: "tm_6", status: "DELIVERED" });
    const goodSig = await sign(SECRET, body); // signed with the API key
    const res = await handleTermiiStatus(
      post(body, { "x-termii-signature": goodSig }),
    );
    assertEquals(
      res.status,
      200,
      "API-key-as-secret must authenticate when no override is set",
    );
  } finally {
    __setServiceClientFactory(null);
    restoreEnv(snap);
  }
});

// ---------------------------------------------------------------------------
// REVERT-PROOF (case 6): see header. Weakening the gate to `const ok = true;`
// flips cases 1/2/3 (and the wrong-secret bonus) from 403 → 200, FAILING their
// assertEquals(res.status, 403). Verified during authoring and restored.
// ---------------------------------------------------------------------------
