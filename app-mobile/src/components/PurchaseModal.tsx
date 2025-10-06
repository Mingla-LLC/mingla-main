import React, { useState } from 'react';
import { Text, View, TouchableOpacity } from 'react-native';
import { X, Check, CreditCard, Apple, Smartphone } from 'lucide-react';
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
      <View className="sticky top-0 z-10 bg-white border-b border-gray-200 p-6">
        <View className="flex items-center justify-between">
          <View>
            <Text className="text-xl font-semibold text-gray-900">Choose Your Experience</Text>
            <Text className="text-gray-600 mt-1">{recommendation.title}</Text>
          </View>
          <TouchableOpacity
            onClick={onClose}
            className="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-gray-600" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Scrollable Content */}
      <View className="flex-1 overflow-y-auto p-6 pt-0">
        <View className="space-y-3 mt-6">
          {recommendation.purchaseOptions.map((option: PurchaseOption) => (
            <View
              key={option.id}
              onClick={() => handleSelectOption(option)}
              className={`relative p-4 border-2 rounded-xl cursor-pointer transition-all ${
                selectedOption?.id === option.id
                  ? 'border-[#eb7825] bg-orange-50'
                  : 'border-gray-200 hover:border-gray-300'
              } ${option.popular ? 'ring-2 ring-[#eb7825] ring-opacity-20' : ''}`}
            >
              {option.popular && (
                <View className="absolute -top-2 left-4 bg-[#eb7825] text-white px-3 py-1 rounded-full text-xs font-semibold">
                  Most Popular
                </View>
              )}
              
              <View className="flex items-start justify-between">
                <View className="flex-1">
                  <View className="flex items-center gap-2 mb-1">
                    <Text className="font-semibold text-gray-900">{option.title}</Text>
                    {selectedOption?.id === option.id && (
                      <View className="w-5 h-5 bg-[#eb7825] rounded-full flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" />
                      </View>
                    )}
                  </View>
                  <Text className="text-gray-600 text-sm mb-3">{option.description}</Text>
                  
                  <View className="space-y-1">
                    {option.includes.map((feature, index) => (
                      <View key={index} className="flex items-center gap-2 text-sm text-gray-700">
                        <View className="w-1 h-1 bg-[#eb7825] rounded-full"></View>
                        <Text>{feature}</Text>
                      </View>
                    ))}
                  </View>
                </View>
                
                <View className="text-right">
                  <View className="text-xl font-bold text-gray-900">
                    {formatPrice(option.price)}
                  </View>
                  {option.duration && (
                    <View className="text-sm text-gray-500">
                      {option.duration}
                    </View>
                  )}
                  {option.savings && (
                    <View className="text-xs text-green-600 font-medium">
                      {option.savings}
                    </View>
                  )}
                </View>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* Fixed Footer */}
      <View className="sticky bottom-0 z-10 p-6 border-t border-gray-200 bg-white">
        <TouchableOpacity
          onClick={handleProceedToPayment}
          disabled={!selectedOption}
          className={`w-full py-4 rounded-xl font-semibold transition-colors ${
            selectedOption
              ? 'bg-[#eb7825] hover:bg-[#d6691f] text-white'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          Continue to Payment
        </TouchableOpacity>
      </View>
    </>
  );

  const renderPaymentStep = () => (
    <>
      {/* Fixed Header */}
      <View className="sticky top-0 z-10 bg-white border-b border-gray-200 p-6">
        <View className="flex items-center justify-between">
          <View>
            <Text className="text-xl font-semibold text-gray-900">Complete Purchase</Text>
            <Text className="text-gray-600 mt-1">{selectedOption?.title}</Text>
          </View>
          <TouchableOpacity
            onClick={() => setPaymentStep('selection')}
            className="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-gray-600" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Scrollable Content */}
      <View className="flex-1 overflow-y-auto p-6 pt-0">
        <View className="mt-6">
          {/* Order Summary */}
          <View className="bg-gray-50 rounded-xl p-4 mb-6">
            <Text className="font-semibold text-gray-900 mb-2">Order Summary</Text>
            <View className="flex items-center justify-between">
              <Text className="text-gray-700">{recommendation.title}</Text>
              <Text className="font-semibold text-gray-900">
                {selectedOption && formatPrice(selectedOption.price)}
              </Text>
            </View>
            <View className="flex items-center justify-between text-sm text-gray-600 mt-1">
              <Text>{selectedOption?.title}</Text>
            </View>
          </View>

          {/* Payment Methods */}
          <View className="space-y-3">
            <Text className="font-semibold text-gray-900">Payment Method</Text>
            
            <View
              onClick={() => setPaymentMethod('apple')}
              className={`flex items-center gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all ${
                paymentMethod === 'apple'
                  ? 'border-[#eb7825] bg-orange-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <View className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
                <Apple className="w-5 h-5 text-white" />
              </View>
              <View className="flex-1">
                <View className="font-semibold text-gray-900">Apple Pay</View>
                <View className="text-sm text-gray-600">Pay with Touch ID or Face ID</View>
              </View>
              {paymentMethod === 'apple' && (
                <View className="w-5 h-5 bg-[#eb7825] rounded-full flex items-center justify-center">
                  <Check className="w-3 h-3 text-white" />
                </View>
              )}
            </View>

            <View
              onClick={() => setPaymentMethod('card')}
              className={`flex items-center gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all ${
                paymentMethod === 'card'
                  ? 'border-[#eb7825] bg-orange-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <View className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-white" />
              </View>
              <View className="flex-1">
                <View className="font-semibold text-gray-900">Credit Card</View>
                <View className="text-sm text-gray-600">•••• •••• •••• 4242</View>
              </View>
              {paymentMethod === 'card' && (
                <View className="w-5 h-5 bg-[#eb7825] rounded-full flex items-center justify-center">
                  <Check className="w-3 h-3 text-white" />
                </View>
              )}
            </View>
          </View>
        </View>
      </View>

      {/* Fixed Footer */}
      <View className="sticky bottom-0 z-10 p-6 border-t border-gray-200 bg-white">
        <TouchableOpacity
          onClick={handleProcessPayment}
          className="w-full bg-[#eb7825] hover:bg-[#d6691f] text-white py-4 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
        >
          {paymentMethod === 'apple' ? (
            <>
              <Apple className="w-5 h-5" />
              Pay with Apple Pay
            </>
          ) : (
            <>
              <CreditCard className="w-5 h-5" />
              Complete Purchase
            </>
          )}
        </TouchableOpacity>
      </View>
    </>
  );

  const renderProcessingStep = () => (
    <View className="p-6 text-center">
      <View className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <View className="w-8 h-8 border-4 border-[#eb7825] border-t-transparent rounded-full animate-spin"></View>
      </View>
      <Text className="text-xl font-semibold text-gray-900 mb-2">Processing Payment...</Text>
      <Text className="text-gray-600">Please wait while we secure your booking</Text>
    </View>
  );

  const renderSuccessStep = () => (
    <View className="p-6 text-center">
      <View className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <Check className="w-8 h-8 text-green-600" />
      </View>
      <Text className="text-xl font-semibold text-gray-900 mb-2">Purchase Complete!</Text>
      <Text className="text-gray-600 mb-4">
        {recommendation.title} has been added to your calendar
      </Text>
      <View className="bg-green-50 border border-green-200 rounded-xl p-4">
        <View className="text-sm text-green-800">
          You'll receive a confirmation email shortly with all the details.
        </View>
      </View>
    </View>
  );

  return (
    <View className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm">
      <View className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md max-h-[calc(100vh-6rem)] sm:max-h-[85vh] overflow-hidden shadow-2xl flex flex-col mb-20 sm:mb-0">
        {paymentStep === 'selection' && renderSelectionStep()}
        {paymentStep === 'payment' && renderPaymentStep()}
        {paymentStep === 'processing' && renderProcessingStep()}
        {paymentStep === 'success' && renderSuccessStep()}
      </View>
    </View>
  );
};

export default PurchaseModal;