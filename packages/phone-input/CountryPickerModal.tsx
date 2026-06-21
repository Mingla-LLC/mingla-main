/**
 * CountryPickerModal — full-screen country picker for @mingla/phone-input.
 *
 * Per ORCH-0847 Phase A — extracted from
 * `app-mobile/src/components/onboarding/CountryPickerModal.tsx`. Refactored
 * to accept `iconRenderer` + `labels` props so both apps can consume.
 *
 * Per ORCH-0847 Phase B — added optional `theme` prop so the mingla-business
 * public buyer form (dark canvas) renders correctly without forking. Defaults
 * to LIGHT mode (matches app-mobile auth onboarding visual).
 *
 * Two surfaces exported:
 *   - CountryPickerModal — wraps content in a native <Modal>. Use in
 *     standalone contexts (onboarding, public buyer form). DO NOT nest
 *     inside another Modal — use CountryPickerOverlay instead.
 *   - CountryPickerOverlay — absolute-fill View. Use when picker must
 *     appear inside an EXISTING Modal (e.g., bottom-sheet contexts).
 */

import React, { useState, useCallback, useMemo, useRef } from "react";
import {
  KeyboardProvider,
  KeyboardToolbar,
  type KeyboardToolbarProps,
} from "react-native-keyboard-controller";
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Platform,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { COUNTRIES } from "./countries";
import type {
  CountryData,
  IconRenderer,
  PhoneInputLabels,
  PhoneInputTheme,
} from "./types";
import { useKeyboard } from "./useKeyboard";
import {
  DEFAULT_PHONE_INPUT_THEME,
  fontWeights,
  radius,
  spacing,
  touchTargets,
  typography,
} from "./tokens";

interface CountryPickerContentProps {
  selectedCode: string;
  onSelect: (code: string) => void;
  onClose: () => void;
  iconRenderer: IconRenderer;
  labels: Pick<
    PhoneInputLabels,
    "pickerTitle" | "pickerSearchPlaceholder" | "pickerCloseAccessibilityLabel"
  >;
  /** Optional theme overrides matching PhoneInput's theme prop. */
  theme?: PhoneInputTheme;
}

interface CountryPickerModalProps extends CountryPickerContentProps {
  visible: boolean;
}

const ROW_HEIGHT = 48;

/** ORCH-1171: Done-only toolbar height (matches app-mobile keyboardConstants). */
const KEYBOARD_TOOLBAR_HEIGHT = 42;

const MINGLA_KEYBOARD_TOOLBAR_THEME: NonNullable<
  KeyboardToolbarProps["theme"]
> = {
  light: {
    primary: "#eb7825",
    disabled: "#B0BEC5",
    background: "#f3f3f4",
    ripple: "#bcbcbcbc",
  },
  dark: {
    primary: "#eb7825",
    disabled: "#707070",
    background: "#2C2C2E",
    ripple: "#F8F8F888",
  },
};

const CountryPickerContent: React.FC<CountryPickerContentProps> = ({
  selectedCode,
  onSelect,
  onClose,
  iconRenderer,
  labels,
  theme,
}) => {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const listRef = useRef<FlatList<CountryData>>(null);

  const t: Required<PhoneInputTheme> = useMemo(
    () => ({ ...DEFAULT_PHONE_INPUT_THEME, ...(theme ?? {}) }),
    [theme],
  );

  const { keyboardHeight } = useKeyboard({ disableLayoutAnimation: true });
  const bottomSpacer =
    keyboardHeight > 0
      ? keyboardHeight + KEYBOARD_TOOLBAR_HEIGHT
      : insets.bottom;

  const filteredCountries = useMemo(() => {
    if (!search.trim()) return COUNTRIES;
    const query = search.toLowerCase().trim();
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.dialCode.includes(query) ||
        c.code.toLowerCase().includes(query),
    );
  }, [search]);

  const handleSearch = useCallback((text: string): void => {
    setSearch(text);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  const handleSelect = useCallback(
    (code: string): void => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onSelect(code);
      onClose();
      setSearch("");
    },
    [onSelect, onClose],
  );

  const handleClose = useCallback((): void => {
    setSearch("");
    onClose();
  }, [onClose]);

  const getItemLayout = useCallback(
    (_data: ArrayLike<CountryData> | null | undefined, index: number) => ({
      length: ROW_HEIGHT,
      offset: ROW_HEIGHT * index,
      index,
    }),
    [],
  );

  const keyExtractor = useCallback((item: CountryData) => item.code, []);

  // Render-time inline styles respecting the resolved theme.
  const containerStyle: ViewStyle = {
    ...styles.container,
    backgroundColor: t.backgroundPrimary,
  };
  const titleStyle: TextStyle = { ...styles.title, color: t.textPrimary };
  const searchContainerStyle: ViewStyle = {
    ...styles.searchContainer,
    backgroundColor: t.searchBackground,
  };
  const searchInputStyle: TextStyle = {
    ...styles.searchInput,
    color: t.textPrimary,
  };
  const countryNameStyle: TextStyle = {
    ...styles.countryName,
    color: t.textPrimary,
  };
  const dialCodeStyle: TextStyle = {
    ...styles.dialCode,
    color: t.textTertiary,
  };

  const renderItem = useCallback(
    ({ item }: { item: CountryData }) => {
      const isSelected = item.code === selectedCode;
      const rowPressedStyle: ViewStyle =
        Platform.OS === "ios"
          ? { backgroundColor: t.rowPressedBackground }
          : {};
      return (
        <Pressable
          style={({ pressed }) => [styles.row, pressed && rowPressedStyle]}
          onPress={() => handleSelect(item.code)}
          android_ripple={{ color: t.divider, borderless: false }}
          accessibilityRole="button"
          accessibilityLabel={`${item.name} ${item.dialCode}`}
        >
          <Text style={styles.flag}>{item.flag}</Text>
          <Text style={countryNameStyle} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={dialCodeStyle}>{item.dialCode}</Text>
          {isSelected ? (
            <View style={styles.checkmark}>
              {iconRenderer("checkmark", { size: 20, color: t.accent })}
            </View>
          ) : null}
        </Pressable>
      );
    },
    [
      selectedCode,
      handleSelect,
      iconRenderer,
      t.accent,
      t.divider,
      t.rowPressedBackground,
      countryNameStyle,
      dialCodeStyle,
    ],
  );

  return (
    <SafeAreaView style={containerStyle} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={titleStyle}>{labels.pickerTitle}</Text>
        <TouchableOpacity
          onPress={handleClose}
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel={labels.pickerCloseAccessibilityLabel}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {iconRenderer("close", { size: 24, color: t.textPrimary })}
        </TouchableOpacity>
      </View>

      <View style={searchContainerStyle}>
        <View style={styles.searchIcon}>
          {iconRenderer("search", { size: 20, color: t.textTertiary })}
        </View>
        <TextInput
          style={searchInputStyle}
          placeholder={labels.pickerSearchPlaceholder}
          placeholderTextColor={t.textTertiary}
          value={search}
          onChangeText={handleSearch}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>

      <FlatList
        ref={listRef}
        data={filteredCountries}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemLayout={getItemLayout}
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={true}
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={5}
      />

      <View style={{ height: bottomSpacer }} />
    </SafeAreaView>
  );
};

export const CountryPickerModal: React.FC<CountryPickerModalProps> = ({
  visible,
  selectedCode,
  onSelect,
  onClose,
  iconRenderer,
  labels,
  theme,
}) => {
  return (
    <Modal
      visible={visible}
      animationType={Platform.OS === "ios" ? "slide" : "fade"}
      presentationStyle="fullScreen"
      statusBarTranslucent
    >
      <KeyboardProvider>
        <SafeAreaProvider>
          <CountryPickerContent
            selectedCode={selectedCode}
            onSelect={onSelect}
            onClose={onClose}
            iconRenderer={iconRenderer}
            labels={labels}
            theme={theme}
          />
        </SafeAreaProvider>
        <KeyboardToolbar
          showArrows={false}
          theme={MINGLA_KEYBOARD_TOOLBAR_THEME}
        />
      </KeyboardProvider>
    </Modal>
  );
};

export const CountryPickerOverlay: React.FC<CountryPickerContentProps> = (
  props,
) => {
  const t: Required<PhoneInputTheme> = useMemo(
    () => ({ ...DEFAULT_PHONE_INPUT_THEME, ...(props.theme ?? {}) }),
    [props.theme],
  );
  const overlayStyle: ViewStyle = {
    ...styles.overlayContainer,
    backgroundColor: t.backgroundPrimary,
  };
  return (
    <View style={overlayStyle}>
      <SafeAreaProvider>
        <CountryPickerContent {...props} />
      </SafeAreaProvider>
    </View>
  );
};

const styles = StyleSheet.create({
  overlayContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    position: "relative",
  },
  title: {
    ...typography.lg,
    fontWeight: fontWeights.semibold,
  },
  closeButton: {
    position: "absolute",
    right: spacing.lg,
    width: touchTargets.minimum,
    height: touchTargets.minimum,
    alignItems: "center",
    justifyContent: "center",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    height: touchTargets.comfortable,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    ...typography.md,
    height: touchTargets.comfortable,
    padding: 0,
  },
  list: {
    flex: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    height: ROW_HEIGHT,
    paddingHorizontal: spacing.lg,
  },
  flag: {
    fontSize: 22,
    marginRight: spacing.sm,
  },
  countryName: {
    flex: 1,
    ...typography.md,
    fontWeight: fontWeights.regular,
  },
  dialCode: {
    ...typography.sm,
    fontWeight: fontWeights.regular,
    marginLeft: spacing.sm,
  },
  checkmark: {
    marginLeft: spacing.sm,
  },
});
