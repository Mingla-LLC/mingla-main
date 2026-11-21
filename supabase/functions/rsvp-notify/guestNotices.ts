// Issue #4508 R5-2 — "Your guest's spot is free" for an unclaimed plus-one
// released by a database path that has no edge of its own to send it: the
// proven-contact claim sweep, or an anonymous own RSVP attached to the
// account. Those paths queue a row in rsvp_guest_notices; on the every-minute
// tick this module takes each row once (issue_4508_take_guest_notices) and
// sends it through notify-dispatch with the same builder, words, type and
// idempotency key the submit path uses, so an inviter told by both paths
// still gets one notice. A failed send is logged, not retried (the
// friend-going notices' rule).

import {
  type GuestNotice,
  guestNoticeDispatch,
} from "../_shared/rsvpGuestNotice.ts";

export interface GuestNoticeClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { message?: string | null } | null;
  }>;
  functions: {
    invoke(
      name: string,
      options: { body: Record<string, unknown> },
    ): PromiseLike<{ error: { message?: string | null } | null }>;
  };
}

interface TakenNotice {
  notice_id?: unknown;
  kind?: unknown;
  user_id?: unknown;
  guest_id?: unknown;
  event_id?: unknown;
  event_title?: unknown;
  phone_last4?: unknown;
}

export interface GuestNoticeRun {
  taken: number;
  sent: number;
  failed: number;
  skipped: number;
}

/** Maps one taken queue row to the shared builder's notice. */
export function noticeFromRow(row: TakenNotice): GuestNotice {
  return {
    kind: row.kind,
    userId: row.user_id,
    guestId: row.guest_id,
    eventId: row.event_id,
    eventTitle: row.event_title,
    phoneLast4: row.phone_last4,
  };
}

export async function sendGuestNotices(
  admin: GuestNoticeClient,
  log: (message: string, detail?: string) => void = (message, detail) =>
    console.error(message, detail ?? ""),
): Promise<GuestNoticeRun> {
  const run: GuestNoticeRun = { taken: 0, sent: 0, failed: 0, skipped: 0 };
  const { data, error } = await admin.rpc("issue_4508_take_guest_notices", {
    p_limit: 50,
  });
  if (error) {
    log("[rsvp-notify] guest notice take failed", error.message ?? "");
    return run;
  }
  const rows = (Array.isArray(data) ? data : []) as TakenNotice[];
  run.taken = rows.length;
  for (const row of rows) {
    const body = guestNoticeDispatch(noticeFromRow(row));
    if (body === null) {
      run.skipped += 1;
      log("[rsvp-notify] guest notice malformed", String(row.notice_id ?? ""));
      continue;
    }
    try {
      const { error: sendError } = await admin.functions.invoke(
        "notify-dispatch",
        { body: { ...body } },
      );
      if (sendError) {
        run.failed += 1;
        log(
          "[rsvp-notify] guest notice send failed",
          `${String(row.notice_id ?? "")} ${sendError.message ?? ""}`,
        );
      } else {
        run.sent += 1;
      }
    } catch (err) {
      run.failed += 1;
      log(
        "[rsvp-notify] guest notice send threw",
        `${String(row.notice_id ?? "")} ${
          err instanceof Error ? err.message : "unknown"
        }`,
      );
    }
  }
  return run;
}
