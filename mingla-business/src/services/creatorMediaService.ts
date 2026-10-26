import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import {
  headTusOffset,
  tusMetadata,
  uploadSourceWeb,
} from "@mingla/video-upload";
import { supabase } from "./supabase";
import {
  patchBunnyTusNative,
  readEventCoverVideoChunk,
} from "./eventCoverVideoTusPatch";
import { randomUuid } from "../utils/randomId";

type Intent = {
  jobId: string;
  aspectWarning: boolean;
  upload: {
    tusEndpoint: string;
    libraryId: string;
    videoId: string;
    authorizationExpire: number;
    authorizationSignature: string;
  };
};

const resolveLocation = (base: string, location: string) => {
  try { return new URL(location, base).toString(); } catch { return location; }
};

const CREATOR_TUS_CHUNK_BYTES = 2 * 1024 * 1024;

async function uploadCreatorShowcaseSource(input: {
  url: string;
  headers: Record<string, string>;
  uri: string;
  bytes: number;
  onProgress: (fraction: number) => void;
}): Promise<void> {
  if (Platform.OS === "web") {
    const response = await fetch(input.uri);
    const file = await response.blob();
    await uploadSourceWeb({
      file,
      transport: { url: input.url, headers: input.headers },
      chunkBytes: CREATOR_TUS_CHUNK_BYTES,
      onProgress: (progress: { confirmedBytes: number; totalBytes: number; final?: boolean }) => {
        const confirmed = progress.final ? progress.totalBytes : progress.confirmedBytes;
        input.onProgress(progress.totalBytes > 0 ? confirmed / progress.totalBytes : 0);
      },
    });
    return;
  }

  let offset = await headTusOffset({ url: input.url, headers: input.headers });
  while (offset < input.bytes) {
    const length = Math.min(CREATOR_TUS_CHUNK_BYTES, input.bytes - offset);
    const body = await readEventCoverVideoChunk(input.uri, offset, length);
    const result = await patchBunnyTusNative({
      url: input.url,
      body,
      headers: {
        ...input.headers,
        "Content-Type": "application/offset+octet-stream",
        "Tus-Resumable": "1.0.0",
        "Upload-Offset": String(offset),
      },
    });
    if (result.status !== 200 && result.status !== 204) {
      throw new Error("We couldn’t upload this video. Check your connection and try again.");
    }
    const confirmed = await headTusOffset({ url: input.url, headers: input.headers });
    if (confirmed <= offset || confirmed > input.bytes) {
      throw new Error("We couldn’t confirm the video upload. Choose the original video again.");
    }
    offset = confirmed;
    input.onProgress(offset / input.bytes);
  }
}

export async function chooseAndUploadCreatorShowcase(
  onProgress: (fraction: number) => void,
): Promise<{ jobId: string; aspectWarning: boolean }> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Videos,
    allowsEditing: false,
    videoMaxDuration: 90,
    quality: 1,
  });
  if (picked.canceled || !picked.assets[0]) throw new Error("No video selected.");
  const asset = picked.assets[0];
  const bytes = asset.fileSize ?? 0;
  const durationSeconds = Math.max(0, (asset.duration ?? 0) / 1000);
  if (bytes <= 0) throw new Error("We couldn’t read that video’s size. Choose it again.");
  if (bytes > 157_286_400) throw new Error("Choose a video no larger than 150 MB.");
  if (durationSeconds <= 0 || durationSeconds > 90) throw new Error("Choose a video up to 90 seconds.");

  const { data, error } = await supabase.functions.invoke<Intent>("creator-media-upload-intent", {
    body: {
      ownerKind: "creator",
      purpose: "showcase",
      contractId: null,
      localMonthId: null,
      clientOperationId: randomUuid(),
      sourceBytes: bytes,
      durationSeconds,
      width: asset.width,
      height: asset.height,
    },
  });
  if (error || !data?.upload) throw new Error(error?.message ?? "Creator uploads are not available yet.");
  const fields = {
    AuthorizationSignature: data.upload.authorizationSignature,
    AuthorizationExpire: String(data.upload.authorizationExpire),
    VideoId: data.upload.videoId,
    LibraryId: data.upload.libraryId,
  };
  const mime = asset.mimeType ?? "video/mp4";
  const create = await fetch(data.upload.tusEndpoint, {
    method: "POST",
    headers: {
      ...fields,
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(bytes),
      "Upload-Metadata": tusMetadata({ filetype: mime, title: `creator-media-job:${data.jobId}` }),
    },
  });
  const location = create.headers.get("Location");
  if (!create.ok || !location) throw new Error("We couldn’t start the secure upload. Try again.");
  await uploadCreatorShowcaseSource({
    url: resolveLocation(data.upload.tusEndpoint, location),
    headers: fields,
    uri: asset.uri,
    bytes,
    onProgress,
  });
  onProgress(1);
  return { jobId: data.jobId, aspectWarning: data.aspectWarning };
}

export async function creatorMediaStatus(jobId: string): Promise<{ status: string }> {
  const { data, error } = await supabase.functions.invoke<{ status: string }>("creator-media-status", { body: { jobId } });
  if (error || !data) throw new Error(error?.message ?? "Couldn’t check the video.");
  return data;
}
