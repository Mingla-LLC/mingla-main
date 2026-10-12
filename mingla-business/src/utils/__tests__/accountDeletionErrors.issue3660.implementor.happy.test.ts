/**
 * #3660 [Host account deletion completes or changes nothing] — implementor
 * happy-path suite for the client's reading of a refused or failed deletion
 * (SPEC §9 T-5; SC-13).
 *
 * What went wrong: every failure of `delete-user` was shown as the same toast,
 * "Couldn't delete. Tap to try again.", including the case where part of the
 * deletion had already landed. The server now answers 409 with the list of
 * things to finish first (nothing changed) or 500 (nothing changed), and the
 * screen must tell them apart by `code`, never by message text.
 *
 * FAILS-ON-REVERT:
 *   - make parseDeletionFailure return the failed error for a 409 → "409 body" fails
 *   - decide on message text instead of `code`                    → "decided on code" fails
 *   - drop a blocker's line                                       → its copy test fails
 */

import {
  ACCOUNT_DELETION_BLOCKED_TITLE,
  ACCOUNT_DELETION_FAILED_MESSAGE,
  ACCOUNT_DELETION_PARTNER_LINKS_LINE,
  ACCOUNT_DELETION_UNKNOWN_BLOCKER_MESSAGE,
  AccountDeletionBlockedError,
  AccountDeletionFailedError,
  describeDeletionBlocker,
  normalizeDeletionBlockers,
  parseDeletionFailure,
} from "../accountDeletionErrors";

describe("#3660 parseDeletionFailure", () => {
  test("409 body → blocked error carrying the blockers", () => {
    const blockers = [
      {
        code: "tickets_sold",
        count: 1,
        items: [{ id: "e1", title: "Rooftop Night" }],
      },
      { code: "money_in_motion", count: 2 },
    ];
    const err = parseDeletionFailure(409, {
      success: false,
      error: "account_deletion_blocked",
      code: "account_deletion_blocked",
      blockers,
    });

    expect(err).toBeInstanceOf(AccountDeletionBlockedError);
    expect(err).not.toBeInstanceOf(AccountDeletionFailedError);
    expect((err as AccountDeletionBlockedError).blockers).toEqual(blockers);
  });

  test("decided on `code`, never on message text", () => {
    // Right words, wrong code: not a block.
    expect(
      parseDeletionFailure(409, {
        error: "account_deletion_blocked",
        message: "account_deletion_blocked",
        code: "something_else",
      }),
    ).toBeInstanceOf(AccountDeletionFailedError);
    // Right code, no words at all: a block.
    expect(
      parseDeletionFailure(409, { code: "account_deletion_blocked" }),
    ).toBeInstanceOf(AccountDeletionBlockedError);
    // Right code on the wrong status: not a block.
    expect(
      parseDeletionFailure(500, { code: "account_deletion_blocked" }),
    ).toBeInstanceOf(AccountDeletionFailedError);
  });

  test("500 → failed error", () => {
    expect(
      parseDeletionFailure(500, {
        success: false,
        error: "account_deletion_failed",
        code: "account_deletion_failed",
      }),
    ).toBeInstanceOf(AccountDeletionFailedError);
  });

  test("an unreadable body → failed error, whatever the status", () => {
    for (const status of [0, 409, 500, 502]) {
      for (const body of [null, undefined, "", "<html>", 42, []]) {
        expect(parseDeletionFailure(status, body)).toBeInstanceOf(
          AccountDeletionFailedError,
        );
      }
    }
  });

  test("a 409 with a malformed blocker list still blocks, with what could be read", () => {
    const err = parseDeletionFailure(409, {
      code: "account_deletion_blocked",
      blockers: [
        null,
        "tickets_sold",
        { count: 3 },
        { code: "upcoming_reservations", count: "2" },
        { code: "tickets_sold", count: 1, items: [{ id: "e1" }, { id: "e2", title: "Kept" }] },
      ],
    });
    expect(err).toBeInstanceOf(AccountDeletionBlockedError);
    expect((err as AccountDeletionBlockedError).blockers).toEqual([
      { code: "upcoming_reservations", count: 0 },
      { code: "tickets_sold", count: 1, items: [{ id: "e2", title: "Kept" }] },
    ]);
  });

  test("normalizeDeletionBlockers reads the RPC's plain array and rejects non-arrays", () => {
    expect(normalizeDeletionBlockers([{ code: "open_menu_orders", count: 4 }])).toEqual([
      { code: "open_menu_orders", count: 4 },
    ]);
    expect(normalizeDeletionBlockers(null)).toEqual([]);
    expect(normalizeDeletionBlockers({ code: "tickets_sold" })).toEqual([]);
  });
});

describe("#3660 describeDeletionBlocker — the exact words", () => {
  test("tickets_sold, one event", () => {
    expect(
      describeDeletionBlocker({
        code: "tickets_sold",
        count: 1,
        items: [{ id: "e1", title: "Rooftop Night" }],
      }),
    ).toBe(
      "1 live or upcoming event has tickets or RSVPs: Rooftop Night. Cancel the event and buyers are refunded through the normal refund process, or wait until it has ended.",
    );
  });

  test("tickets_sold, several events, more than the list shows", () => {
    expect(
      describeDeletionBlocker({
        code: "tickets_sold",
        count: 7,
        items: [
          { id: "e1", title: "A" },
          { id: "e2", title: "B" },
        ],
      }),
    ).toBe(
      "7 live or upcoming events have tickets or RSVPs: A, B and 5 more. Cancel the event and buyers are refunded through the normal refund process, or wait until it has ended.",
    );
  });

  test("tickets_sold with no titles still reads as a sentence", () => {
    expect(describeDeletionBlocker({ code: "tickets_sold", count: 2 })).toBe(
      "2 live or upcoming events have tickets or RSVPs. Cancel the event and buyers are refunded through the normal refund process, or wait until it has ended.",
    );
  });

  test("checkout_in_progress", () => {
    expect(describeDeletionBlocker({ code: "checkout_in_progress", count: 1 })).toBe(
      "Someone is buying a ticket right now. Try again in a few minutes.",
    );
  });

  test("upcoming_reservations", () => {
    expect(describeDeletionBlocker({ code: "upcoming_reservations", count: 1 })).toBe(
      "You have 1 upcoming table reservation. Cancel them or wait until they've passed.",
    );
    expect(describeDeletionBlocker({ code: "upcoming_reservations", count: 3 })).toBe(
      "You have 3 upcoming table reservations. Cancel them or wait until they've passed.",
    );
  });

  test("upcoming_stays", () => {
    expect(describeDeletionBlocker({ code: "upcoming_stays", count: 1 })).toBe(
      "You have 1 stay booking that is still open. Cancel or complete them first.",
    );
    expect(describeDeletionBlocker({ code: "upcoming_stays", count: 2 })).toBe(
      "You have 2 stay bookings that are still open. Cancel or complete them first.",
    );
  });

  test("open_menu_orders", () => {
    expect(describeDeletionBlocker({ code: "open_menu_orders", count: 1 })).toBe(
      "You have 1 open menu order. Complete or cancel them first.",
    );
    expect(describeDeletionBlocker({ code: "open_menu_orders", count: 5 })).toBe(
      "You have 5 open menu orders. Complete or cancel them first.",
    );
  });

  test("money_in_motion", () => {
    expect(describeDeletionBlocker({ code: "money_in_motion", count: 1 })).toBe(
      "A payout or refund on your account is still in progress. Try again once it has settled, or contact support.",
    );
  });

  test("partner_payment_in_progress", () => {
    expect(describeDeletionBlocker({ code: "partner_payment_in_progress", count: 1 })).toBe(
      "A partner payment to you is still in progress. Try again once it has settled, or contact support.",
    );
  });

  test("an unknown code → the generic line", () => {
    expect(describeDeletionBlocker({ code: "something_new", count: 9 })).toBe(
      "Something on your account needs attention before it can be deleted. Contact support.",
    );
    expect(ACCOUNT_DELETION_UNKNOWN_BLOCKER_MESSAGE).toBe(
      "Something on your account needs attention before it can be deleted. Contact support.",
    );
  });

  test("a live partner link no longer blocks: there is no line telling the Host to disconnect", () => {
    // Partner links END with the account (Seth's amendment). The removed
    // blocker code must fall through to the generic line, not to old copy.
    expect(describeDeletionBlocker({ code: "active_partner_link", count: 1 })).toBe(
      ACCOUNT_DELETION_UNKNOWN_BLOCKER_MESSAGE,
    );
  });
});

describe("#3660 fixed screen copy", () => {
  test("the panel title, the honest failure message and the partner line", () => {
    expect(ACCOUNT_DELETION_BLOCKED_TITLE).toBe("You can't delete your account yet");
    expect(ACCOUNT_DELETION_FAILED_MESSAGE).toBe(
      "We couldn't delete your account. Nothing was changed. Try again, or contact support if it keeps happening.",
    );
    expect(ACCOUNT_DELETION_PARTNER_LINKS_LINE).toBe(
      "Your partner connections will end and you'll stop earning from them.",
    );
  });
});

// ── #3660 rework (appended; nothing above is changed) ───────────────────────
// F-5: a failure the server never answered must not be worded as "nothing was
// changed". F-8: the records-retained line exists with its exact words.
describe("#3660 rework F-5 · a failure with no answer is not 'nothing was changed'", () => {
  const {
    ACCOUNT_DELETION_UNCONFIRMED_MESSAGE,
    AccountDeletionUnconfirmedError,
    describeDeletionFailure,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
  } = require("../accountDeletionErrors");

  test("no HTTP status at all → unconfirmed", () => {
    for (const status of [0, NaN, -1, undefined as unknown as number]) {
      for (const body of [null, undefined, "", { error: "x" }]) {
        const err = parseDeletionFailure(status, body);
        expect(err).toBeInstanceOf(AccountDeletionUnconfirmedError);
        // Still a failure for code that only asks "did it fail?".
        expect(err).toBeInstanceOf(AccountDeletionFailedError);
        expect(err).not.toBeInstanceOf(AccountDeletionBlockedError);
      }
    }
  });

  test("a 5xx that is NOT the server's coded answer (gateway timeout) → unconfirmed", () => {
    for (const status of [500, 502, 503, 504, 546]) {
      for (const body of [null, "<html>Gateway Timeout</html>", { message: "timeout" }, { error: "boom" }]) {
        expect(parseDeletionFailure(status, body)).toBeInstanceOf(AccountDeletionUnconfirmedError);
      }
    }
  });

  test("the server's own coded failure → plain failed, on any status", () => {
    for (const status of [500, 503]) {
      const err = parseDeletionFailure(status, {
        success: false,
        error: "account_deletion_failed",
        code: "account_deletion_failed",
      });
      expect(err).toBeInstanceOf(AccountDeletionFailedError);
      expect(err).not.toBeInstanceOf(AccountDeletionUnconfirmedError);
    }
  });

  test("a 4xx refusal is answered, so it is a plain failure, not unconfirmed", () => {
    for (const status of [400, 401, 403, 405, 409]) {
      const err = parseDeletionFailure(status, { error: "Unauthorized or invalid token" });
      expect(err).toBeInstanceOf(AccountDeletionFailedError);
      expect(err).not.toBeInstanceOf(AccountDeletionUnconfirmedError);
    }
  });

  test("a block is still a block whatever else is true", () => {
    expect(
      parseDeletionFailure(409, { code: "account_deletion_blocked", blockers: [] }),
    ).toBeInstanceOf(AccountDeletionBlockedError);
  });

  test("the words follow what is known", () => {
    expect(ACCOUNT_DELETION_UNCONFIRMED_MESSAGE).toBe(
      "We couldn't confirm whether your account was deleted. Check your connection and try again.",
    );
    expect(describeDeletionFailure(parseDeletionFailure(0, null))).toBe(
      ACCOUNT_DELETION_UNCONFIRMED_MESSAGE,
    );
    expect(describeDeletionFailure(parseDeletionFailure(504, null))).toBe(
      ACCOUNT_DELETION_UNCONFIRMED_MESSAGE,
    );
    expect(
      describeDeletionFailure(parseDeletionFailure(500, { code: "account_deletion_failed" })),
    ).toBe(ACCOUNT_DELETION_FAILED_MESSAGE);
    expect(describeDeletionFailure(new Error("anything else"))).toBe(
      ACCOUNT_DELETION_FAILED_MESSAGE,
    );
    expect(ACCOUNT_DELETION_UNCONFIRMED_MESSAGE).not.toMatch(/nothing was changed/i);
  });
});

describe("#3660 rework F-8 · the records-retained line", () => {
  test("exact words", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ACCOUNT_DELETION_RECORDS_RETAINED_LINE } = require("../accountDeletionErrors");
    expect(ACCOUNT_DELETION_RECORDS_RETAINED_LINE).toBe(
      "Your login is kept so your sales and ticket records stay intact. Your Host account, brands and public pages are gone.",
    );
  });
});
