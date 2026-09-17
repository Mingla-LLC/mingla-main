/**
 * Issue #3429 REWORK-1 (D-0) — platform-neutral Ari picker contract.
 *
 * Metro resolves `./ariAttachmentPicker` to `ariAttachmentPicker.native.ts` on
 * iOS and Android. When the native picker imported its permission error from
 * that specifier it imported ITSELF, the class was `undefined`, and every
 * denied photo permission crashed with "right operand of 'instanceof' is not
 * an object". Both picker files and `useAriAttachments` import these from this
 * module only, so each platform shares one real class.
 */

export type AriAttachmentSource = "all" | "photos" | "documents";

export interface AriPickedFile {
  uri: string;
  name: string;
  mimeType: string | null;
  /** Bytes reported by the picker, or null when the picker does not know. */
  size: number | null;
  /** Pixel dimensions when the picker reports them (native photo library). */
  width?: number | null;
  height?: number | null;
  webFile?: File;
}

export class AriAttachmentPickerPermissionError extends Error {
  readonly canOpenSettings: boolean;

  constructor(canOpenSettings: boolean) {
    super("Photo access is off.");
    this.name = "AriAttachmentPickerPermissionError";
    this.canOpenSettings = canOpenSettings;
  }
}
