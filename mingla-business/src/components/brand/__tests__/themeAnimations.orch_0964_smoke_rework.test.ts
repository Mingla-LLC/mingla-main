import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), "..", relativePath), "utf8");

const animationJson = (slug: string): { layers?: Array<{ nm?: string }> } =>
  JSON.parse(repoFile(`packages/theme-animations/lottie/${slug}.json`));

describe("ORCH-0964 smoke rework — distinct original-color Lottie animations", () => {
  test("animations are selected by saved theme slug and preserve original Lottie colors", () => {
    const indexSource = repoFile("packages/theme-animations/index.ts");
    const resolverSource = repoFile("packages/event-rendering/themeResolver.ts");
    const animationSource = repoFile("packages/event-rendering/ThemeEntranceAnimation.tsx");

    expect(indexSource).toContain("export const LOTTIE_BY_SLUG");
    expect(resolverSource).toContain("return eventOverride.animation");
    expect(resolverSource).toContain("return brandTheme.animation");
    expect(animationSource).toContain("source={LOTTIE_BY_SLUG[theme.animation]}");
    expect(animationSource).not.toContain("colorFilters");
    expect(animationSource).not.toContain("brandColorFilters");
  });

  test("bundled Lotties use recognizable shapes instead of three generic tintable layers", () => {
    const expectations: Array<[string, string, number]> = [
      ["confetti", "confetti flutter", 40],
      ["fireworks", "fireworks ray", 80],
      ["balloons", "balloon string", 18],
      ["sparkles", "sparkle twinkle", 30],
      ["glitter_shower", "glitter shard", 50],
      ["snowfall", "snowflake drift", 40],
      ["falling_petals", "falling petal", 30],
      ["hearts", "heart float", 20],
      ["shimmer_reveal", "shimmer sweep", 20],
    ];

    for (const [slug, marker, minimumLayers] of expectations) {
      const layers = animationJson(slug).layers ?? [];
      expect(layers.length).toBeGreaterThanOrEqual(minimumLayers);
      expect(layers.some((layer) => layer.nm?.includes(marker))).toBe(true);
      expect(layers.some((layer) => layer.nm?.includes("tintable 1"))).toBe(false);
    }
  });
});
