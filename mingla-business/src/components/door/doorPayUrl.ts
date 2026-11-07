/**
 * issue #4271 — the ONLY way to build what a door pay code QR may encode.
 *
 * A door code is not a ticket. It encodes nothing but
 * `<business web origin>/pay/door/<code>`: a link to a locked, 10-minute,
 * pays-once basket. `DoorPayQr` accepts only the branded `DoorPayUrl` type,
 * and this module is the only place that mints one, so a ticket credential,
 * an order id or any other string cannot reach the QR renderer.
 */

import { BUSINESS_PUBLIC_ORIGIN } from "../../constants/publicUrls";

declare const doorPayUrlBrand: unique symbol;

/** A URL proven to be a door pay link. Mint with `makeDoorPayUrl` only. */
export type DoorPayUrl = string & { readonly [doorPayUrlBrand]: true };

/** Server alphabet: no 0/O, 1/I/L, so a code read aloud is unambiguous. */
export const DOOR_PAY_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

export const DOOR_PAY_PATH_PREFIX = "/pay/door/";

export class DoorPayUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DoorPayUrlError";
  }
}

export const isDoorPayCode = (code: unknown): code is string =>
  typeof code === "string" && DOOR_PAY_CODE_PATTERN.test(code);

export const makeDoorPayUrl = (code: string): DoorPayUrl => {
  if (!isDoorPayCode(code)) {
    throw new DoorPayUrlError("A door pay code is 8 letters and numbers.");
  }
  return `${BUSINESS_PUBLIC_ORIGIN}${DOOR_PAY_PATH_PREFIX}${code}` as DoorPayUrl;
};

/** Runtime proof used by the QR component; types alone can be cast around. */
export const isDoorPayUrl = (value: unknown): value is DoorPayUrl => {
  if (typeof value !== "string") return false;
  const prefix = `${BUSINESS_PUBLIC_ORIGIN}${DOOR_PAY_PATH_PREFIX}`;
  if (!value.startsWith(prefix)) return false;
  return isDoorPayCode(value.slice(prefix.length));
};

export const assertDoorPayUrl = (value: unknown): DoorPayUrl => {
  if (!isDoorPayUrl(value)) {
    throw new DoorPayUrlError("Only a /pay/door/ link can be shown as a door pay code.");
  }
  return value;
};

/** Shown under the QR and read aloud: "K7Q2-M9XA". */
export const formatDoorPayCode = (code: string): string =>
  code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
