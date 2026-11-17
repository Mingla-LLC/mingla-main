import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { Icon } from '../ui/Icon';
import { BaseBottomSheet, BottomSheetTextInput } from '../ui/BaseBottomSheet';
import { useTranslation } from 'react-i18next';

interface EditBioSheetProps {
  visible: boolean;
  onClose: () => void;
  currentBio: string;
  onSave: (bio: string) => void;
}

const MAX_LENGTH = 160;

// META-ORCH-0991 Wave B Batch 2: compact, content-height form (header + one
// textarea + counter + save). enableDynamicSizing lets the sheet open at the
// content's natural height rather than forcing a tall snap — preserves the prior
// flex-end card's compact feel while becoming a true swipe-down sheet.
//
// #4456: the body used to be `scrollMode="view"`, a plain View that gorhom's
// dynamic sizing cannot measure, so the sheet never opened while its RN Modal
// window swallowed every touch (Profile froze). Header, input and Save now
// live in one measurable BottomSheetScrollView (the TicketCart pattern), capped
// like the chat sheets; BaseBottomSheet closes any such sheet that still fails
// to open.
export const EDIT_BIO_SNAP_POINTS = ['86%'] as const;
export const EDIT_BIO_SCROLL_PROPS = { keyboardShouldPersistTaps: 'handled' as const };
const EditBioSheet: React.FC<EditBioSheetProps> = ({
  visible,
  onClose,
  currentBio,
  onSave,
}) => {
  const { t } = useTranslation(['profile', 'common']);
  const [bioText, setBioText] = useState(currentBio);
  const { height: windowHeight } = useWindowDimensions();

  useEffect(() => {
    if (visible) setBioText(currentBio);
  }, [visible, currentBio]);

  const hasChanged = bioText !== currentBio;
  const atLimit = bioText.length >= MAX_LENGTH;

  const handleSave = () => {
    onSave(bioText.trim());
    onClose();
  };

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onClose}
      theme="light"
      snapPoints={EDIT_BIO_SNAP_POINTS as unknown as string[]}
      enableDynamicSizing
      maxDynamicContentSize={Math.round(windowHeight * 0.86)}
      scrollMode="scroll"
      scrollProps={EDIT_BIO_SCROLL_PROPS}
      wrapInRNModal
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      accessibilityLabel={t('profile:edit_bio.title')}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('profile:edit_bio.title')}</Text>
        <TouchableOpacity
          onPress={onClose}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={t('common:close')}
          testID="edit-bio-close"
        >
          <Icon name="close" size={24} color="#111827" />
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        <BottomSheetTextInput
          style={styles.input}
          value={bioText}
          onChangeText={setBioText}
          testID="edit-bio-input"
          maxLength={MAX_LENGTH}
          multiline
          numberOfLines={4}
          placeholder={t('profile:edit_bio.placeholder')}
          placeholderTextColor="#9ca3af"
          textAlignVertical="top"
        />
        <Text style={[styles.counter, atLimit && styles.counterLimit]}>
          {bioText.length}/{MAX_LENGTH}
        </Text>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveButton, !hasChanged && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={!hasChanged}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ disabled: !hasChanged }}
          testID="edit-bio-save"
        >
          <Text style={styles.saveText}>{t('profile:edit_bio.save')}</Text>
        </TouchableOpacity>
      </View>
    </BaseBottomSheet>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  body: { paddingHorizontal: 24 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    color: '#111827',
    height: 100,
  },
  counter: { fontSize: 13, color: '#6b7280', textAlign: 'right', marginTop: 6 },
  counterLimit: { color: '#ef4444' },
  footer: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 34 },
  saveButton: {
    backgroundColor: '#eb7825',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.5 },
  saveText: { fontSize: 16, fontWeight: '700', color: '#ffffff' },
});

export default EditBioSheet;
