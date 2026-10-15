import { supabase } from "./supabase";

const PREPARED_VIDEO_PLATFORMS = new Set([
  "meta",
  "google",
  "tiktok",
  "snapchat",
]);

type PrepareEnvelope = {
  state?: string;
  retry_after_seconds?: number | null;
  error?: { message?: string } | null;
};

function bunnyVideoIdFromUrl(url: string): string {
  const pathname = new URL(url).pathname;
  const candidate = pathname.split("/").filter(Boolean)[0] ?? "";
  if (!/^[A-Za-z0-9-]{1,128}$/.test(candidate)) {
    throw new Error(
      "The uploaded video has no reusable provider id. Try uploading it again.",
    );
  }
  return candidate;
}

function functionMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function recordAndPrepareAriAdVideo(input: {
  brandId: string;
  platform: string;
  name: string;
  videoUrl: string;
  posterUrl: string;
}): Promise<string> {
  const platform = input.platform.trim().toLowerCase();
  const bunnyVideoId = bunnyVideoIdFromUrl(input.videoUrl);
  const { data: uploadData, error: uploadError } =
    await supabase.functions.invoke<{
      creative?: { id?: string };
    }>("admin-ad-creative-upload", {
      body: {
        action: "record",
        kind: "video",
        name: input.name.trim() || "Ari Host ad video",
        source_url: input.videoUrl,
        mp4_master_url: input.videoUrl,
        bunny_video_id: bunnyVideoId,
        poster_url: input.posterUrl,
        brand_id: input.brandId,
        platforms: [platform],
        ai_generated: false,
      },
    });
  if (uploadError) {
    throw new Error(
      functionMessage(uploadError, "We couldn't validate that ad video."),
    );
  }
  const creativeId = uploadData?.creative?.id;
  if (!creativeId)
    throw new Error("The ad video was validated but not recorded.");
  if (!PREPARED_VIDEO_PLATFORMS.has(platform)) return creativeId;

  let action: "start" | "status" = "start";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const { data, error } = await supabase.functions.invoke<PrepareEnvelope>(
      "admin-ad-creative-prepare",
      {
        body: {
          action,
          creative_library_id: creativeId,
          platform,
          lane: "business",
          brand_id: input.brandId,
        },
      },
    );
    if (error) {
      throw new Error(
        functionMessage(error, "The ad platform couldn't prepare that video."),
      );
    }
    if (data?.state === "ready") return creativeId;
    if (data?.state === "failed" || data?.state === "timed_out") {
      throw new Error(
        data.error?.message || "The ad platform couldn't prepare that video.",
      );
    }
    action = "status";
    const seconds = Math.min(
      10,
      Math.max(1, Number(data?.retry_after_seconds) || 2),
    );
    await wait(seconds * 1000);
  }
  throw new Error(
    "The platform is still preparing this video. Try again in a moment.",
  );
}
