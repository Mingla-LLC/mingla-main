import { supabase } from "./supabase";

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

/**
 * Record the canonical Bunny-backed creative only. Provider-native copies are
 * launch work and are created later by launchHostAdPlan, after the exact plan
 * is funded, reviewed and phrase-confirmed.
 */
export async function recordHostAdVideo(input: {
  brandId: string;
  platforms: string[];
  name: string;
  videoUrl: string;
  posterUrl: string;
}): Promise<string> {
  const platforms = [
    ...new Set(
      input.platforms.map((value) => value.trim().toLowerCase()).filter(Boolean),
    ),
  ];
  if (platforms.length === 0) {
    throw new Error("Choose at least one ad platform before adding the video.");
  }
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
        platforms,
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
  return creativeId;
}
