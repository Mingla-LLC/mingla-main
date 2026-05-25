const VERCEL_PREVIEW_BUSINESS_WEB_ORIGIN =
  /^https:\/\/mingla-business-[a-z0-9-]+\.vercel\.app$/;

export function getBusinessWebOriginOverride(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const origin = window.location?.origin;
  if (
    typeof origin === "string" &&
    VERCEL_PREVIEW_BUSINESS_WEB_ORIGIN.test(origin)
  ) {
    return origin;
  }
  return undefined;
}

export function businessWebOriginOverrideBody():
  | { business_web_origin_override: string }
  | Record<string, never> {
  const override = getBusinessWebOriginOverride();
  return override ? { business_web_origin_override: override } : {};
}
