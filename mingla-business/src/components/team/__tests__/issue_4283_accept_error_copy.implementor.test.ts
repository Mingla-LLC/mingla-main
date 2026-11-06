/**
 * Issue #4283 — the in-app invite sheet tells the truth when Accept fails.
 * A server refusal (HTTP status >= 400) is not "Couldn't reach Mingla"; that
 * copy stays for a request that never got an answer. The new 409
 * invite_membership_conflict code has its own copy.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import {
  ACCEPT_COPY_MEMBERSHIP_CONFLICT,
  ACCEPT_COPY_NETWORK,
  ACCEPT_COPY_SERVER,
  acceptErrorCopy,
} from "../inviteAcceptErrorCopy";

describe("#4283 invite accept error copy", () => {
  it("gives invite_membership_conflict its own copy", () => {
    expect(
      acceptErrorCopy({ code: "invite_membership_conflict", status: 409 }),
    ).toBe(ACCEPT_COPY_MEMBERSHIP_CONFLICT);
    expect(ACCEPT_COPY_MEMBERSHIP_CONFLICT).toBe(
      "We couldn't add you to this brand. Ask the owner to send a new invite.",
    );
  });

  it("does not report a server 500 as a network failure", () => {
    const copy = acceptErrorCopy({ code: "server", status: 500 });
    expect(copy).toBe(ACCEPT_COPY_SERVER);
    expect(copy).not.toContain("Couldn't reach Mingla");
  });

  it("keeps 'Couldn't reach Mingla' for real network failures", () => {
    expect(acceptErrorCopy(null)).toBe(ACCEPT_COPY_NETWORK);
    expect(acceptErrorCopy({ code: "server", status: 0 })).toBe(
      ACCEPT_COPY_NETWORK,
    );
  });

  it("keeps the existing copy for named invite states", () => {
    expect(
      acceptErrorCopy({ code: "invite_email_mismatch", status: 403 }),
    ).toBe("This invite isn't for this account.");
    expect(acceptErrorCopy({ code: "invite_expired", status: 410 })).toBe(
      "This invite is no longer available.",
    );
    expect(
      acceptErrorCopy({ code: "invite_currency_mismatch", status: 409 }),
    ).toBe("Connect your bank to accept this brand.");
  });

  it("routes the sheet's Accept failures through acceptErrorCopy", () => {
    const sheet = readFileSync(
      join(__dirname, "../InvitePendingSheet.tsx"),
      "utf8",
    );
    expect(sheet).toContain('from "./inviteAcceptErrorCopy"');
    expect(sheet).toContain("{ code: err.code, status: err.status }");
  });

  it("names invite_membership_conflict on the web accept screen", () => {
    const screen = readFileSync(
      join(__dirname, "../../../../app/accept-brand-invitation.tsx"),
      "utf8",
    );
    expect(screen).toContain('case "invite_membership_conflict":');
  });
});
