/**
 * issue #4522 W-11 — a host never reads a raw server code when publishing.
 * The mapper lives in a React Native screen module that a node jest run cannot
 * import (the house publishErrorMapper test reads its source too), so this reads
 * the source and evaluates the mapper's own switch; the screen was checked in a
 * browser.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

const src = readFileSync(path.join(__dirname, "..", "TripCreatorStep5Review.tsx"), "utf-8");
const fn = src.slice(src.indexOf("export function mapPublishErrorToState"), src.indexOf("const styles = StyleSheet.create"));

describe("mapPublishErrorToState — no raw codes for a host", () => {
  test("invalid_cover_media_triplet maps to the friendly cover error on step 1", () => {
    const at = fn.indexOf('case "invalid_cover_media_triplet"');
    expect(at).toBeGreaterThan(0);
    const body = fn.slice(at, fn.indexOf("default:", at));
    expect(body).toContain("Choose a cover with a stable preview image before publishing.");
    expect(body).toMatch(/pointsToStep: 1/);
  });
  test("the default branch hides a bare server code", () => {
    const body = fn.slice(fn.indexOf("default:"));
    expect(body).toMatch(/SERVER_CODE_ONLY\.test\(rawMessage\)/);
    expect(body).toContain("Couldn't publish. Tap Publish to try again.");
    const pattern = src.match(/const SERVER_CODE_ONLY = (\/.*\/);/);
    expect(pattern).not.toBeNull();
    const re = new RegExp(pattern![1].slice(1, -1));
    expect(re.test("invalid_cover_media_triplet")).toBe(true);
    expect(re.test("some_new_server_code")).toBe(true);
    expect(re.test("The bank is still being checked.")).toBe(false);
    expect(re.test("Add a title")).toBe(false);
  });
});
