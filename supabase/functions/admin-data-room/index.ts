// #3720 Completion Wave 6 — authenticated broker for the private Data room.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  type DriveFile,
  GoogleDriveClient,
  parseDriveCredentialBundle,
} from "../brand-group-files/drive.ts";

type Json = Record<string, unknown>;
type RpcClient = {
  rpc: (
    name: string,
    args?: Json,
  ) => Promise<{ data: unknown; error: unknown }>;
  auth: {
    getUser: () => Promise<
      { data: { user: { id: string } | null }; error: unknown }
    >;
  };
};

export type DataRoomStore = {
  listDocuments: () => Promise<DriveFile[]>;
  content: (file: DriveFile) => Promise<Response>;
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const KEY = /^[A-Za-z0-9_-]{43}$/;
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const DOCUMENT_TYPES = new Set([
  "application/pdf",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
]);
const GOOGLE_DOCUMENT_TYPES = new Set([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.presentation",
  "application/vnd.google-apps.spreadsheet",
]);

function json(status: number, body: Json): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function safeFilename(value: string | undefined, fallback: string): string {
  const clean = String(value ?? "").replace(/[^A-Za-z0-9._ -]/g, "").trim()
    .slice(0, 120);
  return clean || fallback;
}

function outputType(file: DriveFile): string | null {
  if (file.mimeType && GOOGLE_DOCUMENT_TYPES.has(file.mimeType)) {
    return "application/pdf";
  }
  return file.mimeType && DOCUMENT_TYPES.has(file.mimeType)
    ? file.mimeType
    : null;
}

function fileSize(file: DriveFile): number | null {
  if (file.mimeType && GOOGLE_DOCUMENT_TYPES.has(file.mimeType)) return 0;
  const value = Number(file.size);
  return Number.isSafeInteger(value) && value >= 0 &&
      value <= MAX_DOCUMENT_BYTES
    ? value
    : null;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// The browser receives only a one-way opaque handle, never a Google file id.
export async function dataRoomKey(fileId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`mingla-data-room\0${fileId}`),
  );
  return base64Url(new Uint8Array(digest));
}

async function boundedBytes(
  response: Response,
  maximum: number,
): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximum) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.length <= maximum ? bytes : null;
}

async function activeDataRoomUser(
  user: RpcClient,
): Promise<{ id: string; role: string } | null> {
  const [identity, access] = await Promise.all([
    user.auth.getUser(),
    user.rpc("admin_team_my_access"),
  ]);
  const record = access.data && typeof access.data === "object"
    ? access.data as Json
    : null;
  const role = typeof record?.role === "string" ? record.role : "";
  if (
    identity.error || access.error || !identity.data.user ||
    record?.status !== "active" || !["owner", "admin", "partner"].includes(role)
  ) return null;
  return { id: identity.data.user.id, role };
}

export type DataRoomDependencies = {
  userClient: (request: Request) => RpcClient;
  adminClient: () => Pick<RpcClient, "rpc">;
  store: () => DataRoomStore;
};

export function createDataRoomHandler(dependencies: DataRoomDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response("ok", { headers: cors });
    }
    if (request.method !== "POST") {
      return json(405, { code: "METHOD_NOT_ALLOWED" });
    }
    const authorization = request.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) {
      return json(401, { code: "AUTH_REQUIRED" });
    }

    const user = dependencies.userClient(request);
    const admin = dependencies.adminClient();
    const actor = await activeDataRoomUser(user);
    if (!actor) return json(403, { code: "FORBIDDEN" });
    const body = await request.json().catch(() => null) as Json | null;
    const action = body?.action;
    const key = body?.key;
    if (action !== "manifest" && action !== "document") {
      return json(400, { code: "BAD_REQUEST" });
    }
    if (action === "document" && (typeof key !== "string" || !KEY.test(key))) {
      return json(400, { code: "BAD_REQUEST" });
    }

    let succeeded = false;
    try {
      const store = dependencies.store();
      const files = await store.listDocuments();
      if (files.length > 100) {
        return json(502, { code: "DATA_ROOM_RESPONSE_INVALID" });
      }
      const documents = (await Promise.all(files.map(async (file) => {
        const contentType = outputType(file);
        const size = fileSize(file);
        const label = safeFilename(file.name, "Document");
        if (!file.id || !contentType || size === null || !label) return null;
        return {
          file,
          key: await dataRoomKey(file.id),
          label,
          content_type: contentType,
          size_bytes: size,
          updated_at: typeof file.modifiedTime === "string"
            ? file.modifiedTime.slice(0, 40)
            : null,
        };
      }))).filter((row) => row !== null);

      if (action === "manifest") {
        succeeded = true;
        return json(200, {
          documents: documents.map(({ file: _file, ...document }) => document),
        });
      }

      const document = documents.find((candidate) => candidate.key === key);
      if (!document) return json(404, { code: "DOCUMENT_NOT_FOUND" });
      const upstream = await store.content(document.file);
      if (!upstream.ok) return json(502, { code: "DATA_ROOM_UPSTREAM_FAILED" });
      const contentType = String(upstream.headers.get("content-type") ?? "")
        .split(";")[0].trim().toLowerCase();
      if (contentType !== document.content_type) {
        return json(502, { code: "DATA_ROOM_RESPONSE_INVALID" });
      }
      const bytes = await boundedBytes(upstream, MAX_DOCUMENT_BYTES);
      if (!bytes) return json(413, { code: "DOCUMENT_TOO_LARGE" });
      succeeded = true;
      return new Response(new Uint8Array(bytes).buffer, {
        status: 200,
        headers: {
          ...cors,
          "Content-Type": contentType,
          "Content-Disposition": `inline; filename="${document.label}"`,
          "Cache-Control": "no-store, private",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      const notConfigured = error instanceof Error &&
        error.message === "DRIVE_CONFIG_INVALID";
      return json(notConfigured ? 503 : 502, {
        code: notConfigured
          ? "DATA_ROOM_NOT_CONFIGURED"
          : "DATA_ROOM_UPSTREAM_FAILED",
      });
    } finally {
      await admin.rpc("issue_3720_log_data_room_access", {
        p_user_id: actor.id,
        p_action: action === "manifest" ? "room_open" : "document_open",
        p_document_key: action === "document" ? key : null,
        p_succeeded: succeeded,
      }).catch(() => null);
    }
  };
}

function runtimeDependencies(): DataRoomDependencies {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return {
    userClient: (request) =>
      createClient(url, anon, {
        global: {
          headers: {
            Authorization: request.headers.get("Authorization") ?? "",
          },
        },
        auth: { autoRefreshToken: false, persistSession: false },
      }) as unknown as RpcClient,
    adminClient: () =>
      createClient(url, service, {
        auth: { autoRefreshToken: false, persistSession: false },
      }) as unknown as Pick<RpcClient, "rpc">,
    store: () => {
      const credential = parseDriveCredentialBundle(
        Deno.env.get("GOOGLE_CALENDAR_KEYS") ?? "",
      );
      const folderId = credential.data_room_folder_id ?? "";
      if (!folderId) throw new Error("DRIVE_CONFIG_INVALID");
      const drive = new GoogleDriveClient(
        credential,
        credential.shared_drive_id,
        credential.host_details_folder_id,
      );
      return {
        listDocuments: () => drive.listFolderFiles(folderId),
        content: (file) => drive.dataRoomContent(file),
      };
    },
  };
}

if (import.meta.main) Deno.serve(createDataRoomHandler(runtimeDependencies()));
