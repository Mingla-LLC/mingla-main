import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  Modal,
  StyleSheet,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { COUNTRIES } from '../../constants/countries';
import { CountryData } from '../../types/onboarding';
import {
  colors,
  typography,
  fontWeights,
  spacing,
  radius,
  touchTargets,
} from '../../constants/designSystem';

interface CountryPickerModalProps {
  visible: boolean;
  selectedCode: string;
  onSelect: (code: string) => void;
  onClose: () => void;
}

const ROW_HEIGHT = 48;

export const CountryPickerModal: React.FC<CountryPickerModalProps> = ({
  visible,
  selectedCode,
  onSelect,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');

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

  const getItemLayout = useCallback(
    (_data: CountryData[] | null | undefined, index: number) => ({
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
        <TouchableOpacity
          style={styles.row}
          onPress={() => handleSelect(item.code)}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={`${item.name} ${item.dialCode}`}
        >
          <Text style={styles.flag}>{item.flag}</Text>
          <Text style={styles.countryName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.dialCode}>{item.dialCode}</Text>
          {isSelected && (
            <Ionicons
              name="checkmark"
              size={20}
              color={colors.primary[500]}
              style={styles.checkmark}
            />
          )}
        </TouchableOpacity>
      );
    },
    [selectedCode, handleSelect],
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" statusBarTranslucent>
      <SafeAreaView style={[styles.container, { paddingBottom: insets.bottom }]} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <Text style={styles.title}>Select Country</Text>
          <TouchableOpacity
            onPress={handleClose}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel="Close country picker"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close" size={24} color={colors.text.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.searchContainer}>
          <Ionicons
            name="search-outline"
            size={20}
            color={colors.gray[400]}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, code, or dial code"
            placeholderTextColor={colors.gray[400]}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
        </View>

        <FlatList
          data={filteredCountries}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          getItemLayout={getItemLayout}
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={true}
        />
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
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
