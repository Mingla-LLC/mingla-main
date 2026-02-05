import React, { useState } from 'react';
import { X, Mail, Send, CheckCircle, Copy, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { toast } from 'sonner@2.0.3';

interface BusinessInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  business: any;
  curatorName: string;
  curatorId: string;
}

export default function BusinessInviteModal({
  isOpen,
  onClose,
  business,
  curatorName,
  curatorId
}: BusinessInviteModalProps) {
  const [email, setEmail] = useState(business.email || '');
  const [message, setMessage] = useState(
    `Hi,\n\nI've been creating amazing experiences for ${business.name} on Mingla. I'd love for you to join the platform so you can view your business dashboard, track sales, manage payouts, and validate purchases.\n\nYour business is already set up and ready to go!\n\nBest regards,\n${curatorName}`
  );
  const [inviteSent, setInviteSent] = useState(false);
  const [inviteLink, setInviteLink] = useState('');

  const handleSendInvite = () => {
    if (!email) {
      toast.error('Please enter an email address');
      return;
    }

    // Generate unique invite link
    const inviteToken = btoa(JSON.stringify({
      businessId: business.id,
      curatorId: curatorId,
      email: email,
      timestamp: Date.now()
    }));

    const link = `${window.location.origin}?invite=${inviteToken}`;
    setInviteLink(link);

    // Save invite to localStorage
    const invites = JSON.parse(localStorage.getItem('businessInvites') || '[]');
    invites.push({
      id: Date.now().toString(),
      businessId: business.id,
      businessName: business.name,
      curatorId: curatorId,
      curatorName: curatorName,
      email: email,
      message: message,
      inviteLink: link,
      token: inviteToken,
      status: 'pending',
      sentAt: new Date().toISOString()
    });
    localStorage.setItem('businessInvites', JSON.stringify(invites));
    window.dispatchEvent(new Event('storage'));

    setInviteSent(true);
    toast.success('Invitation created successfully!');
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(inviteLink);
    toast.success('Invite link copied to clipboard!');
  };

  const handleReset = () => {
    setInviteSent(false);
    setInviteLink('');
    setEmail(business.email || '');
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999]" data-modal-portal="true">
          {/* Backdrop - handles click-outside-to-close */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            style={{ pointerEvents: 'auto' }}
          />
          
          {/* Container - layout only, no pointer events */}
          <div className="absolute inset-0 flex items-center justify-center p-4" style={{ pointerEvents: 'none' }}>
            {/* Content - captures all interactions */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl relative"
              style={{ pointerEvents: 'auto' }}
            >
            {/* Header */}
            <div className="bg-gradient-to-r from-[#eb7825] to-[#d6691f] px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-white text-xl">Invite Business Owner</h2>
                <p className="text-white/80 text-sm mt-1">{business.name}</p>
              </div>
              <button
                onClick={onClose}
                className="text-white/80 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              {!inviteSent ? (
                <div className="space-y-6">
                  {/* Business Info */}
                  <div className="bg-gradient-to-br from-gray-50 to-orange-50 rounded-xl p-4 border border-gray-200">
                    <div className="flex items-center gap-4">
                      {business.logo && (
                        <img 
                          src={business.logo} 
                          alt={business.name}
                          className="w-16 h-16 rounded-xl object-cover"
                        />
                      )}
                      <div>
                        <h3 className="text-gray-900">{business.name}</h3>
                        <p className="text-gray-600 text-sm">{business.category}</p>
                        {business.address && (
                          <p className="text-gray-500 text-xs mt-1">{business.address}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Email Input */}
                  <div>
                    <label className="block text-gray-700 mb-2">
                      Business Owner Email <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <Input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="owner@business.com"
                        className="pl-11 rounded-xl"
                      />
                    </div>
                  </div>

                  {/* Message */}
                  <div>
                    <label className="block text-gray-700 mb-2">
                      Personal Message
                    </label>
                    <Textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      className="rounded-xl min-h-[180px]"
                      placeholder="Add a personal message..."
                    />
                  </div>

                  {/* What They Get */}
                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                    <h4 className="text-blue-900 mb-3">What the business owner gets:</h4>
                    <ul className="space-y-2 text-sm text-blue-700">
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>Access to a complete business dashboard</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>View all experiences created for their business</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>Track sales, revenue, and commission details</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>QR code validation for purchase redemption</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>Manage payouts and financial reports</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>Ability to create their own experiences</span>
                      </li>
                    </ul>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3">
                    <Button
                      onClick={onClose}
                      variant="outline"
                      className="flex-1 rounded-xl"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleSendInvite}
                      className="flex-1 bg-[#eb7825] hover:bg-[#d6691f] text-white rounded-xl"
                    >
                      <Send className="w-4 h-4 mr-2" />
                      Send Invitation
                    </Button>
                  </div>
                </div>
              ) : (
                /* Invite Sent Success */
                <div className="space-y-6">
                  <div className="text-center py-6">
                    <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <CheckCircle className="w-8 h-8 text-green-600" />
                    </div>
                    <h3 className="text-gray-900 mb-2">Invitation Created!</h3>
                    <p className="text-gray-600">
                      Share this link with {business.name}
                    </p>
                  </div>

                  {/* Invite Link */}
                  <div>
                    <label className="block text-gray-700 mb-2 text-sm">
                      Invitation Link
                    </label>
                    <div className="flex gap-2">
                      <Input
                        value={inviteLink}
                        readOnly
                        className="flex-1 rounded-xl bg-gray-50"
                      />
                      <Button
                        onClick={handleCopyLink}
                        variant="outline"
                        className="rounded-xl"
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Email Preview */}
                  <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                    <h4 className="text-gray-900 text-sm mb-2">Message Preview:</h4>
                    <div className="text-sm text-gray-600 whitespace-pre-wrap bg-white rounded-lg p-3 border border-gray-200">
                      {message}
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-300">
                      <p className="text-sm text-gray-600 mb-2">
                        To: <span className="text-gray-900">{email}</span>
                      </p>
                      <a
                        href={inviteLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-[#eb7825] hover:text-[#d6691f] flex items-center gap-1"
                      >
                        {inviteLink.substring(0, 60)}...
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>

                  {/* Next Steps */}
                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                    <h4 className="text-blue-900 mb-2 text-sm">Next Steps:</h4>
                    <ol className="space-y-1 text-sm text-blue-700 list-decimal list-inside">
                      <li>Copy and share the invitation link with the business owner</li>
                      <li>They'll sign up using the link and their business will be pre-configured</li>
                      <li>Once they join, they can access their dashboard immediately</li>
                      <li>You'll continue to manage experiences and earn commissions</li>
                    </ol>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3">
                    <Button
                      onClick={handleReset}
                      variant="outline"
                      className="flex-1 rounded-xl"
                    >
                      Send Another
                    </Button>
                    <Button
                      onClick={onClose}
                      className="flex-1 bg-[#eb7825] hover:bg-[#d6691f] text-white rounded-xl"
                    >
                      Done
                    </Button>
                  </div>
                </div>
              )}
            </div>
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
}
