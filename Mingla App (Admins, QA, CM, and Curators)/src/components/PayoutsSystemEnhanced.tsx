import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  DollarSign, Calendar, Download, ChevronRight, Plus, ChevronDown,
  CheckCircle, Clock, AlertCircle, CreditCard, Building2, Smartphone,
  Globe, Upload, ArrowRight, Info, ExternalLink, TrendingUp,
  FileText, Edit, Trash2, AlertTriangle, HelpCircle, Lock, RefreshCw,
  ArrowUpRight, ArrowDownRight, Percent, X, Eye, EyeOff
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import PayoutOnboardingFlow from './PayoutOnboardingFlow';

interface PayoutsSystemEnhancedProps {
  curatorData?: {
    name: string;
    email: string;
    country?: string;
    currency?: string;
    payoutSetupComplete?: boolean;
  };
}

interface Transaction {
  id: string;
  date: string;
  experienceName: string;
  businessName: string;
  grossAmount: number;
  platformFee: number;
  platformFeePercent: number;
  curatorCommission: number;
  curatorCommissionPercent: number;
  paymentProcessorFee: number;
  conversionFee?: number;
  fxRate?: number;
  netPayout: number;
  currency: string;
  originalCurrency?: string;
  status: 'pending' | 'escrow' | 'released' | 'paid';
  escrowReleaseDate?: string;
}

interface PayoutRecord {
  id: string;
  period: string;
  transactions: Transaction[];
  totalGross: number;
  totalNet: number;
  currency: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  requestedDate: string;
  completedDate?: string;
  payoutMethod: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  AUD: 'A$',
  CAD: 'C$',
  BRL: 'R$',
  JPY: '¥',
  INR: '₹',
};

const EXCHANGE_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  AUD: 1.52,
  CAD: 1.36,
  BRL: 4.97,
  JPY: 149.5,
  INR: 83.2,
};

export default function PayoutsSystemEnhanced({ curatorData }: PayoutsSystemEnhancedProps) {
  const [showOnboarding, setShowOnboarding] = useState(!curatorData?.payoutSetupComplete);
  const [selectedCurrency, setSelectedCurrency] = useState(curatorData?.currency || 'USD');
  const [showInOriginalCurrency, setShowInOriginalCurrency] = useState(false);
  const [expandedTransaction, setExpandedTransaction] = useState<string | null>(null);
  const [activeTimeframe, setActiveTimeframe] = useState<'7d' | '30d' | '90d' | 'all'>('30d');

  // Mock data - enhanced with multi-currency
  const earningsSummary = {
    lifetimeEarnings: 28450.75,
    pendingPayout: 2340.00,
    inEscrow: 1180.50,
    thisMonth: 4520.30,
    lastPayout: 3200.00,
    lastPayoutDate: '2025-10-01',
    nextPayoutDate: '2025-11-01',
    currency: selectedCurrency,
  };

  const mockTransactions: Transaction[] = [
    {
      id: 'txn-001',
      date: '2025-10-18',
      experienceName: 'Sunset Rooftop Wine Tasting',
      businessName: 'Skyline Wines',
      grossAmount: 180.00,
      platformFee: 27.00,
      platformFeePercent: 15,
      curatorCommission: 30.60,
      curatorCommissionPercent: 20,
      paymentProcessorFee: 5.22,
      conversionFee: 2.15,
      fxRate: 0.92,
      netPayout: 115.03,
      currency: 'EUR',
      originalCurrency: 'USD',
      status: 'escrow',
      escrowReleaseDate: '2025-10-21',
    },
    {
      id: 'txn-002',
      date: '2025-10-17',
      experienceName: 'Artisan Chocolate Workshop',
      businessName: 'Sweet Creations',
      grossAmount: 95.00,
      platformFee: 14.25,
      platformFeePercent: 15,
      curatorCommission: 16.15,
      curatorCommissionPercent: 20,
      paymentProcessorFee: 2.76,
      netPayout: 61.84,
      currency: 'USD',
      status: 'released',
    },
    {
      id: 'txn-003',
      date: '2025-10-16',
      experienceName: 'Morning Yoga Session',
      businessName: 'Zen Studios',
      grossAmount: 45.00,
      platformFee: 6.75,
      platformFeePercent: 15,
      curatorCommission: 7.65,
      curatorCommissionPercent: 20,
      paymentProcessorFee: 1.31,
      netPayout: 29.29,
      currency: 'USD',
      status: 'paid',
    },
  ];

  const formatCurrency = (amount: number, currency: string = selectedCurrency) => {
    const symbol = CURRENCY_SYMBOLS[currency] || '$';
    return `${symbol}${amount.toFixed(2)}`;
  };

  const convertCurrency = (amount: number, fromCurrency: string, toCurrency: string) => {
    if (fromCurrency === toCurrency) return amount;
    const usdAmount = amount / EXCHANGE_RATES[fromCurrency];
    return usdAmount * EXCHANGE_RATES[toCurrency];
  };

  const renderEarningsTimeline = (transaction: Transaction) => {
    const steps = [
      { label: 'Sale', status: 'completed', date: transaction.date },
      { label: 'Validation', status: 'completed', date: transaction.date },
      { label: transaction.status === 'escrow' ? 'In Escrow' : 'Funds Held', status: transaction.status === 'escrow' || transaction.status === 'released' || transaction.status === 'paid' ? 'completed' : 'pending', date: transaction.escrowReleaseDate },
      { label: 'Payout', status: transaction.status === 'paid' ? 'completed' : 'pending', date: null },
    ];

    return (
      <div className="mt-4 pt-4 border-t border-gray-200">
        <h5 className="text-xs uppercase tracking-wide text-gray-500 mb-3">Payment Timeline</h5>
        <div className="flex items-center justify-between relative">
          {/* Progress bar */}
          <div className="absolute top-4 left-0 right-0 h-0.5 bg-gray-200 z-0" />
          <div 
            className="absolute top-4 left-0 h-0.5 bg-gradient-to-r from-[#eb7825] to-[#d6691f] z-0 transition-all"
            style={{ 
              width: `${((steps.filter(s => s.status === 'completed').length - 1) / (steps.length - 1)) * 100}%` 
            }}
          />

          {steps.map((step, index) => (
            <div key={index} className="flex flex-col items-center z-10 relative">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center mb-2 ${
                step.status === 'completed'
                  ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white'
                  : step.status === 'pending'
                  ? 'bg-gray-300 text-gray-500'
                  : 'bg-blue-500 text-white'
              }`}>
                {step.status === 'completed' ? (
                  <CheckCircle className="w-4 h-4" />
                ) : (
                  <Clock className="w-4 h-4" />
                )}
              </div>
              <span className="text-xs text-gray-600 text-center whitespace-nowrap">{step.label}</span>
              {step.date && (
                <span className="text-xs text-gray-400 mt-1">{step.date}</span>
              )}
            </div>
          ))}
        </div>

        {transaction.status === 'escrow' && transaction.escrowReleaseDate && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-start gap-2">
              <Clock className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-amber-800">
                <p className="font-medium">Funds in Escrow</p>
                <p className="mt-1">
                  This payment is held for 3 days post-experience for dispute resolution. 
                  Funds will be released on <strong>{transaction.escrowReleaseDate}</strong>.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderTransactionBreakdown = (transaction: Transaction) => {
    const isExpanded = expandedTransaction === transaction.id;

    return (
      <motion.div
        key={transaction.id}
        className="border border-gray-200 rounded-xl overflow-hidden hover:border-gray-300 transition-colors"
      >
        {/* Header */}
        <button
          onClick={() => setExpandedTransaction(isExpanded ? null : transaction.id)}
          className="w-full p-4 bg-white hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div className="flex-1 text-left">
              <h4 className="font-medium mb-1">{transaction.experienceName}</h4>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span>{transaction.businessName}</span>
                <span>•</span>
                <span>{transaction.date}</span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="font-medium">{formatCurrency(transaction.netPayout, transaction.currency)}</div>
                {transaction.originalCurrency && transaction.originalCurrency !== transaction.currency && (
                  <div className="text-xs text-gray-500">
                    from {formatCurrency(transaction.grossAmount, transaction.originalCurrency)}
                  </div>
                )}
              </div>
              <div>
                {transaction.status === 'paid' && <CheckCircle className="w-5 h-5 text-green-600" />}
                {transaction.status === 'escrow' && <Clock className="w-5 h-5 text-amber-600" />}
                {transaction.status === 'released' && <ArrowUpRight className="w-5 h-5 text-blue-600" />}
                {transaction.status === 'pending' && <Clock className="w-5 h-5 text-gray-400" />}
              </div>
              <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </div>
          </div>
        </button>

        {/* Expanded Details */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-t border-gray-200 bg-gray-50"
            >
              <div className="p-4 space-y-4">
                {/* Fee Breakdown */}
                <div className="bg-white rounded-lg p-4 border border-gray-200">
                  <h5 className="text-xs uppercase tracking-wide text-gray-500 mb-3">Fee Breakdown</h5>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-600">Gross Sale</span>
                      <span className="font-medium">{formatCurrency(transaction.grossAmount, transaction.originalCurrency || transaction.currency)}</span>
                    </div>
                    
                    <div className="flex justify-between items-center text-sm text-red-600">
                      <div className="flex items-center gap-2">
                        <span>Platform Fee</span>
                        <span className="text-xs px-1.5 py-0.5 bg-red-100 rounded">
                          {transaction.platformFeePercent}%
                        </span>
                      </div>
                      <span>-{formatCurrency(transaction.platformFee, transaction.originalCurrency || transaction.currency)}</span>
                    </div>

                    <div className="h-px bg-gray-200 my-2" />

                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-600">Subtotal</span>
                      <span>{formatCurrency(transaction.grossAmount - transaction.platformFee, transaction.originalCurrency || transaction.currency)}</span>
                    </div>

                    <div className="flex justify-between items-center text-sm text-green-600">
                      <div className="flex items-center gap-2">
                        <span>Your Commission</span>
                        <span className="text-xs px-1.5 py-0.5 bg-green-100 rounded">
                          {transaction.curatorCommissionPercent}%
                        </span>
                      </div>
                      <span>+{formatCurrency(transaction.curatorCommission, transaction.originalCurrency || transaction.currency)}</span>
                    </div>

                    <div className="flex justify-between items-center text-sm text-red-600">
                      <span>Payment Processor Fee</span>
                      <span>-{formatCurrency(transaction.paymentProcessorFee, transaction.originalCurrency || transaction.currency)}</span>
                    </div>

                    {transaction.conversionFee && (
                      <>
                        <div className="h-px bg-gray-200 my-2" />
                        <div className="flex justify-between items-center text-sm text-red-600">
                          <div className="flex items-center gap-2">
                            <span>Currency Conversion Fee</span>
                            <HelpCircle 
                              className="w-3 h-3 text-gray-400 cursor-help" 
                              title={`FX Rate: ${transaction.fxRate} ${transaction.originalCurrency}/${transaction.currency}`}
                            />
                          </div>
                          <span>-{formatCurrency(transaction.conversionFee, transaction.currency)}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs text-gray-500">
                          <span>Exchange Rate</span>
                          <span>1 {transaction.originalCurrency} = {transaction.fxRate} {transaction.currency}</span>
                        </div>
                      </>
                    )}

                    <div className="h-px bg-gray-300 my-3" />

                    <div className="flex justify-between items-center">
                      <span className="font-medium">Net Payout</span>
                      <span className="font-medium text-lg text-[#eb7825]">
                        {formatCurrency(transaction.netPayout, transaction.currency)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Timeline */}
                {renderEarningsTimeline(transaction)}

                {/* Regional Info */}
                {transaction.currency !== 'USD' && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <Globe className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                      <div className="text-xs text-blue-800">
                        <p className="font-medium mb-1">International Payment</p>
                        <p>
                          This transaction was converted from {transaction.originalCurrency} to your payout currency ({transaction.currency}).
                          Processing time: +2 business days for international transfers.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  if (showOnboarding) {
    return (
      <PayoutOnboardingFlow
        isOpen={showOnboarding}
        onClose={() => setShowOnboarding(false)}
        onComplete={(data) => {
          console.log('Payout setup complete:', data);
          setShowOnboarding(false);
        }}
      />
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl mb-1">Earnings & Payouts</h1>
          <p className="text-sm text-gray-600">
            Track your earnings and manage global payouts
          </p>
        </div>
        <Button
          onClick={() => setShowOnboarding(true)}
          variant="outline"
          className="flex items-center gap-2"
        >
          <Edit className="w-4 h-4" />
          Payout Settings
        </Button>
      </div>

      {/* Earnings Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-6 border border-green-200"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-green-700">Lifetime Earnings</span>
            <TrendingUp className="w-4 h-4 text-green-600" />
          </div>
          <div className="text-2xl mb-1">{formatCurrency(earningsSummary.lifetimeEarnings)}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowInOriginalCurrency(!showInOriginalCurrency)}
              className="text-xs text-green-700 hover:underline flex items-center gap-1"
            >
              {showInOriginalCurrency ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              {showInOriginalCurrency ? 'Show converted' : 'Show original'}
            </button>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-200"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-blue-700">Pending Payout</span>
            <Clock className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl mb-1">{formatCurrency(earningsSummary.pendingPayout)}</div>
          <p className="text-xs text-blue-700">
            Next payout: {earningsSummary.nextPayoutDate}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-6 border border-amber-200"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-amber-700">In Escrow</span>
            <Lock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl mb-1">{formatCurrency(earningsSummary.inEscrow)}</div>
          <p className="text-xs text-amber-700">
            Held for dispute resolution
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-6 border border-purple-200"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-purple-700">This Month</span>
            <Calendar className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-2xl mb-1">{formatCurrency(earningsSummary.thisMonth)}</div>
          <div className="flex items-center gap-1 text-xs text-green-600">
            <ArrowUpRight className="w-3 h-3" />
            <span>+23.5% vs last month</span>
          </div>
        </motion.div>
      </div>

      {/* Currency Toggle */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Globe className="w-5 h-5 text-gray-600" />
            <div>
              <h3 className="text-sm font-medium">Display Currency</h3>
              <p className="text-xs text-gray-600">
                Your payout currency: <strong>{selectedCurrency}</strong>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedCurrency}
              onChange={(e) => setSelectedCurrency(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#eb7825]"
            >
              {Object.keys(CURRENCY_SYMBOLS).map((curr) => (
                <option key={curr} value={curr}>
                  {curr} ({CURRENCY_SYMBOLS[curr]})
                </option>
              ))}
            </select>
            <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <RefreshCw className="w-4 h-4 text-gray-600" />
            </button>
          </div>
        </div>

        <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
          <Lock className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            Currency is locked after your first payout. To change your payout currency, please contact support.
          </p>
        </div>
      </div>

      {/* Transactions List */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="font-medium mb-1">Recent Transactions</h3>
            <p className="text-sm text-gray-600">
              Detailed breakdown of earnings and fees
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={activeTimeframe}
              onChange={(e) => setActiveTimeframe(e.target.value as any)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#eb7825]"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="all">All time</option>
            </select>
            <Button variant="outline" size="sm" className="flex items-center gap-2">
              <Download className="w-4 h-4" />
              Export
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          {mockTransactions.map((transaction) => renderTransactionBreakdown(transaction))}
        </div>

        {mockTransactions.length === 0 && (
          <div className="text-center py-12">
            <DollarSign className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600 mb-1">No transactions yet</p>
            <p className="text-sm text-gray-500">
              Your earnings will appear here once you start making sales
            </p>
          </div>
        )}
      </div>

      {/* Regional Compliance Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900">
            <p className="font-medium mb-2">Regional Payout Information</p>
            <ul className="space-y-1 text-blue-800">
              <li>• <strong>Escrow Period:</strong> Funds held for 3 days post-experience for dispute resolution</li>
              <li>• <strong>Processing Time:</strong> 3-5 business days for domestic, 5-7 for international</li>
              <li>• <strong>Minimum Payout:</strong> {formatCurrency(50)} per payout request</li>
              <li>• <strong>Tax Reporting:</strong> 1099 forms issued for US curators earning $600+/year</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
