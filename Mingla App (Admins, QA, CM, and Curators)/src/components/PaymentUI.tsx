import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  CreditCard,
  AlertCircle,
  ShieldCheck,
  Info,
  Lock,
  Globe2,
  CheckCircle,
  XCircle,
  Building2,
  DollarSign
} from 'lucide-react';

/**
 * PAYMENT CURRENCY ARCHITECTURE
 * 
 * Hard Requirements:
 * 1. Charge currency MUST equal merchant's payout currency
 * 2. Currency derived: merchant → Stripe Account → default_currency → charge.currency
 * 3. Never from: card BIN, user locale, IP, or frontend input
 * 4. Frontend cannot override currency
 * 5. Stripe handles all FX automatically
 * 6. Refunds reconcile in original charge currency
 */

interface MerchantCurrencyInfo {
  merchantId: string;
  merchantName: string;
  stripeAccountId: string;
  // This comes from backend only: Stripe ConnectedAccount.default_currency
  payoutCurrency: string;
  // ISO 3166 country code from Stripe account
  country: string;
  // Whether the merchant's Stripe account is fully onboarded
  chargesEnabled: boolean;
}

interface PaymentScreenProps {
  experience: {
    id: string;
    title: string;
    price: number;
  };
  // This data MUST come from backend API call
  // Frontend never determines or changes this
  merchantCurrency: MerchantCurrencyInfo;
}

/**
 * Payment Screen Component
 * 
 * This component displays price ONLY in merchant's payout currency.
 * Currency is read-only and derived from merchant's Stripe account.
 */
export const PaymentScreen: React.FC<PaymentScreenProps> = ({
  experience,
  merchantCurrency
}) => {
  const [cardNumber, setCardNumber] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Format currency for display
  const formatPrice = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(amount);
  };

  const handlePayment = async () => {
    setIsProcessing(true);
    setError(null);

    try {
      // Backend API call structure (example only - not implemented)
      const response = await fetch('/api/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          experienceId: experience.id,
          merchantId: merchantCurrency.merchantId,
          // Frontend sends ONLY IDs, never currency
          // Backend will:
          // 1. Fetch merchant's Stripe connected account
          // 2. Read default_currency from that account
          // 3. Create PaymentIntent with that currency
          // 4. Use on_behalf_of or transfer_data for Connect
        })
      });

      const data = await response.json();

      if (!response.ok) {
        // Backend may reject if:
        // - Merchant's account is not fully onboarded
        // - Card network doesn't support merchant's currency
        // - Stripe Connect account has issues
        setError(data.error || 'Payment failed');
        return;
      }

      // Success - payment processed in merchant's currency
      console.log('Payment successful in', merchantCurrency.payoutCurrency);
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <motion.div
      className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="max-w-md mx-auto">
        {/* Header */}
        <motion.div
          className="glass-card rounded-3xl p-6 mb-6"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
        >
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {experience.title}
          </h2>
          
          {/* Currency Information - Read Only */}
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-4">
            <Globe2 className="w-4 h-4" />
            <span>
              Price set by merchant in <strong>{merchantCurrency.country}</strong>
            </span>
          </div>

          {/* Price Display - Derived from Merchant's Stripe Account */}
          <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-2xl p-6 border-2 border-[#eb7825]/20">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm">
                <Lock className="w-5 h-5 text-[#eb7825]" />
              </div>
              <div className="flex-1">
                <div className="text-sm text-gray-600 mb-1">Amount to charge</div>
                <div className="text-3xl font-bold text-gray-900">
                  {formatPrice(experience.price, merchantCurrency.payoutCurrency)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Currency: {merchantCurrency.payoutCurrency.toUpperCase()}
                </div>
              </div>
            </div>

            {/* Currency Source Explanation */}
            <div className="bg-white/60 backdrop-blur-sm rounded-xl p-3 flex items-start gap-2">
              <Info className="w-4 h-4 text-[#eb7825] flex-shrink-0 mt-0.5" />
              <div className="text-xs text-gray-700 leading-relaxed">
                <strong>Why this currency?</strong> This merchant's Stripe account settles in{' '}
                <strong>{merchantCurrency.payoutCurrency.toUpperCase()}</strong>. All charges 
                must use this currency. Stripe will handle any currency conversion automatically.
              </div>
            </div>
          </div>
        </motion.div>

        {/* Payment Method */}
        <motion.div
          className="glass-card rounded-3xl p-6 mb-6"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1 }}
        >
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-[#eb7825]" />
            Payment Method
          </h3>

          {/* Card Input */}
          <div className="mb-4">
            <label className="text-sm text-gray-600 mb-2 block">
              Card Number
            </label>
            <input
              type="text"
              placeholder="4242 4242 4242 4242"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-[#eb7825] focus:outline-none focus:ring-2 focus:ring-[#eb7825]/20 transition-all"
              maxLength={19}
            />
          </div>

          {/* Important Notice */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-blue-900 leading-relaxed">
              <strong>Currency Protection:</strong> Your card will be charged in{' '}
              <strong>{merchantCurrency.payoutCurrency.toUpperCase()}</strong>. If your card 
              is in a different currency, your bank or card network will handle the conversion.
              Mingla does not perform currency conversion.
            </div>
          </div>
        </motion.div>

        {/* Error Display */}
        {error && (
          <motion.div
            className="glass-card rounded-3xl p-4 mb-6 bg-red-50 border-2 border-red-200"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
              <div>
                <div className="text-sm font-semibold text-red-900 mb-1">
                  Payment Failed
                </div>
                <div className="text-xs text-red-700 leading-relaxed">
                  {error}
                </div>
                {error.includes('currency') && (
                  <div className="text-xs text-red-600 mt-2">
                    This merchant only accepts <strong>{merchantCurrency.payoutCurrency.toUpperCase()}</strong>.
                    Your card network may not support this currency.
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* Pay Button */}
        <motion.button
          className={`w-full py-4 rounded-2xl font-bold text-white shadow-lg transition-all ${
            isProcessing || !merchantCurrency.chargesEnabled
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-gradient-to-br from-[#eb7825] to-[#d6691f] hover:shadow-xl hover:scale-105'
          }`}
          onClick={handlePayment}
          disabled={isProcessing || !merchantCurrency.chargesEnabled}
          whileTap={{ scale: 0.98 }}
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          {isProcessing
            ? 'Processing...'
            : !merchantCurrency.chargesEnabled
            ? 'Merchant Setup Incomplete'
            : `Pay ${formatPrice(experience.price, merchantCurrency.payoutCurrency)}`}
        </motion.button>

        {/* Technical Details Footer */}
        <motion.div
          className="mt-6 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <div className="text-xs text-gray-500 leading-relaxed">
            <div className="mb-2">
              <strong>Security Note:</strong> Currency cannot be changed by users or Mingla.
            </div>
            <div>
              Merchant Stripe Account: <code className="bg-gray-200 px-2 py-0.5 rounded text-gray-700">
                {merchantCurrency.stripeAccountId}
              </code>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};

/**
 * Business Onboarding - Currency Lock-in
 * 
 * Shows merchants their payout currency from Stripe Connect.
 * This cannot be changed after Stripe account creation.
 */
interface BusinessOnboardingProps {
  // Data from Stripe Connect onboarding
  stripeAccountData: {
    accountId: string;
    country: string;
    defaultCurrency: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
  };
}

export const BusinessOnboardingCurrencyDisplay: React.FC<BusinessOnboardingProps> = ({
  stripeAccountData
}) => {
  const getCurrencySymbol = (currency: string) => {
    const symbols: Record<string, string> = {
      usd: '$', eur: '€', gbp: '£', jpy: '¥', cad: 'CAD$', aud: 'AUD$'
    };
    return symbols[currency.toLowerCase()] || currency.toUpperCase();
  };

  return (
    <motion.div
      className="glass-card rounded-3xl p-6 max-w-2xl mx-auto"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-start gap-4 mb-6">
        <div className="w-12 h-12 bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-2xl flex items-center justify-center shadow-lg">
          <Building2 className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-1">
            Payout Currency
          </h2>
          <p className="text-sm text-gray-600">
            Set by Stripe based on your country: <strong>{stripeAccountData.country}</strong>
          </p>
        </div>
      </div>

      {/* Currency Display - Locked */}
      <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl p-6 border-2 border-gray-200 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm text-gray-600 mb-1">Your settlement currency</div>
            <div className="text-4xl font-bold text-gray-900 flex items-center gap-2">
              {getCurrencySymbol(stripeAccountData.defaultCurrency)}
              <span className="text-2xl text-gray-600">
                {stripeAccountData.defaultCurrency.toUpperCase()}
              </span>
            </div>
          </div>
          <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-md">
            <Lock className="w-7 h-7 text-gray-400" />
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Lock className="w-3.5 h-3.5" />
          <span>This currency is locked and cannot be changed</span>
        </div>
      </div>

      {/* Status Indicators */}
      <div className="space-y-3 mb-6">
        <div className={`flex items-center gap-3 p-3 rounded-xl ${
          stripeAccountData.chargesEnabled ? 'bg-green-50' : 'bg-yellow-50'
        }`}>
          {stripeAccountData.chargesEnabled ? (
            <CheckCircle className="w-5 h-5 text-green-600" />
          ) : (
            <AlertCircle className="w-5 h-5 text-yellow-600" />
          )}
          <div className="flex-1">
            <div className={`text-sm font-semibold ${
              stripeAccountData.chargesEnabled ? 'text-green-900' : 'text-yellow-900'
            }`}>
              Charges {stripeAccountData.chargesEnabled ? 'Enabled' : 'Disabled'}
            </div>
            <div className={`text-xs ${
              stripeAccountData.chargesEnabled ? 'text-green-700' : 'text-yellow-700'
            }`}>
              {stripeAccountData.chargesEnabled
                ? 'You can accept payments'
                : 'Complete Stripe onboarding to accept payments'}
            </div>
          </div>
        </div>

        <div className={`flex items-center gap-3 p-3 rounded-xl ${
          stripeAccountData.payoutsEnabled ? 'bg-green-50' : 'bg-yellow-50'
        }`}>
          {stripeAccountData.payoutsEnabled ? (
            <CheckCircle className="w-5 h-5 text-green-600" />
          ) : (
            <AlertCircle className="w-5 h-5 text-yellow-600" />
          )}
          <div className="flex-1">
            <div className={`text-sm font-semibold ${
              stripeAccountData.payoutsEnabled ? 'text-green-900' : 'text-yellow-900'
            }`}>
              Payouts {stripeAccountData.payoutsEnabled ? 'Enabled' : 'Disabled'}
            </div>
            <div className={`text-xs ${
              stripeAccountData.payoutsEnabled ? 'text-green-700' : 'text-yellow-700'
            }`}>
              {stripeAccountData.payoutsEnabled
                ? `You'll receive payouts in ${stripeAccountData.defaultCurrency.toUpperCase()}`
                : 'Add bank account to receive payouts'}
            </div>
          </div>
        </div>
      </div>

      {/* Important Information */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-blue-900 mb-2">
              Currency Rules
            </div>
            <ul className="text-xs text-blue-800 space-y-1.5 leading-relaxed">
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-0.5">•</span>
                <span>
                  All customer charges will be in <strong>{stripeAccountData.defaultCurrency.toUpperCase()}</strong>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-0.5">•</span>
                <span>
                  You cannot change this currency after account creation
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-0.5">•</span>
                <span>
                  Stripe handles all currency conversion automatically
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-0.5">•</span>
                <span>
                  Refunds will be processed in <strong>{stripeAccountData.defaultCurrency.toUpperCase()}</strong>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-0.5">•</span>
                <span>
                  Mingla never changes or overrides this currency
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Stripe Account ID */}
      <div className="mt-4 text-center">
        <div className="text-xs text-gray-500">
          Stripe Account ID
        </div>
        <code className="text-xs bg-gray-100 px-3 py-1.5 rounded-lg text-gray-700 inline-block mt-1">
          {stripeAccountData.accountId}
        </code>
      </div>
    </motion.div>
  );
};

/**
 * Transaction Receipt - Shows Original Currency
 * 
 * Displays completed transaction in the currency it was charged.
 */
interface TransactionReceiptProps {
  transaction: {
    id: string;
    experienceTitle: string;
    amount: number;
    currency: string;
    merchantName: string;
    chargedAt: string;
    paymentIntentId: string;
    stripeAccountId: string;
  };
}

export const TransactionReceipt: React.FC<TransactionReceiptProps> = ({ transaction }) => {
  const formatPrice = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(amount);
  };

  return (
    <motion.div
      className="glass-card rounded-3xl p-6 max-w-md mx-auto"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      {/* Success Icon */}
      <div className="flex justify-center mb-6">
        <div className="w-16 h-16 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center shadow-lg">
          <CheckCircle className="w-9 h-9 text-white" />
        </div>
      </div>

      <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">
        Payment Successful
      </h2>
      <p className="text-sm text-gray-600 text-center mb-6">
        Your booking is confirmed
      </p>

      {/* Amount Charged */}
      <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl p-6 mb-6 border-2 border-gray-200">
        <div className="text-center">
          <div className="text-sm text-gray-600 mb-1">Amount Charged</div>
          <div className="text-4xl font-bold text-gray-900 mb-2">
            {formatPrice(transaction.amount, transaction.currency)}
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
            <Lock className="w-3.5 h-3.5" />
            <span>Original currency: {transaction.currency.toUpperCase()}</span>
          </div>
        </div>
      </div>

      {/* Transaction Details */}
      <div className="space-y-3 mb-6">
        <div className="flex justify-between items-center py-2 border-b border-gray-200">
          <span className="text-sm text-gray-600">Experience</span>
          <span className="text-sm font-semibold text-gray-900">{transaction.experienceTitle}</span>
        </div>
        <div className="flex justify-between items-center py-2 border-b border-gray-200">
          <span className="text-sm text-gray-600">Merchant</span>
          <span className="text-sm font-semibold text-gray-900">{transaction.merchantName}</span>
        </div>
        <div className="flex justify-between items-center py-2 border-b border-gray-200">
          <span className="text-sm text-gray-600">Date</span>
          <span className="text-sm font-semibold text-gray-900">
            {new Date(transaction.chargedAt).toLocaleDateString()}
          </span>
        </div>
        <div className="flex justify-between items-center py-2">
          <span className="text-sm text-gray-600">Transaction ID</span>
          <code className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-700">
            {transaction.id.slice(0, 12)}...
          </code>
        </div>
      </div>

      {/* Refund Notice */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-blue-900 leading-relaxed">
            <strong>Refund Policy:</strong> If you need a refund, it will be processed in the 
            original charge currency (<strong>{transaction.currency.toUpperCase()}</strong>). 
            Contact support for assistance.
          </div>
        </div>
      </div>

      {/* Technical Footer */}
      <div className="mt-6 pt-6 border-t border-gray-200">
        <div className="text-xs text-gray-500 space-y-1 text-center">
          <div>Payment Intent: <code className="bg-gray-100 px-1.5 py-0.5 rounded">{transaction.paymentIntentId}</code></div>
          <div>Merchant Account: <code className="bg-gray-100 px-1.5 py-0.5 rounded">{transaction.stripeAccountId}</code></div>
        </div>
      </div>
    </motion.div>
  );
};

/**
 * Error State - Currency Rejection
 * 
 * Shows when a payment fails due to currency incompatibility
 */
interface CurrencyErrorProps {
  merchantCurrency: string;
  errorMessage: string;
  onRetry: () => void;
  onContactSupport: () => void;
}

export const CurrencyErrorDisplay: React.FC<CurrencyErrorProps> = ({
  merchantCurrency,
  errorMessage,
  onRetry,
  onContactSupport
}) => {
  return (
    <motion.div
      className="glass-card rounded-3xl p-6 max-w-md mx-auto"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      {/* Error Icon */}
      <div className="flex justify-center mb-6">
        <div className="w-16 h-16 bg-gradient-to-br from-red-400 to-red-600 rounded-full flex items-center justify-center shadow-lg">
          <XCircle className="w-9 h-9 text-white" />
        </div>
      </div>

      <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">
        Payment Not Supported
      </h2>
      <p className="text-sm text-gray-600 text-center mb-6">
        This transaction cannot be processed
      </p>

      {/* Error Details */}
      <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4 mb-6">
        <div className="flex items-start gap-3 mb-4">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-red-900 mb-1">
              Currency Incompatibility
            </div>
            <div className="text-xs text-red-700 leading-relaxed">
              {errorMessage}
            </div>
          </div>
        </div>

        <div className="bg-white/60 backdrop-blur-sm rounded-xl p-3">
          <div className="text-xs text-gray-700 leading-relaxed space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-red-600 mt-0.5">•</span>
              <span>
                This merchant only accepts payments in <strong>{merchantCurrency.toUpperCase()}</strong>
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-red-600 mt-0.5">•</span>
              <span>
                Your payment method may not support this currency
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-red-600 mt-0.5">•</span>
              <span>
                Currency cannot be changed (set by merchant's Stripe account)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="space-y-3">
        <button
          onClick={onRetry}
          className="w-full py-3 rounded-xl bg-gradient-to-br from-[#eb7825] to-[#d6691f] text-white font-semibold shadow-lg hover:shadow-xl transition-all hover:scale-105"
        >
          Try Different Card
        </button>
        <button
          onClick={onContactSupport}
          className="w-full py-3 rounded-xl bg-gray-100 text-gray-700 font-semibold hover:bg-gray-200 transition-all"
        >
          Contact Support
        </button>
      </div>

      {/* Why Can't We Change It */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-3">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-blue-900 leading-relaxed">
            <strong>Why can't the currency be changed?</strong> The charge currency must match 
            the merchant's Stripe account payout currency. This ensures proper settlement, 
            refund reconciliation, and compliance with payment regulations.
          </div>
        </div>
      </div>
    </motion.div>
  );
};
