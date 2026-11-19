/**
 * #4453 — one brand switcher per screen on phones: a screen that shows the
 * switcher in its own bar tells the shell, and stops telling it when it goes.
 */
import React from "react";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  create(element: React.ReactElement): { update(element: React.ReactElement): void };
  act(callback: () => void): void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { useOwnPhoneBrandSwitcher, useScreenOwnsBrandSwitcher } from "../phoneBrandSwitcherOwner";

const seen: boolean[] = [];
const Shell = (): null => {
  seen.push(useScreenOwnsBrandSwitcher());
  return null;
};
const Screen = ({ owns }: { owns: boolean }): null => {
  useOwnPhoneBrandSwitcher(owns);
  return null;
};

it("the shell knows while the screen is mounted and owning, and not after", () => {
  let tree!: { update(element: React.ReactElement): void };
  act(() => { tree = create(<><Shell /><Screen owns={false} /></>); });
  expect(seen[seen.length - 1]).toBe(false);
  act(() => { tree.update(<><Shell /><Screen owns /></>); });
  expect(seen[seen.length - 1]).toBe(true);
  act(() => { tree.update(<><Shell /></>); });
  expect(seen[seen.length - 1]).toBe(false);
});
