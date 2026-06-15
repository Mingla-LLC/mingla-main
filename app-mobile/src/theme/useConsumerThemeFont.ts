// ORCH-1138 Leg 1C — consumer-app on-demand theme-font loader.
//
// Mirrors mingla-business/src/theme/useThemeFont.ts (which app-mobile cannot
// import across the app boundary — I-MOR-0827-PACKAGE-ISOLATION). The themed
// consumer trip detail calls `useConsumerThemeFont(theme.fontFamilyValue)` AND
// `useConsumerThemeFont(boldFontFamily(theme))` so the medium + 700-weight bold
// faces are fetched via expo-font ONLY when the trip detail mounts — never at
// app boot (preserves the mobile boot budget; DO NOT add a root `useFonts` call
// or a static `@expo-google-fonts/*` import).
//
// NATIVE BOLD: a loaded custom font ignores `fontWeight` on iOS/Android, so the
// trip page points `fontFamily` at the 700-weight loaded family. This loader
// registers that face with expo-font so the bold actually renders bold.

import { useEffect, useState } from "react";
import * as Font from "expo-font";

import { CONSUMER_THEME_FONT_MODULE_THUNKS } from "./consumerThemeFonts";

// Idempotency cache: multiple surfaces requesting the same family load it once
// (concurrent requests share the in-flight promise).
const inFlight = new Map<string, Promise<void>>();

/**
 * Load a single theme-font family on demand by its `fontFamilyValue`
 * (e.g. "Inter_500Medium" / "Inter_700Bold"). No-op if already loaded or
 * unknown. Idempotent and safe to call from any platform.
 */
export async function loadConsumerThemeFont(
  family: string | null | undefined,
): Promise<void> {
  if (!family) return;
  if (Font.isLoaded(family)) return;

  const existing = inFlight.get(family);
  if (existing) return existing;

  const thunk = CONSUMER_THEME_FONT_MODULE_THUNKS[family];
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
export function useConsumerThemeFont(family: string | null | undefined): {
  loaded: boolean;
} {
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
    void loadConsumerThemeFont(family).then(() => {
      if (!cancelled) setLoaded(Font.isLoaded(family));
    });
    return () => {
      cancelled = true;
    };
  }, [family]);

  return { loaded };
}
