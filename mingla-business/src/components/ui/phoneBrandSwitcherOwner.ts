/**
 * #4453 — one brand switcher per screen on phones. The shell names the brand
 * above every brand screen; a screen that carries the switcher in its own bar
 * (the Website workspace) says so here, and the shell's strip steps aside
 * before the screen paints.
 */
import { useLayoutEffect, useSyncExternalStore } from "react";

let owners = 0;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const snapshot = (): boolean => owners > 0;

/** True while a mounted screen shows the brand switcher in its own bar. */
export const useScreenOwnsBrandSwitcher = (): boolean => useSyncExternalStore(subscribe, snapshot, snapshot);

/** Called by a screen whose own bar shows the brand switcher (while `owns`). */
export function useOwnPhoneBrandSwitcher(owns: boolean): void {
  useLayoutEffect(() => {
    if (!owns) return undefined;
    owners += 1;
    emit();
    return () => {
      owners -= 1;
      emit();
    };
  }, [owns]);
}
