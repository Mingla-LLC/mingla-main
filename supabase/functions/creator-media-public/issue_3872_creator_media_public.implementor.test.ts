import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createPublicCreatorMediaHandler,
  type PublicMediaDeps,
} from "./index.ts";

const JOB = "00000000-3872-4000-8000-000000000091";
const OWNER = "00000000-3872-4000-8000-000000000092";
const request = () =>
  new Request("http://local/creator-media-public", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId: JOB }),
  });
const deps = (
  purpose: "showcase" | "local_review",
  allowed: boolean,
): PublicMediaDeps => ({
  media: () =>
    Promise.resolve({
      id: JOB,
      owner_id: OWNER,
      purpose,
      status: "ready",
      bunny_video_id: "00000000-3872-4000-8000-000000000093",
      deleted_at: null,
    }),
  creatorIsPublic: () => Promise.resolve(allowed),
  localReviewIsPublic: () => Promise.resolve(allowed),
  playback: () =>
    Promise.resolve({
      url: "https://video.example/embed/signed",
      expiresAt: "2030-01-01T00:00:00.000Z",
    }),
});

Deno.test("#3872 public media grants verified Creator showcase playback", async () => {
  const response = await createPublicCreatorMediaHandler(
    deps("showcase", true),
  )(request());
  assertEquals(response.status, 200);
  assertEquals(
    (await response.json()).playback.url,
    "https://video.example/embed/signed",
  );
});

Deno.test("#3872 public media grants published Local review playback", async () => {
  const response = await createPublicCreatorMediaHandler(
    deps("local_review", true),
  )(request());
  assertEquals(response.status, 200);
});

Deno.test("#3872 public media hides non-public and unsupported media", async () => {
  assertEquals(
    (await createPublicCreatorMediaHandler(deps("showcase", false))(request()))
      .status,
    404,
  );
  const unsupported = deps("showcase", true);
  unsupported.media = () =>
    Promise.resolve({
      id: JOB,
      owner_id: OWNER,
      purpose: "delivery",
      status: "ready",
      bunny_video_id: "00000000-3872-4000-8000-000000000093",
      deleted_at: null,
    });
  assertEquals(
    (await createPublicCreatorMediaHandler(unsupported)(request())).status,
    404,
  );
});
