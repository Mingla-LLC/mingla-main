import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(__dirname, "../WelcomeVideoBackground.web.tsx"),
  "utf8",
);

describe("issue #2073 Host web responsive coverage invariant", () => {
  test("uses fluid dimensions on both replaced-media layers without viewport snapshots", () => {
    const responsiveFill = source.match(
      /const MEDIA_FILL_STYLE = \{([^}]+)\} as const;/,
    );

    expect(responsiveFill).not.toBeNull();
    expect(responsiveFill?.[1]).toContain('width: "100%"');
    expect(responsiveFill?.[1]).toContain('height: "100%"');
    expect(
      source.match(
        /style=\{\[StyleSheet\.absoluteFill, MEDIA_FILL_STYLE\]\}/g,
      ),
    ).toHaveLength(2);
    expect(source).not.toMatch(/Dimensions|getWindowDimensions|useWindowDimensions/);
    expect(source).toContain('resizeMode="cover"');
    expect(source).toContain('contentFit="cover"');
  });
});
