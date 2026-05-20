/**
 * File reader platform shim — NATIVE side (iOS / Android).
 *
 * Wraps `expo-file-system` for reading a picked file URI as a base64
 * string. Metro auto-resolves this file on iOS + Android via the
 * `.native.ts` extension; web bundles fall through to `./fileReader.ts`
 * (browser-API impl).
 *
 * Why this split exists (root-cause fix from ORCH-0887, 2026-05-19):
 * `expo-file-system.readAsStringAsync(uri, { Base64 })` throws on web
 * with "The method or property expo-file-system.readAsStringAsync is
 * not available on web". Web pickers (expo-image-picker / expo-document
 * -picker) return blob/data URIs that the browser can read natively via
 * fetch() + FileReader, but the native SDK can't. This file routes
 * native calls to the real SDK; the web file uses standard browser APIs.
 *
 * Mirrors the same precedent established by:
 *   - StripeProviderWrapper.native.tsx / .tsx
 *   - diagnostics/sentry.native.ts / .ts (ORCH-0886)
 *   - ComposerV2/richEditor.native.ts / .tsx (ORCH-0886)
 *
 * Public surface — must stay in sync with `./fileReader.ts`:
 *   - readAsBase64(uri) → Promise<string>
 *
 * If a future caller needs `readAsBlob(uri)`, `readAsArrayBuffer(uri)`,
 * or other file ops, add them as additional exports here AND in the
 * web shim. Don't grow the native side beyond what the web side covers.
 */

import * as FileSystem from "expo-file-system/legacy";

/**
 * Read a picked-file URI and return its bytes as a base64 string
 * (without the `data:mime/type;base64,` prefix — just the base64 payload).
 *
 * Native impl: delegates to `expo-file-system.readAsStringAsync` which is
 * RN-iOS-safe (ORCH-0786 precedent for native file reads).
 */
export async function readAsBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}
