/**
 * tripIntakeSchemaService — consumer-side read + validation for trip intake
 * forms. Faithful mirror of mingla-business
 * `src/services/intakeSchemaService.ts` (ORCH-0880) for the consumer trip
 * checkout (ORCH-1016 REWORK, tester finding D2).
 *
 * The business service lives in `mingla-business/` and can't be imported by
 * the consumer app (separate package, different supabase client + design
 * tokens), so the buyer-facing READ + VALIDATE subset is reimplemented here
 * with identical types/shapes. The planner WRITE API + RPC routing + file
 * upload mint stay business-only — the consumer only reads a published trip's
 * schema and validates answers before checkout.
 *
 * Read: direct anon/authenticated SELECT from `trip_intake_schemas`
 * (columns: event_id, ticket_type_id, schema jsonb, schema_version_id) gated
 * by the published-trip RLS policies
 * (`trip_intake_schemas_anon_select` for anon + the ORCH-1016
 * `trip_intake_schemas_buyer_select` policy for signed-in buyers). This is
 * NOT a brands/tickets table, so COMMS-0009 (anon never reads brands/tickets
 * directly) is unaffected.
 *
 * Submit shape: answers ride the EXISTING `ticket-checkout-create` request
 * body key `intake_form_data` as `IntakeFormData[]`
 * (`{ ticket_type_id, schema_version_id, answers }`), the same shape the
 * business `/checkout-trip` flow submits and the edge fn reads (index.ts
 * §365-457). No new edge function, no post-purchase write.
 */

import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Public types (mirror mingla-business intakeSchemaService)
// ---------------------------------------------------------------------------

export type IntakeQuestionType =
  | "short_text"
  | "long_text"
  | "single_choice"
  | "multi_choice"
  | "date"
  | "number"
  | "file_upload";

export interface IntakeQuestion {
  /** UUID, unique within schema. */
  id: string;
  type: IntakeQuestionType;
  /** Question label shown to buyer, 1-200 chars. */
  label: string;
  required: boolean;
  /** Display order, 0-based, unique within schema. */
  position: number;
  /** Optional planner-side description / helper hint shown above the input. */
  helper?: string;
  /** Optional placeholder shown inside the input. */
  placeholder?: string;
  /** single_choice / multi_choice: 2-10 options. */
  options?: string[];
  /** file_upload: max files per question, 1-5; default 1. */
  max_files?: number;
  /** file_upload: allowed MIME-type categories. */
  allow_images?: boolean;
  allow_pdfs?: boolean;
  allow_docs?: boolean;
  /** number: optional limits. */
  min?: number;
  max?: number;
  /** number: integer-only flag. */
  integer_only?: boolean;
}

export interface IntakeSchema {
  /** UUID — bumped on every save; orders snapshot this for staleness check. */
  schema_version_id: string;
  /** 0-20 questions, ordered by position ascending. */
  questions: IntakeQuestion[];
}

export interface IntakeFileAnswer {
  path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
}

export type IntakeAnswerValue =
  | string // short_text, long_text, date (ISO yyyy-mm-dd), single_choice, number (stringified)
  | string[] // multi_choice
  | IntakeFileAnswer[] // file_upload
  | null;

/**
 * Per-tier intake answer container submitted on `orders.intake_form_data`.
 * Shape per SPEC_ORCH-0880 §15.2 — identical to the business flow.
 */
export interface IntakeFormData {
  ticket_type_id: string;
  schema_version_id: string;
  answers: Record<string, IntakeAnswerValue>;
}

// ---------------------------------------------------------------------------
// Read API
// ---------------------------------------------------------------------------

/**
 * Fetch a single tier's intake schema for a published trip. Returns null when
 * the tier has no schema (the common case — most trips don't require intake).
 *
 * Throws on a real read error so the caller surfaces it (no silent null on
 * failure — distinguishes "no schema" from "couldn't read").
 */
export async function getTripIntakeSchemaByTier(
  eventId: string,
  ticketTypeId: string,
): Promise<IntakeSchema | null> {
  if (!eventId || !ticketTypeId) return null;

  const { data, error } = await supabase
    .from("trip_intake_schemas")
    .select("schema, schema_version_id")
    .eq("event_id", eventId)
    .eq("ticket_type_id", ticketTypeId)
    .maybeSingle();

  if (error !== null) throw error;
  if (data === null) return null;

  const schema = data.schema as IntakeSchema | null;
  if (schema === null) return null;
  // DB column is authoritative for schema_version_id over any value embedded
  // in the schema jsonb.
  return {
    ...schema,
    schema_version_id: data.schema_version_id as string,
  };
}

/**
 * Fetch every tier's intake schema for a trip in one query, keyed by
 * ticket_type_id. Used by the cart sheet so a buyer who selects multiple tiers
 * sees each tier's required questions.
 */
export async function getTripIntakeSchemasByEvent(
  eventId: string,
): Promise<Map<string, IntakeSchema>> {
  const map = new Map<string, IntakeSchema>();
  if (!eventId) return map;

  const { data, error } = await supabase
    .from("trip_intake_schemas")
    .select("ticket_type_id, schema, schema_version_id")
    .eq("event_id", eventId);

  if (error !== null) throw error;

  for (const row of data ?? []) {
    const schema = row.schema as IntakeSchema | null;
    if (schema !== null) {
      map.set(row.ticket_type_id as string, {
        ...schema,
        schema_version_id: row.schema_version_id as string,
      });
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Validation (mirror mingla-business validateAnswerAgainstSchema)
// ---------------------------------------------------------------------------

export function isAnswerEmpty(
  type: IntakeQuestionType,
  answer: IntakeAnswerValue | undefined,
): boolean {
  if (answer === undefined || answer === null) return true;
  switch (type) {
    case "short_text":
    case "long_text":
    case "single_choice":
    case "date":
    case "number":
      return typeof answer !== "string" || answer.trim().length === 0;
    case "multi_choice":
      return !Array.isArray(answer) || answer.length === 0;
    case "file_upload":
      return !Array.isArray(answer) || answer.length === 0;
    default: {
      const _never: never = type;
      void _never;
      return true;
    }
  }
}

/**
 * Validate a tier's answers against its schema. Returns a per-question error
 * map (empty when valid). Mirrors the business validator AND the edge fn's
 * required gate so all three layers agree on "missing required answer".
 */
export function validateAnswerAgainstSchema(
  schema: IntakeSchema,
  answers: Record<string, IntakeAnswerValue>,
): Array<{ question_id: string; error: string }> {
  const errors: Array<{ question_id: string; error: string }> = [];
  for (const q of schema.questions) {
    const answer = answers[q.id];
    if (q.required && isAnswerEmpty(q.type, answer)) {
      errors.push({ question_id: q.id, error: "This question is required." });
      continue;
    }
    if (answer === undefined || answer === null) continue;
    if (q.type === "number") {
      if (typeof answer !== "string") {
        errors.push({ question_id: q.id, error: "Enter a number." });
        continue;
      }
      const parsed = q.integer_only ? parseInt(answer, 10) : parseFloat(answer);
      if (Number.isNaN(parsed)) {
        errors.push({ question_id: q.id, error: "Enter a valid number." });
        continue;
      }
      if (q.min !== undefined && parsed < q.min) {
        errors.push({ question_id: q.id, error: `Must be at least ${q.min}.` });
        continue;
      }
      if (q.max !== undefined && parsed > q.max) {
        errors.push({ question_id: q.id, error: `Must be at most ${q.max}.` });
        continue;
      }
    }
    if (q.type === "single_choice" && typeof answer === "string") {
      if (!q.options?.includes(answer)) {
        errors.push({
          question_id: q.id,
          error: "Pick one of the listed options.",
        });
      }
    }
    if (q.type === "multi_choice" && Array.isArray(answer)) {
      const allowed = new Set(q.options ?? []);
      for (const v of answer) {
        if (typeof v !== "string" || !allowed.has(v)) {
          errors.push({
            question_id: q.id,
            error: "One or more selections aren't in the options list.",
          });
          break;
        }
      }
    }
    if (q.type === "file_upload" && Array.isArray(answer)) {
      const max = q.max_files ?? 1;
      if (answer.length > max) {
        errors.push({
          question_id: q.id,
          error: `Maximum ${max} file${max === 1 ? "" : "s"} per question.`,
        });
      }
    }
  }
  return errors;
}

/**
 * Build the `intake_form_data` array for the ticket-checkout-create body from a
 * set of selected tiers + their schemas + collected answers. Only includes a
 * tier when it has a schema (so non-intake tiers add nothing — the no-schema
 * checkout path stays byte-identical).
 */
export function buildIntakeFormData(
  selectedTierIds: string[],
  schemasByTier: Map<string, IntakeSchema>,
  answersByTier: Record<string, Record<string, IntakeAnswerValue>>,
): IntakeFormData[] {
  const out: IntakeFormData[] = [];
  for (const tierId of selectedTierIds) {
    const schema = schemasByTier.get(tierId);
    if (schema === undefined) continue;
    out.push({
      ticket_type_id: tierId,
      schema_version_id: schema.schema_version_id,
      answers: answersByTier[tierId] ?? {},
    });
  }
  return out;
}
