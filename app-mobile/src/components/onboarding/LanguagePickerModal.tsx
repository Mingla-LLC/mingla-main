import React, { useState, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  Modal,
  StyleSheet,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon } from '../ui/Icon'
import * as Haptics from 'expo-haptics'
import { useKeyboard } from '../../hooks/useKeyboard'
import { LANGUAGES, LanguageData } from '../../constants/languages'
import {
  colors,
  typography,
  fontWeights,
  spacing,
  radius,
  touchTargets,
} from '../../constants/designSystem'

interface LanguagePickerModalProps {
  visible: boolean
  selectedCode: string
  onSelect: (code: string) => void
  onClose: () => void
}

const ROW_HEIGHT = 52

export const LanguagePickerModal: React.FC<LanguagePickerModalProps> = ({
  visible,
  selectedCode,
  onSelect,
  onClose,
}) => {
  const insets = useSafeAreaInsets()
  const [search, setSearch] = useState('')

  // Keyboard awareness — match CountryPickerModal gold standard
  const { keyboardHeight } = useKeyboard({ disableLayoutAnimation: true })
  const bottomSpacer = keyboardHeight > 0 ? keyboardHeight : insets.bottom

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
      onClose()
      setSearch('')
    },
    [onSelect, onClose],
  )

  const handleClose = useCallback(() => {
    setSearch('')
    onClose()
  }, [onClose])

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
          style={styles.row}
          onPress={() => handleSelect(item.code)}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={`${item.nativeName} (${item.name})`}
        >
          <View style={styles.rowContent}>
            <Text style={styles.nativeName} numberOfLines={1}>
              {item.nativeName}
            </Text>
            <Text style={styles.englishName} numberOfLines={1}>
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
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <SafeAreaView style={[styles.container, { paddingBottom: insets.bottom }]} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <Text style={styles.title}>Select Language</Text>
          <TouchableOpacity
            onPress={handleClose}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel="Close language picker"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="close" size={24} color={colors.text.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.searchContainer}>
          <Icon
            name="search-outline"
            size={20}
            color={colors.gray[400]}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search languages..."
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
        />
        {/* Bottom spacer: keyboard height when open, safe area when closed */}
        <View style={{ height: bottomSpacer }} />
      </SafeAreaView>
    </Modal>
  )
}

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
  englishName: {
    ...typography.sm,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
  },
  checkmark: {
    marginLeft: spacing.sm,
  },
})
