/**
 * #4453 — one brand switcher per screen on phones. The shell names the brand
 * above every brand screen; a screen that carries the switcher in its own bar
 * (the Website workspace) says so through the shell's context, and the
 * shell's strip steps aside before the screen paints.
 */
import { useContext, useLayoutEffect } from "react";
import { WorkspaceRouteContext } from "./hostShellContext";


/** Called by a screen whose own bar shows the brand switcher (while `owns`). */
export function useOwnPhoneBrandSwitcher(owns: boolean): void {
  const { ownPhoneSwitcher } = useContext(WorkspaceRouteContext);
  useLayoutEffect(
    () => (owns ? ownPhoneSwitcher?.() : undefined),
    [owns, ownPhoneSwitcher],
  );
}
