import React, { useState, useEffect } from 'react';
import { X, DollarSign, TrendingUp, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { getPlatformCommission } from './utils/platformSettings';

interface CommissionApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  business: any;
  onApprove: (businessId: string) => void;
  onDecline: (businessId: string) => void;
}

export default function CommissionApprovalModal({
  isOpen,
  onClose,
  business,
  onApprove,
  onDecline
}: CommissionApprovalModalProps) {
  const [showConfirmation, setShowConfirmation] = useState<'approve' | 'decline' | null>(null);
  const [platformCommission, setPlatformCommission] = useState(getPlatformCommission());

  // Listen for platform commission changes
  useEffect(() => {
    const handleStorageChange = () => {
      setPlatformCommission(getPlatformCommission());
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  if (!isOpen || !business) return null;

  const curatorCommission = business.curatorCommission || 0;
  const businessRevenue = 100 - platformCommission - curatorCommission;

  const handleApprove = () => {
    onApprove(business.id);
    onClose();
  };

  const handleDecline = () => {
    onDecline(business.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl w-full max-w-lg overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-gray-900">Commission Agreement</h2>
              <p className="text-sm text-gray-600">
                Review curator's commission rate
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {!showConfirmation ? (
            <>
              {/* Curator Info */}
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-sm text-gray-600 mb-1">Curator Requesting</p>
                <p className="font-medium text-gray-900">{business.curatorName || 'Curator'}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Wants to manage experiences for your business
                </p>
              </div>

              {/* Commission Rate */}
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-2">Proposed Commission Rate</p>
                <div className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-br from-orange-50 to-amber-50 rounded-2xl border-2 border-[#eb7825]">
                  <span className="text-4xl font-bold text-[#eb7825]">{curatorCommission}%</span>
                </div>
              </div>

              {/* Revenue Split Breakdown */}
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-5 border border-blue-200">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="w-5 h-5 text-blue-600" />
                  <h3 className="font-medium text-blue-900">Revenue Split on $100 Sale</h3>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Mingla Platform Fee ({platformCommission}%)</p>
                      <p className="text-xs text-gray-600">Required platform commission</p>
                    </div>
                    <span className="text-lg font-bold text-gray-900">${platformCommission.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Curator Commission</p>
                      <p className="text-xs text-gray-600">For managing your experiences</p>
                    </div>
                    <span className="text-lg font-bold text-[#eb7825]">${curatorCommission.toFixed(2)}</span>
                  </div>
                  <div className="pt-3 border-t-2 border-blue-200 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-gray-900">Your Net Revenue</p>
                      <p className="text-xs text-gray-600">What you receive per sale</p>
                    </div>
                    <span className="text-2xl font-bold text-green-600">${businessRevenue.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Info Notice */}
              <div className="bg-yellow-50 rounded-xl p-4 border border-yellow-200">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-medium text-yellow-900 mb-1">
                      What This Means
                    </h4>
                    <ul className="text-sm text-yellow-700 space-y-1 list-disc list-inside">
                      <li>The curator can create and manage experiences for your business</li>
                      <li>All experience bookings will appear in your dashboard</li>
                      <li>You receive {businessRevenue}% of every sale automatically</li>
                      <li>You can view detailed sales reports and analytics</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirmation('decline')}
                  className="flex-1 px-4 py-3 border-2 border-red-300 text-red-700 rounded-xl hover:bg-red-50 transition-colors font-medium flex items-center justify-center gap-2"
                >
                  <XCircle className="w-5 h-5" />
                  Decline
                </button>
                <button
                  onClick={() => setShowConfirmation('approve')}
                  className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl transition-colors font-medium flex items-center justify-center gap-2"
                >
                  <CheckCircle className="w-5 h-5" />
                  Approve Commission
                </button>
              </div>
            </>
          ) : (
            /* Confirmation Screen */
            <div className="text-center py-6">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${
                showConfirmation === 'approve' ? 'bg-green-100' : 'bg-red-100'
              }`}>
                {showConfirmation === 'approve' ? (
                  <CheckCircle className="w-8 h-8 text-green-600" />
                ) : (
                  <XCircle className="w-8 h-8 text-red-600" />
                )}
              </div>
              <h3 className="text-gray-900 mb-2">
                {showConfirmation === 'approve' ? 'Approve Commission?' : 'Decline Commission?'}
              </h3>
              <p className="text-sm text-gray-600 mb-6 max-w-sm mx-auto">
                {showConfirmation === 'approve' 
                  ? `You'll receive ${businessRevenue}% of all sales. The curator can immediately start creating experiences for your business.`
                  : 'The curator will be notified and cannot create experiences until you agree on a commission rate.'
                }
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirmation(null)}
                  className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Go Back
                </button>
                <button
                  onClick={showConfirmation === 'approve' ? handleApprove : handleDecline}
                  className={`flex-1 px-4 py-3 rounded-xl transition-colors font-medium ${
                    showConfirmation === 'approve'
                      ? 'bg-green-600 hover:bg-green-700 text-white'
                      : 'bg-red-600 hover:bg-red-700 text-white'
                  }`}
                >
                  {showConfirmation === 'approve' ? 'Yes, Approve' : 'Yes, Decline'}
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
