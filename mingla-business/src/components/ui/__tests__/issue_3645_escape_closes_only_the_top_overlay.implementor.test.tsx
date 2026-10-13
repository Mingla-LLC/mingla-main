/**
 * issue #3645 — Escape closes only the top-most open overlay.
 *
 * Live test, 2026-10-13: pressing Escape in the payout country list closed the
 * whole brand-creation sheet. Every overlay listened on `document` and closed
 * itself unconditionally, so two stacked overlays both closed on one key press.
 *
 * The stack and the hook are EXECUTED here (real module, real React). That
 * each overlay primitive's Escape handler asks the stack, and that the two
 * platform-modal sheets register so the overlay underneath stays open, is
 * enforced by the strict-grep gate
 * .github/scripts/strict-grep/issue-3645-paid-drafts-stop-at-publish.mjs, group E-a.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

import {
  closeEscapeLayer,
  isTopEscapeLayer,
  openEscapeLayer,
  reserveEscapeLayerOrder,
  resetEscapeLayersForTest,
  useEscapeLayer,
} from "../escapeLayerStack";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
interface Tree {
  update: (element: React.ReactElement) => void;
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (action: () => void | Promise<void>) => Promise<void>;
};

beforeEach(() => resetEscapeLayersForTest());
afterEach(() => resetEscapeLayersForTest());

describe("#3645 — the Escape layer stack", () => {
  test("a single open layer is the top layer", () => {
    const sheet = reserveEscapeLayerOrder();
    openEscapeLayer(sheet);
    expect(isTopEscapeLayer(sheet)).toBe(true);
  });

  test("a layer opened later sits on top; the one underneath is not the top", () => {
    const sheet = reserveEscapeLayerOrder();
    const list = reserveEscapeLayerOrder();
    openEscapeLayer(sheet);
    openEscapeLayer(list);
    expect(isTopEscapeLayer(list)).toBe(true);
    expect(isTopEscapeLayer(sheet)).toBe(false);
  });

  test("closing the top layer hands Escape back to the one underneath", () => {
    const sheet = reserveEscapeLayerOrder();
    const list = reserveEscapeLayerOrder();
    openEscapeLayer(sheet);
    openEscapeLayer(list);
    closeEscapeLayer(list);
    expect(isTopEscapeLayer(sheet)).toBe(true);
  });

  test("three deep: only the last one is the top, and they unwind one at a time", () => {
    const [a, b, c] = [
      reserveEscapeLayerOrder(),
      reserveEscapeLayerOrder(),
      reserveEscapeLayerOrder(),
    ];
    for (const layer of [a, b, c]) openEscapeLayer(layer);
    expect([a, b, c].map(isTopEscapeLayer)).toEqual([false, false, true]);
    closeEscapeLayer(c);
    expect([a, b].map(isTopEscapeLayer)).toEqual([false, true]);
    closeEscapeLayer(b);
    expect(isTopEscapeLayer(a)).toBe(true);
  });

  test("closing the one underneath first leaves the top one on top", () => {
    const sheet = reserveEscapeLayerOrder();
    const list = reserveEscapeLayerOrder();
    openEscapeLayer(sheet);
    openEscapeLayer(list);
    closeEscapeLayer(sheet);
    expect(isTopEscapeLayer(list)).toBe(true);
  });

  test("the effect ORDER does not matter, only the order the layers were opened in", () => {
    // React runs effects child-first: the child registers before its parent.
    const parent = reserveEscapeLayerOrder();
    const child = reserveEscapeLayerOrder();
    openEscapeLayer(child);
    openEscapeLayer(parent);
    expect(isTopEscapeLayer(child)).toBe(true);
    expect(isTopEscapeLayer(parent)).toBe(false);
  });
});

describe("#3645 — useEscapeLayer in a real tree", () => {
  const probes: Record<string, () => boolean> = {};

  function Overlay({
    name,
    open,
    children,
  }: {
    name: string;
    open: boolean;
    children?: React.ReactNode;
  }): React.ReactElement {
    probes[name] = useEscapeLayer(open);
    return <>{children}</>;
  }

  /** What a document keydown does: every open overlay's handler runs. */
  const pressEscape = (open: string[]): string[] =>
    open.filter((name) => probes[name]());

  test("the payout country list over the brand-creation sheet: Escape closes the list only", async () => {
    let tree: Tree | null = null;
    await renderer.act(async () => {
      tree = renderer.create(
        <Overlay name="sheet" open>
          <Overlay name="list" open={false} />
        </Overlay>,
      );
    });
    expect(pressEscape(["sheet"])).toEqual(["sheet"]);

    await renderer.act(async () => {
      (tree as unknown as Tree).update(
        <Overlay name="sheet" open>
          <Overlay name="list" open />
        </Overlay>,
      );
    });
    expect(pressEscape(["sheet", "list"])).toEqual(["list"]);

    // The list closes; the next Escape belongs to the sheet again.
    await renderer.act(async () => {
      (tree as unknown as Tree).update(
        <Overlay name="sheet" open>
          <Overlay name="list" open={false} />
        </Overlay>,
      );
    });
    expect(pressEscape(["sheet"])).toEqual(["sheet"]);
    (tree as unknown as Tree).unmount();
  });

  test("parent and child opened in the SAME commit: the child is still on top", async () => {
    let tree: Tree | null = null;
    await renderer.act(async () => {
      tree = renderer.create(
        <Overlay name="sheet" open>
          <Overlay name="list" open />
        </Overlay>,
      );
    });
    expect(pressEscape(["sheet", "list"])).toEqual(["list"]);
    (tree as unknown as Tree).unmount();
  });

  test("a re-render of the sheet (new onClose, new props) does not move it above the list", async () => {
    let tree: Tree | null = null;
    await renderer.act(async () => {
      tree = renderer.create(
        <Overlay name="sheet" open>
          <Overlay name="list" open={false} />
        </Overlay>,
      );
    });
    await renderer.act(async () => {
      (tree as unknown as Tree).update(
        <Overlay name="sheet" open>
          <Overlay name="list" open />
        </Overlay>,
      );
    });
    for (let i = 0; i < 3; i += 1) {
      await renderer.act(async () => {
        (tree as unknown as Tree).update(
          <Overlay name="sheet" open>
            <Overlay name="list" open />
          </Overlay>,
        );
      });
    }
    expect(pressEscape(["sheet", "list"])).toEqual(["list"]);
    (tree as unknown as Tree).unmount();
  });

  test("an unmounted overlay stops being a layer", async () => {
    let tree: Tree | null = null;
    await renderer.act(async () => {
      tree = renderer.create(
        <Overlay name="sheet" open>
          <Overlay name="list" open />
        </Overlay>,
      );
    });
    await renderer.act(async () => {
      (tree as unknown as Tree).update(<Overlay name="sheet" open />);
    });
    expect(pressEscape(["sheet"])).toEqual(["sheet"]);
    (tree as unknown as Tree).unmount();
  });

  test("a closed overlay that never opened answers 'top' so nothing that closed before stops closing", async () => {
    let tree: Tree | null = null;
    await renderer.act(async () => {
      tree = renderer.create(<Overlay name="solo" open={false} />);
    });
    expect(probes.solo()).toBe(true);
    (tree as unknown as Tree).unmount();
  });
});
