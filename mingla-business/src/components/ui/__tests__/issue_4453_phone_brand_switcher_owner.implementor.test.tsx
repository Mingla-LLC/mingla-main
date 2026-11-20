/**
 * #4453 — one brand switcher per screen on phones: a screen that shows the
 * switcher in its own bar tells the shell, and stops telling it when it goes.
 */
import React from "react";
import { WorkspaceRouteContext } from "../hostShellContext";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  create(element: React.ReactElement): { update(element: React.ReactElement): void };
  act(callback: () => void): void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { useOwnPhoneBrandSwitcher } from "../phoneBrandSwitcherOwner";

// The shell's side, as HostDesktopShell does it: a count of owning screens,
// and the function it hands down in the workspace route context.
const seen: boolean[] = [];
const Shell = ({ children }: { children?: React.ReactNode }): React.ReactElement => {
  const [owners, setOwners] = React.useState(0);
  const ownPhoneSwitcher = React.useCallback((): (() => void) => {
    setOwners((count) => count + 1);
    return () => setOwners((count) => count - 1);
  }, []);
  const route = React.useMemo(() => ({ pathname: null, params: {}, routeBrandId: null, ownPhoneSwitcher }), [ownPhoneSwitcher]);
  seen.push(owners > 0);
  return <WorkspaceRouteContext.Provider value={route}>{children}</WorkspaceRouteContext.Provider>;
};
const Screen = ({ owns }: { owns: boolean }): null => {
  useOwnPhoneBrandSwitcher(owns);
  return null;
};

it("the shell knows while the screen is mounted and owning, and not after", () => {
  let tree!: { update(element: React.ReactElement): void };
  act(() => { tree = create(<Shell><Screen owns={false} /></Shell>); });
  expect(seen[seen.length - 1]).toBe(false);
  act(() => { tree.update(<Shell><Screen owns /></Shell>); });
  expect(seen[seen.length - 1]).toBe(true);
  act(() => { tree.update(<Shell />); });
  expect(seen[seen.length - 1]).toBe(false);
});

it("outside the shell (an isolated render) owning is a no-op", () => {
  expect(() => act(() => { create(<Screen owns />); })).not.toThrow();
});
