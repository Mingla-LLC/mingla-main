import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  DollarSign, Calendar, Download, ChevronRight, Plus,
  CheckCircle, Clock, AlertCircle, CreditCard, Building2, Smartphone,
  Globe, Upload, ArrowRight, Info, ExternalLink, TrendingUp,
  FileText, Edit, Trash2, AlertTriangle
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Separator } from './ui/separator';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { GLOBAL_COUNTRIES, GlobalCoverageSummary, CountrySelector, MobileMoneyInfo } from './PayoutsSystemGlobal';

interface PayoutsSystemProps {
  curatorData?: {
    name: string;
    email: string;
    country?: string;
  };
}

const PAYMENT_TYPES = [
  { 
    id: 'bank',
    name: 'Bank Transfer',
    icon: Building2,
    description: 'Direct deposit to your bank account',
    countries: ['All countries'],
    processingTime: '3-5 business days'
  },
  {
    id: 'wise',
    name: 'Wise',
    icon: Globe,
    description: 'Multi-currency account with low fees',
    countries: ['Global - 160+ countries'],
    processingTime: '1-2 business days'
  },
  {
    id: 'paypal',
    name: 'PayPal',
    icon: CreditCard,
    description: 'Fast and secure online payments',
    countries: ['200+ countries'],
    processingTime: '1 business day'
  },
  {
    id: 'mobile',
    name: 'Mobile Money',
    icon: Smartphone,
    description: 'M-Pesa, bKash, GCash, and regional wallets',
    countries: ['Africa, Asia, Latin America'],
    processingTime: 'Instant - 24 hours'
  }
];

export default function PayoutsSystem({ curatorData }: PayoutsSystemProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'methods' | 'tax'>('overview');
  const [showAddMethodModal, setShowAddMethodModal] = useState(false);
  const [addMethodStep, setAddMethodStep] = useState(1);
  const [selectedPaymentType, setSelectedPaymentType] = useState<string | null>(null);
  const [showPayoutDetailsDrawer, setShowPayoutDetailsDrawer] = useState(false);
  const [selectedPayout, setSelectedPayout] = useState<any>(null);
  const [dateFilter, setDateFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [formData, setFormData] = useState({
    accountHolder: '',
    accountNumber: '',
    routingNumber: '',
    bankName: '',
    country: '',
    currency: 'USD',
    email: '',
    mobileService: '',
    mobileNumber: '',
    setDefault: false
  });

  // Mock data
  const upcomingPayout = {
    amount: 425.00,
    currency: 'USD',
    convertedAmount: 35100,
    convertedCurrency: 'INR',
    payoutDate: '2025-10-22',
    method: 'Wise account ending •••7421'
  };

  const paymentMethods = [
    {
      id: '1',
      type: 'bank',
      name: 'Bank Transfer',
      currency: 'USD',
      status: 'active',
      lastPayout: '2025-10-01',
      accountEnding: '•••4532',
      isDefault: true
    },
    {
      id: '2',
      type: 'wise',
      name: 'Wise',
      currency: 'EUR',
      status: 'verified',
      lastPayout: '2025-09-15',
      accountEnding: '•••7421',
      isDefault: false
    },
    {
      id: '3',
      type: 'paypal',
      name: 'PayPal',
      currency: 'GBP',
      status: 'pending',
      lastPayout: null,
      accountEnding: '•••@email.com',
      isDefault: false
    }
  ];

  const payouts = [
    {
      id: '1',
      period: 'Sep 1-30, 2025',
      experiences: 12,
      gross: 2840.00,
      minglaFee: 284.00,
      conversionFee: 56.80,
      fxRate: 1.12,
      net: 2499.20,
      currency: 'EUR',
      status: 'paid',
      paidDate: '2025-10-01',
      breakdown: [
        { experience: 'Sunset Rooftop Wine Tasting', sales: 8, amount: 680.00 },
        { experience: 'Artisan Chocolate Workshop', sales: 4, amount: 380.00 },
      ]
    },
    {
      id: '2',
      period: 'Aug 1-31, 2025',
      experiences: 15,
      gross: 3150.00,
      minglaFee: 315.00,
      conversionFee: 63.00,
      fxRate: 1.11,
      net: 2772.00,
      currency: 'EUR',
      status: 'paid',
      paidDate: '2025-09-01'
    },
    {
      id: '3',
      period: 'Jul 1-31, 2025',
      experiences: 10,
      gross: 2200.00,
      minglaFee: 220.00,
      conversionFee: 44.00,
      fxRate: 1.10,
      net: 1936.00,
      currency: 'EUR',
      status: 'paid',
      paidDate: '2025-08-01'
    },
    {
      id: '4',
      period: 'Oct 1-19, 2025',
      experiences: 8,
      gross: 1680.00,
      minglaFee: 168.00,
      conversionFee: 33.60,
      fxRate: 1.13,
      net: 1478.40,
      currency: 'EUR',
      status: 'processing',
      paidDate: null
    }
  ];

  const monthlyEarnings = [
    { month: 'May', amount: 1850 },
    { month: 'Jun', amount: 2240 },
    { month: 'Jul', amount: 2200 },
    { month: 'Aug', amount: 3150 },
    { month: 'Sep', amount: 2840 },
    { month: 'Oct', amount: 1680 }
  ];

  const kycStatus = {
    verified: false,
    documentsSubmitted: false,
    requiredForAmount: 600
  };

  const getStatusBadge = (status: string) => {
    const config = {
      active: { color: 'bg-green-100 text-green-700 border-green-200', icon: CheckCircle },
      verified: { color: 'bg-blue-100 text-blue-700 border-blue-200', icon: CheckCircle },
      pending: { color: 'bg-yellow-100 text-yellow-700 border-yellow-200', icon: Clock },
      paid: { color: 'bg-green-100 text-green-700 border-green-200', icon: CheckCircle },
      processing: { color: 'bg-blue-100 text-blue-700 border-blue-200', icon: Clock },
      failed: { color: 'bg-red-100 text-red-700 border-red-200', icon: AlertCircle }
    };
    const cfg = config[status as keyof typeof config] || config.pending;
    const Icon = cfg.icon;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border ${cfg.color}`}>
        <Icon className="w-3 h-3" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const getPaymentIcon = (type: string) => {
    const icons = {
      bank: Building2,
      wise: Globe,
      paypal: CreditCard,
      mobile: Smartphone
    };
    return icons[type as keyof typeof icons] || CreditCard;
  };

  // Payouts Overview Tab
  const renderPayoutsOverview = () => (
    <div className="space-y-6">
      {/* Hero Balance Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-6 md:p-8 border border-green-200"
      >
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="flex-1">
            <div className="text-sm text-green-700 mb-2">Next Payout</div>
            <div className="flex items-baseline gap-3 mb-2">
              <span className="text-4xl text-green-900">${upcomingPayout.amount.toFixed(2)}</span>
              <span className="text-lg text-green-700">
                USD ≈ ₹{upcomingPayout.convertedAmount.toLocaleString()} INR
              </span>
            </div>
            <p className="text-sm text-green-700">
              Will be sent to <span className="font-medium">{upcomingPayout.method}</span> on{' '}
              <span className="font-medium">
                {new Date(upcomingPayout.payoutDate).toLocaleDateString('en-US', { 
                  month: 'short', 
                  day: 'numeric', 
                  year: 'numeric' 
                })}
              </span>
            </p>
          </div>
          <Button
            onClick={() => setActiveTab('methods')}
            variant="outline"
            className="bg-white hover:bg-green-50 border-green-300"
          >
            Change payout method
          </Button>
        </div>
      </motion.div>

      {/* Monthly Earnings Chart */}
      <div className="bg-white rounded-2xl p-6 border border-gray-200">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-gray-900 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[#eb7825]" />
            Monthly Earnings
          </h3>
          <select className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#eb7825] focus:border-transparent">
            <option>Last 6 months</option>
            <option>Last 12 months</option>
            <option>All time</option>
          </select>
        </div>
        <div className="flex items-end gap-2 h-48">
          {monthlyEarnings.map((item, i) => {
            const maxAmount = Math.max(...monthlyEarnings.map(m => m.amount));
            const heightPercent = (item.amount / maxAmount) * 100;
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full relative group">
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${heightPercent}%` }}
                    transition={{ delay: i * 0.1, duration: 0.5 }}
                    className="w-full bg-gradient-to-t from-[#eb7825] to-[#d6691f] rounded-t-lg min-h-[20px] cursor-pointer hover:opacity-80 transition-opacity"
                    style={{ height: `${heightPercent}%` }}
                  />
                  <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    ${item.amount}
                  </div>
                </div>
                <div className="text-xs text-gray-500">{item.month}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="px-4 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#eb7825] focus:border-transparent"
        >
          <option value="all">All time</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="year">This year</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#eb7825] focus:border-transparent"
        >
          <option value="all">All statuses</option>
          <option value="paid">Paid</option>
          <option value="processing">Processing</option>
          <option value="pending">Pending</option>
        </select>
        <Button variant="outline" className="gap-2 sm:ml-auto">
          <Download className="w-4 h-4" />
          Export
        </Button>
      </div>

      {/* Payouts Ledger */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="p-4 bg-gray-50 border-b border-gray-200">
          <h3 className="text-gray-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#eb7825]" />
            Payout History
          </h3>
        </div>

        {/* Desktop Table */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs text-gray-500">Period</th>
                <th className="px-6 py-3 text-left text-xs text-gray-500">Experiences</th>
                <th className="px-6 py-3 text-right text-xs text-gray-500">Gross (USD)</th>
                <th className="px-6 py-3 text-right text-xs text-gray-500">Fees</th>
                <th className="px-6 py-3 text-right text-xs text-gray-500">FX Rate</th>
                <th className="px-6 py-3 text-right text-xs text-gray-500">Net (EUR)</th>
                <th className="px-6 py-3 text-left text-xs text-gray-500">Status</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {payouts.map((payout) => (
                <tr key={payout.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 text-sm text-gray-900">{payout.period}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{payout.experiences}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 text-right">
                    ${payout.gross.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-sm text-red-600 text-right">
                    -${(payout.minglaFee + payout.conversionFee).toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 text-right">
                    {payout.fxRate.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-sm text-green-900 text-right">
                    €{payout.net.toFixed(2)}
                  </td>
                  <td className="px-6 py-4">{getStatusBadge(payout.status)}</td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => {
                        setSelectedPayout(payout);
                        setShowPayoutDetailsDrawer(true);
                      }}
                      className="text-[#eb7825] hover:text-[#d6691f] text-sm flex items-center gap-1"
                    >
                      Details
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Card List */}
        <div className="lg:hidden divide-y divide-gray-100">
          {payouts.map((payout) => (
            <div key={payout.id} className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-sm text-gray-900 mb-1">{payout.period}</div>
                  <div className="text-xs text-gray-500">{payout.experiences} experiences</div>
                </div>
                {getStatusBadge(payout.status)}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                <div>
                  <div className="text-xs text-gray-500">Gross</div>
                  <div className="text-gray-900">${payout.gross.toFixed(2)}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500">Net</div>
                  <div className="text-green-900">€{payout.net.toFixed(2)}</div>
                </div>
              </div>
              <Button
                onClick={() => {
                  setSelectedPayout(payout);
                  setShowPayoutDetailsDrawer(true);
                }}
                variant="outline"
                size="sm"
                className="w-full"
              >
                View Details
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // Payment Methods Tab
  const renderPaymentMethods = () => (
    <div className="space-y-6">
      {/* Global Coverage Summary */}
      <GlobalCoverageSummary />

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-gray-900">Connected Payment Methods</h3>
          <p className="text-sm text-gray-500 mt-1">Manage how you receive payouts</p>
        </div>
        <Button
          onClick={() => {
            setShowAddMethodModal(true);
            setAddMethodStep(1);
            setSelectedPaymentType(null);
          }}
          className="bg-gradient-to-r from-[#eb7825] to-[#d6691f]"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Method
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {paymentMethods.map((method) => {
          const Icon = getPaymentIcon(method.type);
          return (
            <motion.div
              key={method.id}
              whileHover={{ y: -2 }}
              className="bg-white rounded-xl p-6 border border-gray-200 hover:shadow-lg transition-all"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 bg-gradient-to-br from-gray-100 to-gray-50 rounded-xl flex items-center justify-center">
                  <Icon className="w-6 h-6 text-gray-600" />
                </div>
                <div className="flex gap-2">
                  {getStatusBadge(method.status)}
                  {method.isDefault && (
                    <Badge className="bg-[#eb7825] text-white">Default</Badge>
                  )}
                </div>
              </div>

              <div className="space-y-2 mb-4">
                <h4 className="text-gray-900">{method.name}</h4>
                <div className="text-sm text-gray-500">
                  {method.accountEnding} • {method.currency}
                </div>
                {method.lastPayout && (
                  <div className="text-xs text-gray-400">
                    Last payout: {new Date(method.lastPayout).toLocaleDateString()}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1">
                  <Edit className="w-4 h-4 mr-1" />
                  Edit
                </Button>
                {!method.isDefault && (
                  <Button variant="outline" size="sm">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Empty State */}
      {paymentMethods.length === 0 && (
        <div className="bg-gray-50 rounded-2xl p-12 text-center">
          <CreditCard className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-gray-900 mb-2">No payment methods yet</h3>
          <p className="text-gray-500 mb-6 max-w-md mx-auto">
            Add a payment method to start receiving payouts for your curated experiences
          </p>
          <Button
            onClick={() => setShowAddMethodModal(true)}
            className="bg-gradient-to-r from-[#eb7825] to-[#d6691f]"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Your First Method
          </Button>
        </div>
      )}
    </div>
  );

  // Tax & Verification Tab
  const renderTaxVerification = () => (
    <div className="space-y-6">
      {/* KYC Status Card */}
      <div className={`rounded-2xl p-6 border-2 ${
        kycStatus.verified 
          ? 'bg-green-50 border-green-200' 
          : 'bg-yellow-50 border-yellow-200'
      }`}>
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
            kycStatus.verified ? 'bg-green-100' : 'bg-yellow-100'
          }`}>
            {kycStatus.verified ? (
              <CheckCircle className="w-6 h-6 text-green-600" />
            ) : (
              <AlertTriangle className="w-6 h-6 text-yellow-600" />
            )}
          </div>
          <div className="flex-1">
            <h3 className={`mb-2 ${kycStatus.verified ? 'text-green-900' : 'text-yellow-900'}`}>
              {kycStatus.verified ? 'KYC Verified ✅' : 'Action Required ⚠️'}
            </h3>
            <p className={`text-sm mb-4 ${kycStatus.verified ? 'text-green-700' : 'text-yellow-700'}`}>
              {kycStatus.verified 
                ? 'Your identity has been verified. You can receive payouts of any amount.'
                : `Verification is required for payouts exceeding $${kycStatus.requiredForAmount}/year. Complete verification to unlock unlimited payouts.`
              }
            </p>
            {!kycStatus.verified && (
              <Button className="bg-gradient-to-r from-[#eb7825] to-[#d6691f]">
                Start Verification
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Document Upload Section */}
      <div className="bg-white rounded-2xl p-6 border border-gray-200">
        <h3 className="text-gray-900 mb-4">Tax Documents</h3>
        <p className="text-sm text-gray-500 mb-6">
          Upload your tax forms to comply with international tax regulations
        </p>

        <div className="space-y-4">
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-[#eb7825] transition-colors cursor-pointer">
            <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
            <h4 className="text-gray-900 mb-1">Upload Tax Form</h4>
            <p className="text-sm text-gray-500 mb-4">
              W-8BEN (Non-US) or W-9 (US) • PDF, max 10MB
            </p>
            <Button variant="outline">
              <Upload className="w-4 h-4 mr-2" />
              Choose File
            </Button>
          </div>
        </div>
      </div>

      {/* Tax Information Summary */}
      <div className="bg-white rounded-2xl p-6 border border-gray-200">
        <h3 className="text-gray-900 mb-4">Legal Information</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-3 border-b border-gray-100">
            <span className="text-sm text-gray-600">Full Legal Name</span>
            <span className="text-sm text-gray-900">{curatorData?.name || 'Not provided'}</span>
          </div>
          <div className="flex items-center justify-between py-3 border-b border-gray-100">
            <span className="text-sm text-gray-600">Tax Country</span>
            <span className="text-sm text-gray-900">{curatorData?.country || 'Not provided'}</span>
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-gray-600">Tax ID (TIN)</span>
            <span className="text-sm text-gray-900">•••-••-1234</span>
          </div>
        </div>
        <Button variant="outline" className="w-full mt-4">
          <Edit className="w-4 h-4 mr-2" />
          Update Information
        </Button>
      </div>

      {/* Compliance Notice */}
      <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
        <div className="flex gap-3">
          <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-blue-900 text-sm mb-1">Why do we need this?</h4>
            <p className="text-xs text-blue-700">
              Mingla is required to collect tax information from curators who earn more than ${kycStatus.requiredForAmount} per year. This helps us comply with international tax regulations and ensures proper reporting.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  // Add Payment Method Modal
  const renderAddMethodModal = () => (
    <Dialog open={showAddMethodModal} onOpenChange={setShowAddMethodModal}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogTitle>Add Payment Method</DialogTitle>
        <DialogDescription>
          {addMethodStep === 1 && "Choose how you'd like to receive payouts"}
          {addMethodStep === 2 && "Enter your account details"}
          {addMethodStep === 3 && "Review and confirm"}
        </DialogDescription>

        {/* Progress Indicator */}
        <div className="flex items-center gap-2 mb-6">
          {[1, 2, 3].map((step) => (
            <div 
              key={step} 
              className={`flex-1 h-2 rounded-full ${
                step <= addMethodStep ? 'bg-[#eb7825]' : 'bg-gray-200'
              }`} 
            />
          ))}
        </div>

        {/* Step 1: Select Payment Type */}
        {addMethodStep === 1 && (
          <div className="space-y-3">
            {PAYMENT_TYPES.map((type) => {
              const Icon = type.icon;
              return (
                <button
                  key={type.id}
                  onClick={() => setSelectedPaymentType(type.id)}
                  className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                    selectedPaymentType === type.id
                      ? 'border-[#eb7825] bg-orange-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      selectedPaymentType === type.id ? 'bg-[#eb7825]' : 'bg-gray-100'
                    }`}>
                      <Icon className={`w-6 h-6 ${
                        selectedPaymentType === type.id ? 'text-white' : 'text-gray-600'
                      }`} />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-gray-900 mb-1">{type.name}</h4>
                      <p className="text-sm text-gray-500 mb-2">{type.description}</p>
                      <div className="flex items-center gap-4 text-xs text-gray-400">
                        <span>⏱️ {type.processingTime}</span>
                        <span>🌍 {type.countries[0]}</span>
                      </div>
                    </div>
                    {selectedPaymentType === type.id && (
                      <CheckCircle className="w-6 h-6 text-[#eb7825]" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Step 2: Enter Details */}
        {addMethodStep === 2 && (
          <div className="space-y-4">
            {selectedPaymentType === 'bank' && (
              <>
                <div>
                  <label className="text-sm text-gray-700 mb-1.5 block">Account Holder Name</label>
                  <Input
                    value={formData.accountHolder}
                    onChange={(e) => setFormData({ ...formData, accountHolder: e.target.value })}
                    placeholder="John Doe"
                    className="rounded-xl"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-700 mb-1.5 block">Bank Name</label>
                  <Input
                    value={formData.bankName}
                    onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                    placeholder="Chase Bank"
                    className="rounded-xl"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-gray-700 mb-1.5 block">Account Number</label>
                    <Input
                      value={formData.accountNumber}
                      onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                      placeholder="****1234"
                      className="rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-700 mb-1.5 block">Routing Number</label>
                    <Input
                      value={formData.routingNumber}
                      onChange={(e) => setFormData({ ...formData, routingNumber: e.target.value })}
                      placeholder="********"
                      className="rounded-xl"
                    />
                  </div>
                </div>
              </>
            )}

            {(selectedPaymentType === 'paypal' || selectedPaymentType === 'wise') && (
              <div>
                <label className="text-sm text-gray-700 mb-1.5 block">Account Email</label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="your@email.com"
                  className="rounded-xl"
                />
              </div>
            )}

            {selectedPaymentType === 'mobile' && (
              <>
                <div>
                  <label className="text-sm text-gray-700 mb-1.5 block">Mobile Money Service</label>
                  <Input
                    value={formData.mobileService}
                    onChange={(e) => setFormData({ ...formData, mobileService: e.target.value })}
                    placeholder="e.g., M-Pesa, bKash, GCash"
                    className="rounded-xl"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-700 mb-1.5 block">Mobile Number</label>
                  <Input
                    value={formData.mobileNumber}
                    onChange={(e) => setFormData({ ...formData, mobileNumber: e.target.value })}
                    placeholder="+254 712 345 678"
                    className="rounded-xl"
                  />
                </div>
              </>
            )}

            <div>
              <label className="text-sm text-gray-700 mb-1.5 block">Country</label>
              <CountrySelector 
                value={formData.country} 
                onChange={(code) => {
                  const country = GLOBAL_COUNTRIES.find(c => c.code === code);
                  setFormData({ 
                    ...formData, 
                    country: code,
                    currency: country?.currency || 'USD'
                  });
                }} 
              />
            </div>

            {/* Show mobile money info if country selected */}
            {formData.country && <MobileMoneyInfo countryCode={formData.country} />}
          </div>
        )}

        {/* Step 3: Review */}
        {addMethodStep === 3 && (
          <div className="space-y-6">
            <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
              <div className="flex gap-3">
                <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="text-blue-900 mb-2">
                    We'll convert USD to your selected currency ({formData.currency})
                  </p>
                  <p className="text-blue-700">
                    Current rate: 1 USD = {formData.currency === 'EUR' ? '0.91' : '0.82'} {formData.currency}
                    <br />
                    A 2% FX conversion fee applies.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl p-4 border border-gray-200">
              <h4 className="text-gray-900 mb-3">Payment Method Summary</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Type</span>
                  <span className="text-gray-900">{PAYMENT_TYPES.find(t => t.id === selectedPaymentType)?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Currency</span>
                  <span className="text-gray-900">{formData.currency}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Processing Time</span>
                  <span className="text-gray-900">{PAYMENT_TYPES.find(t => t.id === selectedPaymentType)?.processingTime}</span>
                </div>
              </div>
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.setDefault}
                onChange={(e) => setFormData({ ...formData, setDefault: e.target.checked })}
                className="mt-1"
              />
              <span className="text-sm text-gray-700">
                Set as default payout method
              </span>
            </label>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-4 border-t border-gray-200">
          {addMethodStep > 1 && (
            <Button
              variant="outline"
              onClick={() => setAddMethodStep(addMethodStep - 1)}
            >
              Back
            </Button>
          )}
          <Button
            onClick={() => {
              if (addMethodStep < 3) {
                setAddMethodStep(addMethodStep + 1);
              } else {
                setShowAddMethodModal(false);
                setAddMethodStep(1);
                setSelectedPaymentType(null);
              }
            }}
            className="flex-1 bg-gradient-to-r from-[#eb7825] to-[#d6691f]"
            disabled={addMethodStep === 1 && !selectedPaymentType}
          >
            {addMethodStep === 3 ? 'Confirm & Add' : 'Continue'}
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  // Payout Details Drawer
  const renderPayoutDetailsDrawer = () => {
    if (!selectedPayout) return null;

    return (
      <Dialog open={showPayoutDetailsDrawer} onOpenChange={setShowPayoutDetailsDrawer}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogTitle>Payout Details</DialogTitle>
          <DialogDescription>{selectedPayout.period}</DialogDescription>

          <div className="space-y-6">
            {/* Status Banner */}
            <div className={`rounded-xl p-4 ${
              selectedPayout.status === 'paid' 
                ? 'bg-green-50 border border-green-200' 
                : 'bg-blue-50 border border-blue-200'
            }`}>
              <div className="flex items-center gap-3">
                {selectedPayout.status === 'paid' ? (
                  <CheckCircle className="w-6 h-6 text-green-600" />
                ) : (
                  <Clock className="w-6 h-6 text-blue-600" />
                )}
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {selectedPayout.status === 'paid' ? 'Payout Completed' : 'Processing Payout'}
                  </div>
                  {selectedPayout.paidDate && (
                    <div className="text-xs text-gray-600">
                      Paid on {new Date(selectedPayout.paidDate).toLocaleDateString('en-US', { 
                        month: 'long', 
                        day: 'numeric', 
                        year: 'numeric' 
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Breakdown */}
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="p-4 border-b border-gray-200">
                <h4 className="text-gray-900">Payment Breakdown</h4>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Gross Sales (USD)</span>
                  <span className="text-gray-900">${selectedPayout.gross.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Mingla Platform Fee (10%)</span>
                  <span className="text-red-600">-${selectedPayout.minglaFee.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Currency Conversion Fee (2%)</span>
                  <span className="text-red-600">-${selectedPayout.conversionFee.toFixed(2)}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">FX Rate Applied</span>
                  <span className="text-gray-900">1 USD = {selectedPayout.fxRate} {selectedPayout.currency}</span>
                </div>
                <Separator className="border-gray-300" />
                <div className="flex items-center justify-between">
                  <span className="text-gray-900">Net Amount</span>
                  <span className="text-xl text-green-900">€{selectedPayout.net.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Experience Breakdown */}
            {selectedPayout.breakdown && (
              <div className="bg-white rounded-xl border border-gray-200">
                <div className="p-4 border-b border-gray-200">
                  <h4 className="text-gray-900">Experience Sales</h4>
                </div>
                <div className="divide-y divide-gray-100">
                  {selectedPayout.breakdown.map((item: any, i: number) => (
                    <div key={i} className="p-4 flex items-center justify-between">
                      <div>
                        <div className="text-sm text-gray-900">{item.experience}</div>
                        <div className="text-xs text-gray-500">{item.sales} sales</div>
                      </div>
                      <div className="text-sm text-gray-900">${item.amount.toFixed(2)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1">
                <Download className="w-4 h-4 mr-2" />
                Download PDF
              </Button>
              <Button variant="outline" className="flex-1">
                <ExternalLink className="w-4 h-4 mr-2" />
                View Invoice
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-gray-900">Payouts & Payments</h2>
        <p className="text-gray-500 text-sm mt-1">Manage your earnings and payment methods</p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)}>
        <TabsList className="grid w-full grid-cols-3 rounded-xl">
          <TabsTrigger value="overview">Earnings & Payouts</TabsTrigger>
          <TabsTrigger value="methods">Payment Methods</TabsTrigger>
          <TabsTrigger value="tax">Tax & Verification</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          {renderPayoutsOverview()}
        </TabsContent>

        <TabsContent value="methods" className="mt-6">
          {renderPaymentMethods()}
        </TabsContent>

        <TabsContent value="tax" className="mt-6">
          {renderTaxVerification()}
        </TabsContent>
      </Tabs>

      {/* Modals */}
      {renderAddMethodModal()}
      {renderPayoutDetailsDrawer()}
    </div>
  );
}
