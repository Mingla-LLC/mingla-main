/**
 * ReportUserModal
 *
 * META-ORCH-0991 Wave B — migrated from a hand-rolled RN <Modal> (fade,
 * flex-end, minHeight 95%) onto BaseBottomSheet. It is now a true swipe-down
 * bottom sheet that rolls up and pan-dismisses exactly like
 * ExpandedBusinessEventSheet. Snap height ['90%'] preserves the prior 95%
 * minHeight feel. The report-reason form has a free-text "additional details"
 * field, so the TextInput is swapped to gorhom's BottomSheetTextInput
 * (re-exported from BaseBottomSheet) and the sheet runs keyboardBehavior
 * 'interactive' so the field is never hidden by the keyboard. The fixed header
 * + scrolling options/details body + pinned footer + disclaimer map onto the
 * primitive's header / scroll body / stickyFooter slots. Opened from
 * FriendActionsSheet / ConnectionsPage over the chat surface, so it sets
 * wrapInRNModal for z-stacking above the in-tree tab bar (ORCH-0908). All copy,
 * report options, callbacks, block-after-report logic, and analytics preserved.
 */

import React, { useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { TrackedTouchableOpacity } from './TrackedTouchableOpacity';
import { useTranslation } from 'react-i18next';
import { Icon } from './ui/Icon';
import { BaseBottomSheet, BottomSheetTextInput } from './ui/BaseBottomSheet';
import { blockUser, BlockReason } from '../services/blockService';

interface ReportUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: {
    id: string;
    name: string;
    username: string;
  };
  onReport: (userId: string, reason: string, details?: string) => void | Promise<void>;
}

// META-ORCH-0991 Wave B — single tall snap. Preserves the prior 95%-minHeight
// feel of the report form (it has a description, four reason cards, and an
// expanding details field) while leaving a sliver of backdrop to signal
// swipe-down-to-dismiss.
const REPORT_SNAP_POINTS = ['90%'];

const REPORT_OPTION_KEYS = [
  { id: 'spam', labelKey: 'social:spam', descKey: 'social:spamDescription', icon: 'chatbubbles', color: '#ea580c' },
  { id: 'inappropriate-content', labelKey: 'social:inappropriateContent', descKey: 'social:inappropriateContentDescription', icon: 'warning', color: '#dc2626' },
  { id: 'harassment', labelKey: 'social:harassment', descKey: 'social:harassmentDescription', icon: 'shield', color: '#7c3aed' },
  { id: 'other', labelKey: 'social:other', descKey: 'social:otherDescription', icon: 'document-text', color: '#6b7280' },
];

export default function ReportUserModal({ isOpen, onClose, user, onReport }: ReportUserModalProps) {
  const { t } = useTranslation(['social', 'common']);
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [additionalDetails, setAdditionalDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!selectedReason || isSubmitting) return;
    
    setIsSubmitting(true);
    
    try {
      // Call the parent's onReport handler (which handles the actual API call)
      await onReport(user.id, selectedReason, additionalDetails || undefined);
      
      // Block the user after report is submitted
      // Map report reasons to block reasons
      const blockReasonMap: Record<string, BlockReason> = {
        'spam': 'spam',
        'inappropriate-content': 'inappropriate',
        'harassment': 'harassment',
        'other': 'other',
      };
      const blockReason = blockReasonMap[selectedReason] || 'other';
      
      const blockResult = await blockUser(user.id, blockReason);
      if (!blockResult.success) {
        console.warn('Failed to block user after report:', blockResult.error);
      }
      
      // Reset form state after successful submission
      setSelectedReason('');
      setAdditionalDetails('');
    } catch (error) {
      console.error('Error in report submission:', error);
    } finally {
      setIsSubmitting(false);
      // Note: Parent component handles closing the modal and showing confirmation
    }
  };

  const handleClose = () => {
    if (isSubmitting) return; // Prevent closing while submitting
    setSelectedReason('');
    setAdditionalDetails('');
    onClose();
  };

  // META-ORCH-0991 Wave B — fixed header (title + close), pinned to the top of
  // the sheet above the scrolling reason/details body.
  const header = (
    <View style={styles.header}>
      <View style={styles.headerSidePlaceholder} />
      <View style={styles.headerCenter}>
        <View style={styles.iconContainer}>
          <Icon name="flag" size={20} color="#dc2626" />
        </View>
        <Text style={styles.headerTitle}>{t('social:reportUserTitle')}</Text>
      </View>
      <TrackedTouchableOpacity logComponent="ReportUserModal"
        onPress={handleClose}
        style={styles.closeButton}
      >
        <Icon name="close" size={20} color="#9ca3af" />
      </TrackedTouchableOpacity>
    </View>
  );

  // Pinned footer: submit/cancel actions + the reporting disclaimer. Stays
  // visible above the keyboard while the details field is focused.
  const footer = (
    <View>
      <View style={styles.footer}>
        <TrackedTouchableOpacity logComponent="ReportUserModal"
          onPress={handleClose}
          style={styles.cancelButton}
        >
          <Text style={styles.cancelButtonText}>{t('social:cancel')}</Text>
        </TrackedTouchableOpacity>
        <TrackedTouchableOpacity logComponent="ReportUserModal"
          onPress={handleSubmit}
          disabled={!selectedReason || isSubmitting}
          style={[
            styles.submitButton,
            selectedReason && !isSubmitting ? styles.submitButtonEnabled : styles.submitButtonDisabled
          ]}
        >
          <Text style={[
            styles.submitButtonText,
            selectedReason && !isSubmitting ? styles.submitButtonTextEnabled : styles.submitButtonTextDisabled
          ]}>
            {isSubmitting ? t('social:submitting') : t('social:submitReport')}
          </Text>
        </TrackedTouchableOpacity>
      </View>
      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>
          {t('social:reportDisclaimer')}
        </Text>
      </View>
    </View>
  );

  return (
    <BaseBottomSheet
      visible={isOpen}
      onClose={handleClose}
      theme="light"
      snapPoints={REPORT_SNAP_POINTS}
      scrollMode="scroll"
      wrapInRNModal
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      header={header}
      stickyFooter={footer}
      scrollProps={{ keyboardShouldPersistTaps: 'handled', style: styles.content }}
      accessibilityLabel={t('social:reportUserTitle')}
    >
          <View style={styles.descriptionContainer}>
            <Text style={styles.description}>
              {t('social:reportDescription', { name: user.name })}
            </Text>
            <Text style={styles.subDescription}>
              {t('social:reportBlockNotice')}
            </Text>
          </View>

          {/* Report Options */}
          <View style={styles.optionsContainer}>
            <Text style={styles.optionsTitle}>{t('social:reasonForReporting')}</Text>
            {REPORT_OPTION_KEYS.map((option) => (
              <TrackedTouchableOpacity logComponent="ReportUserModal"
                key={option.id}
                onPress={() => setSelectedReason(option.id)}
                style={[
                  styles.optionButton,
                  selectedReason === option.id ? styles.optionButtonSelected : styles.optionButtonDefault
                ]}
              >
                <View style={styles.optionContent}>
                  <Icon
                    name={option.icon}
                    size={20}
                    color={selectedReason === option.id ? '#eb7825' : option.color}
                    style={styles.optionIcon}
                  />
                  <View style={styles.optionTextContainer}>
                    <Text style={[
                      styles.optionLabel,
                      selectedReason === option.id ? styles.optionLabelSelected : styles.optionLabelDefault
                    ]}>
                      {t(option.labelKey)}
                    </Text>
                    <Text style={styles.optionDescription}>
                      {t(option.descKey)}
                    </Text>
                  </View>
                </View>
              </TrackedTouchableOpacity>
            ))}
          </View>

          {/* Additional Details */}
          {selectedReason && (
            <View style={styles.detailsContainer}>
              <Text style={styles.detailsTitle}>
                {t('social:additionalDetails')}
              </Text>
              <BottomSheetTextInput
                value={additionalDetails}
                onChangeText={setAdditionalDetails}
                placeholder={t('social:additionalDetailsPlaceholder')}
                style={styles.textInput}
                multiline={true}
                numberOfLines={3}
                maxLength={500}
                textAlignVertical="top"
              />
              <Text style={styles.characterCount}>
                {additionalDetails.length}/500
              </Text>
            </View>
          )}
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  // META-ORCH-0991 Wave B — scrim, rounded top, and width now come from
  // BaseBottomSheet's light-theme chrome (glass.notificationsSheet, topRadius
  // 28). The former `overlay` / `backdropTouch` / `modalContainer` shells are
  // gone; the sheet provides the backdrop (press-to-close) and pan-down.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  iconContainer: {
    width: 40,
    height: 40,
    backgroundColor: '#fef2f2',
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginTop: 2,
    textAlign: 'center',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSidePlaceholder: {
    width: 36,
    height: 36,
  },
  content: {
    flex: 1,
    padding: 24,
  },
  descriptionContainer: {
    marginBottom: 24,
  },
  description: {
    fontSize: 16,
    color: '#374151',
    lineHeight: 24,
    marginBottom: 16,
  },
  boldText: {
    fontWeight: '600',
  },
  subDescription: {
    fontSize: 14,
    color: '#6b7280',
  },
  optionsContainer: {
    marginBottom: 24,
  },
  optionsTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
    marginBottom: 12,
  },
  optionButton: {
    width: '100%',
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    marginBottom: 12,
  },
  optionButtonDefault: {
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
  },
  optionButtonSelected: {
    borderColor: '#eb7825',
    backgroundColor: '#fef3e7',
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  optionIcon: {
    marginTop: 2,
  },
  optionTextContainer: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  optionLabelDefault: {
    color: '#111827',
  },
  optionLabelSelected: {
    color: '#eb7825',
  },
  optionDescription: {
    fontSize: 14,
    color: '#6b7280',
  },
  detailsContainer: {
    marginBottom: 24,
  },
  detailsTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
    marginBottom: 8,
  },
  textInput: {
    width: '100%',
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    fontSize: 16,
    color: '#111827',
    backgroundColor: 'white',
    minHeight: 80,
  },
  characterCount: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'right',
    marginTop: 4,
  },
  footer: {
    padding: 24,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#374151',
  },
  submitButton: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonEnabled: {
    backgroundColor: '#dc2626',
  },
  submitButtonDisabled: {
    backgroundColor: '#e5e7eb',
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  submitButtonTextEnabled: {
    color: 'white',
  },
  submitButtonTextDisabled: {
    color: '#9ca3af',
  },
  disclaimer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  disclaimerText: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 16,
  },
});