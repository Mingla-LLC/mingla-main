/**
 * META-ORCH-1161 COMPLIANCE-PAGES — TESTER adversarial regression.
 *
 * ANGLE the implementor's happy-path suite did NOT cover: an email-case-mismatch
 * suppression BYPASS.
 *
 * The DB function `public.can_send(...)` matches a stored suppression with
 * `s.contact = lower(p_contact)` (case-insensitive on the SEND side). Proven
 * against the live Postgres in TEST_META-ORCH-1161_COMPLIANCE_PAGES.md §5:
 *   - When the opt-out row's `contact` is stored LOWERCASED (what the edge fn
 *     does today at index.ts:134 / :144), a later send to ANY casing of that
 *     address is correctly suppressed (can_send → false).
 *   - When the opt-out row's `contact` is stored with MIXED CASE (the regression
 *     that would happen if the `.toLowerCase()` normalization were removed from
 *     index.ts), a send to the normalized-case address is NOT suppressed
 *     (can_send → true) → the user is opted out yet still receives messages.
 *
 * Therefore the security invariant is: the email contact MUST be lowercased
 * BEFORE it is written, on BOTH resolution paths (typed email AND token-derived
 * recipient_email). suppress.ts trusts its caller (it writes `contact` verbatim),
 * so the only enforcement point is index.ts. This test guards that enforcement.
 *
 * Two assertions:
 *  1. Contract boundary — writeSuppressions stores `contact` VERBATIM (it does not
 *     normalize), proving normalization MUST live upstream. (If a future edit made
 *     the writer lowercase too that's harmless, but this documents the boundary.)
 *  2. Enforcement guard — index.ts lowercases the email on BOTH the typed-email and
 *     the token recipient_email paths. Deleting either `.toLowerCase()` (the bypass
 *     regression) makes this test FAIL.
 *
 * fails-on-revert: remove `.toLowerCase()` from either email-resolution line in
 * index.ts → assertion (2) fails.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  type SupabaseLike,
  writeSuppressions,
} from "./suppress.ts";

// (1) Contract boundary: the writer persists `contact` exactly as handed to it.
Deno.test("ADVERSARIAL: writeSuppressions stores email contact VERBATIM (normalization is the caller's job)", async () => {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const client: SupabaseLike = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  // Hand it a NON-normalized email (the bypass shape). The writer must NOT silently
  // "fix" it — it writes what it's given, which is why index.ts must normalize first.
  await writeSuppressions(client, {
    email: "Adversary@Example.COM",
    phone: null,
    scope: "all",
  });

  const cs = inserts.find((i) => i.table === "channel_suppressions");
  assert(cs, "expected a channel_suppressions insert");
  // Documents the boundary: the stored value equals the input exactly.
  assertEquals(cs!.row.contact, "Adversary@Example.COM");
  const mu = inserts.find((i) => i.table === "marketing_unsubscribes");
  assert(mu, "expected a marketing_unsubscribes insert");
  assertEquals(mu!.row.contact_email, "Adversary@Example.COM");
});

// (2) Enforcement guard: index.ts lowercases on BOTH email-resolution paths.
// This is the actual bypass fence — see the live-Postgres proof in the TEST report.
Deno.test("ADVERSARIAL: index.ts lowercases the email on BOTH typed-email and token paths (anti-case-bypass)", async () => {
  const src = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );

  // Typed-email path: `body.email.trim().toLowerCase()`.
  assertStringIncludes(
    src,
    "body.email.trim().toLowerCase()",
    "typed-email contact must be lowercased before write — removing this reopens the case-mismatch suppression bypass",
  );

  // Token recipient path: `payload.recipient_email.trim().toLowerCase()`.
  assertStringIncludes(
    src,
    "payload.recipient_email.trim().toLowerCase()",
    "token-derived recipient_email must be lowercased before write — removing this reopens the case-mismatch suppression bypass on the one-click link",
  );
});
