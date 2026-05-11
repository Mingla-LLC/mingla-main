import { File } from "expo-file-system";

import { EventCoverMediaError } from "../utils/eventCoverMediaRules";

export interface EventCoverFileBytes {
  bytes: Uint8Array;
  byteLength: number;
}

const toUint8Array = (buffer: ArrayBuffer): Uint8Array =>
  new Uint8Array(buffer);

export const readEventCoverFileBytes = async (
  uri: string,
): Promise<EventCoverFileBytes> => {
  try {
    const buffer = await new File(uri).arrayBuffer();
    const bytes = toUint8Array(buffer);
    return {
      bytes,
      byteLength: bytes.byteLength,
    };
  } catch {
    throw new EventCoverMediaError(
      "upload_failed",
      "We couldn't read that file. Try another cover.",
    );
  }
};
