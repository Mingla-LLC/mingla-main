import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createCreatorMediaStatusHandler,
  type MediaStatusDeps,
  type MediaStatusRow,
} from "./index.ts";

const JOB = "00000000-3872-4000-8000-0000000000a1";
const OWNER = "00000000-3872-4000-8000-0000000000a2";
const HOST = "00000000-3872-4000-8000-0000000000a3";
const STRANGER = "00000000-3872-4000-8000-0000000000a4";
const CONTRACT = "00000000-3872-4000-8000-0000000000a5";

const request = () =>
  new Request("http://local/creator-media-status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId: JOB }),
  });

const row = (purpose: string): MediaStatusRow => ({
  id: JOB,
  owner_id: OWNER,
  purpose,
  status: "ready",
  contract_id: purpose === "showcase" ? null : CONTRACT,
  bunny_video_id: "00000000-3872-4000-8000-0000000000a6",
  aspect_warning: false,
  failure_code: null,
  ready_at: "2026-10-26T12:00:00Z",
});

const deps = (actor: string, purpose: string, admin = false): MediaStatusDeps => ({
  actorId: () => Promise.resolve(actor),
  media: () => Promise.resolve(row(purpose)),
  isContractHost: (contractId, actorId) =>
    Promise.resolve(contractId === CONTRACT && actorId === HOST),
  isAdmin: () => Promise.resolve(admin),
  playback: () => Promise.resolve({ url: "https://video.example/play", expiresAt: "later" }),
});

Deno.test("#3872 the owner gets playback for their own media", async () => {
  const res = await createCreatorMediaStatusHandler(deps(OWNER, "showcase"))(request());
  assertEquals(res.status, 200);
  assertEquals((await res.json()).playback.url, "https://video.example/play");
});

Deno.test("#3872 the contract's host can play the delivered video it must review", async () => {
  const res = await createCreatorMediaStatusHandler(deps(HOST, "delivery"))(request());
  assertEquals(res.status, 200);
  assertEquals((await res.json()).playback.url, "https://video.example/play");
});

Deno.test("#3872 an admin can play a delivery for disputes", async () => {
  const res = await createCreatorMediaStatusHandler(deps(STRANGER, "delivery", true))(request());
  assertEquals(res.status, 200);
});

Deno.test("#3872 a stranger gets not_found for someone else's delivery", async () => {
  const res = await createCreatorMediaStatusHandler(deps(STRANGER, "delivery"))(request());
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error, "not_found");
});

Deno.test("#3872 a host cannot read a creator's private showcase through this route", async () => {
  const res = await createCreatorMediaStatusHandler(deps(HOST, "showcase"))(request());
  assertEquals(res.status, 404);
});
