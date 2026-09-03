import type { PayloadRequest } from "payload";
import { cmsConfig } from "./config";
import { hmac, sha256 } from "./crypto";
import { readCoreProjection } from "./gateway";
import { readObject, writeObject } from "./objectStore";

// Payload documents are generated dynamically from the closed collection
// schema; this private normalizer deliberately handles their heterogeneous
// field values before emitting the strictly validated public artifact.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = Record<string, any>;
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, field]) => field !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, field]) => `${JSON.stringify(key)}:${stable(field)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export async function publicationDraftDigest(input: {
  pages: unknown[];
  navigation: unknown | null;
  footer: unknown | null;
  settings: unknown;
  media: unknown[];
}): Promise<string> {
  return sha256(stable({
    renderer_key: "restaurant-website-v1",
    renderer_version: 1,
    pages: input.pages,
    navigation: input.navigation,
    footer: input.footer,
    settings: input.settings,
    media: input.media,
  }));
}
function id(value: unknown): string {
  return typeof value === "object" && value
    ? String((value as AnyDoc).id)
    : String(value || "");
}
function lexicalText(value: unknown): string[] {
  const result: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const item = node as AnyDoc;
    if (typeof item.text === "string") result.push(item.text);
    if (Array.isArray(item.children)) {
      const before = result.length;
      item.children.forEach(walk);
      if (result.length > before) result.push("\n");
    }
  };
  walk(value);
  const paragraphs = result
    .join("")
    .split("\n")
    .map((text) => text.trim())
    .filter(Boolean)
    .slice(0, 30);
  if (
    paragraphs.some((text) => text.length > 2_000) ||
    paragraphs.reduce((total, text) => total + text.length, 0) > 20_000
  ) throw new Error("VALIDATION_FAILED");
  return paragraphs;
}

async function tenantRequest(
  req: PayloadRequest,
  tenant: AnyDoc,
): Promise<PayloadRequest> {
  return {
    ...req,
    context: {
      ...req.context,
      minglaSignedCore: true,
      minglaInternalTenantId: String(tenant.id),
    },
    user: {
      id: crypto.randomUUID(),
      collection: "studio-users",
      siteId: tenant.core_site_id,
      brandId: tenant.core_brand_id,
      tenantId: tenant.id,
      rank: 60,
      tenants: [{ tenant: tenant.id }],
    // Payload's TypedUser union cannot express fields added by our custom
    // session strategy, though the collection and access hooks require them.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

export async function buildPublicationArtifact(
  req: PayloadRequest,
  input: {
    tenant: AnyDoc;
    operationId: string;
    publicationId: string;
    sourceRevisionId: string;
    sourceDigest: string;
    generatedAt: string;
  },
) {
  const scopedReq = await tenantRequest(req, input.tenant);
  const query = { tenant: { equals: input.tenant.id } };
  const [
    pagesResult,
    navigationResult,
    footerResult,
    settingsResult,
    mediaResult,
  ] = await Promise.all([
    req.payload.find({
      collection: "pages",
      where: query,
      overrideAccess: false,
      req: scopedReq,
      depth: 0,
      draft: true,
      limit: 5,
      sort: "nav_order",
    }),
    req.payload.find({
      collection: "navigation",
      where: query,
      overrideAccess: false,
      req: scopedReq,
      depth: 0,
      draft: true,
      limit: 1,
    }),
    req.payload.find({
      collection: "footer",
      where: query,
      overrideAccess: false,
      req: scopedReq,
      depth: 0,
      draft: true,
      limit: 1,
    }),
    req.payload.find({
      collection: "site-settings",
      where: query,
      overrideAccess: false,
      req: scopedReq,
      depth: 0,
      draft: true,
      limit: 1,
    }),
    req.payload.find({
      collection: "media",
      where: { and: [query, { state: { equals: "READY" } }] },
      overrideAccess: false,
      req: scopedReq,
      depth: 0,
      limit: 500,
      sort: "id",
    }),
  ]);
  const settings = settingsResult.docs[0] as AnyDoc | undefined;
  const home = pagesResult.docs.find((page: AnyDoc) => page.role === "home");
  if (!settings || !home || home.enabled !== true)
    throw new Error("VALIDATION_FAILED");
  const observedDraftDigest = await publicationDraftDigest({
    pages: pagesResult.docs,
    navigation: navigationResult.docs[0] ?? null,
    footer: footerResult.docs[0] ?? null,
    settings,
    media: mediaResult.docs,
  });
  if (observedDraftDigest !== input.sourceDigest) {
    throw new Error("REVISION_CONFLICT");
  }
  const media = new Map(
    mediaResult.docs.map((item: AnyDoc) => [String(item.id), item]),
  );
  const pageRoles = new Map(
    pagesResult.docs.map((page: AnyDoc) => [String(page.id), page.role]),
  );
  const offeringIds = new Set<string>();
  for (const page of pagesResult.docs as AnyDoc[])
    for (const block of page.blocks || [])
      for (const row of block.offering_ids || [])
        if (row.offering_id) offeringIds.add(String(row.offering_id));
  // #2830 — does any page show the menu? Only then do we read one.
  let wantsMenu = false;
  for (const page of pagesResult.docs as AnyDoc[])
    for (const block of page.blocks || [])
      if (block.blockType === "menu_board") wantsMenu = true;
  let commercial: AnyDoc[] = [];
  let menuRows: AnyDoc[] = [];
  if (offeringIds.size || wantsMenu) {
    const projection = await readCoreProjection(
      `/internal/v1/sites/${input.tenant.core_site_id}/projection`,
      input.tenant.core_site_id,
      input.operationId,
      [...offeringIds],
      wantsMenu,
    );
    commercial = Array.isArray(projection.offerings)
      ? (projection.offerings as AnyDoc[])
      : [];
    if (commercial.length !== offeringIds.size)
      throw new Error("VALIDATION_FAILED");
    menuRows = Array.isArray(projection.menu)
      ? (projection.menu as AnyDoc[])
      : [];
  }
  /*
   * Group Mingla's flat rows into the sections the renderer draws. The order is
   * Mingla's own (menu sort, then item sort), never re-sorted here — a brand
   * that arranged its menu in the app must see that arrangement on its site.
   *
   * A price stays NULL when Mingla has none, and currency travels per row.
   * Neither is defaulted: "price on request" is a real thing on gogi's printed
   * menu, and inventing a 0 or a currency on a restaurant's own menu is a live
   * commercial lie, not a cosmetic default.
   */
  const menuSections = (() => {
    const sections = new Map<string, AnyDoc>();
    for (const row of menuRows) {
      const key = String(row.menu_id);
      let section = sections.get(key);
      if (!section) {
        section = {
          name: String(row.menu_name ?? ""),
          description: row.menu_description ?? null,
          items: [] as AnyDoc[],
        };
        sections.set(key, section);
      }
      (section.items as AnyDoc[]).push({
        name: String(row.item_name ?? ""),
        description: row.item_description ?? null,
        price_minor: typeof row.price_cents === "number" ? row.price_cents : null,
        currency: typeof row.currency === "string" ? row.currency : null,
      });
    }
    return [...sections.values()].filter(
      (section) => (section.items as AnyDoc[]).length > 0,
    );
  })();
  const renderMedia = (mediaId: unknown, alt = "") => {
    const record = media.get(id(mediaId));
    if (!record || record.state !== "READY" || !record.rendition_manifest)
      throw new Error("MEDIA_PROCESSING");
    const rendition =
      record.rendition_manifest.renditions?.find(
        (item: AnyDoc) => item.width >= 1440,
      ) || record.rendition_manifest.renditions?.at(-1);
    return {
      id: String(record.id),
      url: `https://gogi.sites.usemingla.com/media/${record.id}/${rendition?.target_width || 960}.webp`,
      alt,
      width: Number(rendition?.width || record.width),
      height: Math.round(
        (Number(record.height) * Number(rendition?.width || record.width)) /
          Number(record.width),
      ),
      integrity: String(rendition?.digest),
      object_key: String(rendition?.key),
    };
  };
  const blocks = (source: AnyDoc[]) =>
    source.map((raw) => {
      switch (raw.blockType) {
        case "hero":
          return {
            type: "hero",
            heading: raw.heading,
            subheading: raw.subheading,
            media_url: renderMedia(raw.media, "").url,
            ctas: (raw.ctas || []).map((row: AnyDoc) => ({
              label: row.label,
              href: row.href,
            })),
          };
        case "rich_text":
          return {
            type: "rich_text",
            heading: raw.heading,
            paragraphs: lexicalText(raw.content).map((text) => ({ text })),
          };
        case "media_feature":
          return {
            type: "media_feature",
            media_url: renderMedia(raw.media, String(raw.alt || "")).url,
            alt: raw.alt,
            heading: raw.heading,
            caption: raw.caption,
            alignment: raw.alignment,
          };
        case "cta":
          return {
            type: "cta",
            heading: raw.heading,
            body: raw.body,
            label: raw.label,
            href: raw.href,
          };
        case "offering_grid":
          return {
            type: "offering_grid",
            heading: raw.heading,
            offerings: (raw.offering_ids || []).map((row: AnyDoc) => {
              const resolved = commercial.find(
                (item) => item.id === row.offering_id,
              );
              if (!resolved) throw new Error("VALIDATION_FAILED");
              return {
                id: resolved.id,
                label: resolved.title,
                summary: resolved.summary || "",
                url: resolved.url,
              };
            }),
          };
        case "venue_reservation": {
          const resolved = commercial.find(
            (item) => item.id === raw.reservation_target_id,
          );
          if (!resolved) throw new Error("VALIDATION_FAILED");
          return {
            type: "venue_reservation",
            heading: raw.heading,
            body: raw.body,
            url: resolved.checkout_url,
          };
        }
        case "menu_board": {
          // A menu block with nothing behind it is dropped rather than
          // published as an empty "Menu" heading on a restaurant's website.
          if (!menuSections.length) return null;
          return {
            type: "menu_board",
            heading: raw.heading ?? null,
            note: raw.note ?? null,
            sections: menuSections,
          };
        }
        case "menu_link":
          return {
            type: "menu_link",
            heading: raw.heading,
            label: raw.label,
            href: raw.href,
          };
        case "gallery":
          return {
            type: "gallery",
            heading: raw.heading,
            images: (raw.images || []).map((row: AnyDoc) =>
              renderMedia(row.media, String(row.alt || ""))
            ),
          };
        case "hours_location":
          return {
            type: "hours_location",
            heading: raw.heading,
            address: raw.address,
            map_url: raw.map_url,
            hours: (raw.hours || []).map((row: AnyDoc) => ({
              day: row.day,
              value: row.value,
            })),
          };
        case "testimonials":
          return {
            type: "testimonials",
            heading: raw.heading,
            items: (raw.items || []).map((row: AnyDoc) => ({
              name: row.name,
              quote: row.quote,
            })),
          };
        case "faq":
          return {
            type: "faq",
            heading: raw.heading,
            items: (raw.items || []).map((row: AnyDoc) => ({
              question: row.question,
              answer: row.answer,
            })),
          };
        case "contact_handoff":
          return {
            type: "contact_handoff",
            heading: raw.heading,
            body: raw.body,
            label: raw.label,
            href: raw.href,
          };
        case "divider":
          return { type: "divider" };
        case "spacer":
          return { type: "spacer", size: raw.size };
        default:
          throw new Error("VALIDATION_FAILED");
      }
    });
  const artifact: AnyDoc = {
    schema_version: 1,
    site_id: input.tenant.core_site_id,
    brand_id: input.tenant.core_brand_id,
    renderer_key: "restaurant-website-v1",
    renderer_version: 1,
    publication_id: input.publicationId,
    source_revision_id: input.sourceRevisionId,
    source_digest: input.sourceDigest,
    generated_at: input.generatedAt,
    pages: (pagesResult.docs as AnyDoc[]).map((page) => ({
      role: page.role,
      slug: page.slug,
      title: page.title,
      enabled: page.enabled,
      nav_label: page.nav_label,
      nav_order: page.nav_order,
      blocks: blocks(page.blocks || []),
      seo: page.seo,
    })),
    navigation: {
      page_roles: ((navigationResult.docs[0] as AnyDoc)?.pages || [])
        .map((page: unknown) => pageRoles.get(id(page)))
        .filter(Boolean),
    },
    footer: (() => {
      const footer = { ...((footerResult.docs[0] as AnyDoc) || {}) };
      for (const key of [
        "id",
        "tenant",
        "createdAt",
        "updatedAt",
        "_status",
        "label",
      ])
        delete footer[key];
      if (Array.isArray(footer.links)) {
        footer.links = footer.links.map((row: AnyDoc) => ({
          label: row.label,
          href: row.href,
        }));
      }
      return footer;
    })(),
    site_settings: {
      display_name: settings.display_name,
      short_description: settings.short_description,
      logo: settings.logo
        ? renderMedia(settings.logo, `${settings.display_name} logo`)
        : undefined,
      colors: {
        background: settings.background_color,
        foreground: settings.foreground_color,
        accent: settings.accent_color,
      },
      typography: settings.typography,
      seo: {
        title: settings.seo_title,
        description: settings.seo_description,
        canonical_url: settings.canonical_url,
        social_image: settings.social_image
          ? renderMedia(settings.social_image, "")
          : undefined,
      },
    },
    media: [...media.values()].map((item) => renderMedia(item.id, "")),
    commercial_references: commercial.map((item) => ({
      kind: item.kind,
      id: item.id,
      url: item.url,
    })),
  };
  const serialized = stable(artifact);
  const digest = await sha256(serialized);
  const key = `publications/${input.tenant.core_site_id}/${input.publicationId}/${digest}.json`;
  await writeObject(
    cmsConfig().artifactBucket,
    key,
    new TextEncoder().encode(serialized),
    "application/json",
  );
  const readback = await readObject(cmsConfig().artifactBucket, key);
  if ((await sha256(readback)) !== digest)
    throw new Error("ARTIFACT_DIGEST_MISMATCH");
  return { artifact, serialized, artifactKey: key, artifactDigest: digest };
}

export async function probePublicationCandidate(input: {
  siteId: string;
  brandId: string;
  publicationId: string;
  artifactKey: string;
  artifactDigest: string;
  rendererVersion: number;
}): Promise<Record<string, unknown>> {
  const config = cmsConfig();
  const body = JSON.stringify({
    site_id: input.siteId, brand_id: input.brandId,
    publication_id: input.publicationId, artifact_key: input.artifactKey,
    artifact_digest: input.artifactDigest, artifact_schema_version: 1,
    renderer_key: "restaurant-website-v1", renderer_version: input.rendererVersion,
  });
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();
  const signature = await hmac(
    config.candidateProbeSecret,
    `${timestamp}\n${nonce}\n${await sha256(body)}`,
  );
  const response = await fetch(`${config.publicRuntimeOrigin}/api/internal/candidate-probe`, {
    method: "POST",
    headers: {
      "content-type": "application/json", "x-mingla-probe-time": timestamp,
      "x-mingla-probe-nonce": nonce, "x-mingla-probe-signature": signature,
    },
    body,
    cache: "no-store",
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok || result.data?.observed_digest !== input.artifactDigest) {
    throw new Error("PROBE_FAILED");
  }
  return result.data as Record<string, unknown>;
}

export async function buildRollbackPublicationArtifact(input: {
  siteId: string;
  brandId: string;
  publicationId: string;
  sourceRevisionId: string;
  sourceDigest: string;
  generatedAt: string;
  rollbackSourcePublicationId: string;
  rollbackSource: Record<string, unknown>;
}) {
  const sourceArtifactDigest = String(
    input.rollbackSource.artifact_digest || "",
  );
  const sourceArtifactKey = String(input.rollbackSource.artifact_key || "");
  if (
    input.rollbackSource.id !== input.rollbackSourcePublicationId ||
    input.rollbackSource.site_id !== input.siteId ||
    input.rollbackSource.source_revision_id !== input.sourceRevisionId ||
    input.rollbackSource.source_digest !== input.sourceDigest ||
    input.rollbackSource.status !== "published" ||
    input.rollbackSource.artifact_schema_version !== 1 ||
    input.rollbackSource.renderer_key !== "restaurant-website-v1" ||
    input.rollbackSource.renderer_version !== 1 ||
    !/^[0-9a-f]{64}$/.test(sourceArtifactDigest) ||
    sourceArtifactKey !==
      `publications/${input.siteId}/${input.rollbackSourcePublicationId}/${sourceArtifactDigest}.json`
  ) throw new Error("VALIDATION_FAILED");
  const sourceBytes = await readObject(
    cmsConfig().artifactBucket,
    sourceArtifactKey,
  );
  if (await sha256(sourceBytes) !== sourceArtifactDigest) {
    throw new Error("ARTIFACT_DIGEST_MISMATCH");
  }
  const sourceArtifact = JSON.parse(
    new TextDecoder().decode(sourceBytes),
  ) as AnyDoc;
  if (
    sourceArtifact.site_id !== input.siteId ||
    sourceArtifact.brand_id !== input.brandId ||
    sourceArtifact.publication_id !== input.rollbackSourcePublicationId ||
    sourceArtifact.source_revision_id !== input.sourceRevisionId ||
    sourceArtifact.source_digest !== input.sourceDigest ||
    sourceArtifact.schema_version !== 1 ||
    sourceArtifact.renderer_key !== "restaurant-website-v1" ||
    sourceArtifact.renderer_version !== 1
  ) throw new Error("VALIDATION_FAILED");
  const artifact = {
    ...sourceArtifact,
    publication_id: input.publicationId,
    generated_at: input.generatedAt,
  };
  const serialized = stable(artifact);
  const artifactDigest = await sha256(serialized);
  const artifactKey =
    `publications/${input.siteId}/${input.publicationId}/${artifactDigest}.json`;
  await writeObject(
    cmsConfig().artifactBucket,
    artifactKey,
    new TextEncoder().encode(serialized),
    "application/json",
  );
  const readback = await readObject(cmsConfig().artifactBucket, artifactKey);
  if (await sha256(readback) !== artifactDigest) {
    throw new Error("ARTIFACT_DIGEST_MISMATCH");
  }
  return { artifact, serialized, artifactKey, artifactDigest };
}
