import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, MessageCircle, FileText, Clock, CheckCircle, AlertCircle, Send } from 'lucide-react';

interface ChatHistory {
  id: string;
  messages: Array<{
    id: string;
    text: string;
    sender: 'user' | 'support';
    timestamp: Date;
  }>;
  startedAt: Date;
  status: 'active' | 'closed';
}

interface Ticket {
  id: string;
  subject: string;
  description: string;
  status: 'open' | 'in-progress' | 'resolved';
  createdAt: Date;
  updatedAt: Date;
}

interface SupportPageProps {
  onBack: () => void;
  chatHistory: ChatHistory[];
  onClearHistory?: () => void;
  onStartNewChat?: () => void;
}

export default function SupportPage({ onBack, chatHistory, onClearHistory, onStartNewChat }: SupportPageProps) {
  const [activeTab, setActiveTab] = useState<'chats' | 'tickets'>('chats');
  const [showTicketForm, setShowTicketForm] = useState(false);
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketDescription, setTicketDescription] = useState('');

  // Mock tickets data
  const [tickets] = useState<Ticket[]>([
    {
      id: '1',
      subject: 'Payment processing issue',
      description: 'Having trouble receiving payouts',
      status: 'in-progress',
      createdAt: new Date(2026, 1, 1),
      updatedAt: new Date(2026, 1, 2)
    },
    {
      id: '2',
      subject: 'Booking not showing',
      description: 'A booking from yesterday is not appearing in my dashboard',
      status: 'resolved',
      createdAt: new Date(2026, 0, 28),
      updatedAt: new Date(2026, 0, 29)
    }
  ]);

  const handleSubmitTicket = () => {
    if (!ticketSubject.trim() || !ticketDescription.trim()) return;
    
    // Here you would submit to backend
    console.log('Submitting ticket:', { ticketSubject, ticketDescription });
    setTicketSubject('');
    setTicketDescription('');
    setShowTicketForm(false);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'in-progress': return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'resolved': return 'bg-green-100 text-green-700 border-green-200';
      case 'active': return 'bg-green-100 text-green-700 border-green-200';
      case 'closed': return 'bg-gray-100 text-gray-700 border-gray-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'resolved': return <CheckCircle className="w-3 h-3" />;
      case 'in-progress': return <Clock className="w-3 h-3" />;
      default: return <AlertCircle className="w-3 h-3" />;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100">
      {/* Fixed Header */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="sticky top-0 z-30 bg-white/70 backdrop-blur-2xl border-b border-gray-200/50 px-4 py-3"
      >
        <div className="flex items-center gap-3">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={onBack}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-700" />
          </motion.button>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-xl shadow-lg shadow-[#eb7825]/20">
              <MessageCircle className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-gray-900">Support Center</h1>
              <p className="text-xs text-gray-500">Chat history & tickets</p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Tabs */}
      <div className="sticky top-[57px] z-20 bg-white/70 backdrop-blur-2xl border-b border-gray-200/50 px-4">
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab('chats')}
            className={`flex-1 py-3 text-sm font-semibold transition-all relative ${
              activeTab === 'chats' ? 'text-[#eb7825]' : 'text-gray-500'
            }`}
          >
            Chat History
            {activeTab === 'chats' && (
              <motion.div
                layoutId="activeTab"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-[#eb7825] to-[#d6691f]"
              />
            )}
          </button>
          <button
            onClick={() => setActiveTab('tickets')}
            className={`flex-1 py-3 text-sm font-semibold transition-all relative ${
              activeTab === 'tickets' ? 'text-[#eb7825]' : 'text-gray-500'
            }`}
          >
            Support Tickets
            {activeTab === 'tickets' && (
              <motion.div
                layoutId="activeTab"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-[#eb7825] to-[#d6691f]"
              />
            )}
          </button>
        </div>
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <AnimatePresence mode="wait">
          {activeTab === 'chats' && (
            <motion.div
              key="chats"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-3"
            >
              {/* Start New Chat Button */}
              {onStartNewChat && (
                <motion.button
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onStartNewChat}
                  className="w-full py-3.5 bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white font-semibold rounded-2xl shadow-lg shadow-[#eb7825]/30 flex items-center justify-center gap-2"
                >
                  <MessageCircle className="w-4 h-4" />
                  Start New Chat
                </motion.button>
              )}

              {chatHistory.length === 0 ? (
                <div className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-8 shadow-xl shadow-gray-900/5 text-center">
                  <div className="p-4 bg-gray-100 rounded-full w-fit mx-auto mb-4">
                    <MessageCircle className="w-8 h-8 text-gray-400" />
                  </div>
                  <h3 className="font-bold text-gray-900 mb-2">No Chat History</h3>
                  <p className="text-sm text-gray-500">
                    Your chat conversations will appear here
                  </p>
                </div>
              ) : (
                <>
                  {chatHistory.map((chat) => (
                    <motion.div
                      key={chat.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-4 shadow-xl shadow-gray-900/5"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl">
                            <MessageCircle className="w-4 h-4 text-white" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-gray-900">
                              Chat Session
                            </p>
                            <p className="text-xs text-gray-500">
                              {chat.startedAt.toLocaleDateString()} at {chat.startedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(chat.status)}`}>
                          {chat.status}
                        </span>
                      </div>
                      
                      {/* Message Preview */}
                      <div className="space-y-2 pl-2">
                        {chat.messages.slice(-3).map((msg) => (
                          <div key={msg.id} className="text-xs">
                            <span className="font-medium text-gray-700">
                              {msg.sender === 'user' ? 'You' : 'Support'}:
                            </span>{' '}
                            <span className="text-gray-600">{msg.text}</span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  ))}
                  
                  {onClearHistory && chatHistory.length > 0 && (
                    <motion.button
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={onClearHistory}
                      className="w-full py-3 bg-white/60 backdrop-blur-xl border border-red-200/50 rounded-3xl text-red-600 font-semibold shadow-xl shadow-gray-900/5 hover:bg-red-50/50 transition-all text-sm"
                    >
                      Clear Chat History
                    </motion.button>
                  )}
                </>
              )}
            </motion.div>
          )}

          {activeTab === 'tickets' && (
            <motion.div
              key="tickets"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-3"
            >
              {/* Submit Ticket Button */}
              {!showTicketForm && (
                <motion.button
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowTicketForm(true)}
                  className="w-full py-3.5 bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white font-semibold rounded-2xl shadow-lg shadow-[#eb7825]/30 flex items-center justify-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  Submit New Ticket
                </motion.button>
              )}

              {/* Ticket Form */}
              <AnimatePresence>
                {showTicketForm && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-5 shadow-xl shadow-gray-900/5 space-y-4"
                  >
                    <h3 className="text-base font-bold text-gray-900">Submit Support Ticket</h3>
                    
                    <div>
                      <label className="text-xs font-medium text-gray-600 block mb-2">Subject</label>
                      <input
                        type="text"
                        value={ticketSubject}
                        onChange={(e) => setTicketSubject(e.target.value)}
                        placeholder="Brief description of your issue"
                        className="w-full px-4 py-3 bg-gray-50/80 border border-gray-200/50 rounded-2xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#eb7825]/30 focus:border-[#eb7825]/50 transition-all"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-gray-600 block mb-2">Description</label>
                      <textarea
                        value={ticketDescription}
                        onChange={(e) => setTicketDescription(e.target.value)}
                        placeholder="Provide detailed information about your issue..."
                        rows={5}
                        className="w-full px-4 py-3 bg-gray-50/80 border border-gray-200/50 rounded-2xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#eb7825]/30 focus:border-[#eb7825]/50 transition-all resize-none"
                      />
                    </div>

                    <div className="flex gap-2">
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={handleSubmitTicket}
                        disabled={!ticketSubject.trim() || !ticketDescription.trim()}
                        className={`flex-1 py-3 rounded-2xl font-semibold transition-all ${
                          ticketSubject.trim() && ticketDescription.trim()
                            ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-lg shadow-[#eb7825]/30'
                            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        }`}
                      >
                        <Send className="w-4 h-4 inline mr-2" />
                        Submit Ticket
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setShowTicketForm(false)}
                        className="px-6 py-3 bg-gray-100 text-gray-700 rounded-2xl font-semibold hover:bg-gray-200 transition-all"
                      >
                        Cancel
                      </motion.button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Tickets List */}
              {tickets.map((ticket) => (
                <motion.div
                  key={ticket.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-4 shadow-xl shadow-gray-900/5"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900 mb-1">{ticket.subject}</h4>
                      <p className="text-sm text-gray-600 mb-2">{ticket.description}</p>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span>Created: {ticket.createdAt.toLocaleDateString()}</span>
                        <span>•</span>
                        <span>Updated: {ticket.updatedAt.toLocaleDateString()}</span>
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium border flex items-center gap-1 ${getStatusColor(ticket.status)}`}>
                      {getStatusIcon(ticket.status)}
                      {ticket.status}
                    </span>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom Spacer for Navigation */}
        <div className="h-20" />
      </div>
    </div>
  );
}