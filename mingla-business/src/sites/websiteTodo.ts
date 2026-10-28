/**
 * #2829 W9a — Home's to-do row for the website plan, decided from Core's
 * plan answer (brand_site_plan_get). Self-contained on purpose: it is loaded
 * by a dynamic import from useWebsiteTodo and shares no module with the plan
 * screens, so Metro neither puts it in the boot payload nor hoists a shared
 * module into `__common` (#3493). The part names are pinned to site-contracts
 * PLAN_PARTS by a parity test.
 *
 * Every number and "next" part is Core's; nothing here ticks anything.
 */
import { supabase } from "../services/supabase";

export const WEBSITE_TODO_PART_LABELS: Readonly<Record<string, string>> = {
  offer: "What you'll offer",
  brand: "Your brand details",
  look: "Choose your design",
  story: "Your story",
  approve: "Approve the plan",
  build: "Build your pages",
  first_offering: "Add your first trip or event",
  publish: "Check and publish",
};

export type WebsiteTodo =
  | { variant: "build"; route: string }
  | { variant: "finish"; route: string; done: number; nextLabel: string | null }
  | { variant: "ask"; route: string };

type Raw = Record<string, unknown>;
const obj = (value: unknown): Raw => (value && typeof value === "object" && !Array.isArray(value) ? value as Raw : {});

/**
 * "Build your website" (no plan and no site yet) / "Finish your website · n
 * of 8 done · next: …" for brand admins and owners; "Your website · Ask an
 * admin to start it" for marketing (20) and event managers (40) before a
 * site exists; nothing for finance managers, scanners, brands without
 * websites, a paused site, or once the site has been published.
 */
export function websiteTodoFor(brandId: string, answer: unknown): WebsiteTodo | null {
  const raw = obj(answer);
  if (raw.entitled !== true) return null;
  const site = raw.site ? obj(raw.site) : null;
  if (site && (site.published === true || site.paused === true)) return null;
  const route = `/brand/${brandId}/website/plan`;
  if (raw.can_manage === true) {
    if (!raw.plan && !site) return { variant: "build", route };
    const status = obj(raw.status);
    const done = typeof status.done_count === "number" ? status.done_count : 0;
    const next = typeof status.next_part === "string" ? WEBSITE_TODO_PART_LABELS[status.next_part] ?? null : null;
    return { variant: "finish", route, done, nextLabel: next };
  }
  if ((raw.rank === 20 || raw.rank === 40) && !site) return { variant: "ask", route };
  return null;
}

/** Throws on any failure: an unknown answer shows no row (a to-do row must be true). */
export async function loadWebsiteTodo(brandId: string): Promise<WebsiteTodo | null> {
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; data?: unknown }>(
    "brand-site-control",
    { body: { route: `/v1/brands/${brandId}/site-plan`, method: "GET" } },
  );
  if (error !== null || !data || data.ok !== true) throw new Error("WEBSITE_PLAN_UNAVAILABLE");
  return websiteTodoFor(brandId, data.data);
}
