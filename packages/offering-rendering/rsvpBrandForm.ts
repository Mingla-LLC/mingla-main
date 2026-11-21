// #4541 — transport-neutral RSVP brand-form state shared by Explorer and buyer web.

export type RsvpBrandFormAnswers = Record<string, string | string[] | null>;
export interface RsvpBrandFormDefinition {
  title?: string;
  intro?: string;
  questions: Array<{
    id: string;
    position: number;
    type: "short_text" | "long_text" | "number" | "date" | "single_choice" | "multi_choice";
    label: string;
    help?: string | null;
    required: boolean;
    options?: Array<{ id: string; label: string }>;
    show_if?: { question_id: string; option_id: string } | null;
    show_at_door?: boolean;
    door_label?: string | null;
  }>;
}

export interface RsvpBrandFormPage {
  active: true;
  mode: "optional_on_page" | "required_step";
  formId: string;
  versionId: string;
  name: string;
  definition: RsvpBrandFormDefinition;
  doorFullAnswers: boolean;
  brand: Record<string, unknown>;
}

export interface RsvpBrandFormPayload {
  formId: string;
  versionId: string;
  answers: RsvpBrandFormAnswers;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRsvpBrandFormPage(value: unknown): RsvpBrandFormPage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.active !== true || row.mode === "after_purchase") return null;
  if (
    (row.mode !== "optional_on_page" && row.mode !== "required_step") ||
    typeof row.formId !== "string" || !UUID.test(row.formId) ||
    typeof row.versionId !== "string" || !UUID.test(row.versionId) ||
    !row.definition || typeof row.definition !== "object" || Array.isArray(row.definition) ||
    !Array.isArray((row.definition as { questions?: unknown }).questions)
  ) return null;
  return {
    active: true,
    mode: row.mode,
    formId: row.formId.toLowerCase(),
    versionId: row.versionId.toLowerCase(),
    name: typeof row.name === "string" ? row.name : "Questions",
    definition: row.definition as RsvpBrandFormDefinition,
    doorFullAnswers: row.doorFullAnswers === true,
    brand: row.brand && typeof row.brand === "object" && !Array.isArray(row.brand)
      ? row.brand as Record<string, unknown>
      : {},
  };
}

/**
 * #4541 R1.3 — an "After they RSVP" form: nothing is asked on the page; the
 * page shows one line, and the guest is handed the form after the RSVP.
 */
export interface RsvpBrandFormAfterRsvp {
  active: true;
  mode: "after_purchase";
  formId: string;
  /** The one-line notice under the RSVP choices. */
  notice: string;
}

/** The page's form read: questions on the page, an after-RSVP notice, or nothing. */
export type RsvpBrandFormRead = RsvpBrandFormPage | RsvpBrandFormAfterRsvp;

/** "{brand} will ask a few questions after you sign up" (R1.3, exact words). */
export function rsvpAfterRsvpNotice(brandName: string | null | undefined): string {
  const name = typeof brandName === "string" && brandName.trim().length > 0 ? brandName.trim() : "The host";
  return `${name} will ask a few questions after you sign up`;
}

/**
 * #4541 R1.3 — the page parser that keeps "After they RSVP". A question page
 * parses exactly as `parseRsvpBrandFormPage`; an after_purchase page returns
 * its notice. `parseRsvpBrandFormPage` still returns question pages only, so
 * every surface that draws questions keeps its type.
 */
export function parseRsvpBrandFormRead(value: unknown): RsvpBrandFormRead | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.active === true && row.mode === "after_purchase") {
    if (typeof row.formId !== "string" || !UUID.test(row.formId)) return null;
    const brand = row.brand && typeof row.brand === "object" && !Array.isArray(row.brand)
      ? row.brand as Record<string, unknown>
      : {};
    return {
      active: true,
      mode: "after_purchase",
      formId: row.formId.toLowerCase(),
      notice: rsvpAfterRsvpNotice(typeof brand.displayName === "string" ? brand.displayName : null),
    };
  }
  return parseRsvpBrandFormPage(value);
}

/** Narrow a read to a page that draws questions (null for none or after-RSVP). */
export function rsvpQuestionsPage(read: RsvpBrandFormRead | null | undefined): RsvpBrandFormPage | null {
  return read !== null && read !== undefined && read.mode !== "after_purchase" ? read : null;
}

export function rsvpBrandFormPayload(
  page: RsvpBrandFormPage | null,
  answers: RsvpBrandFormAnswers,
): RsvpBrandFormPayload | null {
  return page === null
    ? null
    : { formId: page.formId, versionId: page.versionId, answers };
}

/**
 * #4541 — when the host edits the form while a guest is typing, keep the
 * answers whose question still exists (a choice answer only while its option
 * still exists); everything else is dropped so the server never sees a stale id.
 */
export function carryOverRsvpAnswers(
  previous: RsvpBrandFormAnswers,
  page: RsvpBrandFormPage,
): RsvpBrandFormAnswers {
  const next: RsvpBrandFormAnswers = {};
  for (const q of page.definition.questions) {
    if (!Object.prototype.hasOwnProperty.call(previous, q.id)) continue;
    const value = previous[q.id];
    if (q.type === "single_choice" || q.type === "multi_choice") {
      const known = new Set((q.options ?? []).map((o) => o.id));
      if (typeof value === "string") {
        if (known.has(value)) next[q.id] = value;
      } else if (Array.isArray(value)) {
        const kept = value.filter((id) => known.has(id));
        if (kept.length > 0) next[q.id] = kept;
      }
    } else if (typeof value === "string") {
      next[q.id] = value;
    }
  }
  return next;
}

/** #4541 — the server refused the RSVP because of the form (changed, missing or invalid answers). */
export function isRsvpFormErrorCode(code: string): boolean {
  return (
    code.includes("form_changed") ||
    code.includes("form_answers_required") ||
    code.includes("form_answers_invalid")
  );
}

const rsvpAnswerEmpty = (value: string | string[] | null | undefined): boolean => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  return value.length === 0;
};

/**
 * #4541 — ids of the visible required questions still unanswered, computed
 * from the page and the current answers (no renderer callback needed). Mirrors
 * `missingRequiredIds` in packages/form-rendering/brandFormRules.ts: a hidden
 * question (its `show_if` source not picked) is never required; a blank string
 * or an empty list counts as unanswered.
 */
export function rsvpFormMissingRequiredIds(
  page: RsvpBrandFormPage | null,
  answers: RsvpBrandFormAnswers,
): string[] {
  // Defensive on shape: gating must never throw on a page that is not a parsed
  // form (the read is validated by parseRsvpBrandFormPage, tests may stub it).
  const questions = page?.definition?.questions;
  if (!Array.isArray(questions)) return [];
  const visible = (q: RsvpBrandFormDefinition["questions"][number]): boolean => {
    const rule = q.show_if;
    if (rule === undefined || rule === null) return true;
    const source = questions.find((s) => s.id === rule.question_id);
    if (source === undefined || source.type !== "single_choice") return false;
    if (source.show_if !== undefined && source.show_if !== null && !visible(source)) return false;
    return answers[source.id] === rule.option_id;
  };
  return [...questions]
    .sort((a, b) => a.position - b.position)
    .filter((q) => visible(q) && q.required && rsvpAnswerEmpty(answers[q.id]))
    .map((q) => q.id);
}
