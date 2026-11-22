/**
 * #4490 spec 08 §13 (decided 22 Nov) — door sales of Entry work with or
 * without the Till, chosen by the one switch that swaps the order pad for the
 * Till (`venueOrderEntry`):
 *  - Till off for the venue (release flag off, or the venue's Sell in person
 *    feature off) → the gate sale sheet, exactly as before O1 (cash, transfer,
 *    pay by code through `venue-check-in` sell);
 *  - Till on → the Till's Entry tab (O1, `sell_in_till`).
 * Every device on this build carries the Till; installed apps from before #4490
 * have neither, so "the device does not have the Till" needs no third input.
 *
 * At the door nobody is hidden by the switch: who may take the money is the
 * server's call on either path (the gate sale checks check-in rights, the Till
 * checks Sell), as before O1 and as O1 built. So the switch is asked as for a
 * person who may sell, and only its pad/Till answer is used.
 *
 * [TRANSITIONAL] the "gate_sale" branch exits when every venue is on the Till.
 */

import { venueOrderEntry } from "../../venueModules";

export type DoorSaleEntry = "gate_sale" | "till";

export function doorSaleEntry(input: { tillReleased: boolean; tillFeatureOn: boolean }): DoorSaleEntry {
  return venueOrderEntry({ tillReleased: input.tillReleased, tillFeatureOn: input.tillFeatureOn, canSell: true }) === "pad"
    ? "gate_sale"
    : "till";
}

/**
 * A guest-list arrival in the reduced window. The server answers by the same
 * switch (`issue_4490_till_enabled`: release flag and the venue's feature):
 * `sell` → the gate sale at the list price (spec 07 §I as first written),
 * `sell_in_till` → the Till's Entry tab prefilled (spec 07 §11 B3). The
 * server's answer wins over a stale local read of the flag, so the guest is
 * never sent down a path the server would refuse.
 */
export function guestListDoorSale(result: string): DoorSaleEntry | null {
  if (result === "sell_in_till") return "till";
  if (result === "sell") return "gate_sale";
  return null;
}
