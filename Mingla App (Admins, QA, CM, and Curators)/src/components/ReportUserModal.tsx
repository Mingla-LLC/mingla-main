import React, { useState } from 'react';
import { X, Flag, AlertTriangle, MessageSquare, Shield, FileText } from 'lucide-react';

interface ReportUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: {
    id: string;
    name: string;
    username: string;
  };
  onReport: (userId: string, reason: string, details?: string) => void;
}

const reportOptions = [
  {
    id: 'spam',
    label: 'Spam',
    description: 'Unwanted or repetitive messages',
    icon: MessageSquare,
    color: 'text-orange-600'
  },
  {
    id: 'inappropriate-content',
    label: 'Inappropriate Content',
    description: 'Offensive or inappropriate behavior',
    icon: AlertTriangle,
    color: 'text-red-600'
  },
  {
    id: 'harassment',
    label: 'Harassment',
    description: 'Bullying or threatening behavior',
    icon: Shield,
    color: 'text-purple-600'
  },
  {
    id: 'other',
    label: 'Other',
    description: 'Another reason not listed above',
    icon: FileText,
    color: 'text-gray-600'
  }
];

export default function ReportUserModal({ isOpen, onClose, user, onReport }: ReportUserModalProps) {
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [additionalDetails, setAdditionalDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!selectedReason) return;
    
    setIsSubmitting(true);
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    onReport(user.id, selectedReason, additionalDetails || undefined);
    
    // Reset form
    setSelectedReason('');
    setAdditionalDetails('');
    setIsSubmitting(false);
    onClose();
  };

  const handleClose = () => {
    setSelectedReason('');
    setAdditionalDetails('');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-60 p-4 pb-24">
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[calc(100vh-8rem)] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
              <Flag className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Report User</h2>
              <p className="text-sm text-gray-600">@{user.username}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          <div>
            <p className="text-gray-700 mb-4">
              We take reports seriously. Please select the reason that best describes why you're reporting <strong>{user.name}</strong>.
            </p>
            <p className="text-sm text-gray-500">
              This user has been blocked and will no longer be able to contact you.
            </p>
          </div>

          {/* Report Options */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-gray-900">Reason for reporting:</label>
            {reportOptions.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.id}
                  onClick={() => setSelectedReason(option.id)}
                  className={`w-full p-4 rounded-xl border-2 transition-all duration-200 text-left ${
                    selectedReason === option.id
                      ? 'border-[#eb7825] bg-orange-50'
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <Icon className={`w-5 h-5 mt-0.5 ${
                      selectedReason === option.id ? 'text-[#eb7825]' : option.color
                    }`} />
                    <div className="flex-1">
                      <div className={`font-medium ${
                        selectedReason === option.id ? 'text-[#eb7825]' : 'text-gray-900'
                      }`}>
                        {option.label}
                      </div>
                      <div className="text-sm text-gray-600 mt-1">
                        {option.description}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Additional Details */}
          {selectedReason && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-900">
                Additional details (optional):
              </label>
              <textarea
                value={additionalDetails}
                onChange={(e) => setAdditionalDetails(e.target.value)}
                placeholder="Please provide any additional context that might help us review this report..."
                className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#eb7825]/20 focus:border-[#eb7825] transition-colors resize-none"
                rows={3}
                maxLength={500}
              />
              <div className="text-xs text-gray-500 text-right">
                {additionalDetails.length}/500
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 flex gap-3">
          <button
            onClick={handleClose}
            className="flex-1 px-4 py-3 border border-gray-200 rounded-xl hover:bg-gray-50 font-medium text-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedReason || isSubmitting}
            className={`flex-1 px-4 py-3 rounded-xl font-medium transition-all ${
              selectedReason && !isSubmitting
                ? 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white shadow-lg'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Report'}
          </button>
        </div>

        {/* Disclaimer */}
        <div className="px-6 pb-6">
          <p className="text-xs text-gray-500 text-center">
            Reports are reviewed by our moderation team. False reports may result in action on your account.
          </p>
        </div>
      </div>
    </div>
  );
}