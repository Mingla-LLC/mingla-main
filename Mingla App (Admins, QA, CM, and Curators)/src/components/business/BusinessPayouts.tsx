import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Wallet, ExternalLink, CheckCircle2, 
  CreditCard, Calendar, ArrowUp, Clock, TrendingUp, ChevronRight
} from 'lucide-react';

interface BusinessPayoutsProps {
  businessData?: any;
  business?: any;
}

export default function BusinessPayouts({ businessData, business }: BusinessPayoutsProps) {
  const [stripeConnected, setStripeConnected] = useState(false); // Change to true to see connected state
  const [showKYCDetails, setShowKYCDetails] = useState(false);

  // Mock balances
  const balances = {
    available: 2456.80,
    pending: 845.20,
    total: 3302.00
  };

  const handleConnectStripe = () => {
    console.log('Redirecting to Stripe Connect...');
    window.open('https://connect.stripe.com/express/oauth/authorize', '_blank');
    setTimeout(() => setStripeConnected(true), 2000);
  };

  const openStripeDashboard = () => {
    window.open('https://dashboard.stripe.com', '_blank');
  };

  const handleWithdraw = () => {
    console.log('Processing withdrawal...');
    // In production, this would trigger an immediate payout via Stripe
  };

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100">
      {/* Fixed Header */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="sticky top-0 z-30 bg-white/70 backdrop-blur-2xl border-b border-gray-200/50 px-4 py-3"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-xl shadow-lg shadow-[#eb7825]/20">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-gray-900">Finance</h1>
              <p className="text-xs text-gray-500">Manage payouts</p>
            </div>
          </div>
          {stripeConnected && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 rounded-full border border-green-200"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
              <span className="text-xs font-medium text-green-700">Active</span>
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {/* Stripe Connection Card */}
        {!stripeConnected ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, type: "spring" }}
            className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-4 shadow-xl shadow-gray-900/5"
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2.5 bg-gradient-to-br from-[#eb7825]/10 to-[#d6691f]/10 rounded-2xl border border-[#eb7825]/20">
                <CreditCard className="w-5 h-5 text-[#eb7825]" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 mb-1">Connect to Stripe</h3>
                <p className="text-sm text-gray-600">Link your account to receive payouts</p>
              </div>
            </div>

            {/* KYC Requirements Toggle */}
            <motion.button
              onClick={() => setShowKYCDetails(!showKYCDetails)}
              className="w-full flex items-center justify-between p-3 bg-gray-50/50 rounded-xl mb-3"
            >
              <span className="text-sm font-medium text-gray-700">Required Information</span>
              <motion.div
                animate={{ rotate: showKYCDetails ? 90 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </motion.div>
            </motion.button>

            <AnimatePresence>
              {showKYCDetails && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="overflow-hidden mb-4"
                >
                  <div className="grid grid-cols-2 gap-2 pt-2">
                    {['Name', 'Email', 'Address', 'Phone Number', 'Date of Birth', 'ID Verification', 'Business Website', 'Business Name', 'Business Descriptor', 'Terms Acceptance'].map((item, idx) => (
                      <motion.div
                        key={item}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="flex items-center gap-2 p-2 bg-white/50 rounded-lg"
                      >
                        <div className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                        <span className="text-xs text-gray-600">{item}</span>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleConnectStripe}
              className="w-full py-3.5 bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white font-semibold rounded-2xl shadow-xl shadow-[#eb7825]/30 flex items-center justify-center gap-2"
            >
              Connect to Stripe
              <ExternalLink className="w-4 h-4" />
            </motion.button>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, type: "spring" }}
            className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-4 shadow-xl shadow-gray-900/5"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <span className="font-medium text-gray-900">Stripe Connected</span>
              </div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={openStripeDashboard}
                className="text-xs font-medium text-[#eb7825] flex items-center gap-1"
              >
                Dashboard
                <ExternalLink className="w-3 h-3" />
              </motion.button>
            </div>

            {/* Balance Cards */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <motion.div
                whileHover={{ y: -2 }}
                className="p-4 bg-gradient-to-br from-[#eb7825]/5 to-[#eb7825]/10 backdrop-blur-sm rounded-2xl border border-[#eb7825]/20"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-[#eb7825]" />
                  <p className="text-xs text-gray-600">Available</p>
                </div>
                <p className="text-2xl font-bold text-gray-900">${balances.available.toFixed(2)}</p>
                <p className="text-xs text-[#eb7825] mt-1 font-medium">Ready to withdraw</p>
              </motion.div>

              <motion.div
                whileHover={{ y: -2 }}
                className="p-4 bg-gradient-to-br from-gray-100 to-gray-200/50 backdrop-blur-sm rounded-2xl border border-gray-300/30"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-gray-400" />
                  <p className="text-xs text-gray-600">Pending</p>
                </div>
                <p className="text-2xl font-bold text-gray-900">${balances.pending.toFixed(2)}</p>
                <p className="text-xs text-gray-500 mt-1 font-medium">Processing</p>
              </motion.div>
            </div>

            {/* Withdraw Button */}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleWithdraw}
              disabled={balances.available <= 0}
              className={`w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2 shadow-lg transition-all ${
                balances.available > 0
                  ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-[#eb7825]/30'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-gray-200'
              }`}
            >
              <ArrowUp className="w-4 h-4" />
              Withdraw ${balances.available.toFixed(2)}
            </motion.button>
          </motion.div>
        )}

        {/* Payment Method */}
        {stripeConnected && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-4 shadow-xl shadow-gray-900/5"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200/50">
                  <CreditCard className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">Payment Method</p>
                  <p className="text-xs text-gray-500 mt-0.5">Bank •••• 4242</p>
                </div>
              </div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={openStripeDashboard}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-xl text-xs font-medium text-gray-700 transition-all"
              >
                Manage
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* Payout History */}
        {stripeConnected && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-4 shadow-xl shadow-gray-900/5"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Payout History</h3>
              <TrendingUp className="w-4 h-4 text-gray-400" />
            </div>

            <div className="space-y-2.5">
              {/* Upcoming Payout */}
              <motion.div
                whileHover={{ x: 2 }}
                className="flex items-center justify-between p-3 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200/50"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500 rounded-xl">
                    <Clock className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Upcoming</p>
                    <p className="text-xs text-gray-500">Feb 10, 2026</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-900">${balances.available.toFixed(2)}</p>
                  <p className="text-xs text-blue-600 font-medium">Scheduled</p>
                </div>
              </motion.div>

              {/* Past Payouts */}
              <PayoutItem date="Feb 3, 2026" amount={1842.50} />
              <PayoutItem date="Jan 27, 2026" amount={2105.25} />
              <PayoutItem date="Jan 20, 2026" amount={1678.90} />
              <PayoutItem date="Jan 13, 2026" amount={2234.75} />

              {/* View All Button */}
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={openStripeDashboard}
                className="w-full py-3 text-sm font-medium text-[#eb7825] flex items-center justify-center gap-2 border border-gray-200 rounded-2xl hover:border-[#eb7825]/50 hover:bg-[#eb7825]/5 transition-all"
              >
                View All in Stripe
                <ExternalLink className="w-3.5 h-3.5" />
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* Bottom Spacer for Navigation */}
        <div className="h-20" />
      </div>
    </div>
  );
}

// Payout History Item Component
function PayoutItem({ date, amount }: { date: string; amount: number }) {
  return (
    <motion.div
      whileHover={{ x: 2 }}
      className="flex items-center justify-between p-3 bg-gray-50/50 backdrop-blur-sm rounded-2xl border border-gray-200/50"
    >
      <div className="flex items-center gap-3">
        <div className="p-2 bg-gray-200 rounded-xl">
          <Calendar className="w-4 h-4 text-gray-600" />
        </div>
        <div>
          <p className="text-sm font-medium text-gray-900">Payout</p>
          <p className="text-xs text-gray-500">{date}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="font-bold text-gray-900">${amount.toFixed(2)}</p>
        <p className="text-xs text-green-600 font-medium">Completed</p>
      </div>
    </motion.div>
  );
}
