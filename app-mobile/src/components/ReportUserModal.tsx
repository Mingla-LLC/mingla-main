import React, { useState } from 'react';
import { Text, View, TouchableOpacity, StyleSheet, Modal, ScrollView, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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

const reportOptions = [
  {
    id: 'spam',
    label: 'Spam',
    description: 'Unwanted or repetitive messages',
    icon: 'chatbubbles',
    color: '#ea580c'
  },
  {
    id: 'inappropriate-content',
    label: 'Inappropriate Content',
    description: 'Offensive or inappropriate behavior',
    icon: 'warning',
    color: '#dc2626'
  },
  {
    id: 'harassment',
    label: 'Harassment',
    description: 'Bullying or threatening behavior',
    icon: 'shield',
    color: '#7c3aed'
  },
  {
    id: 'other',
    label: 'Other',
    description: 'Another reason not listed above',
    icon: 'document-text',
    color: '#6b7280'
  }
];

export default function ReportUserModal({ isOpen, onClose, user, onReport }: ReportUserModalProps) {
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [additionalDetails, setAdditionalDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

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

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
          <TouchableOpacity
            style={styles.backdropTouch}
            activeOpacity={1}
            onPress={handleClose}
          />
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerSidePlaceholder} />
            <View style={styles.headerCenter}>
              <View style={styles.iconContainer}>
                <Ionicons name="flag" size={20} color="#dc2626" />
              </View>
              <Text style={styles.headerTitle}>Report User</Text>
              <Text style={styles.headerSubtitle}>@{user.username}</Text>
            </View>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={20} color="#9ca3af" />
            </TouchableOpacity>
          </View>

        {/* Content */}
        <ScrollView style={styles.content}>
          <View style={styles.descriptionContainer}>
            <Text style={styles.description}>
              We take reports seriously. Please select the reason that best describes why you're reporting <Text style={styles.boldText}>{user.name}</Text>.
            </Text>
            <Text style={styles.subDescription}>
              This user will be blocked and will no longer be able to contact you.
            </Text>
          </View>

          {/* Report Options */}
          <View style={styles.optionsContainer}>
            <Text style={styles.optionsTitle}>Reason for reporting:</Text>
            {reportOptions.map((option) => (
              <TouchableOpacity
                key={option.id}
                onPress={() => setSelectedReason(option.id)}
                style={[
                  styles.optionButton,
                  selectedReason === option.id ? styles.optionButtonSelected : styles.optionButtonDefault
                ]}
              >
                <View style={styles.optionContent}>
                  <Ionicons 
                    name={option.icon as any} 
                    size={20} 
                    color={selectedReason === option.id ? '#eb7825' : option.color}
                    style={styles.optionIcon}
                  />
                  <View style={styles.optionTextContainer}>
                    <Text style={[
                      styles.optionLabel,
                      selectedReason === option.id ? styles.optionLabelSelected : styles.optionLabelDefault
                    ]}>
                      {option.label}
                    </Text>
                    <Text style={styles.optionDescription}>
                      {option.description}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          {/* Additional Details */}
          {selectedReason && (
            <View style={styles.detailsContainer}>
              <Text style={styles.detailsTitle}>
                Additional details (optional):
              </Text>
              <TextInput
                value={additionalDetails}
                onChangeText={setAdditionalDetails}
                placeholder="Please provide any additional context that might help us review this report..."
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
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <TouchableOpacity
            onPress={handleClose}
            style={styles.cancelButton}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
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
              {isSubmitting ? 'Submitting...' : 'Submit Report'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Disclaimer */}
        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerText}>
            Reports are reviewed by our moderation team. False reports may result in action on your account.
          </Text>
        </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  modalContainer: {
    backgroundColor: 'white',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    width: '100%',
    minHeight: '95%',
    overflow: 'hidden',
  },
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