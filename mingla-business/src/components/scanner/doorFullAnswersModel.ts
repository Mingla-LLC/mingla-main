/**
 * #4514 wave 6 — the "See all answers" server read, read defensively. Pure, so
 * it is testable without the renderer. Imported ONLY by DoorAnswersSheet (the
 * forms renderer's lazy chunk).
 */
import type { BrandAnswers, BrandFormDefinitionShape } from "@mingla/form-rendering";

export type DoorFullAnswers =
  | {
      state: "answered";
      formName: string;
      fromOrderOf: string | null;
      answeredAt: string | null;
      isCurrentVersion: boolean;
      definition: BrandFormDefinitionShape;
      answers: BrandAnswers;
    }
  | { state: "not_answered"; formName: string }
  | { state: "line_only"; formName: string; line: string | null }
  | { state: "no_form" }
  | { state: "rate_limited" };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v : null);

/** Stored answers as the renderer takes them: text, an option id or option ids. */
const toBrandAnswers = (raw: unknown): BrandAnswers => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: BrandAnswers = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[id] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[id] = String(value);
    else if (Array.isArray(value)) out[id] = value.filter((x): x is string => typeof x === "string");
  }
  return out;
};

/** The server read, defensively. Anything unreadable throws (the sheet shows the retry state). */
export const readDoorFullAnswers = (data: unknown): DoorFullAnswers => {
  const raw = (data ?? {}) as Record<string, unknown>;
  const formName = str(raw.formName) ?? "Guest questions";
  switch (raw.state) {
    case "answered": {
      const def = raw.definition as { questions?: unknown } | null | undefined;
      if (def === null || typeof def !== "object" || !Array.isArray(def.questions)) {
        throw new Error("door_answers_unreadable");
      }
      return {
        state: "answered",
        formName,
        fromOrderOf: str(raw.fromOrderOf),
        answeredAt: str(raw.answeredAt),
        isCurrentVersion: raw.isCurrentVersion !== false,
        definition: def as BrandFormDefinitionShape,
        answers: toBrandAnswers(raw.answers),
      };
    }
    case "not_answered":
      return { state: "not_answered", formName };
    case "line_only": {
      const line = raw.line as { items?: unknown } | null | undefined;
      const items = Array.isArray(line?.items) ? line.items : [];
      const text = items
        .flatMap((i) => {
          const x = i as Record<string, unknown> | null;
          return x !== null && typeof x === "object" && typeof x.label === "string" && typeof x.value === "string"
            ? [`${x.label}: ${x.value}`]
            : [];
        })
        .join(" · ");
      return { state: "line_only", formName, line: text.length > 0 ? text : null };
    }
    case "no_form":
      return { state: "no_form" };
    case "rate_limited":
      return { state: "rate_limited" };
    default:
      throw new Error("door_answers_unreadable");
  }
};

