import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Pressable,
} from 'react-native';
import { Icon } from '../ui/Icon';
import { KeyboardAwareView } from '../ui/KeyboardAwareView';
import { useTranslation } from 'react-i18next';

interface EditBioSheetProps {
  visible: boolean;
  onClose: () => void;
  currentBio: string;
  onSave: (bio: string) => void;
}

const MAX_LENGTH = 160;

const EditBioSheet: React.FC<EditBioSheetProps> = ({
  visible,
  onClose,
  currentBio,
  onSave,
}) => {
  const { t } = useTranslation(['profile', 'common']);
  const [bioText, setBioText] = useState(currentBio);

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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <KeyboardAwareView
          style={styles.keyboardView}
          dismissOnTap={false}
        >
          <Pressable style={styles.card} onPress={() => {}}>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>{t('profile:edit_bio.title')}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close" size={24} color="#111827" />
              </TouchableOpacity>
            </View>

            <View style={styles.body}>
              <TextInput
                style={styles.input}
                value={bioText}
                onChangeText={setBioText}
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
              >
                <Text style={styles.saveText}>{t('profile:edit_bio.save')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </KeyboardAwareView>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  keyboardView: { justifyContent: 'flex-end' },
  card: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
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
