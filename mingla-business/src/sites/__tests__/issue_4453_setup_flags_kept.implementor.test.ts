/*
 * #4453 — Website setup kept switching the new Sites features off.
 *
 * Only the plan READ carries Core's per-brand values (style_library,
 * ari_add_page, plan_preview). Every write reply (save, design, heartbeat,
 * take-over) is normalised without them, and the setup screen's first
 * heartbeat replaced the cached plan, so the ten styles, the three-style
 * preview and "Add a page with Ari" vanished a second after load. Found live
 * on Gameland Lagos, 2026-11-18, with all seven flags on.
 */
import { keepCoreFlags, normalizeSitePlan } from "../sitePlanState";
import { stylePreviewBlocker } from "../styleLibrary";

const read = normalizeSitePlan("b", {
  plan: { brand_id: "b", revision: 3, offerings_selected: ["experiences", "events"], story: { main_action: "Book an experience" } },
  style_library: true,
  ari_add_page: true,
  plan_preview: true,
});
const heartbeat = normalizeSitePlan("b", { plan: { brand_id: "b", revision: 3 } });

describe("#4453 setup keeps Core's per-brand Sites values", () => {
  it("only the plan read is marked as carrying them", () => {
    expect(read.coreFlags).toBe(true);
    expect(heartbeat.coreFlags).toBe(false);
    expect(heartbeat.styleLibrary).toBe(false);
  });

  it("a heartbeat or save reply keeps the read's values (the regression)", () => {
    const kept = keepCoreFlags(read, heartbeat);
    expect(kept.styleLibrary).toBe(true);
    expect(kept.ariAddPage).toBe(true);
    expect(kept.planPreview).toBe(true);
    expect(kept.plan?.revision).toBe(3);
  });

  it("a fresh read always wins, so switching a flag off still takes effect", () => {
    const off = normalizeSitePlan("b", { plan: { brand_id: "b", revision: 4 }, style_library: false, ari_add_page: false });
    const next = keepCoreFlags(read, off);
    expect(next.styleLibrary).toBe(false);
    expect(next.ariAddPage).toBe(false);
    expect(next.planPreview).toBe(false);
  });

  it("with no earlier read, a write reply stays as Core sent it", () => {
    expect(keepCoreFlags(undefined, heartbeat).styleLibrary).toBe(false);
    expect(keepCoreFlags(heartbeat, heartbeat).styleLibrary).toBe(false);
  });
});

describe("#4453 live style preview in Choose your design", () => {
  it("previews a picked style once the plan has a format", () => {
    expect(stylePreviewBlocker(read, "voyage")).toBeNull();
  });

  it("says why it can't preview yet", () => {
    expect(stylePreviewBlocker(read, null)).toMatch(/Pick a style/);
    expect(stylePreviewBlocker({ ...read, planPreview: false }, "voyage")).toMatch(/aren't on/);
    expect(stylePreviewBlocker({ ...read, plan: null }, "voyage")).toMatch(/Your story/);
  });
});
