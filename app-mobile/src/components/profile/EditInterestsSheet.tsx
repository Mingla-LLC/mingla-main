import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Pressable,
} from 'react-native';
import { X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { ONBOARDING_INTENTS } from '../../types/onboarding';
import { categories } from '../../constants/categories';
import { INTENT_ICON_MAP, CATEGORY_ICON_MAP } from '../../constants/interestIcons';
import { useTranslation } from 'react-i18next';

interface EditInterestsSheetProps {
  visible: boolean;
  onClose: () => void;
  currentIntents: string[];
  currentCategories: string[];
  onSave: (intents: string[], categories: string[]) => void;
}

const EditInterestsSheet: React.FC<EditInterestsSheetProps> = ({
  visible,
  onClose,
  currentIntents,
  currentCategories,
  onSave,
}) => {
  const { t } = useTranslation(['profile', 'common']);
  const [selectedIntents, setSelectedIntents] = useState<string[]>(currentIntents);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(currentCategories);

  const hasChanged = useMemo(() => {
    const intentsMatch =
      selectedIntents.length === currentIntents.length &&
      selectedIntents.every((id) => currentIntents.includes(id));
    const catsMatch =
      selectedCategories.length === currentCategories.length &&
      selectedCategories.every((s) => currentCategories.includes(s));
    return !intentsMatch || !catsMatch;
  }, [selectedIntents, selectedCategories, currentIntents, currentCategories]);

  const toggleIntent = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedIntents((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  };

  const toggleCategory = (name: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedCategories((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name],
    );
  };

  const handleSave = () => {
    onSave(selectedIntents, selectedCategories);
    onClose();
  };

  // Reset local state when modal opens
  React.useEffect(() => {
    if (visible) {
      setSelectedIntents(currentIntents);
      setSelectedCategories(currentCategories);
    }
  }, [visible, currentIntents, currentCategories]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t('profile:edit_interests.title')}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={24} color="#111827" strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionTitle}>{t('profile:edit_interests.what_are_you_into')}</Text>
            <View style={styles.pillsWrap}>
              {ONBOARDING_INTENTS.map((intent) => {
                const selected = selectedIntents.includes(intent.id);
                const IconComponent = INTENT_ICON_MAP[intent.id];
                return (
                  <TouchableOpacity
                    key={intent.id}
                    style={[
                      styles.intentPill,
                      selected
                        ? { backgroundColor: intent.color }
                        : styles.unselectedPill,
                    ]}
                    onPress={() => toggleIntent(intent.id)}
                    activeOpacity={0.7}
                  >
                    {IconComponent && (
                      <IconComponent
                        size={16}
                        color={selected ? '#ffffff' : '#374151'}
                        strokeWidth={2.5}
                        style={styles.pillIcon}
                      />
                    )}
                    <Text style={[styles.pillText, selected ? styles.selectedText : styles.unselectedText]}>
                      {intent.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.sectionTitle}>{t('profile:edit_interests.what_do_you_like')}</Text>
            <View style={styles.pillsWrap}>
              {categories.map((cat) => {
                const selected = selectedCategories.includes(cat.slug);
                const CatIcon = CATEGORY_ICON_MAP[cat.slug];
                return (
                  <TouchableOpacity
                    key={cat.slug}
                    style={[
                      styles.categoryPill,
                      selected ? styles.selectedCategoryPill : styles.unselectedPill,
                    ]}
                    onPress={() => toggleCategory(cat.slug)}
                    activeOpacity={0.7}
                  >
                    {CatIcon && (
                      <CatIcon
                        size={16}
                        color={selected ? '#ffffff' : '#374151'}
                        strokeWidth={2}
                        style={styles.catPillIcon}
                      />
                    )}
                    <Text style={[styles.pillText, selected ? styles.selectedText : styles.unselectedText]}>
                      {t(`common:category_${cat.slug}`)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.scrollPadding} />
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.saveButton, !hasChanged && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={!hasChanged}
              activeOpacity={0.8}
            >
              <Text style={styles.saveText}>{t('profile:edit_interests.save')}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
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
  card: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
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
  scroll: { paddingHorizontal: 24 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#111827', marginTop: 16, marginBottom: 10 },
  pillsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  intentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  catPillIcon: { marginRight: 6 },
  selectedCategoryPill: { backgroundColor: '#eb7825' },
  unselectedPill: { borderWidth: 1, borderColor: '#d1d5db' },
  pillIcon: { marginRight: 6 },
  pillText: { fontSize: 14 },
  selectedText: { color: '#ffffff', fontWeight: '600' },
  unselectedText: { color: '#374151' },
  scrollPadding: { height: 16 },
  footer: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 34 },
  saveButton: {
    backgroundColor: '#eb7825',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.5 },
  saveText: { fontSize: 16, fontWeight: '700', color: '#ffffff' },
});

export default EditInterestsSheet;
