/**
 * #4271 door polish — the tone of every Tap to Pay end state (design "State
 * map"). Pure, so the map is pinned by a unit test.
 *
 *   approved                                   ok
 *   declined                                   bad
 *   needs_pin, timed_out, cancelled, failed    neutral (nothing was charged)
 *   unknown_result, save_failed                caution (money may be real)
 *   reader_problem retryable                   neutral
 *   reader_problem device_banned / blocked     bad (Apple's hard blocks)
 *   not_on_this_phone, ios_update_required     neutral (a fallback exists)
 */
import { tapReaderProblemCanRetry, type TapReaderProblem } from "../../../constants/tapToPayCopy";
import type { DoorTone } from "../doorTone";

export type TapEndKind =
  | "approved"
  | "declined"
  | "needs_pin"
  | "timed_out"
  | "cancelled"
  | "failed"
  | "unknown_result"
  | "save_failed"
  | "reader_problem"
  | "not_on_this_phone"
  | "ios_update_required";

export const tapSaleTone = (kind: TapEndKind, problem: TapReaderProblem | null = null): DoorTone => {
  switch (kind) {
    case "approved":
      return "ok";
    case "declined":
      return "bad";
    case "unknown_result":
    case "save_failed":
      return "caution";
    case "reader_problem":
      return problem !== null && !tapReaderProblemCanRetry(problem) ? "bad" : "neutral";
    case "needs_pin":
    case "timed_out":
    case "cancelled":
    case "failed":
    case "not_on_this_phone":
    case "ios_update_required":
      return "neutral";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
};

/** Fixed second line on "Paid, still saving": the money is real. */
export const TAP_SAVE_FAILED_PAID_LINE = "The guest has paid. Don't take this payment again.";
