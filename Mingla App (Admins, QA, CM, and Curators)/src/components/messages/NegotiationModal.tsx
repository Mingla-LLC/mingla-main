import React from 'react';
import { DollarSign, TrendingUp } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { NegotiationModalProps } from './types';

export default function NegotiationModal({
  isOpen,
  proposedCommission,
  proposalReason,
  onClose,
  onProposedCommissionChange,
  onProposalReasonChange,
  onSubmit
}: NegotiationModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-full bg-[#eb7825]/10 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-[#eb7825]" />
            </div>
            <div>
              <DialogTitle>Propose Commission Rate</DialogTitle>
              <DialogDescription>
                Suggest a new commission rate for this collaboration
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Commission Rate Input */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">
              Commission Rate (%)
            </label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <Input
                type="number"
                min="0"
                max="50"
                step="0.5"
                value={proposedCommission}
                onChange={(e) => onProposedCommissionChange(e.target.value)}
                placeholder="e.g., 15"
                className="pl-10"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Standard range: 10-20%
            </p>
          </div>

          {/* Reason/Message */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">
              Message (Optional)
            </label>
            <Textarea
              value={proposalReason}
              onChange={(e) => onProposalReasonChange(e.target.value)}
              placeholder="Explain your proposal..."
              rows={3}
              className="resize-none"
            />
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm text-blue-800">
              <strong>Tip:</strong> A clear explanation helps the other party understand your reasoning and increases acceptance chances.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={onSubmit}
              disabled={!proposedCommission || parseFloat(proposedCommission) < 0 || parseFloat(proposedCommission) > 50}
              className="flex-1 bg-[#eb7825] hover:bg-[#d6691f]"
            >
              Send Proposal
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
