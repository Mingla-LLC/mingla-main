import React, { useState, useRef, useEffect } from 'react';
import { X, Send, Paperclip, Smile, CheckCheck, Clock, User, MessageCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface LiveChatSupportProps {
  isOpen?: boolean;
  onClose?: () => void;
  curatorData?: {
    name: string;
    email: string;
  };
  isQAView?: boolean;
}

interface Message {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: Date;
  status?: 'sent' | 'delivered' | 'read';
}

export default function LiveChatSupport({ isOpen = false, onClose = () => {}, curatorData, isQAView = false }: LiveChatSupportProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      sender: 'agent',
      text: `Hi ${curatorData?.name || 'there'}! 👋 I'm Sarah from Mingla Support. How can I help you today?`,
      timestamp: new Date(),
      status: 'delivered'
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [agentTyping, setAgentTyping] = useState(false);
  const [agentStatus, setAgentStatus] = useState<'online' | 'typing' | 'away'>('online');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = () => {
    if (!inputValue.trim()) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: inputValue,
      timestamp: new Date(),
      status: 'sent'
    };

    setMessages([...messages, newMessage]);
    setInputValue('');

    // Simulate agent typing and response
    setTimeout(() => {
      setAgentTyping(true);
      setAgentStatus('typing');
    }, 1000);

    setTimeout(() => {
      const agentMessage: Message = {
        id: (Date.now() + 1).toString(),
        sender: 'agent',
        text: getAgentResponse(inputValue),
        timestamp: new Date(),
        status: 'delivered'
      };
      setMessages(prev => [...prev, agentMessage]);
      setAgentTyping(false);
      setAgentStatus('online');
    }, 3000);
  };

  const getAgentResponse = (userMessage: string): string => {
    const lowerMessage = userMessage.toLowerCase();
    
    if (lowerMessage.includes('card') && lowerMessage.includes('create')) {
      return "I can help you with creating cards! You can create a new experience card by clicking the '+' button in your dashboard. Would you like me to walk you through the process?";
    } else if (lowerMessage.includes('payment') || lowerMessage.includes('payout')) {
      return "For payout-related questions, please visit the Earnings tab in your dashboard. You can manage your payment methods and view payout history there. Need specific help with something?";
    } else if (lowerMessage.includes('business')) {
      return "You can manage your business partnerships in the 'My Businesses' section. This is where you can add new businesses, update existing ones, and create experiences on their behalf. What would you like to know?";
    } else if (lowerMessage.includes('bug') || lowerMessage.includes('error')) {
      return "I'm sorry you're experiencing an issue! Could you please describe what's happening in more detail? You can also submit a bug report through the 'Contact Support' option for our technical team to investigate.";
    } else {
      return "I understand. Let me look into that for you. Could you provide more details so I can assist you better?";
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const quickActions = [
    'How do I create a card?',
    'Payout questions',
    'Business partnership',
    'Technical issue'
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          className="fixed bottom-4 right-4 z-50 w-full max-w-md shadow-2xl rounded-2xl overflow-hidden bg-white border border-gray-200"
          style={{ maxHeight: 'calc(100vh - 100px)' }}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-[#eb7825] to-[#d6691f] px-5 py-4 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                    <MessageCircle className="w-5 h-5" />
                  </div>
                  <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-400 rounded-full border-2 border-white"></div>
                </div>
                <div>
                  <div className="font-medium">Mingla Support</div>
                  <div className="text-xs text-white/80 flex items-center gap-1">
                    {agentStatus === 'online' && (
                      <>
                        <span className="w-1.5 h-1.5 bg-green-400 rounded-full"></span>
                        Online - Sarah
                      </>
                    )}
                    {agentStatus === 'typing' && (
                      <>
                        <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse"></span>
                        Typing...
                      </>
                    )}
                    {agentStatus === 'away' && (
                      <>
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full"></span>
                        Away
                      </>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={onClose}
                className="text-white/80 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="h-96 overflow-y-auto p-4 space-y-4 bg-gray-50">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] ${
                    message.sender === 'user'
                      ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white rounded-2xl rounded-tr-sm'
                      : 'bg-white text-gray-900 rounded-2xl rounded-tl-sm border border-gray-200'
                  } px-4 py-2.5 shadow-sm`}
                >
                  {message.sender === 'agent' && (
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-5 h-5 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-full flex items-center justify-center">
                        <User className="w-3 h-3 text-blue-600" />
                      </div>
                      <span className="text-xs text-gray-500">Sarah - Support Agent</span>
                    </div>
                  )}
                  <p className="text-sm leading-relaxed">{message.text}</p>
                  <div className={`flex items-center gap-1 mt-1 text-xs ${
                    message.sender === 'user' ? 'text-white/70 justify-end' : 'text-gray-400'
                  }`}>
                    <span>{formatTime(message.timestamp)}</span>
                    {message.sender === 'user' && message.status === 'read' && (
                      <CheckCheck className="w-3 h-3" />
                    )}
                    {message.sender === 'user' && message.status === 'delivered' && (
                      <CheckCheck className="w-3 h-3" />
                    )}
                    {message.sender === 'user' && message.status === 'sent' && (
                      <Clock className="w-3 h-3" />
                    )}
                  </div>
                </div>
              </div>
            ))}

            {agentTyping && (
              <div className="flex justify-start">
                <div className="bg-white text-gray-900 rounded-2xl rounded-tl-sm border border-gray-200 px-4 py-3 shadow-sm">
                  <div className="flex gap-1">
                    <motion.div
                      animate={{ y: [0, -5, 0] }}
                      transition={{ repeat: Infinity, duration: 0.6, delay: 0 }}
                      className="w-2 h-2 bg-gray-400 rounded-full"
                    />
                    <motion.div
                      animate={{ y: [0, -5, 0] }}
                      transition={{ repeat: Infinity, duration: 0.6, delay: 0.2 }}
                      className="w-2 h-2 bg-gray-400 rounded-full"
                    />
                    <motion.div
                      animate={{ y: [0, -5, 0] }}
                      transition={{ repeat: Infinity, duration: 0.6, delay: 0.4 }}
                      className="w-2 h-2 bg-gray-400 rounded-full"
                    />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick Actions */}
          {messages.length <= 1 && (
            <div className="px-4 py-3 bg-white border-t border-gray-200">
              <div className="text-xs text-gray-500 mb-2">Quick actions:</div>
              <div className="flex flex-wrap gap-2">
                {quickActions.map((action) => (
                  <button
                    key={action}
                    onClick={() => setInputValue(action)}
                    className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full transition-colors"
                  >
                    {action}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="px-4 py-4 bg-white border-t border-gray-200">
            <div className="flex items-end gap-2">
              <div className="flex-1 relative">
                <Input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Type your message..."
                  className="rounded-xl pr-20 resize-none"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                  <button className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors rounded-lg hover:bg-gray-100">
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <button className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors rounded-lg hover:bg-gray-100">
                    <Smile className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <Button
                onClick={handleSendMessage}
                disabled={!inputValue.trim()}
                size="icon"
                className="bg-gradient-to-r from-[#eb7825] to-[#d6691f] rounded-xl h-10 w-10 flex-shrink-0"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Average response time: 2 minutes
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
