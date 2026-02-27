import React, { useState } from 'react';
import { Text, View, TouchableOpacity, StyleSheet, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatCurrency } from './utils/formatters';

interface PurchaseOption {
  id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  includes: string[];
  duration?: string;
  popular?: boolean;
  savings?: string;
}

interface PurchaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  recommendation: any;
  accountPreferences: any;
  onPurchaseComplete: (recommendation: any, option: PurchaseOption) => void;
}

const PurchaseModal: React.FC<PurchaseModalProps> = ({
  isOpen,
  onClose,
  recommendation,
  accountPreferences,
  onPurchaseComplete
}) => {
  const [selectedOption, setSelectedOption] = useState<PurchaseOption | null>(null);
  const [paymentStep, setPaymentStep] = useState<'selection' | 'payment' | 'processing' | 'success'>('selection');
  const [paymentMethod, setPaymentMethod] = useState<'apple' | 'card'>('apple');

  if (!isOpen || !recommendation) return null;

  const handleSelectOption = (option: PurchaseOption) => {
    setSelectedOption(option);
  };

  const handleProceedToPayment = () => {
    if (selectedOption) {
      setPaymentStep('payment');
    }
  };

  const handleProcessPayment = () => {
    if (!selectedOption) return;
    
    setPaymentStep('processing');
    
    // Simulate payment processing
    setTimeout(() => {
      setPaymentStep('success');
      
      // Auto-close and call completion handler after showing success
      setTimeout(() => {
        onPurchaseComplete(recommendation, selectedOption);
        onClose();
        // Reset state for next time
        setPaymentStep('selection');
        setSelectedOption(null);
      }, 2000);
    }, 2000);
  };

  const formatPrice = (price: number) => {
    return formatCurrency(price, accountPreferences?.currency || 'USD');
  };

  const renderSelectionStep = () => (
    <>
      {/* Fixed Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.headerTitle}>Choose Your Experience</Text>
            <Text style={styles.headerSubtitle}>{recommendation.title}</Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeButton}
          >
            <Ionicons name="close" size={20} color="#6b7280" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Scrollable Content */}
      <ScrollView style={styles.content}>
        <View style={styles.optionsContainer}>
          {recommendation.purchaseOptions.map((option: PurchaseOption) => (
            <TouchableOpacity
              key={option.id}
              onPress={() => handleSelectOption(option)}
              style={[
                styles.optionCard,
                selectedOption?.id === option.id ? styles.optionCardSelected : styles.optionCardDefault,
                option.popular ? styles.optionCardPopular : null
              ]}
            >
              {option.popular && (
                <View style={styles.popularBadge}>
                  <Text style={styles.popularBadgeText}>Most Popular</Text>
                </View>
              )}
              
              <View style={styles.optionContent}>
                <View style={styles.optionLeft}>
                  <View style={styles.optionHeader}>
                    <Text style={styles.optionTitle}>{option.title}</Text>
                    {selectedOption?.id === option.id && (
                      <View style={styles.selectedIndicator}>
                        <Ionicons name="checkmark" size={12} color="white" />
                      </View>
                    )}
                  </View>
                  <Text style={styles.optionDescription}>{option.description}</Text>
                  
                  <View style={styles.featuresContainer}>
                    {option.includes.map((feature, index) => (
                      <View key={index} style={styles.featureItem}>
                        <View style={styles.featureDot} />
                        <Text style={styles.featureText}>{feature}</Text>
                      </View>
                    ))}
                  </View>
                </View>
                
                <View style={styles.optionRight}>
                  <Text style={styles.optionPrice}>
                    {formatPrice(option.price)}
                  </Text>
                  {option.duration && (
                    <Text style={styles.optionDuration}>
                      {option.duration}
                    </Text>
                  )}
                  {option.savings && (
                    <Text style={styles.optionSavings}>
                      {option.savings}
                    </Text>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Fixed Footer */}
      <View style={styles.footer}>
        <TouchableOpacity
          onPress={handleProceedToPayment}
          disabled={!selectedOption}
          style={[
            styles.continueButton,
            selectedOption ? styles.continueButtonEnabled : styles.continueButtonDisabled
          ]}
        >
          <Text style={[
            styles.continueButtonText,
            selectedOption ? styles.continueButtonTextEnabled : styles.continueButtonTextDisabled
          ]}>
            Continue to Payment
          </Text>
        </TouchableOpacity>
      </View>
    </>
  );

  const renderPaymentStep = () => (
    <>
      {/* Fixed Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.headerTitle}>Complete Purchase</Text>
            <Text style={styles.headerSubtitle}>{selectedOption?.title}</Text>
          </View>
          <TouchableOpacity
            onPress={() => setPaymentStep('selection')}
            style={styles.closeButton}
          >
            <Ionicons name="close" size={20} color="#6b7280" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Scrollable Content */}
      <ScrollView style={styles.content}>
        <View style={styles.paymentContent}>
          {/* Order Summary */}
          <View style={styles.orderSummary}>
            <Text style={styles.orderSummaryTitle}>Order Summary</Text>
            <View style={styles.orderSummaryRow}>
              <Text style={styles.orderSummaryItem}>{recommendation.title}</Text>
              <Text style={styles.orderSummaryPrice}>
                {selectedOption && formatPrice(selectedOption.price)}
              </Text>
            </View>
            <View style={styles.orderSummaryRow}>
              <Text style={styles.orderSummarySubItem}>{selectedOption?.title}</Text>
            </View>
          </View>

          {/* Payment Methods */}
          <View style={styles.paymentMethodsContainer}>
            <Text style={styles.paymentMethodsTitle}>Payment Method</Text>
            
            <TouchableOpacity
              onPress={() => setPaymentMethod('apple')}
              style={[
                styles.paymentMethodCard,
                paymentMethod === 'apple' ? styles.paymentMethodCardSelected : styles.paymentMethodCardDefault
              ]}
            >
              <View style={styles.applePayIcon}>
                <Ionicons name="logo-apple" size={20} color="white" />
              </View>
              <View style={styles.paymentMethodContent}>
                <Text style={styles.paymentMethodTitle}>Apple Pay</Text>
                <Text style={styles.paymentMethodSubtitle}>Pay with Touch ID or Face ID</Text>
              </View>
              {paymentMethod === 'apple' && (
                <View style={styles.paymentMethodSelected}>
                  <Ionicons name="checkmark" size={12} color="white" />
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setPaymentMethod('card')}
              style={[
                styles.paymentMethodCard,
                paymentMethod === 'card' ? styles.paymentMethodCardSelected : styles.paymentMethodCardDefault
              ]}
            >
              <View style={styles.creditCardIcon}>
                <Ionicons name="card" size={20} color="white" />
              </View>
              <View style={styles.paymentMethodContent}>
                <Text style={styles.paymentMethodTitle}>Credit Card</Text>
                <Text style={styles.paymentMethodSubtitle}>•••• •••• •••• 4242</Text>
              </View>
              {paymentMethod === 'card' && (
                <View style={styles.paymentMethodSelected}>
                  <Ionicons name="checkmark" size={12} color="white" />
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Fixed Footer */}
      <View style={styles.footer}>
        <TouchableOpacity
          onPress={handleProcessPayment}
          style={styles.payButton}
        >
          {paymentMethod === 'apple' ? (
            <>
              <Ionicons name="logo-apple" size={20} color="white" />
              <Text style={styles.payButtonText}>Pay with Apple Pay</Text>
            </>
          ) : (
            <>
              <Ionicons name="card" size={20} color="white" />
              <Text style={styles.payButtonText}>Complete Purchase</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </>
  );

  const renderProcessingStep = () => (
    <View style={styles.processingContainer}>
      <View style={styles.processingSpinner}>
        <ActivityIndicator size="large" color="#eb7825" />
      </View>
      <Text style={styles.processingTitle}>Processing Payment...</Text>
      <Text style={styles.processingSubtitle}>Please wait while we secure your booking</Text>
    </View>
  );

  const renderSuccessStep = () => (
    <View style={styles.successContainer}>
      <View style={styles.successIcon}>
        <Ionicons name="checkmark" size={32} color="#10b981" />
      </View>
      <Text style={styles.successTitle}>Purchase Complete!</Text>
      <Text style={styles.successSubtitle}>
        {recommendation.title} has been added to your calendar
      </Text>
      <View style={styles.successMessage}>
        <Text style={styles.successMessageText}>
          You'll receive a confirmation email shortly with all the details.
        </Text>
      </View>
    </View>
  );

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <TouchableOpacity
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.modalContainer}>
          {paymentStep === 'selection' && renderSelectionStep()}
          {paymentStep === 'payment' && renderPaymentStep()}
          {paymentStep === 'processing' && renderProcessingStep()}
          {paymentStep === 'success' && renderSuccessStep()}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  modalContainer: {
    backgroundColor: 'white',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 16,
    flex: 1,
  },
  header: {
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  closeButton: {
    width: 32,
    height: 32,
    backgroundColor: '#f3f4f6',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  optionsContainer: {
    padding: 24,
    gap: 12,
  },
  optionCard: {
    position: 'relative',
    padding: 16,
    borderWidth: 2,
    borderRadius: 12,
  },
  optionCardDefault: {
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
  },
  optionCardSelected: {
    borderColor: '#eb7825',
    backgroundColor: '#fef3e2',
  },
  optionCardPopular: {
    borderColor: '#eb7825',
    borderWidth: 2,
  },
  popularBadge: {
    position: 'absolute',
    top: -8,
    left: 16,
    backgroundColor: '#eb7825',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  popularBadgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  optionLeft: {
    flex: 1,
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  optionTitle: {
    fontWeight: '600',
    color: '#111827',
    fontSize: 16,
  },
  selectedIndicator: {
    width: 20,
    height: 20,
    backgroundColor: '#eb7825',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionDescription: {
    color: '#6b7280',
    fontSize: 14,
    marginBottom: 12,
  },
  featuresContainer: {
    gap: 4,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  featureDot: {
    width: 4,
    height: 4,
    backgroundColor: '#eb7825',
    borderRadius: 2,
  },
  featureText: {
    fontSize: 14,
    color: '#374151',
  },
  optionRight: {
    alignItems: 'flex-end',
  },
  optionPrice: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  optionDuration: {
    fontSize: 14,
    color: '#6b7280',
  },
  optionSavings: {
    fontSize: 12,
    color: '#10b981',
    fontWeight: '500',
  },
  footer: {
    padding: 24,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: 'white',
  },
  continueButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  continueButtonEnabled: {
    backgroundColor: '#eb7825',
  },
  continueButtonDisabled: {
    backgroundColor: '#e5e7eb',
  },
  continueButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  continueButtonTextEnabled: {
    color: 'white',
  },
  continueButtonTextDisabled: {
    color: '#9ca3af',
  },
  paymentContent: {
    padding: 24,
  },
  orderSummary: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  orderSummaryTitle: {
    fontWeight: '600',
    color: '#111827',
    fontSize: 16,
    marginBottom: 8,
  },
  orderSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  orderSummaryItem: {
    color: '#374151',
    fontSize: 16,
  },
  orderSummaryPrice: {
    fontWeight: '600',
    color: '#111827',
    fontSize: 16,
  },
  orderSummarySubItem: {
    color: '#6b7280',
    fontSize: 14,
    marginTop: 4,
  },
  paymentMethodsContainer: {
    gap: 12,
  },
  paymentMethodsTitle: {
    fontWeight: '600',
    color: '#111827',
    fontSize: 16,
  },
  paymentMethodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderWidth: 2,
    borderRadius: 12,
  },
  paymentMethodCardDefault: {
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
  },
  paymentMethodCardSelected: {
    borderColor: '#eb7825',
    backgroundColor: '#fef3e2',
  },
  applePayIcon: {
    width: 32,
    height: 32,
    backgroundColor: '#000000',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creditCardIcon: {
    width: 32,
    height: 32,
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentMethodContent: {
    flex: 1,
  },
  paymentMethodTitle: {
    fontWeight: '600',
    color: '#111827',
    fontSize: 16,
  },
  paymentMethodSubtitle: {
    fontSize: 14,
    color: '#6b7280',
  },
  paymentMethodSelected: {
    width: 20,
    height: 20,
    backgroundColor: '#eb7825',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payButton: {
    width: '100%',
    backgroundColor: '#eb7825',
    paddingVertical: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  payButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  processingContainer: {
    padding: 24,
    alignItems: 'center',
  },
  processingSpinner: {
    width: 64,
    height: 64,
    backgroundColor: '#fef3e2',
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  processingTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  processingSubtitle: {
    color: '#6b7280',
    fontSize: 16,
  },
  successContainer: {
    padding: 24,
    alignItems: 'center',
  },
  successIcon: {
    width: 64,
    height: 64,
    backgroundColor: '#dcfce7',
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  successSubtitle: {
    color: '#6b7280',
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'center',
  },
  successMessage: {
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 12,
    padding: 16,
  },
  successMessageText: {
    fontSize: 14,
    color: '#166534',
    textAlign: 'center',
  },
});

export default PurchaseModal;