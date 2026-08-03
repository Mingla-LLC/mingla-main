/**
 * deferAfterDismiss — run a callback just PAST the sheet/modal unmount window,
 * so a payment-confirmation Toast presents its native <Modal> from a now-free
 * OS-root view controller. iOS presents ONE modal at a time; a toast raised in
 * the SAME synchronous tick that closes a Refund/Cancel/DoorRefund sheet tries
 * to present while the closing sheet's native modal still occupies the root VC,
 * and UIKit silently drops the second modal.
 *
 * Fixes #1360 (Tier 3 of #1342). The toast is already parent-owned and correct;
 * only its firing MOMENT changes — from the close handler to just after dismissal.
 *
 * I-PROPOSED-1360-PAYMENT-CONFIRM-DEFERRED-PAST-DISMISSAL.
 *
 * Single source of truth for the delay: the Sheet + Modal primitives' OWN
 * unmount windows are imported (never hardcoded) so this helper stays in lockstep
 * if either animation window ever changes.
 */
import { UNMOUNT_DELAY_MS as SHEET_UNMOUNT_DELAY_MS } from "../components/ui/SheetMobile";
import { UNMOUNT_DELAY_MS as MODAL_UNMOUNT_DELAY_MS } from "../components/ui/Modal";

// Safety margin past the longer of the two native unmount windows, so the
// toast's modal presents only after the closing sheet/dialog has fully torn down.
const SETTLE_MARGIN_MS = 60;

/**
 * Default settle delay: the LONGER of the Sheet (280ms) and Modal (200ms)
 * unmount windows, plus the safety margin (≈340ms). Exported for the timing test.
 */
export const DEFER_SETTLE_MS =
  Math.max(SHEET_UNMOUNT_DELAY_MS, MODAL_UNMOUNT_DELAY_MS) + SETTLE_MARGIN_MS;

/**
 * Schedule `fn` to run after the closing sheet/modal has fully dismissed.
 * Fire-and-forget: the toast target is parent-owned and idempotent, so the
 * timer is intentionally not tracked or cancelled.
 */
export function deferAfterDismiss(
  fn: () => void,
  settleMs: number = DEFER_SETTLE_MS,
): void {
  setTimeout(fn, settleMs);
}
