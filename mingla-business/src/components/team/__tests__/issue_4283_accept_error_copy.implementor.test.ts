/**
 * Issue #4283 — the in-app invite sheet tells the truth when Accept fails.
 * A server refusal (HTTP status >= 400) is not "Couldn't reach Mingla"; that
 * copy stays for a request that never got an answer. The new 409
 * invite_membership_conflict code has its own copy.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ACCEPT_COPY_MEMBERSHIP_CONFLICT,
  ACCEPT_COPY_NETWORK,
  ACCEPT_COPY_SERVER,
  acceptErrorCopy,
} from "../inviteAcceptErrorCopy.ts";

Deno.test("#4283 invite_membership_conflict has its own copy", () => {
  assertEquals(
    acceptErrorCopy({ code: "invite_membership_conflict", status: 409 }),
    ACCEPT_COPY_MEMBERSHIP_CONFLICT,
  );
  assertEquals(
    ACCEPT_COPY_MEMBERSHIP_CONFLICT,
    "We couldn't add you to this brand. Ask the owner to send a new invite.",
  );
});

Deno.test("#4283 a server 500 is not reported as a network failure", () => {
  const copy = acceptErrorCopy({ code: "server", status: 500 });
  assertEquals(copy, ACCEPT_COPY_SERVER);
  assertEquals(copy.includes("Couldn't reach Mingla"), false);
});

Deno.test("#4283 'Couldn't reach Mingla' stays for real network failures", () => {
  assertEquals(acceptErrorCopy(null), ACCEPT_COPY_NETWORK);
  assertEquals(acceptErrorCopy({ code: "server", status: 0 }), ACCEPT_COPY_NETWORK);
});

Deno.test("#4283 named invite states keep their existing copy", () => {
  assertEquals(
    acceptErrorCopy({ code: "invite_email_mismatch", status: 403 }),
    "This invite isn't for this account.",
  );
  assertEquals(
    acceptErrorCopy({ code: "invite_expired", status: 410 }),
    "This invite is no longer available.",
  );
  assertEquals(
    acceptErrorCopy({ code: "invite_currency_mismatch", status: 409 }),
    "Connect your bank to accept this brand.",
  );
});

Deno.test("#4283 the sheet routes Accept failures through acceptErrorCopy", () => {
  const sheet = Deno.readTextFileSync(
    new URL("../InvitePendingSheet.tsx", import.meta.url),
  );
  assertEquals(sheet.includes('from "./inviteAcceptErrorCopy"'), true);
  assertEquals(sheet.includes("{ code: err.code, status: err.status }"), true);
});

Deno.test("#4283 the web accept screen names invite_membership_conflict", () => {
  const screen = Deno.readTextFileSync(
    new URL("../../../../app/accept-brand-invitation.tsx", import.meta.url),
  );
  assertEquals(screen.includes('case "invite_membership_conflict":'), true);
});
