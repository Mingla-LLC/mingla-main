import { File } from "expo-file-system";

import { CreatorAvatarError } from "../utils/creatorAvatarRules";

export interface CreatorAvatarFileBytes {
  bytes: Uint8Array;
  byteLength: number;
}

const toUint8Array = (buffer: ArrayBuffer): Uint8Array =>
  new Uint8Array(buffer);

export const readCreatorAvatarFileBytes = async (
  uri: string,
): Promise<CreatorAvatarFileBytes> => {
  try {
    const buffer = await new File(uri).arrayBuffer();
    const bytes = toUint8Array(buffer);
    return {
      bytes,
      byteLength: bytes.byteLength,
    };
  } catch {
    throw new CreatorAvatarError(
      "upload_failed",
      "We couldn't read that photo. Try another.",
    );
  }
};
