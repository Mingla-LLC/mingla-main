export const PRODUCTION_BUSINESS_WEB_ORIGIN =
  "https://business.usemingla.com" as const;

const VERCEL_PREVIEW_BUSINESS_WEB_ORIGIN =
  /^https:\/\/mingla-business-[a-z0-9-]+\.vercel\.app$/;

export type BusinessWebOriginResolution =
  | { ok: true; origin: string }
  | { ok: false; detail: "business_web_origin_override_unrecognized" };

export function resolveBusinessWebOrigin(input: {
  configuredOrigin: string;
  override: unknown;
}): BusinessWebOriginResolution {
  if (input.override === undefined || input.override === null) {
    return { ok: true, origin: input.configuredOrigin };
  }
  if (typeof input.override !== "string") {
    return { ok: false, detail: "business_web_origin_override_unrecognized" };
  }

  const candidate = input.override.trim();
  if (
    candidate === PRODUCTION_BUSINESS_WEB_ORIGIN ||
    VERCEL_PREVIEW_BUSINESS_WEB_ORIGIN.test(candidate)
  ) {
    return { ok: true, origin: candidate };
  }

  return { ok: false, detail: "business_web_origin_override_unrecognized" };
}
