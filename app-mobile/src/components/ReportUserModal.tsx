import React, { useState } from 'react';
import { Text, View, TouchableOpacity, StyleSheet, Modal, ScrollView, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ReportUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: {
    id: string;
    name: string;
    username: string;
  };
  onReport: (userId: string, reason: string, details?: string) => void;
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
    if (!selectedReason) return;
    
    setIsSubmitting(true);
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    onReport(user.id, selectedReason, additionalDetails || undefined);
    
    // Reset form
    setSelectedReason('');
    setAdditionalDetails('');
    setIsSubmitting(false);
    onClose();
  };

  const handleClose = () => {
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
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <View style={styles.iconContainer}>
                <Ionicons name="flag" size={20} color="#dc2626" />
              </View>
              <View>
                <Text style={styles.headerTitle}>Report User</Text>
                <Text style={styles.headerSubtitle}>@{user.username}</Text>
              </View>
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
              This user has been blocked and will no longer be able to contact you.
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
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 96,
  },
  modalContainer: {
    backgroundColor: 'white',
    borderRadius: 16,
    maxWidth: 400,
    width: '100%',
    maxHeight: '90%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#6b7280',
  },
  closeButton: {
    padding: 8,
    borderRadius: 8,
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