import { safeText } from "./validation";

type Relationship = string | number | { id?: unknown } | null | undefined;

export interface StudioMediaSelectionInput {
  expectedRevision: string;
  blockIndex: number;
  field: "media" | "images";
  imageIndex: number | null;
  alt: string;
  decorative: boolean;
}

export interface StudioMediaTarget {
  id: string;
  pageId: string;
  pageTitle: string;
  pageRole: string;
  expectedRevision: string;
  blockIndex: number;
  field: "media" | "images";
  imageIndex: number | null;
  label: string;
  currentMediaId: string | null;
  currentAlt: string;
  decorativeOnly: boolean;
}

interface PageLike {
  id: string | number;
  title?: unknown;
  role?: unknown;
  revision?: unknown;
  blocks?: unknown;
}

function relationshipId(value: Relationship): string | null {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (value && typeof value === "object" && "id" in value) {
    return typeof value.id === "string" || typeof value.id === "number"
      ? String(value.id)
      : null;
  }
  return null;
}

function targetId(
  pageId: string,
  blockIndex: number,
  field: "media" | "images",
  imageIndex: number | null,
): string {
  return `${pageId}:${blockIndex}:${field}:${imageIndex ?? "new"}`;
}

export function studioMediaTargets(pages: PageLike[]): StudioMediaTarget[] {
  const targets: StudioMediaTarget[] = [];
  for (const page of pages) {
    const pageId = String(page.id);
    const pageTitle = String(page.title || page.role || "Page");
    const pageRole = String(page.role || "");
    const expectedRevision = String(page.revision || "");
    const blocks = Array.isArray(page.blocks) ? page.blocks : [];
    blocks.forEach((raw, blockIndex) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
      const block = raw as Record<string, unknown>;
      const blockType = String(block.blockType || "");
      if (blockType === "hero") {
        targets.push({
          id: targetId(pageId, blockIndex, "media", null),
          pageId,
          pageTitle,
          pageRole,
          expectedRevision,
          blockIndex,
          field: "media",
          imageIndex: null,
          label: `${pageTitle} · Hero image`,
          currentMediaId: relationshipId(block.media as Relationship),
          currentAlt: "",
          decorativeOnly: true,
        });
      }
      if (blockType === "media_feature") {
        targets.push({
          id: targetId(pageId, blockIndex, "media", null),
          pageId,
          pageTitle,
          pageRole,
          expectedRevision,
          blockIndex,
          field: "media",
          imageIndex: null,
          label: `${pageTitle} · Image feature ${blockIndex + 1}`,
          currentMediaId: relationshipId(block.media as Relationship),
          currentAlt: typeof block.alt === "string" ? block.alt : "",
          decorativeOnly: false,
        });
      }
      if (blockType !== "gallery") return;
      const images = Array.isArray(block.images) ? block.images : [];
      images.forEach((image, imageIndex) => {
        if (!image || typeof image !== "object" || Array.isArray(image)) return;
        const row = image as Record<string, unknown>;
        targets.push({
          id: targetId(pageId, blockIndex, "images", imageIndex),
          pageId,
          pageTitle,
          pageRole,
          expectedRevision,
          blockIndex,
          field: "images",
          imageIndex,
          label: `${pageTitle} · Gallery image ${imageIndex + 1}`,
          currentMediaId: relationshipId(row.media as Relationship),
          currentAlt: typeof row.alt === "string" ? row.alt : "",
          decorativeOnly: false,
        });
      });
      if (images.length < 12) {
        targets.push({
          id: targetId(pageId, blockIndex, "images", null),
          pageId,
          pageTitle,
          pageRole,
          expectedRevision,
          blockIndex,
          field: "images",
          imageIndex: null,
          label: `${pageTitle} · Add gallery image`,
          currentMediaId: null,
          currentAlt: "",
          decorativeOnly: false,
        });
      }
    });
  }
  return targets;
}

export function applyStudioMediaSelection(
  page: PageLike,
  mediaId: string,
  input: StudioMediaSelectionInput,
): unknown[] {
  if (
    !/^[0-9a-f-]{36}$/i.test(mediaId) ||
    String(page.revision) !== input.expectedRevision ||
    !Number.isInteger(input.blockIndex) ||
    input.blockIndex < 0 ||
    (input.imageIndex !== null &&
      (!Number.isInteger(input.imageIndex) || input.imageIndex < 0))
  ) {
    throw new Error("REVISION_CONFLICT");
  }
  const blocks = structuredClone(Array.isArray(page.blocks) ? page.blocks : []);
  const block = blocks[input.blockIndex];
  if (!block || typeof block !== "object" || Array.isArray(block)) {
    throw new Error("VALIDATION_FAILED");
  }
  const typed = block as Record<string, unknown>;
  const blockType = String(typed.blockType || "");
  const trimmedAlt = input.alt.trim();
  if (
    typeof input.decorative !== "boolean" ||
    (!input.decorative &&
      (trimmedAlt.length < 1 || safeText(trimmedAlt, 240) !== true))
  ) {
    throw new Error("VALIDATION_FAILED");
  }
  const alt = input.decorative ? "" : trimmedAlt;

  if (input.field === "media") {
    if (!['hero', 'media_feature'].includes(blockType) || input.imageIndex !== null) {
      throw new Error("VALIDATION_FAILED");
    }
    if (blockType === "hero" && !input.decorative) {
      throw new Error("VALIDATION_FAILED");
    }
    typed.media = mediaId;
    if (blockType === "media_feature") typed.alt = alt;
    return blocks;
  }

  if (input.field !== "images" || blockType !== "gallery") {
    throw new Error("VALIDATION_FAILED");
  }
  const images = Array.isArray(typed.images)
    ? structuredClone(typed.images) as Array<Record<string, unknown>>
    : [];
  if (input.imageIndex === null) {
    if (images.length >= 12) throw new Error("VALIDATION_FAILED");
    images.push({ media: mediaId, alt });
  } else {
    const current = images[input.imageIndex];
    if (!current) throw new Error("VALIDATION_FAILED");
    images[input.imageIndex] = { ...current, media: mediaId, alt };
  }
  typed.images = images;
  return blocks;
}

export function referencedStudioMediaIds(pages: PageLike[]): Set<string> {
  const ids = new Set<string>();
  for (const target of studioMediaTargets(pages)) {
    if (target.currentMediaId) ids.add(target.currentMediaId);
  }
  return ids;
}
