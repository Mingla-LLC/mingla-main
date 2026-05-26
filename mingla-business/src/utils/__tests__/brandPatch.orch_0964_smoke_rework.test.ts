import { describe, expect, test } from "@jest/globals";

import { computeDirtyFieldsPatch } from "../brandPatch";
import type { Brand } from "../../store/currentBrandStore";

const baseBrand = (theme: Brand["theme"]): Brand => ({
  id: "brand-orch-0964",
  displayName: "ORCH 0964 Smoke",
  slug: "orch-0964-smoke",
  address: null,
  coverHue: 25,
  role: "owner",
  stats: { events: 0, followers: 0, rev: 0, rev7d: 0, attendees: 0 },
  currentLiveEvent: null,
  theme,
});

describe("ORCH-0964 smoke rework — brand theme save patch", () => {
  test("includes theme when only public-page theme changed", () => {
    const original = baseBrand(null);
    const draft = baseBrand({
      color: "#8B5CF6",
      font: "playfair-display",
      animation: "fireworks",
    });

    expect(computeDirtyFieldsPatch(draft, original)).toEqual({
      theme: {
        color: "#8B5CF6",
        font: "playfair-display",
        animation: "fireworks",
      },
    });
  });

  test("can clear theme back to defaults", () => {
    const original = baseBrand({
      color: "#8B5CF6",
      font: "playfair-display",
      animation: "fireworks",
    });
    const draft = baseBrand(null);

    expect(computeDirtyFieldsPatch(draft, original)).toEqual({ theme: null });
  });
});
