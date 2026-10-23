/** Issue #3697 — strict Creative Library campaign metadata boundary. */

export type CreativeTagPatch = {
  stage_tags: Array<"prospecting" | "retarget" | "abandoners">;
  concept_tag: string | null;
  hook_tag: string | null;
  event_id: string | null;
  licence_reference: string | null;
  date_locked_until: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGES = new Set(["prospecting", "retarget", "abandoners"]);

function optionalText(
  value: unknown,
  max: number,
): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  return clean.length > 0 && clean.length <= max ? clean : undefined;
}

export function normalizeCreativeTagUpdate(
  input: Record<string, unknown>,
): { ok: true; patch: CreativeTagPatch } | { ok: false; detail: string } {
  if (!Array.isArray(input.stage_tags)) {
    return { ok: false, detail: "stage_tags_invalid" };
  }
  const stageTags = [...new Set(input.stage_tags)];
  if (
    stageTags.some((value) => typeof value !== "string" || !STAGES.has(value))
  ) {
    return { ok: false, detail: "stage_tags_invalid" };
  }
  const conceptTag = optionalText(input.concept_tag, 120);
  const hookTag = optionalText(input.hook_tag, 120);
  const licenceReference = optionalText(input.licence_reference, 240);
  if (
    conceptTag === undefined || hookTag === undefined ||
    licenceReference === undefined
  ) {
    return { ok: false, detail: "creative_tag_text_invalid" };
  }
  const eventId = input.event_id === null || input.event_id === ""
    ? null
    : typeof input.event_id === "string" && UUID_RE.test(input.event_id)
    ? input.event_id
    : undefined;
  if (eventId === undefined) {
    return { ok: false, detail: "event_id_invalid" };
  }
  const rawDateLock = input.date_locked_until;
  const dateLockedUntil = rawDateLock === null || rawDateLock === ""
    ? null
    : typeof rawDateLock === "string" &&
        Number.isFinite(Date.parse(rawDateLock))
    ? new Date(rawDateLock).toISOString()
    : undefined;
  if (dateLockedUntil === undefined) {
    return { ok: false, detail: "date_locked_until_invalid" };
  }
  return {
    ok: true,
    patch: {
      stage_tags: stageTags as CreativeTagPatch["stage_tags"],
      concept_tag: conceptTag,
      hook_tag: hookTag,
      event_id: eventId,
      licence_reference: licenceReference,
      date_locked_until: dateLockedUntil,
    },
  };
}
