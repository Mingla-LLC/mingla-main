/**
 * #4514 — the business app's visual primitives for `@mingla/form-rendering`
 * (C11), in their own module so the checkout Questions step and this owner both
 * use them without an import cycle. Reached only through the forms lazy owner
 * (`./formRenderingPrimitives`); never import it from an eager module.
 */

import React, { Suspense, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import type {
  FormBrandCoverProps,
  FormRenderingPrimitives,
  FormWebDateInputProps,
} from "@mingla/form-rendering";

import { radius, space, type } from "../../../constants/designSystem";
import { activeSurfaceTokens, themed } from "../../../theme/surfaceTokens";
import { EventCoverMedia } from "../../ui/EventCoverMedia";
import { Icon } from "../../ui/Icon";

/** The brand header's cover: the host's cover media, or its hue gradient (§5.1). */
const BusinessBrandCover: React.FC<FormBrandCoverProps> = ({ uri, hue, height }) => (
  <EventCoverMedia
    hue={hue}
    mediaUrl={uri}
    mediaType={uri === null ? null : "image"}
    radius={0}
    label=""
    height={height}
  />
);

/**
 * #4523: a date question is picked from the Host's Mingla calendar (sheet on
 * phones, popover on wide web) on every platform. The calendar loads on first
 * use from the shared Host calendar chunk; meanwhile the row is pressable and a
 * tap made while loading opens it once loaded (no dead tap). The question shell
 * draws the label, so only the question's label is spoken here. The answer is
 * the picked `YYYY-MM-DD`, as before. This module is itself lazily loaded, so
 * none of this reaches the Host boot payload.
 */
const FormDateBody = React.lazy(() =>
  import("../../ui/HostCalendarBody").then((m) => ({ default: m.FormDateBody })),
);

const BusinessFormDateInput: React.FC<FormWebDateInputProps> = ({
  value,
  onChangeValue,
  ariaLabel,
  disabled = false,
  hasError = false,
  testID,
}) => {
  const [armed, setArmed] = useState(false);
  const { color } = activeSurfaceTokens();
  return (
    <Suspense
      fallback={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ariaLabel}
          accessibilityState={{ busy: true, disabled }}
          disabled={disabled}
          onPress={() => setArmed(true)}
          testID={testID === undefined ? undefined : `${testID}-loading`}
          style={[
            styles.loadingRow,
            { borderColor: hasError ? color.danger : color.line, backgroundColor: color.fill.inset },
            disabled ? styles.loadingDisabled : null,
          ]}
        >
          <Text style={[styles.loadingText, { color: color.text4 }]}>Choose a date</Text>
        </Pressable>
      }
    >
      <FormDateBody
        value={value}
        onChangeValue={onChangeValue}
        accessibilityLabel={ariaLabel}
        disabled={disabled}
        hasError={hasError}
        testID={testID}
        openOnMount={armed}
      />
    </Suspense>
  );
};

const styles = StyleSheet.create({
  loadingRow: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  loadingDisabled: { opacity: 0.45 },
  loadingText: { fontSize: 16 },
});

/**
 * #4518: text and line colours come from the surface tokens, read at render.
 * `themed` builds one token object per active palette, so the package's
 * per-token style cache rebuilds when a host palette is set and a change of
 * palette never reuses a stale sheet.
 */
const surfaceFormTokens = themed(() => ({
  color: activeSurfaceTokens().color,
  radius,
  space,
  type,
}));

export const businessFormPrimitives: FormRenderingPrimitives = {
  get tokens() {
    return surfaceFormTokens();
  },
  Icon,
  WebDateTimeInput: BusinessFormDateInput,
  BrandCover: BusinessBrandCover,
};

