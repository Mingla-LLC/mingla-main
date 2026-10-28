import { crc32 } from "node:zlib";

/*
 * #2829 — "Download everything": one zip per export, written once to
 * `exports/<site_id>/<operation_id>.zip` in the publication-artifacts bucket
 * (7-day retention, scripts/sites/run-sites-retention.mjs). Entries are STORED
 * (no compression): media is already compressed, and a tiny dependency-free
 * writer is easier to trust than a new package.
 */

export type ExportEntry = { name: string; bytes: Uint8Array };

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

export function exportObjectKey(siteId: string, operationId: string): string {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(siteId) || !uuid.test(operationId)) throw new Error("VALIDATION_FAILED");
  return `exports/${siteId.toLowerCase()}/${operationId.toLowerCase()}.zip`;
}

/** A standard ZIP (stored entries, UTF-8 names, no data descriptors). */
export function buildZip(entries: ExportEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!SAFE_NAME.test(entry.name) || entry.name.includes("..") || seen.has(entry.name)) {
      throw new Error("VALIDATION_FAILED");
    }
    seen.add(entry.name);
    const name = Buffer.from(encoder.encode(entry.name));
    const data = Buffer.from(entry.bytes);
    const crc = crc32(data) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(0, 8); // stored
    header.writeUInt32LE(0, 10); // time/date
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, data);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(0, 10);
    record.writeUInt32LE(0, 12);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, directory, end]));
}

/** Read the entry names back out of a zip built by buildZip (tests, checks). */
export function zipEntryNames(zip: Uint8Array): string[] {
  const buffer = Buffer.from(zip);
  const end = buffer.length - 22;
  if (buffer.readUInt32LE(end) !== 0x06054b50) throw new Error("NOT_A_ZIP");
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const names: string[] = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("NOT_A_ZIP");
    const length = buffer.readUInt16LE(cursor + 28);
    names.push(buffer.subarray(cursor + 46, cursor + 46 + length).toString("utf8"));
    cursor += 46 + length;
  }
  return names;
}

export function jsonEntry(name: string, value: unknown): ExportEntry {
  return { name, bytes: new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`) };
}

/*
 * #2829 W9f (A18 item 3) — WHY "DOWNLOAD EVERYTHING" FAILED WITH A 503.
 *
 * The export used to copy every approved media original INTO the zip. Young &
 * Stamped has 156 ready media files (143 images, 13 videos, ~520 MB), so the
 * CMS read half a gigabyte into memory one object at a time (23-50 s), built
 * one zip of that size, and tried to write it to `sites-publication-artifacts`,
 * whose per-object limit is 20 MiB (scripts/sites/bootstrap-sites-cms.sql, the
 * same in production). Storage refused the write, the CMS answered 503, and
 * Core had already given up at its 15 s request limit and marked the export
 * ambiguous. Any site with more than ~20 MB of media could never export.
 *
 * Now the zip carries every page, block, setting, collection entry,
 * navigation, footer and the active artifact (all small JSON), and each media
 * original is listed in `media.json` and `media-download-links.txt` with its
 * own signed 24-hour link to the stored original. Nothing is read from
 * storage per media file, so the export finishes in about a second and the
 * zip stays far under the object limit whatever the site's media weighs.
 */
export const EXPORT_LINK_TTL_SECONDS = 86_400;

export type ExportMediaRow = Record<string, unknown>;

export type ExportInput = {
  siteId: string;
  brandId: string;
  tenantName: unknown;
  address: unknown;
  exportedAt: string;
  pages: unknown[];
  navigation: unknown[];
  footer: unknown[];
  settings: unknown[];
  collections: Record<string, unknown[]>;
  /** #2829 W9b — "Why it looks like this": every logged change, its reason and citations. */
  workLog?: unknown[];
  media: ExportMediaRow[];
  activeArtifact: Uint8Array | null;
  /** A signed GET link for one approved original (presignedGet). */
  signMediaLink: (approvedKey: string) => Promise<string>;
};

export async function buildExportEntries(input: ExportInput): Promise<ExportEntry[]> {
  const media = await Promise.all(input.media.map(async (item) => {
    const key = item.approved_master_key;
    const ready = item.state === "READY" && typeof key === "string";
    if (ready && !(key as string).startsWith(`approved/${input.siteId}/`)) {
      throw new Error("TENANT_MISMATCH");
    }
    const extension = ready ? /\.([a-z0-9]{2,5})$/.exec(key as string)?.[1] ?? "bin" : null;
    return {
      id: item.id,
      alt: item.alt ?? null,
      state: item.state,
      filename: item.original_filename_safe ?? null,
      mime: item.detected_mime ?? null,
      bytes: typeof item.bytes === "number" ? item.bytes : null,
      file: ready ? `${String(item.id)}.${extension}` : null,
      download_url: ready ? await input.signMediaLink(key as string) : null,
    };
  }));
  const linked = media.filter((item) => item.download_url !== null);
  const entries: ExportEntry[] = [
    jsonEntry("site.json", {
      site_id: input.siteId,
      brand_id: input.brandId,
      name: input.tenantName,
      address: input.address ?? null,
      exported_at: input.exportedAt,
      media_links_expire_after_seconds: EXPORT_LINK_TTL_SECONDS,
    }),
    jsonEntry("pages.json", input.pages),
    jsonEntry("navigation.json", input.navigation),
    jsonEntry("footer.json", input.footer),
    jsonEntry("settings.json", input.settings),
    ...Object.keys(input.collections).sort().map((slug) =>
      jsonEntry(`collections/${slug}.json`, input.collections[slug])
    ),
    jsonEntry("why-it-looks-like-this.json", input.workLog ?? []),
    jsonEntry("media.json", media),
    {
      name: "media-download-links.txt",
      bytes: new TextEncoder().encode(
        linked.map((item) => item.download_url).join("\n") + (linked.length ? "\n" : ""),
      ),
    },
    {
      name: "README.txt",
      bytes: new TextEncoder().encode([
        "Your Mingla website export.",
        "",
        "pages.json, navigation.json, footer.json, settings.json and collections/ hold every page, block,",
        "setting and collection entry. active-artifact.json is the version visitors see now.",
        "why-it-looks-like-this.json lists every change Ari made to your website, why, and what it was based on.",
        `Your ${linked.length} photos and videos are listed in media.json. Each has a download link that works`,
        "for 24 hours; media-download-links.txt has one link per line for a download manager.",
        "",
      ].join("\n")),
    },
  ];
  if (input.activeArtifact) {
    entries.push({ name: "active-artifact.json", bytes: input.activeArtifact });
  }
  return entries;
}
