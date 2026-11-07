/** #2830 — only the Ari chat uses this, so it stays in the chat's own chunk. */
const SETUP_STEPS = new Set(["offer", "brand", "look", "story", "approve", "build", "first_offering", "publish"]);

/**
 * #2830 — Ari's cards route to Brand details or the old plan address. Beside the
 * setup form those are a step on the same screen. Null: a real page to open.
 */
export function setupStepFromRoute(route: string, brandId: string): string | null {
  const [path, query = ""] = route.split("?");
  const base = `/brand/${brandId}`;
  if (path === `${base}/edit`) return "brand";
  if (path !== `${base}/website/plan` && path !== `${base}/website/setup`) return null;
  const params = new URLSearchParams(query);
  const step = params.get("part") ?? params.get("step");
  return step && SETUP_STEPS.has(step) ? step : "approve";
}

/**
 * #2830 — "Add it myself" (and any card that opens Brand details) beside the
 * setup form: the Brand details part on this screen, at the field Ari is
 * asking about, instead of leaving for Brand edit. Null: not a setup step.
 */
export function setupHandoff(
  route: string,
  brandId: string,
  fieldKey: string | null | undefined,
): { step: string; field: string | null } | null {
  const step = setupStepFromRoute(route, brandId);
  if (!step) return null;
  return { step, field: step === "brand" && fieldKey ? fieldKey : null };
}
