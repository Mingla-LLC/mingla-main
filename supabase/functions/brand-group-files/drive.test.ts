import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { GoogleDriveClient, parseDriveCredentialBundle, parseDriveServiceAccount } from "./drive.ts";

const serviceAccount = {
  client_email: "drive@example.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nunused-in-test\n-----END PRIVATE KEY-----",
  shared_drive_id: "shared-drive",
  host_details_folder_id: "host-details",
};

function client(fetcher: typeof fetch): GoogleDriveClient {
  const drive = new GoogleDriveClient(serviceAccount, "shared-drive", "host-details", fetcher);
  const internal = drive as unknown as { accessToken: string; accessTokenExpiresAt: number };
  internal.accessToken = "test-token";
  internal.accessTokenExpiresAt = Date.now() + 3_600_000;
  return drive;
}

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" }, ...init });
}

Deno.test("#3720 Drive config fails closed when folder authority is incomplete", () => {
  assertRejects(async () => parseDriveServiceAccount(JSON.stringify({ client_email: "x@y", private_key: "BEGIN PRIVATE KEY" })), Error, "DRIVE_CONFIG_INVALID");
});

Deno.test("#3720 Drive config extends the Google bundle without changing Calendar fields", () => {
  const encoded = btoa(JSON.stringify(serviceAccount)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  assertEquals(parseDriveCredentialBundle(`calendar-id|calendar-secret|calendar-refresh|${encoded}`), serviceAccount);
});

Deno.test("#3720 provision adopts one exact Host folder and creates the three canonical children", async () => {
  const created: Array<{ name: string; parents: string[] }> = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    if (init?.method === "PATCH") return json({ id: url.pathname.split("/").pop(), mimeType: "application/vnd.google-apps.folder", parents: ["host-details"] });
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { name: string; parents: string[] };
      created.push(body);
      return json({ id: `created-${created.length}`, name: body.name, mimeType: "application/vnd.google-apps.folder", parents: body.parents });
    }
    const query = url.searchParams.get("q") ?? "";
    if (query.includes("appProperties has") && query.includes("minglaBrandId")) return json({ files: [] });
    if (query.includes("name='Example Host'")) return json({ files: [{ id: "existing-host", name: "Example Host", mimeType: "application/vnd.google-apps.folder", parents: ["host-details"] }] });
    return json({ files: [] });
  }) as typeof fetch;

  const binding = await client(fetcher).ensureBinding({ brandId: "brand-1", canonicalName: "Example Host" });
  assertEquals(binding, {
    hostFolderId: "existing-host",
    mediaPacketFolderId: "created-1",
    hostUploadsFolderId: "created-2",
    staffSharingFolderId: "created-3",
  });
  assertEquals(created.map((folder) => folder.name), ["Media Packet", "Host uploads", "Staff sharing"]);
  assertEquals(created.map((folder) => folder.parents[0]), ["existing-host", "created-1", "created-1"]);
});

Deno.test("#3720 provision refuses ambiguous provider bindings", async () => {
  const fetcher = (async (): Promise<Response> => json({ files: [
    { id: "one", name: "One" }, { id: "two", name: "Two" },
  ] })) as typeof fetch;
  await assertRejects(
    () => client(fetcher).ensureBinding({ brandId: "brand-1", canonicalName: "Example Host" }),
    Error,
    "DRIVE_FOLDER_AMBIGUOUS",
  );
});

Deno.test("#3720 upload retry reuses the appProperties-bound provider object", async () => {
  let writes = 0;
  const fetcher = (async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (init?.method === "POST" || init?.method === "PUT") writes += 1;
    return json({ files: [{ id: "provider-file", name: "menu.pdf", mimeType: "application/pdf", size: "12" }] });
  }) as typeof fetch;
  const uploaded = await client(fetcher).upload({
    folderId: "host-uploads",
    minglaUploadId: "mingla-file-id",
    name: "menu.pdf",
    mimeType: "application/pdf",
    body: new Blob(["hello world!"], { type: "application/pdf" }),
  });
  assertEquals(uploaded.id, "provider-file");
  assertEquals(writes, 0);
});
