/**
 * #4238 — the plan service as seen from inside the Host Ads chunk.
 *
 * The ads screens ship in the same lazy chunk as the plan service
 * (HostAdScreens re-exports it), so they read it statically. This keeps the
 * `loadHostAdPlanService()` call shape the builder already uses, without a
 * dynamic import that loops back through HostAdScreens. Surfaces outside the
 * Host Ads screens (Ari's ad card) keep using services/lazyHostAdPlanService.
 */
import * as hostAdPlanService from "../../services/hostAdPlanService";

export const loadHostAdPlanService = async (): Promise<typeof hostAdPlanService> =>
  hostAdPlanService;
