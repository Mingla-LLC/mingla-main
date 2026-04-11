import React, { useState, useCallback, useMemo, useRef } from 'react';
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
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../ui/Icon';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { COUNTRIES } from '../../constants/countries';
import { CountryData } from '../../types/onboarding';
import { useKeyboard } from '../../hooks/useKeyboard';
import {
  colors,
  typography,
  fontWeights,
  spacing,
  radius,
  touchTargets,
} from '../../constants/designSystem';

// ─── Shared props for the inner content ──────────────────────────────
interface CountryPickerContentProps {
  selectedCode: string;
  onSelect: (code: string) => void;
  onClose: () => void;
}

// ─── Modal-specific props ────────────────────────────────────────────
interface CountryPickerModalProps extends CountryPickerContentProps {
  visible: boolean;
}

const ROW_HEIGHT = 48;

// ═════════════════════════════════════════════════════════════════════
// CountryPickerContent — shared inner UI
// Used by both the Modal wrapper (standalone/onboarding) and the
// Overlay wrapper (embedded inside another Modal).
// ═════════════════════════════════════════════════════════════════════
const CountryPickerContent: React.FC<CountryPickerContentProps> = ({
  selectedCode,
  onSelect,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(['onboarding']);
  const [search, setSearch] = useState('');
  const listRef = useRef<FlatList<CountryData>>(null);

  // ── Keyboard awareness ─────────────────────────────────────────
  // disableLayoutAnimation: true — prevents the global LayoutAnimation
  // side-effect that leaks into other components (KeyboardAwareScrollView,
  // parent modals) and causes cascading keyboard show/hide cycles.
  const { keyboardHeight } = useKeyboard({ disableLayoutAnimation: true });
  const bottomSpacer = keyboardHeight > 0 ? keyboardHeight : insets.bottom;

  // ── Data ─────────────────────────────────────────────────────────
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

  // ── Handlers ─────────────────────────────────────────────────────
  const handleSearch = useCallback((text: string) => {
    setSearch(text);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  const handleSelect = useCallback(
    (code: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onSelect(code);
      onClose();
      setSearch('');
    },
    [onSelect, onClose],
  );

  const handleClose = useCallback(() => {
    setSearch('');
    onClose();
  }, [onClose]);

  // ── FlatList optimizations ───────────────────────────────────────
  const getItemLayout = useCallback(
    (_data: ArrayLike<CountryData> | null | undefined, index: number) => ({
      length: ROW_HEIGHT,
      offset: ROW_HEIGHT * index,
      index,
    }),
    [],
  );

  const keyExtractor = useCallback((item: CountryData) => item.code, []);

  const renderItem = useCallback(
    ({ item }: { item: CountryData }) => {
      const isSelected = item.code === selectedCode;
      return (
        <Pressable
          style={({ pressed }) => [
            styles.row,
            pressed && styles.rowPressed,
          ]}
          onPress={() => handleSelect(item.code)}
          android_ripple={{ color: colors.gray[200], borderless: false }}
          accessibilityRole="button"
          accessibilityLabel={`${item.name} ${item.dialCode}`}
        >
          <Text style={styles.flag}>{item.flag}</Text>
          <Text style={styles.countryName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.dialCode}>{item.dialCode}</Text>
          {isSelected && (
            <Icon
              name="checkmark"
              size={20}
              color={colors.primary[500]}
              style={styles.checkmark}
            />
          )}
        </Pressable>
      );
    },
    [selectedCode, handleSelect],
  );

  return (
    <SafeAreaView
      style={styles.container}
      edges={['top', 'left', 'right']}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Select Country</Text>
        <TouchableOpacity
          onPress={handleClose}
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding:country_picker.close_accessibility')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="close" size={24} color={colors.text.primary} />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <Icon
          name="search-outline"
          size={20}
          color={colors.gray[400]}
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          placeholder={t('onboarding:country_picker.search_placeholder')}
          placeholderTextColor={colors.gray[400]}
          value={search}
          onChangeText={handleSearch}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>

      {/* Country list — flex:1 shrinks when spacer grows */}
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

      {/* Bottom spacer: keyboard height when open, safe area when closed. */}
      <View style={{ height: bottomSpacer }} />
    </SafeAreaView>
  );
};

// ═════════════════════════════════════════════════════════════════════
// CountryPickerModal — wraps content in a native <Modal>.
// Use this in standalone contexts (onboarding, AddFriendView) where
// there is NO parent Modal. Do NOT use inside another Modal — use
// CountryPickerOverlay instead to avoid nested Android Dialogs.
// ═════════════════════════════════════════════════════════════════════
export const CountryPickerModal: React.FC<CountryPickerModalProps> = ({
  visible,
  selectedCode,
  onSelect,
  onClose,
}) => {
  return (
    <Modal
      visible={visible}
      animationType={Platform.OS === 'ios' ? 'slide' : 'fade'}
      presentationStyle="fullScreen"
      statusBarTranslucent
    >
      <SafeAreaProvider>
        <CountryPickerContent
          selectedCode={selectedCode}
          onSelect={onSelect}
          onClose={onClose}
        />
      </SafeAreaProvider>
    </Modal>
  );
};

// ═════════════════════════════════════════════════════════════════════
// CountryPickerOverlay — renders content as an absolute-fill View.
// Use this when the picker must appear inside an EXISTING Modal
// (e.g. CollaborationModule's bottom sheet). Avoids creating a nested
// Android Dialog, which is slow to create and can cause keyboard
// show/hide cascades. The overlay fills the entire parent Modal window
// and renders above all other content via zIndex / elevation.
// ═════════════════════════════════════════════════════════════════════
export const CountryPickerOverlay: React.FC<CountryPickerContentProps> = ({
  selectedCode,
  onSelect,
  onClose,
}) => {
  return (
    <View style={styles.overlayContainer}>
      <SafeAreaProvider>
        <CountryPickerContent
          selectedCode={selectedCode}
          onSelect={onSelect}
          onClose={onClose}
        />
      </SafeAreaProvider>
    </View>
  );
};

const styles = StyleSheet.create({
  // ── Overlay wrapper ──────────────────────────────────────────────
  overlayContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: colors.background.primary,
  },
  // ── Shared content styles ────────────────────────────────────────
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    position: 'relative',
  },
  title: {
    ...typography.lg,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  closeButton: {
    position: 'absolute',
    right: spacing.lg,
    width: touchTargets.minimum,
    height: touchTargets.minimum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    height: touchTargets.comfortable,
    borderRadius: radius.md,
    backgroundColor: colors.gray[100],
    paddingHorizontal: spacing.md,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    ...typography.md,
    color: colors.text.primary,
    height: touchTargets.comfortable,
    padding: 0,
  },
  list: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ROW_HEIGHT,
    paddingHorizontal: spacing.lg,
  },
  rowPressed: {
    backgroundColor: Platform.OS === 'ios' ? colors.gray[100] : undefined,
  },
  flag: {
    fontSize: 22,
    marginRight: spacing.sm,
  },
  countryName: {
    flex: 1,
    ...typography.md,
    fontWeight: fontWeights.regular,
    color: colors.text.primary,
  },
  dialCode: {
    ...typography.sm,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
    marginLeft: spacing.sm,
  },
  checkmark: {
    marginLeft: spacing.sm,
  },
});
