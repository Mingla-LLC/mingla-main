/**
 * #4334 — web: the shared Google address field loads from its own chunk.
 *
 * Every Host screen with an address field shares the wrapper, so a static
 * import put the whole field on every visitor's boot path (`__common`, the
 * #2099 / #3493 ceiling). Same lazy pattern as LazyAddressMapPreview: the field
 * chunk loads on the first render of any address field, behind a box of the
 * field's height so nothing jumps. Native keeps the static import
 * (`sharedAddressField.tsx` — same extension as this file, so Metro picks
 * the `.web` variant on web).
 */
import React, { Suspense } from "react";
import { View } from "react-native";

import type { AddressInputProps } from "@mingla/location-input/src/AddressInput";

const LazySharedAddressInput = React.lazy(async () => {
  const mod = await import("@mingla/location-input/src/AddressInput");
  return { default: mod.AddressInput };
});

// The Host field's own height (the shared field row's minHeight, 52), so the form does not
// shift when the chunk arrives.
const FIELD_PLACEHOLDER_HEIGHT = 52;

export const SharedAddressInput: React.FC<AddressInputProps> = (props) => (
  <Suspense fallback={<View style={{ minHeight: FIELD_PLACEHOLDER_HEIGHT }} />}>
    <LazySharedAddressInput {...props} />
  </Suspense>
);
