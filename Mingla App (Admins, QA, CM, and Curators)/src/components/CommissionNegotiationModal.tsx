import React, { useState } from 'react';
import { X, DollarSign, Send, AlertCircle, TrendingUp, MessageSquare, Calculator, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { getPlatformCommission } from './utils/platformSettings';

interface CommissionNegotiationModalProps {
  isOpen: boolean;
  onClose: () => void;
  purchase: any;
  businessId: string;
  businessName: string;
  currentCommission: number;
  isCurator?: boolean;
}

interface NegotiationMessage {
  id: string;
  from: 'curator' | 'business';
  message: string;
  proposedRate?: number;
  timestamp: string;
}

export default function CommissionNegotiationModal({
  isOpen,
  onClose,
  purchase,
  businessId,
  businessName,
  currentCommission,
  isCurator = false
}: CommissionNegotiationModalProps) {
  const [proposedRate, setProposedRate] = useState(currentCommission.toString());
  const [message, setMessage] = useState('');
  const [negotiations, setNegotiations] = useState<NegotiationMessage[]>([]);
  const [activeTab, setActiveTab] = useState('chat');
  const platformCommission = getPlatformCommission();

  const handleSendProposal = () => {
    if (!proposedRate || parseFloat(proposedRate) < 0 || parseFloat(proposedRate) > 100) {
      alert('Please enter a valid commission rate between 0 and 100');
      return;
    }

    const newMessage: NegotiationMessage = {
      id: Date.now().toString(),
      from: isCurator ? 'curator' : 'business',
      message: message || `Proposed new commission rate: ${proposedRate}%`,
      proposedRate: parseFloat(proposedRate),
      timestamp: new Date().toISOString()
    };

    setNegotiations([...negotiations, newMessage]);
    
    // Save to localStorage
    const key = `commission_negotiation_${purchase.id}`;
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    localStorage.setItem(key, JSON.stringify([...existing, newMessage]));

    setMessage('');
    alert('Proposal sent! Waiting for response.');
  };

  const handleAcceptProposal = (rate: number) => {
    // Update the purchase with new commission
    const purchases = JSON.parse(localStorage.getItem('purchases') || '[]');
    const updated = purchases.map((p: any) => 
      p.id === purchase.id ? { ...p, curatorCommission: (p.amount * rate / 100) } : p
    );
    localStorage.setItem('purchases', JSON.stringify(updated));
    window.dispatchEvent(new Event('storage'));
    
    alert('Commission rate accepted!');
    onClose();
  };

  const businessRevenue = purchase.amount * (100 - platformCommission - parseFloat(proposedRate || '0')) / 100;
  const curatorEarnings = purchase.amount * (parseFloat(proposedRate || '0') / 100);
  const platformFee = purchase.amount * (platformCommission / 100);

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
              className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col relative"
              style={{ pointerEvents: 'auto' }}
            >
            {/* Header */}
            <div className="bg-gradient-to-r from-[#eb7825] to-[#d6691f] px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-white text-xl">Commission Negotiation</h2>
                <p className="text-white/80 text-sm mt-1">{businessName} - {purchase.experienceName}</p>
              </div>
              <button
                onClick={onClose}
                className="text-white/80 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Content - Desktop: 2 Column, Mobile: Tabbed */}
            <div className="flex-1 overflow-hidden">
              {/* Mobile: Tabbed Interface */}
              <div className="lg:hidden h-full flex flex-col">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
                  <TabsList className="grid w-full grid-cols-3 rounded-none bg-gray-100">
                    <TabsTrigger value="chat" className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4" />
                      <span className="hidden sm:inline">Chat</span>
                    </TabsTrigger>
                    <TabsTrigger value="calculator" className="flex items-center gap-2">
                      <Calculator className="w-4 h-4" />
                      <span className="hidden sm:inline">Calculator</span>
                    </TabsTrigger>
                    <TabsTrigger value="info" className="flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      <span className="hidden sm:inline">Info</span>
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="chat" className="flex-1 overflow-y-auto p-4 mt-0">
                    <ChatSection
                      negotiations={negotiations}
                      isCurator={isCurator}
                      handleAcceptProposal={handleAcceptProposal}
                    />
                  </TabsContent>

                  <TabsContent value="calculator" className="flex-1 overflow-y-auto p-4 mt-0">
                    <CalculatorSection
                      proposedRate={proposedRate}
                      setProposedRate={setProposedRate}
                      message={message}
                      setMessage={setMessage}
                      platformCommission={platformCommission}
                      platformFee={platformFee}
                      curatorEarnings={curatorEarnings}
                      businessRevenue={businessRevenue}
                      isCurator={isCurator}
                    />
                  </TabsContent>

                  <TabsContent value="info" className="flex-1 overflow-y-auto p-4 mt-0">
                    <InfoSection
                      purchase={purchase}
                      currentCommission={currentCommission}
                    />
                  </TabsContent>
                </Tabs>
              </div>

              {/* Desktop: 2 Column Layout */}
              <div className="hidden lg:grid lg:grid-cols-[1fr,400px] h-full">
                {/* Left Column: Chat */}
                <div className="border-r border-gray-200 flex flex-col">
                  <div className="p-4 border-b border-gray-200 bg-gray-50">
                    <h3 className="text-gray-900 flex items-center gap-2">
                      <MessageSquare className="w-5 h-5 text-[#eb7825]" />
                      Negotiation Chat
                    </h3>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4">
                    <ChatSection
                      negotiations={negotiations}
                      isCurator={isCurator}
                      handleAcceptProposal={handleAcceptProposal}
                    />
                  </div>
                </div>

                {/* Right Column: Calculator & Info */}
                <div className="flex flex-col overflow-y-auto">
                  {/* Info Section - Sticky at top */}
                  <div className="p-4 border-b border-gray-200 bg-gray-50">
                    <InfoSection
                      purchase={purchase}
                      currentCommission={currentCommission}
                    />
                  </div>
                  
                  {/* Calculator Section */}
                  <div className="p-4">
                    <CalculatorSection
                      proposedRate={proposedRate}
                      setProposedRate={setProposedRate}
                      message={message}
                      setMessage={setMessage}
                      platformCommission={platformCommission}
                      platformFee={platformFee}
                      curatorEarnings={curatorEarnings}
                      businessRevenue={businessRevenue}
                      isCurator={isCurator}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer - Always visible */}
            <div className="border-t border-gray-200 p-4 bg-white flex gap-3">
              <Button
                onClick={onClose}
                variant="outline"
                className="flex-1 rounded-xl"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSendProposal}
                disabled={!proposedRate || parseFloat(proposedRate) < 0}
                className="flex-1 bg-[#eb7825] hover:bg-[#d6691f] text-white rounded-xl"
              >
                <Send className="w-4 h-4 mr-2" />
                Send Proposal
              </Button>
            </div>
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
}

// Chat Section Component
function ChatSection({
  negotiations,
  isCurator,
  handleAcceptProposal
}: {
  negotiations: NegotiationMessage[];
  isCurator: boolean;
  handleAcceptProposal: (rate: number) => void;
}) {
  if (negotiations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center px-4">
        <MessageSquare className="w-16 h-16 text-gray-300 mb-4" />
        <h3 className="text-gray-900 mb-2">No messages yet</h3>
        <p className="text-gray-500 text-sm">
          Start the negotiation by proposing a commission rate
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {negotiations.map((neg) => {
        const isFromMe = neg.from === (isCurator ? 'curator' : 'business');
        return (
          <div
            key={neg.id}
            className={`flex ${isFromMe ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] sm:max-w-[75%] rounded-2xl p-3 ${
                isFromMe
                  ? 'bg-[#eb7825] text-white rounded-br-sm'
                  : 'bg-gray-100 text-gray-900 rounded-bl-sm'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Badge 
                  variant="secondary"
                  className={isFromMe ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'}
                >
                  {neg.from === 'curator' ? 'Curator' : 'Business'}
                </Badge>
                <span className={`text-xs ${isFromMe ? 'text-white/70' : 'text-gray-500'}`}>
                  {new Date(neg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="text-sm mb-2">{neg.message}</p>
              {neg.proposedRate && (
                <div className={`mt-2 pt-2 border-t ${isFromMe ? 'border-white/20' : 'border-gray-200'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className={`text-xs ${isFromMe ? 'text-white/70' : 'text-gray-500'}`}>
                        Proposed Rate
                      </div>
                      <div className={`text-lg ${isFromMe ? 'text-white' : 'text-gray-900'}`}>
                        {neg.proposedRate}%
                      </div>
                    </div>
                    {!isFromMe && (
                      <Button
                        size="sm"
                        onClick={() => handleAcceptProposal(neg.proposedRate!)}
                        className="bg-green-600 hover:bg-green-700 text-white rounded-lg"
                      >
                        Accept
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Calculator Section Component
function CalculatorSection({
  proposedRate,
  setProposedRate,
  message,
  setMessage,
  platformCommission,
  platformFee,
  curatorEarnings,
  businessRevenue,
  isCurator
}: {
  proposedRate: string;
  setProposedRate: (rate: string) => void;
  message: string;
  setMessage: (msg: string) => void;
  platformCommission: number;
  platformFee: number;
  curatorEarnings: number;
  businessRevenue: number;
  isCurator: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Calculator className="w-5 h-5 text-[#eb7825]" />
        <h3 className="text-gray-900">Commission Calculator</h3>
      </div>

      {/* Commission Input */}
      <div>
        <label className="block text-gray-700 mb-2 text-sm">
          Proposed Commission Rate
        </label>
        <div className="relative">
          <Input
            type="number"
            min="0"
            max="100"
            step="0.5"
            value={proposedRate}
            onChange={(e) => setProposedRate(e.target.value)}
            className="rounded-xl pr-12 text-lg"
            placeholder="0.0"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500">%</span>
        </div>
      </div>

      {/* Revenue Preview */}
      {proposedRate && !isNaN(parseFloat(proposedRate)) && (
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-200">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            <h4 className="text-blue-900">Revenue Split</h4>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Platform Fee</span>
              <div className="text-right">
                <div className="text-gray-900">${platformFee.toFixed(2)}</div>
                <div className="text-xs text-gray-500">{platformCommission}%</div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Curator Earnings</span>
              <div className="text-right">
                <div className="text-[#eb7825]">${curatorEarnings.toFixed(2)}</div>
                <div className="text-xs text-gray-500">{proposedRate}%</div>
              </div>
            </div>
            <div className="pt-3 border-t border-blue-200 flex items-center justify-between">
              <span className="text-gray-900">Business Gets</span>
              <div className="text-right">
                <div className="text-green-600 text-xl">${businessRevenue.toFixed(2)}</div>
                <div className="text-xs text-gray-500">
                  {(100 - platformCommission - parseFloat(proposedRate)).toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Message Input */}
      <div>
        <label className="block text-gray-700 mb-2 text-sm">
          Message (Optional)
        </label>
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Explain your proposal..."
          className="rounded-xl min-h-[80px]"
        />
      </div>

      {/* Info Alert */}
      <div className="bg-yellow-50 rounded-xl p-3 border border-yellow-200">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-yellow-700">
            Both parties must agree before the rate takes effect. The {isCurator ? 'business' : 'curator'} will be notified.
          </p>
        </div>
      </div>
    </div>
  );
}

// Info Section Component
function InfoSection({
  purchase,
  currentCommission
}: {
  purchase: any;
  currentCommission: number;
}) {
  return (
    <div className="space-y-3">
      <h4 className="text-gray-900 flex items-center gap-2">
        <FileText className="w-4 h-4 text-[#eb7825]" />
        Agreement Details
      </h4>
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-200">
        <div className="p-3">
          <div className="text-xs text-gray-500 mb-1">Sale Amount</div>
          <div className="text-gray-900 text-lg">${purchase.amount}</div>
        </div>
        <div className="p-3">
          <div className="text-xs text-gray-500 mb-1">Current Commission</div>
          <div className="text-[#eb7825] text-lg">{currentCommission}%</div>
        </div>
        <div className="p-3">
          <div className="text-xs text-gray-500 mb-1">Purchase Date</div>
          <div className="text-gray-900">
            {new Date(purchase.purchaseDate).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
