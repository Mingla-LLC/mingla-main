import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { useFontPreviews } from "../../../sites/contentApi";

/*
 * #2829 W9r — drawing each Google font in itself (DESIGN_SPEC §3 Fonts).
 * Web: the validated woff2 Mingla already stores, loaded with FontFace under
 * a private alias (visitors never contact Google).
 * #2829 W11 (A17) — iPhone and Android: the TrueType file the same pipeline
 * stores (they can't read woff2), loaded with expo-font under the same alias.
 * Until a family is ready (or if it can't be loaded) its name shows in the
 * system face.
 */
const loaded = new Map<string, "loading" | "ready" | "failed">();
const listeners = new Set<() => void>();

export function previewAlias(family: string): string {
  return `MinglaPreview ${family}`;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function loadNative(family: string, url: string): void {
  if (loaded.has(family)) return;
  loaded.set(family, "loading");
  // Required here, on the phone path only: web and the Website section's
  // tests never load the native font module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Font = require("expo-font") as { loadAsync: (fonts: Record<string, { uri: string }>) => Promise<void> };
  Font.loadAsync({ [previewAlias(family)]: { uri: url } })
    .then(() => {
      loaded.set(family, "ready");
      notify();
    })
    .catch(() => {
      loaded.set(family, "failed");
      notify();
    });
}

function load(family: string, url: string): void {
  if (Platform.OS !== "web") {
    loadNative(family, url);
    return;
  }
  if (typeof document === "undefined" || loaded.has(family)) return;
  const FontFaceCtor = (globalThis as { FontFace?: new (name: string, source: string) => { load: () => Promise<unknown> } }).FontFace;
  if (!FontFaceCtor) return;
  loaded.set(family, "loading");
  const face = new FontFaceCtor(previewAlias(family), `url(${JSON.stringify(url)})`);
  face.load()
    .then((ready) => {
      (document as unknown as { fonts: { add: (font: unknown) => void } }).fonts.add(ready);
      loaded.set(family, "ready");
      notify();
    })
    .catch(() => {
      loaded.set(family, "failed");
      notify();
    });
}

/** Loads (up to 12 at a time) and returns which families are drawable now. */
export function useFontSpecimens(siteId: string | null, families: readonly string[]): (family: string) => string | null {
  const wanted = families.filter((family) => family && !loaded.has(family)).slice(0, 12);
  const previews = useFontPreviews(siteId, wanted, Platform.OS === "web" ? "woff2" : "ttf");
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((tick) => tick + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  useEffect(() => {
    for (const preview of previews.data ?? []) {
      if (preview.url) load(preview.family, preview.url);
      else if (!loaded.has(preview.family)) loaded.set(preview.family, "failed");
    }
  }, [previews.data]);
  return (family: string) => (loaded.get(family) === "ready" ? previewAlias(family) : null);
}

export function fontLoading(family: string): boolean {
  return !loaded.has(family) || loaded.get(family) === "loading";
}
