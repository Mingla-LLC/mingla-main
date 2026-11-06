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
