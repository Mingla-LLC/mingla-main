/**
 * issue #3351 [free trip intake loop] — THE SINGLE OWNER OF TRIP-CHECKOUT STEP
 * ORDER.
 *
 * THE DECISION IS KEYED ON COMPLETION, NOT ON PRESENCE. Keying it on presence
 * is issue #3351: a free trip carrying ANY intake question could never be
 * booked. The details step pushed to /intake because a schema EXISTED, the
 * intake step replaced back to /buyer because the cart was FREE, and neither
 * screen ever wrote down "the questions are answered now" — so the deciding
 * predicate was byte-identical before and after the buyer filled the form. A
 * traveller bounced between the two screens forever and the checkout made
 * ZERO `ticket-checkout-create` requests (proven at runtime on buyer web,
 * three laps). Requiredness is NOT consulted either: the loop fired for an
 * optional-only schema too, because the trigger was `questions.length > 0`.
 *
 * "Complete" therefore means one thing only: for every cart tier that carries
 * a schema with at least one question, the cart holds a committed answer set
 * whose `schema_version_id` equals that tier's CURRENT `schema_version_id`.
 * That single definition does three jobs — it terminates the walk, it makes an
 * optional-only schema behave like any other, and it re-asks (rather than
 * refusing) when an organiser edits the schema mid-checkout.
 *
 * Both screens consult this module and neither may hold a second predicate
 * over the intake schema query that decides navigation.
 *
 * ZERO RUNTIME IMPORTS, BY CONTRACT. Nothing here may import React, the
 * intake schema service (which pulls in `./supabase` at module scope), or
 * `./tripFunnelSteps`. Every parameter is a structural type declared below, so
 * the exhaustive decision-table test runs in the default node/ts-jest config
 * with no module mock. `tripFunnelSteps.ts` stays a separate file because
 * `orch_1176_funnel_wiring.test.ts` asserts the exact single-name import line
 * `import { tripFunnelTotalSteps } from "./tripFunnelSteps"` in two screens,
 * and that suite is not authorised for edit.
 *
 * Seth's OQ-2 decision (2026-09-21): finishing the last form does NOT submit
 * the reservation. The buyer returns to the DETAILS step with an enabled
 * Reserve button and taps it. Nothing in this route may submit a reservation
 * without a buyer tap, so there is no auto-finalise decision and no
 * single-use finalise token.
 */

/** The intake facts the step order turns on. */
export interface TripIntakeState {
  /** The schema query has produced data. `false` → decide nothing. */
  settled: boolean;
  /** At least one cart tier carries a schema with ≥1 question. */
  hasIntake: boolean;
  /**
   * Every schema'd tier has a cart-committed answer set at that tier's current
   * `schema_version_id`. Vacuously true when there are no schema'd tiers.
   */
  intakeComplete: boolean;
}

/**
 * What the checkout does next.
 *
 * - `wait` — the schema read has not settled; navigate nowhere, send nothing.
 * - `go_intake` — open the questions.
 * - `submit_free` — create the free reservation (details step only).
 * - `go_payment` — open the paid step.
 * - `go_details_finalize` — return to the details step, where the buyer taps
 *   Reserve. The intake screen NEVER creates a reservation.
 */
export type TripStepDecision =
  | "wait"
  | "go_intake"
  | "submit_free"
  | "go_payment"
  | "go_details_finalize";

/** A cart line, reduced to the only field the step order reads. */
export interface TripStepCartLine {
  ticketTypeId: string;
}

/** A resolved intake schema, reduced to the two fields the step order reads. */
export interface TripStepSchema {
  questions: readonly unknown[];
  schema_version_id: string;
}

export interface TripIntakeStateInput {
  /** The cart lines, in cart order. */
  lines: readonly TripStepCartLine[];
  /**
   * `useTripIntakeSchemasByEvent(...).data` — `undefined` until it resolves,
   * and `undefined` forever if the read failed.
   */
  schemas: ReadonlyMap<string, TripStepSchema> | undefined;
  /**
   * `cart.intakeFormData` — typed `Record<string, unknown>` in CartContext, so
   * the version is read structurally with no cast and no import.
   */
  committed: Readonly<Record<string, unknown>>;
}

const committedVersionId = (entry: unknown): string | null => {
  if (entry === null || typeof entry !== "object") return null;
  const version = (entry as { schema_version_id?: unknown }).schema_version_id;
  return typeof version === "string" ? version : null;
};

/**
 * The completion predicate. Requiredness-blind on purpose (see the header):
 * an optional-only schema is incomplete until the buyer has been through the
 * form once and it has been committed, and complete immediately afterwards —
 * so it cannot loop.
 */
export function tripIntakeState(input: TripIntakeStateInput): TripIntakeState {
  const { lines, schemas, committed } = input;
  if (schemas === undefined) {
    return { settled: false, hasIntake: false, intakeComplete: false };
  }

  // The schema'd tiers, deduplicated by ticketTypeId, in cart-line order.
  const schemaTiers: Array<{ ticketTypeId: string; versionId: string }> = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.ticketTypeId)) continue;
    seen.add(line.ticketTypeId);
    const schema = schemas.get(line.ticketTypeId);
    if (schema === undefined || schema.questions.length === 0) continue;
    schemaTiers.push({
      ticketTypeId: line.ticketTypeId,
      versionId: schema.schema_version_id,
    });
  }

  if (schemaTiers.length === 0) {
    return { settled: true, hasIntake: false, intakeComplete: true };
  }

  let intakeComplete = true;
  for (const tier of schemaTiers) {
    const version = Object.prototype.hasOwnProperty.call(
      committed,
      tier.ticketTypeId,
    )
      ? committedVersionId(committed[tier.ticketTypeId])
      : null;
    if (version === null || version !== tier.versionId) {
      intakeComplete = false;
      break;
    }
  }

  return { settled: true, hasIntake: true, intakeComplete };
}

export type TripStepOrigin = "details" | "intake";

export interface TripStepInput extends TripIntakeState {
  isFree: boolean;
}

/**
 * The decision table. Total over every input.
 *
 * | from      | condition                      | result                |
 * |-----------|--------------------------------|-----------------------|
 * | `details` | `!settled`                     | `wait`                |
 * | `details` | `hasIntake && !intakeComplete` | `go_intake`           |
 * | `details` | `isFree`                       | `submit_free`         |
 * | `details` | otherwise                      | `go_payment`          |
 * | `intake`  | `!settled`                     | `wait`                |
 * | `intake`  | `isFree`                       | `go_details_finalize` |
 * | `intake`  | otherwise                      | `go_payment`          |
 *
 * THE `intake` ROWS DELIBERATELY IGNORE `intakeComplete`, AND THAT IS
 * LOAD-BEARING. The intake screen commits the active tier's answers and then
 * decides in the SAME handler; the reducer dispatch has not landed in that
 * closure yet, so an `intakeComplete` read there is stale by one commit and
 * would send a traveller who has just answered everything straight back to
 * the form. The details screen reads the same fact one navigation later, once
 * the dispatch has landed, and there it is correct. "Tightening" the `intake`
 * rows with an `intakeComplete` condition reintroduces #3351 in a new shape.
 */
export function nextTripCheckoutStep(
  from: TripStepOrigin,
  input: TripStepInput,
): TripStepDecision {
  const { isFree, settled, hasIntake, intakeComplete } = input;
  if (from === "details") {
    if (!settled) return "wait";
    if (hasIntake && !intakeComplete) return "go_intake";
    return isFree ? "submit_free" : "go_payment";
  }
  if (!settled) return "wait";
  return isFree ? "go_details_finalize" : "go_payment";
}

/**
 * The ONE flattener from the cart's per-tier answer map to the array shape
 * `ticket-checkout-create` reads (`intake_form_data`). Entries keep
 * `Object.keys(committed)` order, are restricted to tiers actually in the
 * cart, and `undefined` / `null` entries are dropped. The committed entries
 * are passed through untouched — `{ ticket_type_id, schema_version_id,
 * answers }` is exactly what the server matches on, so nothing here may
 * reshape, rename or re-key them.
 */
export function tripIntakeFormDataArray(
  committed: Readonly<Record<string, unknown>>,
  lines: readonly TripStepCartLine[],
): unknown[] {
  const cartTierIds = new Set<string>();
  for (const line of lines) cartTierIds.add(line.ticketTypeId);
  const out: unknown[] = [];
  for (const ticketTypeId of Object.keys(committed)) {
    if (!cartTierIds.has(ticketTypeId)) continue;
    const entry = committed[ticketTypeId];
    if (entry === undefined || entry === null) continue;
    out.push(entry);
  }
  return out;
}
