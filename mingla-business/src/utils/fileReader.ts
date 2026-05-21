/**
 * File reader platform shim — WEB side (and default fallback).
 *
 * Reads picked-file URIs (blob: or data: URLs returned by the web variants
 * of expo-image-picker and expo-document-picker) using standard browser
 * APIs (fetch + FileReader). Metro picks `./fileReader.native.ts` on
 * iOS + Android (real expo-file-system); web bundles fall through here.
 *
 * Why this stub exists (root-cause fix from ORCH-0887, 2026-05-19):
 * `expo-file-system.readAsStringAsync(uri, { Base64 })` throws on web
 * because the native SDK can't handle blob/data URIs. The browser CAN
 * handle them natively via fetch() → Blob → FileReader.readAsDataURL —
 * which gives us back a `data:mime;base64,XXXX` URL we strip the prefix
 * from to match the native return shape. End result: identical base64
 * payload either way, so downstream Gemini upload (parse-restaurant-menu
 * edge function) doesn't care which platform produced the bytes.
 *
 * Mirrors the same precedent established by:
 *   - StripeProviderWrapper.tsx (web Fragment passthrough)
 *   - diagnostics/sentry.ts (ORCH-0886 web no-op stubs)
 *   - ComposerV2/richEditor.tsx (ORCH-0886 web placeholder component)
 *
 * Public surface — must stay in sync with `./fileReader.native.ts`:
 *   - readAsBase64(uri) → Promise<string>
 */

/**
 * Read a picked-file URI and return its bytes as a base64 string
 * (without the `data:mime/type;base64,` prefix — just the base64 payload).
 *
 * Web impl: fetch the URI (works for blob: + data: URLs returned by the
 * web variants of expo-image-picker / expo-document-picker), convert to
 * a Blob, then base64-encode via FileReader.readAsDataURL. The DataURL
 * result has shape `data:<mime>;base64,<payload>` — we strip the prefix
 * so the return value matches the native shape exactly.
 */
export async function readAsBase64(uri: string): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader returned non-string result"));
        return;
      }
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = (): void => {
      reject(reader.error ?? new Error("FileReader error"));
    };
    reader.readAsDataURL(blob);
  });
}
