import type { BrandGroupPickedFile } from "../../services/brandGroupsService";

export type BrandGroupFileSource = "camera" | "photos" | "files";
export type { BrandGroupPickedFile };

export class BrandGroupFilePermissionError extends Error {
  constructor(readonly source: "camera" | "photos") {
    super(source === "camera" ? "Camera access is off." : "Photo access is off.");
    this.name = "BrandGroupFilePermissionError";
  }
}
