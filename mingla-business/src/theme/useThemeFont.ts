// ORCH-1083: on-demand theme-font loader. Replaces the eager root-level
// `useFonts(MINGLA_THEME_FONTS)` (14 families) — see SPEC §C-2.
//
// Themed surfaces (PublicBrandPage, PublicEventPage, ThemeEditorSection) call
// `useThemeFont(theme.fontFamilyValue)` so the correct family is fetched ONLY
// when that surface mounts/changes, instead of all 14 at app boot. On every
// platform (web + native) the load goes through `expo-font`'s `Font.loadAsync`.
//
// DO NOT re-introduce a static `@expo-google-fonts/*` import or a root
// `useFonts` call (breaks the mobile boot budget). The 14 family modules are
// dynamic `import()` thunks in ./themeFonts.

import { useEffect, useState } from "react";
import * as Font from "expo-font";

import { THEME_FONT_MODULE_THUNKS } from "./themeFonts";

// Idempotency cache so multiple surfaces requesting the same family load it once
// (and concurrent requests share the in-flight promise).
const inFlight = new Map<string, Promise<void>>();

/**
 * Load a single theme-font family on demand by its `fontFamilyValue`
 * (e.g. "Inter_500Medium"). No-op if already loaded or unknown.
 * Idempotent and safe to call from any platform.
 */
export async function loadThemeFont(family: string | null | undefined): Promise<void> {
  if (!family) return;
  if (Font.isLoaded(family)) return;

  const existing = inFlight.get(family);
  if (existing) return existing;

  const thunk = THEME_FONT_MODULE_THUNKS[family];
  if (!thunk) return; // unknown family → leave to system-font fallback

  const promise = (async () => {
    try {
      const fontModule = await thunk();
      // Re-check after the dynamic import resolves (another caller may have won).
      if (!Font.isLoaded(family)) {
        await Font.loadAsync({ [family]: fontModule });
      }
    } finally {
      inFlight.delete(family);
    }
  })();

  inFlight.set(family, promise);
  return promise;
}

/**
 * Hook form: loads the given theme-font family on mount/change and reports when
 * it is ready. The themed surface renders immediately (system-font fallback for
 * ≤ the load duration); `loaded` flips true once the family is available.
 */
export function useThemeFont(family: string | null | undefined): { loaded: boolean } {
  const [loaded, setLoaded] = useState<boolean>(() =>
    family ? Font.isLoaded(family) : true,
  );

  useEffect(() => {
    let cancelled = false;
    if (!family) {
      setLoaded(true);
      return;
    }
    if (Font.isLoaded(family)) {
      setLoaded(true);
      return;
    }
    setLoaded(false);
    void loadThemeFont(family).then(() => {
      if (!cancelled) setLoaded(Font.isLoaded(family));
    });
    return () => {
      cancelled = true;
    };
  }, [family]);

  return { loaded };
}
