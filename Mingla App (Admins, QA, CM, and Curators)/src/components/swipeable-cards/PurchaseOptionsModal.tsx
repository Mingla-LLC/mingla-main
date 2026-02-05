import React, { useState } from 'react';
import { X, Clock, Check, CreditCard } from 'lucide-react';
import { Recommendation, PurchaseOption } from './types';
import { formatCurrency } from '../utils/formatters';

interface PurchaseOptionsModalProps {
  recommendation: Recommendation;
  onClose: () => void;
  onPurchaseComplete: (option: PurchaseOption) => void;
}

export default function PurchaseOptionsModal({
  recommendation,
  onClose,
  onPurchaseComplete
}: PurchaseOptionsModalProps) {
  const [selectedOption, setSelectedOption] = useState<PurchaseOption | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showApplePay, setShowApplePay] = useState(false);

  const formatPrice = (price: number, currency: string) => {
    return formatCurrency(price, currency);
  };

  const handlePurchase = async () => {
    if (!selectedOption) return;

    setIsProcessing(true);
    setShowApplePay(true);

    // Simulate Apple Pay processing
    setTimeout(() => {
      setShowApplePay(false);
      onPurchaseComplete(selectedOption);
      setIsProcessing(false);
      onClose();
    }, 2000);
  };

  if (!recommendation.purchaseOptions || recommendation.purchaseOptions.length === 0) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-end sm:items-center justify-center">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg max-h-[90vh] overflow-hidden flex flex-col relative">
        {/* Header */}
        <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-gray-100 p-4 rounded-t-3xl z-10">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-lg text-gray-900">Choose Your Experience</h3>
            <button
              onClick={onClose}
              className="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4 text-gray-600" />
            </button>
          </div>
          <p className="text-sm text-gray-600 mt-1">{recommendation.title}</p>
        </div>

        {/* Purchase Options */}
        <div className="p-4 space-y-3 pb-32 overflow-y-auto">
          {recommendation.purchaseOptions.map((option) => (
            <div
              key={option.id}
              onClick={() => setSelectedOption(option)}
              className={`relative p-3 rounded-xl border-2 cursor-pointer transition-all ${
                selectedOption?.id === option.id
                  ? 'border-[#eb7825] bg-orange-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              {/* Popular badge */}
              {option.popular && (
                <div className="absolute -top-2 left-4 bg-[#eb7825] text-white px-2 py-1 rounded-full text-xs font-medium">
                  Most Popular
                </div>
              )}
              
              {/* Savings badge */}
              {option.savings && (
                <div className="absolute -top-2 right-4 bg-green-600 text-white px-2 py-1 rounded-full text-xs font-medium">
                  {option.savings}
                </div>
              )}

              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h4 className="font-semibold text-gray-900 mb-1">{option.title}</h4>
                  <p className="text-sm text-gray-600 mb-2">{option.description}</p>
                  {option.duration && (
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <Clock className="w-3 h-3" />
                      <span>{option.duration}</span>
                    </div>
                  )}
                </div>
                <div className="text-right ml-3">
                  <div className="font-bold text-lg text-gray-900">
                    {formatPrice(option.price, option.currency)}
                  </div>
                </div>
              </div>

              {/* Includes */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-700 mb-2">Includes:</p>
                {option.includes.slice(0, 3).map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
                    <Check className="w-3 h-3 text-[#eb7825] flex-shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
                {option.includes.length > 3 && (
                  <p className="text-xs text-gray-500 ml-5">+{option.includes.length - 3} more</p>
                )}
              </div>

              {/* Selection indicator */}
              {selectedOption?.id === option.id && (
                <div className="absolute top-3 right-3 w-6 h-6 bg-[#eb7825] rounded-full flex items-center justify-center">
                  <Check className="w-4 h-4 text-white" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Purchase Button */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 p-4">
          <button
            onClick={handlePurchase}
            disabled={!selectedOption || isProcessing}
            className={`w-full py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 ${
              selectedOption && !isProcessing
                ? 'bg-[#eb7825] hover:bg-[#d6691f] text-white'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {isProcessing ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <CreditCard className="w-4 h-4" />
                {selectedOption ? `Buy with Apple Pay • ${formatPrice(selectedOption.price, selectedOption.currency)}` : 'Select an option'}
              </>
            )}
          </button>
          
          {selectedOption && !isProcessing && (
            <p className="text-xs text-gray-500 text-center mt-2">
              Secure payment with Apple Pay • Cancel anytime
            </p>
          )}
        </div>

        {/* Apple Pay Animation Overlay */}
        {showApplePay && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-20">
            <div className="bg-white rounded-2xl p-8 max-w-sm mx-4 text-center">
              <div className="w-16 h-16 bg-gray-900 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <span className="text-white font-bold text-lg">Apple Pay</span>
              </div>
              <h4 className="font-semibold text-gray-900 mb-2">Processing Payment</h4>
              <p className="text-sm text-gray-600 mb-4">
                {formatPrice(selectedOption?.price || 0, selectedOption?.currency || 'USD')} • {recommendation.title}
              </p>
              <div className="flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-[#eb7825] border-t-transparent rounded-full animate-spin" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
