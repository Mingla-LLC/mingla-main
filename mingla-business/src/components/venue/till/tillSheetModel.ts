/**
 * #4490 spec 08 O3 fix 3 (O3-S1) — which native modal each Till sheet presents
 * from, so an iPhone never holds two at once.
 *
 * Every kit `Sheet` on a phone is a React Native `Modal`. On iOS a Modal is a
 * view controller presented by the controller that owns its host view. Two
 * sibling Modals both present from the screen; UIKit refuses the second while
 * the first is up ("Attempt to present … which is already presenting …"), and
 * the Till's state then says a sheet is open that nobody can see. On a phone
 * the basket is itself a Sheet, so Pay (and every other sheet the basket opens)
 * failed this way on iPhone from O1 on. Android and web stack sibling sheets
 * and keep their tree exactly as before.
 *
 * The app's two existing answers, reused here:
 *  - I-SUB-SHEET-INSIDE-PARENT (MemberDetailSheet #1369, CoverPickerSheet
 *    #1356, RsvpGuestDetailSheet #1376): a sheet opened from inside a sheet is
 *    rendered inside it, so it presents from that sheet's own modal and iOS
 *    stacks it; closing it shows the parent unchanged.
 *  - #4270 one-at-a-time (DoorModeScreen `switchOverlay` / `afterSheet`,
 *    BrandPlanPanel): one sheet replacing another opens only once the first has
 *    really gone (the Sheet's `onDismissed`).
 */
import type { FloorLayout } from "../../../utils/floorLayout";

export type TillSheetHost = "screen" | "basket";
export type TillCheckSheet = "actions" | "move" | "handover" | "rename";

/** On an iPhone the sheets the basket opens render inside the basket's sheet. */
export function basketSheetsNest(layout: FloorLayout, platform: string): boolean {
  return layout === "phone" && platform === "ios";
}

/**
 * Refund opens from the basket (late money) and from the paid list under the
 * catalog (basket closed). On an iPhone it presents from the basket while the
 * basket is open, from the screen otherwise.
 */
export function refundHost(layout: FloorLayout, platform: string, basketOpen: boolean): TillSheetHost {
  return basketSheetsNest(layout, platform) && basketOpen ? "basket" : "screen";
}

/** What the sheets the basket opened hold. */
export interface BasketLaunched {
  pay: boolean;
  name: boolean;
  voidRow: boolean;
  lineRefund: boolean;
  check: TillCheckSheet | null;
  refund: boolean;
}

/**
 * The basket has closed. Where its sheets live inside it they are gone with
 * it, so their state is cleared: the Till never believes a sheet is open that
 * is not on screen. Elsewhere nothing changes.
 */
export function basketLaunchedAfterClose(state: BasketLaunched, nests: boolean): BasketLaunched {
  if (!nests) return state;
  return { pay: false, name: false, voidRow: false, lineRefund: false, check: null, refund: false };
}

/** One check sheet on screen, and the one waiting for it to go. */
export interface CheckSheetStep {
  shown: TillCheckSheet | null;
  queued: TillCheckSheet | null;
}

/**
 * From the check's actions to Move, Hand over or Rename. On iOS the actions
 * sheet closes first and the next one opens once it has gone; elsewhere the
 * swap happens at once, as before.
 */
export function pickCheckSheet(next: TillCheckSheet, platform: string): CheckSheetStep {
  return platform === "ios" ? { shown: null, queued: next } : { shown: next, queued: null };
}

/** The closing check sheet has gone: the queued one, if any, opens now. */
export function checkSheetGone(step: CheckSheetStep): CheckSheetStep {
  if (step.queued === null) return step;
  return { shown: step.queued, queued: null };
}

/** Everything the Till can show as a sheet or dialog at one moment. */
export interface TillSheetsOpen extends BasketLaunched {
  basket: boolean;
  receipt: boolean;
  choices: boolean;
  offer: boolean;
  checks: boolean;
  leave: boolean;
}

/**
 * The native modals each presenter is asked to hold for this state: the
 * screen, and (on an iPhone) the basket's own sheet. A presenter holding two
 * is the O3-S1 failure on iOS.
 */
export function presenterStacks(
  open: TillSheetsOpen,
  layout: FloorLayout,
  platform: string,
): Record<TillSheetHost, string[]> {
  const stacks: Record<TillSheetHost, string[]> = { screen: [], basket: [] };
  const basketShown = layout === "phone" && open.basket;
  const nests = basketSheetsNest(layout, platform) && basketShown;
  if (basketShown) stacks.screen.push("basket");
  const launched: [string, boolean][] = [
    ["pay", open.pay],
    ["name", open.name],
    ["void", open.voidRow],
    ["lineRefund", open.lineRefund],
    ["check", open.check !== null],
  ];
  for (const [key, on] of launched) {
    if (!on) continue;
    // A sheet nested in a closed basket is not in the tree at all.
    if (basketSheetsNest(layout, platform) && !basketShown) continue;
    stacks[nests ? "basket" : "screen"].push(key);
  }
  if (open.refund) stacks[refundHost(layout, platform, basketShown)].push("refund");
  const screenOnly: [string, boolean][] = [
    ["receipt", open.receipt],
    ["choices", open.choices],
    ["offer", open.offer],
    ["checks", open.checks],
    ["leave", open.leave],
  ];
  for (const [key, on] of screenOnly) if (on) stacks.screen.push(key);
  return stacks;
}
