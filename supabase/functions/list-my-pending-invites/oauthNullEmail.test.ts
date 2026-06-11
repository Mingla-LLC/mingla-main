// ORCH-1111 loop-back fix — OAuth null-email resolution (append-only).
//
// Proves the DB-observed defect is fixed: a Google-OAuth user whose
// `auth.users.email` is NULL but who has a VERIFIED `auth.identities` email
// resolves that email (→ their pending invite surfaces). A user with NO
// verified identity email resolves to "" (→ no invite, no leak). And the
// match NEVER trusts user_metadata (user-writable).
//
// FAILS-ON-REVERT: reverting the identity fallback in
// `_shared/trustedCallerEmail.ts` (i.e. resolving from `user.email` only)
// makes the null-email case return "" → the first test FAILS.
//
// This drives the SAME resolver the live list-my-pending-invites handler calls
// (resolveTrustedCallerEmail + makeAuthIdentitiesFetcher), with the admin
// getUserById stubbed to mirror the real account 332e1733-… payload.

import {
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  makeAuthIdentitiesFetcher,
  pickVerifiedIdentityEmail,
  resolveTrustedCallerEmail,
} from "../_shared/trustedCallerEmail.ts";

// Stub a service client whose admin.getUserById returns a GoTrue-shaped user
// with a populated identities[] (the real shape for the bug account).
// deno-lint-ignore no-explicit-any
function stubService(identities: unknown): any {
  return {
    auth: {
      admin: {
        // deno-lint-ignore require-await
        getUserById: async (_id: string) => ({
          data: { user: { id: _id, identities } },
          error: null,
        }),
      },
    },
  };
}

Deno.test("OAuth user with NULL users.email resolves the verified identity email", async () => {
  // Mirrors auth user 332e1733-af2b-49ca-8014-87d56f1b735e: users.email NULL,
  // verified Google identity carries the email.
  const user = {
    id: "332e1733-af2b-49ca-8014-87d56f1b735e",
    email: null,
    identities: undefined, // getUser() omitted them → fallback to admin query
  };
  const fetcher = makeAuthIdentitiesFetcher(
    stubService([
      {
        identity_data: {
          email: "SethOgievaBelgium@gmail.com",
          email_verified: "true",
        },
        last_sign_in_at: "2026-06-10T00:00:00Z",
      },
    ]),
  );
  const email = await resolveTrustedCallerEmail(user, fetcher);
  // Resolved + lowercased — the invite lookup keys on this exact value.
  assertEquals(email, "sethogievabelgium@gmail.com");
});

Deno.test("OAuth user with NO verified identity email resolves to empty (no invite)", async () => {
  const user = { id: "u-unverified", email: null, identities: undefined };
  const fetcher = makeAuthIdentitiesFetcher(
    stubService([
      {
        identity_data: {
          email: "spoof@example.com",
          email_verified: "false", // NOT verified → must be ignored
        },
      },
    ]),
  );
  const email = await resolveTrustedCallerEmail(user, fetcher);
  assertEquals(email, "");
});

Deno.test("users.email (when present) wins without a DB hop", async () => {
  let hit = false;
  const user = {
    id: "u-has-email",
    email: "Owner@Mingla.com",
    identities: undefined,
  };
  const fetcher = (_id: string) => {
    hit = true;
    return Promise.resolve([]);
  };
  const email = await resolveTrustedCallerEmail(user, fetcher);
  assertEquals(email, "owner@mingla.com");
  assertEquals(hit, false); // no fallback query when users.email exists
});

Deno.test("getUser() identities[] are used before the DB fallback", async () => {
  let hit = false;
  const user = {
    id: "u-inline-identity",
    email: null,
    identities: [
      {
        identity_data: { email: "Inline@Gmail.com", email_verified: true },
      },
    ],
  };
  const fetcher = (_id: string) => {
    hit = true;
    return Promise.resolve([]);
  };
  const email = await resolveTrustedCallerEmail(user, fetcher);
  assertEquals(email, "inline@gmail.com");
  assertEquals(hit, false); // inline identities short-circuit the DB hop
});

Deno.test("user_metadata is NEVER consulted (untrusted, user-writable)", async () => {
  // A user with NULL email, NO verified identity, but an attacker-set
  // user_metadata.email MUST resolve to "" — we never read user_metadata.
  const user = {
    id: "u-meta-spoof",
    email: null,
    identities: undefined,
    // Present on the real getUser() user object but deliberately ignored.
    user_metadata: { email: "victim@gmail.com" },
    raw_user_meta_data: { email: "victim@gmail.com" },
  };
  const fetcher = makeAuthIdentitiesFetcher(stubService([]));
  const email = await resolveTrustedCallerEmail(user, fetcher);
  assertEquals(email, "");
});

Deno.test("pickVerifiedIdentityEmail tolerates the flattened projection shape", () => {
  // Defensive: accepts both nested identity_data and flat email/email_verified.
  assertEquals(
    pickVerifiedIdentityEmail([
      { email: "Flat@Gmail.com", email_verified: "t" },
    ]),
    "flat@gmail.com",
  );
  assertEquals(
    pickVerifiedIdentityEmail([{ email: "flat@gmail.com", email_verified: "f" }]),
    "",
  );
});
