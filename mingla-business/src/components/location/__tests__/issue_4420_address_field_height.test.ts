/**
 * #4420 native run: the Host address field was padding-derived (~38pt) next to
 * 48pt inputs on the trip Basics step. The shared field now takes an optional
 * height floor and the Host bundle sets it to the Host input size.
 */
import fs from "fs";
import path from "path";

import { size } from "../../../constants/designSystem";

const read = (rel: string): string => fs.readFileSync(path.join(__dirname, rel), "utf8");

describe("#4420 Host address field height", () => {
  test("the Host token bundle floors the field at size.input", () => {
    const src = read("../AddressInput.tsx");
    expect(src).toContain("minHeight: sizeTokens.input,");
    expect(size.input).toBe(48);
  });

  test("the shared field applies the optional floor and leaves it off when omitted", () => {
    const shared = read("../../../../../packages/location-input/src/AddressInput.tsx");
    expect(shared).toMatch(
      /tokens\.field\.minHeight !== undefined\s*\?\s*\{ minHeight: tokens\.field\.minHeight \}\s*:\s*null/,
    );
    const types = read("../../../../../packages/location-input/src/types.ts");
    expect(types).toContain("minHeight?: number;");
  });
});
