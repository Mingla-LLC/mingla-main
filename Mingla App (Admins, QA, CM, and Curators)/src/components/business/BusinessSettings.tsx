import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  User, Mail, Lock, Bell, Eye, EyeOff, 
  Camera, ChevronRight, FileText, Shield, MessageCircle, Save
} from 'lucide-react';
import { toast } from 'sonner@2.0.3';
import BusinessPrivacyPolicy from './BusinessPrivacyPolicy';
import BusinessTermsConditions from './BusinessTermsConditions';
import SupportChat from './SupportChat';
import SupportOptions from './SupportOptions';
import SupportPage from './SupportPage';

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

interface BusinessSettingsProps {
  businessData?: any;
  onSignOut: () => void;
}

export default function BusinessSettings({ businessData, onSignOut }: BusinessSettingsProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [name, setName] = useState(businessData?.name || 'Business Name');
  const [email, setEmail] = useState(businessData?.email || 'business@email.com');
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const [showTermsConditions, setShowTermsConditions] = useState(false);
  const [showSupportChat, setShowSupportChat] = useState(false);
  const [showSupportOptions, setShowSupportOptions] = useState(false);
  const [showSupportPage, setShowSupportPage] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatHistory[]>([]);
  const [currentChatMessages, setCurrentChatMessages] = useState<Array<{
    id: string;
    text: string;
    sender: 'user' | 'support';
    timestamp: Date;
  }>>([]);

  const handleSave = () => {
    toast.success('Settings saved successfully');
  };

  const handleImageUpload = () => {
    toast.info('Profile picture upload coming soon');
  };

  const openPrivacyPolicy = () => {
    setShowPrivacyPolicy(true);
  };

  const openTerms = () => {
    setShowTermsConditions(true);
  };

  const openSupport = () => {
    setShowSupportOptions(true);
  };

  const handleCloseSupportChat = (messages: Array<{ id: string; text: string; sender: 'user' | 'support'; timestamp: Date }>) => {
    // Save chat history when closing
    if (messages.length > 1) { // More than just the initial greeting
      const newChatHistory: ChatHistory = {
        id: Date.now().toString(),
        messages: messages,
        startedAt: messages[0].timestamp,
        status: 'closed'
      };
      setChatHistory(prev => [newChatHistory, ...prev]);
    }
    setShowSupportChat(false);
  };

  const handleStartLiveChat = () => {
    setShowSupportOptions(false);
    setShowSupportChat(true);
  };

  const handleSubmitTicket = () => {
    setShowSupportOptions(false);
    setShowSupportPage(true);
  };

  const handleViewSupportPage = () => {
    setShowSupportPage(true);
  };

  const handleClearChatHistory = () => {
    setChatHistory([]);
    toast.success('Chat history cleared');
  };

  const handleStartNewChatFromHistory = () => {
    setShowSupportPage(false);
    setShowSupportChat(true);
  };

  if (showPrivacyPolicy) {
    return <BusinessPrivacyPolicy onBack={() => setShowPrivacyPolicy(false)} />;
  }

  if (showTermsConditions) {
    return <BusinessTermsConditions onBack={() => setShowTermsConditions(false)} />;
  }

  if (showSupportPage) {
    return <SupportPage onBack={() => setShowSupportPage(false)} chatHistory={chatHistory} onClearHistory={handleClearChatHistory} onStartNewChat={handleStartNewChatFromHistory} />;
  }

  return (
    <>
      {/* Support Options Modal */}
      <AnimatePresence>
        {showSupportOptions && (
          <SupportOptions 
            onClose={() => setShowSupportOptions(false)}
            onLiveChat={handleStartLiveChat}
            onSubmitTicket={handleSubmitTicket}
            onViewHistory={handleViewSupportPage}
            chatHistoryCount={chatHistory.length}
          />
        )}
      </AnimatePresence>

      {/* Support Chat Modal */}
      <AnimatePresence>
        {showSupportChat && (
          <SupportChat 
            onClose={handleCloseSupportChat}
            userName={name}
          />
        )}
      </AnimatePresence>

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
                <User className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-gray-900">Profile</h1>
                <p className="text-xs text-gray-500">Manage your account</p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {/* Profile Picture & Account Settings */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, type: "spring" }}
            className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-5 shadow-xl shadow-gray-900/5"
          >
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Account Settings</h3>

            {/* Profile Picture */}
            <div className="flex items-center gap-4 mb-5">
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center text-white shadow-lg">
                  <User className="w-10 h-10" />
                </div>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={handleImageUpload}
                  className="absolute bottom-0 right-0 p-1.5 bg-white rounded-full shadow-lg border border-gray-200"
                >
                  <Camera className="w-3.5 h-3.5 text-gray-700" />
                </motion.button>
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900">{name}</p>
                <p className="text-sm text-gray-500">{email}</p>
              </div>
            </div>

            {/* Name Input */}
            <div className="space-y-2 mb-4">
              <label className="text-xs font-medium text-gray-600 block">Name</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2">
                  <User className="w-4 h-4 text-gray-400" />
                </div>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-gray-50/50 border border-gray-200/50 rounded-2xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#eb7825]/30 focus:border-[#eb7825]/50 transition-all"
                  placeholder="Enter your name"
                />
              </div>
            </div>

            {/* Email Input */}
            <div className="space-y-2 mb-4">
              <label className="text-xs font-medium text-gray-600 block">Email</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2">
                  <Mail className="w-4 h-4 text-gray-400" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-gray-50/50 border border-gray-200/50 rounded-2xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#eb7825]/30 focus:border-[#eb7825]/50 transition-all"
                  placeholder="Enter your email"
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-2 mb-5">
              <label className="text-xs font-medium text-gray-600 block">Password</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2">
                  <Lock className="w-4 h-4 text-gray-400" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  defaultValue="••••••••"
                  className="w-full pl-10 pr-12 py-3 bg-gray-50/50 border border-gray-200/50 rounded-2xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#eb7825]/30 focus:border-[#eb7825]/50 transition-all"
                  placeholder="Enter your password"
                />
                <button
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Save Button */}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleSave}
              className="w-full py-3.5 bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white font-semibold rounded-2xl shadow-lg shadow-[#eb7825]/30 flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" />
              Save Changes
            </motion.button>
          </motion.div>

          {/* Notifications Toggle */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-4 shadow-xl shadow-gray-900/5"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200/50">
                  <Bell className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">Notifications</p>
                  <p className="text-xs text-gray-500 mt-0.5">Push notifications & alerts</p>
                </div>
              </div>
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => setNotificationsEnabled(!notificationsEnabled)}
                className={`relative w-12 h-7 rounded-full transition-colors ${
                  notificationsEnabled ? 'bg-[#eb7825]' : 'bg-gray-300'
                }`}
              >
                <motion.div
                  animate={{ x: notificationsEnabled ? 20 : 2 }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  className="absolute top-1 w-5 h-5 bg-white rounded-full shadow-md"
                />
              </motion.button>
            </div>
          </motion.div>

          {/* Legal & Support Links */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-3xl p-4 shadow-xl shadow-gray-900/5 space-y-2"
          >
            {/* Privacy Policy */}
            <motion.button
              whileHover={{ x: 2 }}
              whileTap={{ scale: 0.98 }}
              onClick={openPrivacyPolicy}
              className="w-full flex items-center justify-between p-3 bg-gray-50/50 rounded-2xl hover:bg-gray-100/50 transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-xl">
                  <Shield className="w-4 h-4 text-green-600" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-gray-900">Privacy Policy</p>
                  <p className="text-xs text-gray-500">How we protect your data</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </motion.button>

            {/* Terms and Conditions */}
            <motion.button
              whileHover={{ x: 2 }}
              whileTap={{ scale: 0.98 }}
              onClick={openTerms}
              className="w-full flex items-center justify-between p-3 bg-gray-50/50 rounded-2xl hover:bg-gray-100/50 transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 rounded-xl">
                  <FileText className="w-4 h-4 text-purple-600" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-gray-900">Terms & Conditions</p>
                  <p className="text-xs text-gray-500">Platform usage terms</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </motion.button>

            {/* Support Live Chat */}
            <motion.button
              whileHover={{ x: 2 }}
              whileTap={{ scale: 0.98 }}
              onClick={openSupport}
              className="w-full flex items-center justify-between p-3 bg-gray-50/50 rounded-2xl hover:bg-gray-100/50 transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-100 rounded-xl">
                  <MessageCircle className="w-4 h-4 text-[#eb7825]" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-gray-900">Support</p>
                  <p className="text-xs text-gray-500">Get help from our team</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </motion.button>

            {/* Support History */}
            <motion.button
              whileHover={{ x: 2 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleViewSupportPage}
              className="w-full flex items-center justify-between p-3 bg-gray-50/50 rounded-2xl hover:bg-gray-100/50 transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-xl">
                  <FileText className="w-4 h-4 text-blue-600" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-gray-900">Support History</p>
                  <p className="text-xs text-gray-500">View chats & tickets log</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {chatHistory.length > 0 && (
                  <span className="px-2 py-0.5 bg-[#eb7825] text-white text-xs font-semibold rounded-full">
                    {chatHistory.length}
                  </span>
                )}
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </div>
            </motion.button>
          </motion.div>

          {/* Sign Out Button */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={onSignOut}
              className="w-full py-3.5 bg-white/60 backdrop-blur-xl border border-red-200/50 rounded-3xl text-red-600 font-semibold shadow-xl shadow-gray-900/5 hover:bg-red-50/50 transition-all"
            >
              Sign Out
            </motion.button>
          </motion.div>

          {/* Bottom Spacer for Navigation */}
          <div className="h-20" />
        </div>
      </div>
    </>
  );
}