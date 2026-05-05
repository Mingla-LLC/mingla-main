/**
 * Display labels for door-sale payment methods. Single source of truth —
 * used in door sale detail (`app/event/[id]/door/[saleId].tsx`), door sale
 * list rows (`app/event/[id]/door/index.tsx`), and guest detail screens
 * (`app/event/[id]/guests/[guestId].tsx`).
 *
 * Per Cycle 17a §B.5 (consolidated 2026-05-04 from 3 inline copies; closes
 * D-CYCLE12-IMPL-4). All three prior copies were verified identical before
 * lift — see implementation report for verification matrix.
 */

import type { DoorPaymentMethod } from "../store/doorSalesStore";

export const PAYMENT_METHOD_LABELS: Record<DoorPaymentMethod, string> = {
  cash: "Cash",
  card_reader: "Card reader",
  nfc: "NFC tap",
  manual: "Manual",
};
