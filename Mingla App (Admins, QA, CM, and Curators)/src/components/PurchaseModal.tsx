import React, { useState } from 'react';
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
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Choose Your Experience</h2>
            <p className="text-gray-600 mt-1">{recommendation.title}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-6 pt-0">
        <div className="space-y-3 mt-6">
          {recommendation.purchaseOptions.map((option: PurchaseOption) => (
            <div
              key={option.id}
              onClick={() => handleSelectOption(option)}
              className={`relative p-4 border-2 rounded-xl cursor-pointer transition-all ${
                selectedOption?.id === option.id
                  ? 'border-[#eb7825] bg-orange-50'
                  : 'border-gray-200 hover:border-gray-300'
              } ${option.popular ? 'ring-2 ring-[#eb7825] ring-opacity-20' : ''}`}
            >
              {option.popular && (
                <div className="absolute -top-2 left-4 bg-[#eb7825] text-white px-3 py-1 rounded-full text-xs font-semibold">
                  Most Popular
                </div>
              )}
              
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900">{option.title}</h3>
                    {selectedOption?.id === option.id && (
                      <div className="w-5 h-5 bg-[#eb7825] rounded-full flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </div>
                  <p className="text-gray-600 text-sm mb-3">{option.description}</p>
                  
                  <div className="space-y-1">
                    {option.includes.map((feature, index) => (
                      <div key={index} className="flex items-center gap-2 text-sm text-gray-700">
                        <div className="w-1 h-1 bg-[#eb7825] rounded-full"></div>
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="text-right">
                  <div className="text-xl font-bold text-gray-900">
                    {formatPrice(option.price)}
                  </div>
                  {option.duration && (
                    <div className="text-sm text-gray-500">
                      {option.duration}
                    </div>
                  )}
                  {option.savings && (
                    <div className="text-xs text-green-600 font-medium">
                      {option.savings}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Fixed Footer */}
      <div className="sticky bottom-0 z-10 p-6 border-t border-gray-200 bg-white">
        <button
          onClick={handleProceedToPayment}
          disabled={!selectedOption}
          className={`w-full py-4 rounded-xl font-semibold transition-colors ${
            selectedOption
              ? 'bg-[#eb7825] hover:bg-[#d6691f] text-white'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          Continue to Payment
        </button>
      </div>
    </>
  );

  const renderPaymentStep = () => (
    <>
      {/* Fixed Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Complete Purchase</h2>
            <p className="text-gray-600 mt-1">{selectedOption?.title}</p>
          </div>
          <button
            onClick={() => setPaymentStep('selection')}
            className="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-6 pt-0">
        <div className="mt-6">
          {/* Order Summary */}
          <div className="bg-gray-50 rounded-xl p-4 mb-6">
            <h3 className="font-semibold text-gray-900 mb-2">Order Summary</h3>
            <div className="flex items-center justify-between">
              <span className="text-gray-700">{recommendation.title}</span>
              <span className="font-semibold text-gray-900">
                {selectedOption && formatPrice(selectedOption.price)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm text-gray-600 mt-1">
              <span>{selectedOption?.title}</span>
            </div>
          </div>

          {/* Payment Methods */}
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900">Payment Method</h3>
            
            <div
              onClick={() => setPaymentMethod('apple')}
              className={`flex items-center gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all ${
                paymentMethod === 'apple'
                  ? 'border-[#eb7825] bg-orange-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
                <Apple className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-gray-900">Apple Pay</div>
                <div className="text-sm text-gray-600">Pay with Touch ID or Face ID</div>
              </div>
              {paymentMethod === 'apple' && (
                <div className="w-5 h-5 bg-[#eb7825] rounded-full flex items-center justify-center">
                  <Check className="w-3 h-3 text-white" />
                </div>
              )}
            </div>

            <div
              onClick={() => setPaymentMethod('card')}
              className={`flex items-center gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all ${
                paymentMethod === 'card'
                  ? 'border-[#eb7825] bg-orange-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-gray-900">Credit Card</div>
                <div className="text-sm text-gray-600">•••• •••• •••• 4242</div>
              </div>
              {paymentMethod === 'card' && (
                <div className="w-5 h-5 bg-[#eb7825] rounded-full flex items-center justify-center">
                  <Check className="w-3 h-3 text-white" />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Fixed Footer */}
      <div className="sticky bottom-0 z-10 p-6 border-t border-gray-200 bg-white">
        <button
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
        </button>
      </div>
    </>
  );

  const renderProcessingStep = () => (
    <div className="p-6 text-center">
      <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <div className="w-8 h-8 border-4 border-[#eb7825] border-t-transparent rounded-full animate-spin"></div>
      </div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">Processing Payment...</h2>
      <p className="text-gray-600">Please wait while we secure your booking</p>
    </div>
  );

  const renderSuccessStep = () => (
    <div className="p-6 text-center">
      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <Check className="w-8 h-8 text-green-600" />
      </div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">Purchase Complete!</h2>
      <p className="text-gray-600 mb-4">
        {recommendation.title} has been added to your calendar
      </p>
      <div className="bg-green-50 border border-green-200 rounded-xl p-4">
        <div className="text-sm text-green-800">
          You'll receive a confirmation email shortly with all the details.
        </div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md max-h-[calc(100vh-6rem)] sm:max-h-[85vh] overflow-hidden shadow-2xl flex flex-col mb-20 sm:mb-0">
        {paymentStep === 'selection' && renderSelectionStep()}
        {paymentStep === 'payment' && renderPaymentStep()}
        {paymentStep === 'processing' && renderProcessingStep()}
        {paymentStep === 'success' && renderSuccessStep()}
      </div>
    </div>
  );
};

export default PurchaseModal;