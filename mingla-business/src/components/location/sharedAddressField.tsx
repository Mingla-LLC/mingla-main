/**
 * #4334 — the shared Google address field, as the Host wrapper loads it.
 *
 * Native (and jest): a plain static import — the field renders on first paint.
 * Web: `sharedAddressField.web.tsx` loads the same field from its own async
 * chunk, so the ~16 KB field stays off the eager `__common` boot payload
 * (#2099 / #3493 ceiling). Import the field through this module, never from
 * the package index (the index pulls the field into whatever imports it).
 */
export { AddressInput as SharedAddressInput } from "@mingla/location-input/src/AddressInput";
