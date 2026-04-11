import React, { useState, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native'
import { Icon } from '../ui/Icon'
import * as Haptics from 'expo-haptics'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, LanguageData } from '../../constants/languages'
import {
  colors,
  typography,
  fontWeights,
  spacing,
  radius,
  touchTargets,
} from '../../constants/designSystem'

interface LanguageSelectionStepProps {
  selectedCode: string
  onSelect: (code: string) => void
}

const ROW_HEIGHT = 52

export const LanguageSelectionStep: React.FC<LanguageSelectionStepProps> = ({
  selectedCode,
  onSelect,
}) => {
  const { t } = useTranslation('onboarding')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return LANGUAGES
    const q = search.toLowerCase().trim()
    return LANGUAGES.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q)
    )
  }, [search])

  const handleSelect = useCallback(
    (code: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      onSelect(code)
    },
    [onSelect],
  )

  const getItemLayout = useCallback(
    (_data: ArrayLike<LanguageData> | null | undefined, index: number) => ({
      length: ROW_HEIGHT,
      offset: ROW_HEIGHT * index,
      index,
    }),
    [],
  )

  const keyExtractor = useCallback((item: LanguageData) => item.code, [])

  const renderItem = useCallback(
    ({ item }: { item: LanguageData }) => {
      const isSelected = item.code === selectedCode
      return (
        <TouchableOpacity
          style={[styles.row, isSelected && styles.rowSelected]}
          onPress={() => handleSelect(item.code)}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={`${item.nativeName} (${item.name})`}
          accessibilityState={{ selected: isSelected }}
        >
          <View style={styles.rowContent}>
            <Text style={[styles.nativeName, isSelected && styles.nativeNameSelected]} numberOfLines={1}>
              {item.nativeName}
            </Text>
            <Text style={[styles.englishName, isSelected && styles.englishNameSelected]} numberOfLines={1}>
              {item.name}
            </Text>
          </View>
          {isSelected && (
            <Icon
              name="checkmark"
              size={20}
              color={colors.primary[500]}
              style={styles.checkmark}
            />
          )}
        </TouchableOpacity>
      )
    },
    [selectedCode, handleSelect],
  )

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <Icon
          name="search-outline"
          size={20}
          color={colors.gray[400]}
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          placeholder={t('language.search_placeholder')}
          placeholderTextColor={colors.gray[400]}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>

      <FlatList
        data={filtered}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemLayout={getItemLayout}
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={true}
        scrollEnabled={false}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
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
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  rowSelected: {
    backgroundColor: colors.primary[50],
  },
  rowContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  nativeName: {
    ...typography.md,
    fontWeight: fontWeights.medium,
    color: colors.text.primary,
  },
  nativeNameSelected: {
    color: colors.primary[600],
    fontWeight: fontWeights.semibold,
  },
  englishName: {
    ...typography.sm,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
  },
  englishNameSelected: {
    color: colors.primary[400],
  },
  checkmark: {
    marginLeft: spacing.sm,
  },
})
