import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  DollarSign, Calendar, Download, ChevronRight, Plus, Check,
  CheckCircle, Clock, AlertCircle, CreditCard, Building2, 
  Globe, ArrowRight, Info, ExternalLink, TrendingUp, Zap,
  FileText, AlertTriangle, Lock, Shield, Users, Percent,
  ArrowUpRight, ArrowDownRight, PieChart, BarChart3, X,
  RefreshCw, Eye, EyeOff, HelpCircle, ChevronDown
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Separator } from './ui/separator';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import PayoutOnboardingFlow from './PayoutOnboardingFlow';

interface StripePayoutsSystemProps {
  curatorData?: {
    name: string;
    email: string;
    country?: string;
    stripeAccountId?: string;
  };
}

// Mock data for demonstration
const MOCK_STRIPE_STATUS = {
  connected: true,
  chargesEnabled: true,
  payoutsEnabled: true,
  country: 'US',
  currency: 'USD',
  accountType: 'express',
  verificationStatus: 'verified',
  lastUpdated: '2025-10-15'
};

const MOCK_EARNINGS_DATA = {
  totalEarned: 12458.50,
  pendingPayout: 425.00,
  escrowBalance: 180.00,
  nextPayoutDate: '2025-10-22',
  currency: 'USD',
  lifetimeEarnings: 45230.80
};

const MOCK_TRANSACTIONS = [
  {
    id: 'txn_1',
    date: '2025-10-18',
    experienceName: 'Sunset Rooftop Wine Tasting',
    saleAmount: 120.00,
    platformFee: 18.00,
    stripeFee: 3.78,
    fxFee: 0,
    netEarnings: 98.22,
    currency: 'USD',
    status: 'available',
    buyerCurrency: 'USD',
    buyerAmount: 120.00,
    validatedDate: '2025-10-19'
  },
  {
    id: 'txn_2',
    date: '2025-10-17',
    experienceName: 'Artisan Chocolate Workshop',
    saleAmount: 95.00,
    platformFee: 14.25,
    stripeFee: 3.06,
    fxFee: 0,
    netEarnings: 77.69,
    currency: 'USD',
    status: 'available',
    buyerCurrency: 'USD',
    buyerAmount: 95.00,
    validatedDate: '2025-10-18'
  },
  {
    id: 'txn_3',
    date: '2025-10-16',
    experienceName: 'Morning Yoga at Golden Gate Park',
    saleAmount: 88.50,
    platformFee: 13.28,
    stripeFee: 2.87,
    fxFee: 1.24,
    netEarnings: 71.11,
    currency: 'USD',
    status: 'pending',
    buyerCurrency: 'EUR',
    buyerAmount: 82.00,
    validatedDate: null
  },
  {
    id: 'txn_4',
    date: '2025-10-15',
    experienceName: 'Jazz Night at The Blue Note',
    saleAmount: 75.00,
    platformFee: 11.25,
    stripeFee: 2.48,
    fxFee: 0,
    netEarnings: 61.27,
    currency: 'USD',
    status: 'paid',
    buyerCurrency: 'USD',
    buyerAmount: 75.00,
    paidDate: '2025-10-18'
  },
  {
    id: 'txn_5',
    date: '2025-10-14',
    experienceName: 'Sunset Rooftop Wine Tasting',
    saleAmount: 120.00,
    platformFee: 18.00,
    stripeFee: 3.78,
    fxFee: 0,
    netEarnings: 98.22,
    currency: 'USD',
    status: 'held',
    buyerCurrency: 'USD',
    buyerAmount: 120.00,
    holdReason: 'Awaiting experience validation'
  }
];

const PAYOUT_TIMELINE_STAGES = [
  { id: 'sale', label: 'Sale Made', icon: DollarSign, color: 'green' },
  { id: 'validation', label: 'Validated', icon: CheckCircle, color: 'blue' },
  { id: 'held', label: 'Held (3-7 days)', icon: Clock, color: 'amber' },
  { id: 'paid', label: 'Paid Out', icon: Check, color: 'green' }
];

export default function StripePayoutsSystem({ curatorData }: StripePayoutsSystemProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'earnings' | 'payouts' | 'tax'>('overview');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showFeeBreakdown, setShowFeeBreakdown] = useState<string | null>(null);
  const [currencyView, setCurrencyView] = useState<'usd' | 'local'>('usd');
  const [showConvertedAmounts, setShowConvertedAmounts] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateRange, setDateRange] = useState('30days');

  const stripeStatus = MOCK_STRIPE_STATUS;
  const earnings = MOCK_EARNINGS_DATA;

  // Stripe Connect Status Widget
  const renderStripeStatusWidget = () => (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 mb-6">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium text-gray-900">Stripe Connect</h3>
              {stripeStatus.connected && (
                <Badge className="bg-green-100 text-green-700 border-green-200">
                  <Check className="w-3 h-3 mr-1" />
                  Connected
                </Badge>
              )}
            </div>
            <p className="text-sm text-gray-600 mb-3">
              Your payout account is fully verified and active
            </p>
            
            {/* Status Indicators */}
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2 text-sm">
                <div className={`w-2 h-2 rounded-full ${stripeStatus.chargesEnabled ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-gray-700">Charges {stripeStatus.chargesEnabled ? 'Enabled' : 'Disabled'}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className={`w-2 h-2 rounded-full ${stripeStatus.payoutsEnabled ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-gray-700">Payouts {stripeStatus.payoutsEnabled ? 'Enabled' : 'Disabled'}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Globe className="w-4 h-4 text-gray-500" />
                <span className="text-gray-700">{stripeStatus.country}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <DollarSign className="w-4 h-4 text-gray-500" />
                <span className="text-gray-700">{stripeStatus.currency}</span>
              </div>
            </div>
          </div>
        </div>
        
        <Button
          variant="outline"
          size="sm"
          className="flex items-center gap-2"
          onClick={() => window.open('https://dashboard.stripe.com', '_blank')}
        >
          <ExternalLink className="w-4 h-4" />
          Stripe Dashboard
        </Button>
      </div>

      {!stripeStatus.payoutsEnabled && (
        <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-amber-900 font-medium mb-1">Action Required</p>
              <p className="text-sm text-amber-800 mb-2">
                Complete your verification to enable payouts
              </p>
              <Button
                size="sm"
                className="bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white"
                onClick={() => setShowOnboarding(true)}
              >
                Complete Setup
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Overview Tab
  const renderOverviewTab = () => (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Total Earned */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-lg transition-shadow">
          <div className="flex items-start justify-between mb-3">
            <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-emerald-500 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <button className="text-gray-400 hover:text-gray-600">
              <HelpCircle className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-gray-600">Total Earned</p>
            <p className="text-2xl font-semibold text-gray-900">
              ${earnings.totalEarned.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-green-600 flex items-center gap-1">
              <ArrowUpRight className="w-3 h-3" />
              +12.5% from last month
            </p>
          </div>
        </div>

        {/* Pending Payout */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-lg transition-shadow">
          <div className="flex items-start justify-between mb-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-lg flex items-center justify-center">
              <Clock className="w-5 h-5 text-white" />
            </div>
            <button className="text-gray-400 hover:text-gray-600">
              <HelpCircle className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-gray-600">Pending Payout</p>
            <p className="text-2xl font-semibold text-gray-900">
              ${earnings.pendingPayout.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-gray-500">
              Due {earnings.nextPayoutDate}
            </p>
          </div>
        </div>

        {/* Escrow Balance */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-lg transition-shadow">
          <div className="flex items-start justify-between mb-3">
            <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-orange-500 rounded-lg flex items-center justify-center">
              <Lock className="w-5 h-5 text-white" />
            </div>
            <button className="text-gray-400 hover:text-gray-600">
              <HelpCircle className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-gray-600">Funds Held</p>
            <p className="text-2xl font-semibold text-gray-900">
              ${earnings.escrowBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-gray-500">
              Awaiting validation
            </p>
          </div>
        </div>

        {/* Next Payout */}
        <div className="bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-xl p-5 text-white">
          <div className="flex items-start justify-between mb-3">
            <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-lg flex items-center justify-center">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            <Zap className="w-5 h-5 text-white/80" />
          </div>
          <div className="space-y-1">
            <p className="text-sm text-white/80">Next Payout</p>
            <p className="text-2xl font-semibold">
              ${earnings.pendingPayout.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-white/80">
              {earnings.nextPayoutDate}
            </p>
          </div>
        </div>
      </div>

      {/* Payout Timeline Visualization */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Payout Timeline</h3>
            <p className="text-sm text-gray-600">How your earnings flow from sale to payout</p>
          </div>
          <Button variant="outline" size="sm" className="flex items-center gap-2">
            <Info className="w-4 h-4" />
            Learn More
          </Button>
        </div>

        <div className="relative">
          <div className="flex items-center justify-between">
            {PAYOUT_TIMELINE_STAGES.map((stage, index) => (
              <React.Fragment key={stage.id}>
                <div className="flex flex-col items-center flex-1">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 ${
                    stage.color === 'green' ? 'bg-green-100 text-green-600' :
                    stage.color === 'blue' ? 'bg-blue-100 text-blue-600' :
                    'bg-amber-100 text-amber-600'
                  }`}>
                    <stage.icon className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-medium text-gray-900 text-center mb-1">{stage.label}</p>
                  <p className="text-xs text-gray-500 text-center max-w-[120px]">
                    {index === 0 && 'Customer books experience'}
                    {index === 1 && 'Experience completed & verified'}
                    {index === 2 && 'Stripe holding period'}
                    {index === 3 && 'Transferred to your account'}
                  </p>
                </div>
                {index < PAYOUT_TIMELINE_STAGES.length - 1 && (
                  <div className="w-full max-w-[80px] h-0.5 bg-gray-200 mb-16" />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-900">
              <p className="font-medium mb-1">Standard Timeline</p>
              <ul className="space-y-1 text-blue-800">
                <li>• Domestic transfers: 3-5 business days after validation</li>
                <li>• International transfers: 5-7 business days after validation</li>
                <li>• Instant payout available for eligible transactions (3% fee)</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Alert Cards */}
      <div className="space-y-3">
        {earnings.escrowBalance > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Lock className="w-5 h-5 text-amber-600" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-amber-900 mb-1">Funds Held for Validation</p>
                <p className="text-sm text-amber-800 mb-3">
                  ${earnings.escrowBalance.toFixed(2)} is being held until experiences are validated by customers. This typically takes 24-48 hours after the experience date.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-amber-300 text-amber-700 hover:bg-amber-100"
                >
                  View Pending Validations
                </Button>
              </div>
            </div>
          </div>
        )}

        {earnings.pendingPayout > 50 && (
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5 text-purple-600" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-medium text-purple-900">Instant Payout Available</p>
                  <Badge className="bg-purple-600 text-white">Premium</Badge>
                </div>
                <p className="text-sm text-purple-800 mb-3">
                  Get ${earnings.pendingPayout.toFixed(2)} now instead of waiting until {earnings.nextPayoutDate}. 3% fee applies (${(earnings.pendingPayout * 0.03).toFixed(2)}).
                </p>
                <Button
                  size="sm"
                  className="bg-gradient-to-r from-purple-600 to-purple-700 text-white hover:from-purple-700 hover:to-purple-800"
                >
                  <Zap className="w-4 h-4 mr-2" />
                  Request Instant Payout
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // Earnings Tab with Detailed Transactions
  const renderEarningsTab = () => {
    const filteredTransactions = MOCK_TRANSACTIONS.filter(txn => {
      if (statusFilter !== 'all' && txn.status !== statusFilter) return false;
      return true;
    });

    return (
      <div className="space-y-6">
        {/* Filters and Controls */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7days">Last 7 days</SelectItem>
                <SelectItem value="30days">Last 30 days</SelectItem>
                <SelectItem value="90days">Last 90 days</SelectItem>
                <SelectItem value="year">This year</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="held">Held</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowConvertedAmounts(!showConvertedAmounts)}
              className="flex items-center gap-2"
            >
              {showConvertedAmounts ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {showConvertedAmounts ? 'Hide' : 'Show'} Conversions
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export
            </Button>
          </div>
        </div>

        {/* Earnings Table */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date / Experience
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Sale Amount
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Fees
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Net Earnings
                  </th>
                  <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredTransactions.map((txn) => {
                  const totalFees = txn.platformFee + txn.stripeFee + txn.fxFee;
                  
                  return (
                    <tr key={txn.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{txn.experienceName}</p>
                          <p className="text-xs text-gray-500">{txn.date}</p>
                          {txn.buyerCurrency !== txn.currency && showConvertedAmounts && (
                            <p className="text-xs text-blue-600 mt-1">
                              Buyer paid: {txn.buyerCurrency} {txn.buyerAmount.toFixed(2)}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <p className="text-sm font-medium text-gray-900">
                          ${txn.saleAmount.toFixed(2)}
                        </p>
                        <p className="text-xs text-gray-500">{txn.currency}</p>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => setShowFeeBreakdown(txn.id)}
                          className="text-sm text-gray-900 hover:text-[#eb7825] transition-colors"
                        >
                          -${totalFees.toFixed(2)}
                        </button>
                        <p className="text-xs text-gray-500">
                          ({((totalFees / txn.saleAmount) * 100).toFixed(1)}%)
                        </p>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <p className="text-sm font-semibold text-green-600">
                          ${txn.netEarnings.toFixed(2)}
                        </p>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <Badge className={
                          txn.status === 'paid' ? 'bg-green-100 text-green-700 border-green-200' :
                          txn.status === 'available' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                          txn.status === 'pending' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                          'bg-gray-100 text-gray-700 border-gray-200'
                        }>
                          {txn.status === 'paid' && <Check className="w-3 h-3 mr-1" />}
                          {txn.status === 'pending' && <Clock className="w-3 h-3 mr-1" />}
                          {txn.status === 'held' && <Lock className="w-3 h-3 mr-1" />}
                          {txn.status.charAt(0).toUpperCase() + txn.status.slice(1)}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowFeeBreakdown(txn.id)}
                          className="text-gray-600 hover:text-gray-900"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filteredTransactions.length === 0 && (
            <div className="py-12 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-600 mb-2">No transactions found</p>
              <p className="text-sm text-gray-500">Try adjusting your filters</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Tax & Compliance Tab
  const renderTaxTab = () => (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Tax Information</h3>
        
        <div className="space-y-4">
          {/* Tax Form Status */}
          <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <FileText className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="font-medium text-green-900">W-9 Form</p>
                <p className="text-sm text-green-700">Submitted & Verified</p>
              </div>
            </div>
            <Badge className="bg-green-600 text-white">
              <Check className="w-3 h-3 mr-1" />
              Active
            </Badge>
          </div>

          {/* Tax Summary */}
          <div className="p-4 border border-gray-200 rounded-lg">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-medium text-gray-900">2025 Tax Year</h4>
              <Button variant="outline" size="sm" className="flex items-center gap-2">
                <Download className="w-4 h-4" />
                Download 1099
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Income</p>
                <p className="text-xl font-semibold text-gray-900">${earnings.lifetimeEarnings.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Reportable Amount</p>
                <p className="text-xl font-semibold text-gray-900">${earnings.totalEarned.toFixed(2)}</p>
              </div>
            </div>
          </div>

          {/* Info */}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-900">
                <p className="font-medium mb-1">Tax Reporting</p>
                <p className="text-blue-800">
                  Stripe handles tax reporting for your jurisdiction. You'll receive a 1099 form if you earned over $600 in the tax year.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Fee Breakdown Modal
  const renderFeeBreakdownModal = () => {
    const transaction = MOCK_TRANSACTIONS.find(t => t.id === showFeeBreakdown);
    if (!transaction) return null;

    const totalFees = transaction.platformFee + transaction.stripeFee + transaction.fxFee;
    const platformPercent = (transaction.platformFee / transaction.saleAmount) * 100;
    const stripePercent = (transaction.stripeFee / transaction.saleAmount) * 100;
    const fxPercent = (transaction.fxFee / transaction.saleAmount) * 100;
    const netPercent = (transaction.netEarnings / transaction.saleAmount) * 100;

    return (
      <Dialog open={!!showFeeBreakdown} onOpenChange={() => setShowFeeBreakdown(null)}>
        <DialogContent className="max-w-md">
          <DialogTitle>Fee Breakdown</DialogTitle>
          <DialogDescription>
            Detailed breakdown for {transaction.experienceName}
          </DialogDescription>

          <div className="space-y-6 py-4">
            {/* Visual Breakdown */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Sale Amount</span>
                <span className="text-sm font-semibold text-gray-900">
                  ${transaction.saleAmount.toFixed(2)}
                </span>
              </div>
              
              <Separator />

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-[#eb7825] rounded-sm" />
                    <span className="text-sm text-gray-700">Platform Fee ({platformPercent.toFixed(1)}%)</span>
                  </div>
                  <span className="text-sm text-gray-900">-${transaction.platformFee.toFixed(2)}</span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-blue-500 rounded-sm" />
                    <span className="text-sm text-gray-700">Stripe Fee ({stripePercent.toFixed(1)}%)</span>
                  </div>
                  <span className="text-sm text-gray-900">-${transaction.stripeFee.toFixed(2)}</span>
                </div>

                {transaction.fxFee > 0 && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-purple-500 rounded-sm" />
                      <span className="text-sm text-gray-700">FX Fee ({fxPercent.toFixed(1)}%)</span>
                    </div>
                    <span className="text-sm text-gray-900">-${transaction.fxFee.toFixed(2)}</span>
                  </div>
                )}
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-500 rounded-sm" />
                  <span className="text-sm font-medium text-gray-900">You Earn ({netPercent.toFixed(1)}%)</span>
                </div>
                <span className="text-lg font-semibold text-green-600">
                  ${transaction.netEarnings.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Visual Chart */}
            <div className="h-8 flex rounded-lg overflow-hidden">
              <div 
                className="bg-[#eb7825]" 
                style={{ width: `${platformPercent}%` }}
                title={`Platform: ${platformPercent.toFixed(1)}%`}
              />
              <div 
                className="bg-blue-500" 
                style={{ width: `${stripePercent}%` }}
                title={`Stripe: ${stripePercent.toFixed(1)}%`}
              />
              {transaction.fxFee > 0 && (
                <div 
                  className="bg-purple-500" 
                  style={{ width: `${fxPercent}%` }}
                  title={`FX: ${fxPercent.toFixed(1)}%`}
                />
              )}
              <div 
                className="bg-green-500" 
                style={{ width: `${netPercent}%` }}
                title={`You earn: ${netPercent.toFixed(1)}%`}
              />
            </div>

            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-600 mb-2">
                <strong>Note:</strong> Stripe processing fees are automatically deducted. Platform fees support Mingla operations and curator tools.
              </p>
              {transaction.fxFee > 0 && (
                <p className="text-xs text-gray-600">
                  <strong>Currency Conversion:</strong> A small fee applies when buyer currency differs from your payout currency.
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  return (
    <div className="space-y-6">
      {/* Stripe Status Widget */}
      {renderStripeStatusWidget()}

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
        <TabsList className="grid w-full grid-cols-4 mb-6">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="earnings" className="flex items-center gap-2">
            <DollarSign className="w-4 h-4" />
            Earnings
          </TabsTrigger>
          <TabsTrigger value="payouts" className="flex items-center gap-2">
            <CreditCard className="w-4 h-4" />
            Payouts
          </TabsTrigger>
          <TabsTrigger value="tax" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Tax & Compliance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">{renderOverviewTab()}</TabsContent>
        <TabsContent value="earnings">{renderEarningsTab()}</TabsContent>
        <TabsContent value="payouts">
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CreditCard className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Payout History</h3>
            <p className="text-gray-600 mb-4">View your completed payouts and payout schedule</p>
            <Button className="bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white">
              View Payout History
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="tax">{renderTaxTab()}</TabsContent>
      </Tabs>

      {/* Modals */}
      {renderFeeBreakdownModal()}
      
      <PayoutOnboardingFlow
        isOpen={showOnboarding}
        onClose={() => setShowOnboarding(false)}
        onComplete={(data) => {
          console.log('Payout setup completed:', data);
          setShowOnboarding(false);
        }}
      />
    </div>
  );
}
