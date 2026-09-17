/**
 * Issue #3429 REWORK-1 (D-5) — native (iOS, Android) Ari image preparation.
 *
 * House pattern: `utils/normalizeTripDayImage.ts` (`manipulateAsync` with a
 * `SaveFormat`). `expo-image-manipulator` 14.0.8 and `expo-file-system`
 * 19.0.22 already ship in the Business binary, so this adds no native module,
 * dependency, or service cost. The output is always re-encoded (EXIF stripped,
 * orientation applied) and its size is read from the written file.
 */

import * as ImageManipulator from "expo-image-manipulator";

import { readAriAttachmentSize } from "./ariAttachmentFileReader";
import {
  ARI_IMAGE_PREPARED_LONG_EDGE,
  AriImagePreparationError,
  type AriImagePreparationInput,
  type AriPreparedImage,
  ariPreparedDimensions,
  planAriImagePreparation,
} from "./ariImagePreparation";

export async function prepareAriImage(
  input: AriImagePreparationInput & { uri: string },
): Promise<AriPreparedImage> {
  const plan = planAriImagePreparation(input);
  if (plan === null) throw new AriImagePreparationError("IMAGE_UNREADABLE");
  if (plan.kind === "refuse") throw new AriImagePreparationError(plan.code);
  const format = plan.format === "webp"
    ? ImageManipulator.SaveFormat.WEBP
    : ImageManipulator.SaveFormat.JPEG;
  const save = { compress: plan.compress, format };
  let result: ImageManipulator.ImageResult;
  try {
    result = await ImageManipulator.manipulateAsync(
      input.uri,
      plan.resize ? [{ resize: plan.resize }] : [],
      save,
    );
    // The picker's dimensions can predate EXIF orientation, or be missing.
    // Measure the real output and scale once more if it is still too long.
    if (Math.max(result.width, result.height) > ARI_IMAGE_PREPARED_LONG_EDGE) {
      result = await ImageManipulator.manipulateAsync(
        result.uri,
        [{ resize: ariPreparedDimensions(result.width, result.height) }],
        save,
      );
    }
  } catch {
    throw new AriImagePreparationError("IMAGE_UNREADABLE");
  }
  const sizeBytes = await readAriAttachmentSize({ uri: result.uri });
  if (sizeBytes === null) throw new AriImagePreparationError("IMAGE_UNREADABLE");
  return {
    uri: result.uri,
    name: plan.name,
    mimeType: plan.mimeType,
    sizeBytes,
    width: result.width,
    height: result.height,
  };
}
