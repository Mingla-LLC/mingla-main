/**
 * #4389 A3 — Ari's create-brand card when the confirm finds a brand already
 * in setup (DRAFT_EXISTS / EXISTING_INCOMPLETE_BRAND) or the confirmation
 * expired: designed cards, never plain error text.
 *
 * FAILS-ON-REVERT: dropping the duplicate branch in AriChatScreen falls back
 * to ariChatErrorCopy text and fails "the chat routes …"; deleting the code
 * check in a3NoticeFor fails the mapping test.
 */
import { describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import React from "react";

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll(predicate: (node: TestInstance) => boolean, options?: { deep?: boolean }): TestInstance[];
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create(element: React.ReactElement): { root: TestInstance; unmount(): void };
  act(callback: () => void): void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* eslint-disable import/first */
import { a3NoticeFor } from "../ariCreateBrandOutcome";
import { AriCreateBrandNotice } from "../AriSetupCard";
/* eslint-enable import/first */

const BIZ = path.join(__dirname, "../../../..");
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

function strings(root: TestInstance): string[] {
  return root
    .findAll((n) => typeof n.type === "string" && /Text/.test(n.type as string), { deep: true })
    .map((n) => n.props.children)
    .filter((c): c is string => typeof c === "string");
}

describe("#4389 A3 mapping", () => {
  test("duplicate found, from either server code, names the brand", () => {
    for (const code of ["DRAFT_EXISTS", "EXISTING_INCOMPLETE_BRAND"]) {
      expect(
        a3NoticeFor({
          toolName: "create_brand",
          args: { name: "Lantern Room", payout_country: "GB" },
          code,
          message: `You already started this brand (brand_id ${ID}). Offer to continue it instead.`,
          expired: false,
          brandNamesById: { [ID]: "Lantern Rooms" },
        }),
      ).toEqual({ kind: "duplicate", brandId: ID, name: "Lantern Rooms" });
    }
  });
  test("expired keeps the question and says ask again", () => {
    expect(
      a3NoticeFor({ toolName: "create_brand", args: { name: "Lantern Room", payout_country: "GB" }, code: null, expired: true }),
    ).toEqual({ kind: "expired", question: "Create Lantern Room collecting funds in United Kingdom (GBP)?" });
  });
  test("other tools and other errors are not A3", () => {
    expect(a3NoticeFor({ toolName: "update_brand", args: {}, code: "DRAFT_EXISTS", expired: false })).toBeNull();
    expect(a3NoticeFor({ toolName: "create_brand", args: {}, code: "FORBIDDEN", expired: false })).toBeNull();
  });
});

describe("#4389 A3 cards", () => {
  test("duplicate: words, Continue first, Create new", () => {
    const onContinue = jest.fn();
    const onCreateNew = jest.fn();
    let r!: { root: TestInstance; unmount(): void };
    TestRenderer.act(() => {
      r = TestRenderer.create(
        <AriCreateBrandNotice notice={{ kind: "duplicate", brandId: ID, name: "Lantern Room" }} onContinue={onContinue} onCreateNew={onCreateNew} />,
      );
    });
    expect(strings(r.root)).toEqual(["You already started Lantern Room. Continue it?", "Continue", "Create new"]);
    const press = (id: string): void => {
      const hit = r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === "function")[0];
      TestRenderer.act(() => (hit?.props.onPress as () => void)());
    };
    press("ari-a3-continue");
    press("ari-a3-create-new");
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onCreateNew).toHaveBeenCalledTimes(1);
    r.unmount();
  });
  test("expired: the question and This expired. Ask again.", () => {
    let r!: { root: TestInstance; unmount(): void };
    TestRenderer.act(() => {
      r = TestRenderer.create(
        <AriCreateBrandNotice notice={{ kind: "expired", question: "Create X?" }} onContinue={() => undefined} onCreateNew={() => undefined} />,
      );
    });
    expect(strings(r.root)).toEqual(["Create X?", "This expired. Ask again."]);
    r.unmount();
  });
  test("the chat routes duplicate and expired create_brand outcomes to the cards", () => {
    const screen = fs.readFileSync(path.join(BIZ, "src/screens/ari/AriChatScreen.tsx"), "utf8");
    expect(screen).toMatch(/if \(duplicate !== null\) \{\s*setA3Notice\(duplicate\);/);
    expect(screen).toMatch(/if \(expiredCard !== null\) setA3Notice\(expiredCard\);/);
    expect(screen).toContain("<AriCreateBrandNotice");
  });
});
