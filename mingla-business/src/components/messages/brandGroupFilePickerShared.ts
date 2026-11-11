import type { BrandGroupPickedFile } from "../../services/brandGroupFilesService";

export type BrandGroupFileSource = "camera" | "photos" | "files";

/**
 * #4255 W5 — Mingla team chats reuse these pickers with their own limits:
 * photos only (no video) and their own document types. Brand groups pass
 * nothing and keep today's behaviour.
 */
export interface BrandGroupPickOptions {
  imagesOnly?: boolean;
  /** Native document picker types. */
  documentMimes?: readonly string[];
  /** Web file input accept string. */
  accept?: string;
}
export type { BrandGroupPickedFile };

export class BrandGroupFilePermissionError extends Error {
  constructor(readonly source: "camera" | "photos") {
    super(source === "camera" ? "Camera access is off." : "Photo access is off.");
    this.name = "BrandGroupFilePermissionError";
  }
}
