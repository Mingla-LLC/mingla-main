// #3720 — Google Drive stays behind the Mingla authorization boundary.
// Provider ids are service-only data and must never be returned to a client.

export interface DriveServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
  shared_drive_id: string;
  host_details_folder_id: string;
  data_room_folder_id?: string;
}

export interface DriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
}

export interface DriveMediaInfo {
  hasThumbnail: boolean;
  thumbnailLink: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export interface DriveBinding {
  hostFolderId: string;
  mediaPacketFolderId: string;
  hostUploadsFolderId: string;
  staffSharingFolderId: string;
}

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

function base64Url(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function privateKeyBytes(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  if (!body) throw new Error("DRIVE_CONFIG_INVALID");
  const binary = atob(body);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function q(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function parseDriveServiceAccount(serialized: string): DriveServiceAccount {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("DRIVE_CONFIG_INVALID");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("DRIVE_CONFIG_INVALID");
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.client_email !== "string" || !candidate.client_email.includes("@") ||
    typeof candidate.private_key !== "string" || !candidate.private_key.includes("BEGIN PRIVATE KEY") ||
    typeof candidate.shared_drive_id !== "string" || candidate.shared_drive_id.length < 8 ||
    typeof candidate.host_details_folder_id !== "string" || candidate.host_details_folder_id.length < 8
  ) {
    throw new Error("DRIVE_CONFIG_INVALID");
  }
  if (candidate.token_uri !== undefined && typeof candidate.token_uri !== "string") {
    throw new Error("DRIVE_CONFIG_INVALID");
  }
  if (
    candidate.data_room_folder_id !== undefined &&
    (typeof candidate.data_room_folder_id !== "string" || candidate.data_room_folder_id.length < 8)
  ) {
    throw new Error("DRIVE_CONFIG_INVALID");
  }
  return candidate as unknown as DriveServiceAccount;
}

/**
 * The governed Google bundle keeps its original three Calendar fields intact:
 * client_id|client_secret|refresh_token. Wave 3 appends one base64url-encoded
 * JSON Drive object as field four, avoiding an 89th Supabase secret name.
 * Governed manifest fields: drive_storage.client_email,
 * drive_storage.private_key, drive_storage.shared_drive_id,
 * drive_storage.host_details_folder_id and optional
 * drive_storage.data_room_folder_id.
 */
export function parseDriveCredentialBundle(packed: string): DriveServiceAccount {
  const parts = packed.split("|");
  if (parts.length !== 4 || parts.slice(0, 3).some((part) => !part) || !parts[3]) {
    throw new Error("DRIVE_CONFIG_INVALID");
  }
  try {
    const base64 = parts[3].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    return parseDriveServiceAccount(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("DRIVE_CONFIG_INVALID");
  }
}

export class GoogleDriveClient {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor(
    private readonly serviceAccount: DriveServiceAccount,
    readonly sharedDriveId: string,
    readonly hostDetailsFolderId: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!sharedDriveId || !hostDetailsFolderId) throw new Error("DRIVE_CONFIG_INVALID");
  }

  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000) {
      return this.accessToken;
    }
    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64Url(JSON.stringify({
      iss: this.serviceAccount.client_email,
      scope: DRIVE_SCOPE,
      aud: this.serviceAccount.token_uri ?? "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }));
    const key = await crypto.subtle.importKey(
      "pkcs8",
      privateKeyBytes(this.serviceAccount.private_key).slice().buffer as ArrayBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(`${header}.${payload}`),
    );
    const assertion = `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
    const response = await this.fetcher(
      this.serviceAccount.token_uri ?? "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }),
      },
    );
    const json = await response.json().catch(() => null) as {
      access_token?: unknown;
      expires_in?: unknown;
    } | null;
    if (!response.ok || typeof json?.access_token !== "string") {
      throw new Error("DRIVE_AUTH_FAILED");
    }
    this.accessToken = json.access_token;
    const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
    this.accessTokenExpiresAt = Date.now() + expiresIn * 1000;
    return this.accessToken;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.token();
    const response = await this.fetcher(`https://www.googleapis.com${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
    if (!response.ok) {
      const status = response.status;
      await response.arrayBuffer().catch(() => null);
      if (status === 404) throw new Error("DRIVE_NOT_FOUND");
      if (status === 401 || status === 403) throw new Error("DRIVE_FORBIDDEN");
      throw new Error(status === 429 || status >= 500 ? "DRIVE_TEMPORARY" : "DRIVE_REJECTED");
    }
    return response;
  }

  private async list(query: string, fields = "files(id,name,mimeType,parents,appProperties,size)"): Promise<DriveFile[]> {
    const params = new URLSearchParams({
      q: `${query} and trashed=false`,
      corpora: "drive",
      driveId: this.sharedDriveId,
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
      pageSize: "100",
      fields,
    });
    const response = await this.request(`/drive/v3/files?${params.toString()}`);
    const body = await response.json() as { files?: DriveFile[] };
    return Array.isArray(body.files) ? body.files : [];
  }

  private async get(fileId: string): Promise<DriveFile> {
    const params = new URLSearchParams({
      supportsAllDrives: "true",
      fields: "id,name,mimeType,parents,appProperties,size",
    });
    return await (await this.request(`/drive/v3/files/${encodeURIComponent(fileId)}?${params}`)).json() as DriveFile;
  }

  private async patch(fileId: string, metadata: Record<string, unknown>): Promise<DriveFile> {
    const params = new URLSearchParams({ supportsAllDrives: "true", fields: "id,name,mimeType,parents,appProperties,size" });
    return await (await this.request(`/drive/v3/files/${encodeURIComponent(fileId)}?${params}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
    })).json() as DriveFile;
  }

  private async createFolder(
    name: string,
    parentId: string,
    appProperties: Record<string, string>,
  ): Promise<DriveFile> {
    const params = new URLSearchParams({ supportsAllDrives: "true", fields: "id,name,mimeType,parents,appProperties" });
    return await (await this.request(`/drive/v3/files?${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: DRIVE_FOLDER_MIME, parents: [parentId], appProperties }),
    })).json() as DriveFile;
  }

  private async ensureChildFolder(
    parentId: string,
    name: string,
    appProperties: Record<string, string>,
    knownId?: string | null,
  ): Promise<string> {
    if (knownId) {
      const known = await this.get(knownId);
      if (known.mimeType !== DRIVE_FOLDER_MIME || !known.parents?.includes(parentId)) {
        throw new Error("DRIVE_BINDING_INVALID");
      }
      if (known.appProperties?.minglaBrandId !== appProperties.minglaBrandId) {
        await this.patch(known.id, { appProperties: { ...known.appProperties, ...appProperties } });
      }
      return known.id;
    }
    const matches = await this.list(
      `'${q(parentId)}' in parents and mimeType='${DRIVE_FOLDER_MIME}' and name='${q(name)}'`,
    );
    if (matches.length > 1) throw new Error("DRIVE_FOLDER_AMBIGUOUS");
    if (matches.length === 1) {
      await this.patch(matches[0].id, { appProperties: { ...matches[0].appProperties, ...appProperties } });
      return matches[0].id;
    }
    return (await this.createFolder(name, parentId, appProperties)).id;
  }

  private async ensureHostFolder(
    brandId: string,
    canonicalName: string,
    knownId?: string | null,
  ): Promise<string> {
    if (knownId) {
      return await this.ensureChildFolder(
        this.hostDetailsFolderId,
        canonicalName,
        { minglaBrandId: brandId, minglaFolderRole: "host_root" },
        knownId,
      );
    }
    const marked = await this.list(
      `'${q(this.hostDetailsFolderId)}' in parents and mimeType='${DRIVE_FOLDER_MIME}' and appProperties has { key='minglaBrandId' and value='${q(brandId)}' }`,
    );
    if (marked.length > 1) throw new Error("DRIVE_FOLDER_AMBIGUOUS");
    if (marked.length === 1) return marked[0].id;

    const exact = await this.list(
      `'${q(this.hostDetailsFolderId)}' in parents and mimeType='${DRIVE_FOLDER_MIME}' and name='${q(canonicalName)}'`,
    );
    if (exact.length > 1) throw new Error("DRIVE_FOLDER_AMBIGUOUS");
    if (exact.length === 1) {
      await this.patch(exact[0].id, {
        appProperties: { ...exact[0].appProperties, minglaBrandId: brandId, minglaFolderRole: "host_root" },
      });
      return exact[0].id;
    }

    const candidates = await this.list(
      `'${q(this.hostDetailsFolderId)}' in parents and mimeType='${DRIVE_FOLDER_MIME}' and name contains '${q(canonicalName)}'`,
    );
    const parenthetical = candidates.filter((file) =>
      typeof file.name === "string" && file.name.startsWith(`${canonicalName} (`) && file.name.endsWith(")")
    );
    if (parenthetical.length > 1) throw new Error("DRIVE_FOLDER_AMBIGUOUS");
    if (parenthetical.length === 1) {
      await this.patch(parenthetical[0].id, {
        appProperties: { ...parenthetical[0].appProperties, minglaBrandId: brandId, minglaFolderRole: "host_root" },
      });
      return parenthetical[0].id;
    }
    return (await this.createFolder(canonicalName, this.hostDetailsFolderId, {
      minglaBrandId: brandId,
      minglaFolderRole: "host_root",
    })).id;
  }

  async ensureBinding(input: {
    brandId: string;
    canonicalName: string;
    hostFolderId?: string | null;
    mediaPacketFolderId?: string | null;
    hostUploadsFolderId?: string | null;
    staffSharingFolderId?: string | null;
  }): Promise<DriveBinding> {
    const common = { minglaBrandId: input.brandId };
    const hostFolderId = await this.ensureHostFolder(input.brandId, input.canonicalName, input.hostFolderId);
    const mediaPacketFolderId = await this.ensureChildFolder(
      hostFolderId,
      "Media Packet",
      { ...common, minglaFolderRole: "media_packet" },
      input.mediaPacketFolderId,
    );
    const hostUploadsFolderId = await this.ensureChildFolder(
      mediaPacketFolderId,
      "Host uploads",
      { ...common, minglaFolderRole: "host_uploads" },
      input.hostUploadsFolderId,
    );
    const staffSharingFolderId = await this.ensureChildFolder(
      mediaPacketFolderId,
      "Staff sharing",
      { ...common, minglaFolderRole: "staff_sharing" },
      input.staffSharingFolderId,
    );
    return { hostFolderId, mediaPacketFolderId, hostUploadsFolderId, staffSharingFolderId };
  }

  async findUpload(folderId: string, minglaUploadId: string): Promise<DriveFile | null> {
    const matches = await this.list(
      `'${q(folderId)}' in parents and appProperties has { key='minglaUploadId' and value='${q(minglaUploadId)}' }`,
    );
    if (matches.length > 1) throw new Error("DRIVE_UPLOAD_AMBIGUOUS");
    return matches[0] ?? null;
  }

  async upload(input: {
    folderId: string;
    minglaUploadId: string;
    name: string;
    mimeType: string;
    body: Blob;
  }): Promise<DriveFile> {
    const existing = await this.findUpload(input.folderId, input.minglaUploadId);
    if (existing && Number(existing.size) === input.body.size) return existing;
    if (existing) await this.remove(existing.id);
    const startParams = new URLSearchParams({ uploadType: "resumable", supportsAllDrives: "true", fields: "id,name,mimeType,size,parents,appProperties" });
    const start = await this.request(`/upload/drive/v3/files?${startParams}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": input.mimeType,
        "X-Upload-Content-Length": String(input.body.size),
      },
      body: JSON.stringify({
        name: input.name,
        parents: [input.folderId],
        appProperties: { minglaUploadId: input.minglaUploadId },
      }),
    });
    const location = start.headers.get("location");
    if (!location?.startsWith("https://www.googleapis.com/")) throw new Error("DRIVE_UPLOAD_FAILED");
    const token = await this.token();
    const finish = await this.fetcher(location, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": input.mimeType,
        "Content-Length": String(input.body.size),
      },
      body: input.body,
    });
    if (!finish.ok) {
      await finish.arrayBuffer().catch(() => null);
      throw new Error(finish.status === 429 || finish.status >= 500 ? "DRIVE_TEMPORARY" : "DRIVE_UPLOAD_FAILED");
    }
    return await finish.json() as DriveFile;
  }

  async remove(fileId: string): Promise<void> {
    try {
      await this.request(`/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, { method: "DELETE" });
    } catch (error) {
      if (error instanceof Error && error.message === "DRIVE_NOT_FOUND") return;
      throw error;
    }
  }

  async media(fileId: string, range?: string | null): Promise<Response> {
    const token = await this.token();
    return await this.fetcher(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}`, ...(range ? { Range: range } : {}) } },
    );
  }

  async mediaInfo(fileId: string): Promise<DriveMediaInfo> {
    const params = new URLSearchParams({
      supportsAllDrives: "true",
      fields:
        "hasThumbnail,thumbnailLink,imageMediaMetadata(width,height),videoMediaMetadata(width,height,durationMillis)",
    });
    const response = await this.request(
      `/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    );
    const body = await response.json() as {
      hasThumbnail?: unknown;
      thumbnailLink?: unknown;
      imageMediaMetadata?: { width?: unknown; height?: unknown };
      videoMediaMetadata?: { width?: unknown; height?: unknown; durationMillis?: unknown };
    };
    const image = body.imageMediaMetadata;
    const video = body.videoMediaMetadata;
    const positiveInteger = (value: unknown): number | null => {
      const parsed = typeof value === "number" ? value : Number(value);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    };
    const nonNegativeInteger = (value: unknown): number | null => {
      const parsed = typeof value === "number" ? value : Number(value);
      return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
    };
    return {
      hasThumbnail: body.hasThumbnail === true,
      thumbnailLink: typeof body.thumbnailLink === "string" && body.thumbnailLink.length > 0
        ? body.thumbnailLink
        : null,
      width: positiveInteger(video?.width) ?? positiveInteger(image?.width),
      height: positiveInteger(video?.height) ?? positiveInteger(image?.height),
      durationMs: nonNegativeInteger(video?.durationMillis),
    };
  }

  async thumbnail(link: string, sizePx = 480): Promise<Response> {
    const target = new URL(link);
    const normalizedSize = Number.isInteger(sizePx) && sizePx > 0 ? sizePx : 480;
    if (/=s[0-9]+$/.test(target.href)) {
      target.href = target.href.replace(/=s[0-9]+$/, `=s${normalizedSize}`);
    } else {
      target.href = `${target.href}=s${normalizedSize}`;
    }
    const token = await this.token();
    return await this.fetcher(target, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  async listFolderFiles(folderId: string): Promise<DriveFile[]> {
    if (!folderId) throw new Error("DRIVE_CONFIG_INVALID");
    return await this.list(
      `'${q(folderId)}' in parents and mimeType!='${DRIVE_FOLDER_MIME}'`,
      "files(id,name,mimeType,size,modifiedTime,parents)",
    );
  }

  async dataRoomContent(file: DriveFile): Promise<Response> {
    if (!file.id) throw new Error("DRIVE_NOT_FOUND");
    const exportable = new Set([
      "application/vnd.google-apps.document",
      "application/vnd.google-apps.presentation",
      "application/vnd.google-apps.spreadsheet",
    ]);
    if (file.mimeType && exportable.has(file.mimeType)) {
      const params = new URLSearchParams({ mimeType: "application/pdf" });
      return await this.request(
        `/drive/v3/files/${encodeURIComponent(file.id)}/export?${params}`,
      );
    }
    return await this.media(file.id);
  }
}
