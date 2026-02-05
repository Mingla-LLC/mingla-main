import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageCircle, Send, Plus, Search, Users, Hash, 
  MoreVertical, X, Pin, Archive, User, Paperclip, Smile
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Textarea } from '../ui/textarea';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner@2.0.3';
import AdminPageLayout from './AdminPageLayout';

export default function AdminQAChatEnhanced({ userData }: any) {
  const [threads, setThreads] = useState<any[]>([]);
  const [selectedThread, setSelectedThread] = useState<any>(null);
  const [message, setMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewThreadModal, setShowNewThreadModal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadThreads();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [selectedThread?.messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadThreads = () => {
    // Load existing threads from localStorage
    const savedThreads = JSON.parse(localStorage.getItem('adminChatThreads') || '[]');
    
    if (savedThreads.length === 0) {
      // Create default threads
      const defaultThreads = [
        {
          id: 'thread-1',
          name: 'General Support',
          type: 'channel',
          members: ['Admin', 'QA Team'],
          unread: 3,
          lastMessage: 'New ticket from user',
          lastMessageTime: new Date().toISOString(),
          messages: [
            {
              id: 'msg-1',
              sender: 'QA Manager',
              text: 'We have a new support ticket',
              timestamp: new Date().toISOString(),
              senderAvatar: 'Q'
            }
          ]
        },
        {
          id: 'thread-2',
          name: 'Content Moderation',
          type: 'channel',
          members: ['Admin', 'Content Team'],
          unread: 0,
          lastMessage: 'All clear',
          lastMessageTime: new Date().toISOString(),
          messages: []
        }
      ];
      setThreads(defaultThreads);
      localStorage.setItem('adminChatThreads', JSON.stringify(defaultThreads));
    } else {
      setThreads(savedThreads);
    }
  };

  const handleSendMessage = () => {
    if (!message.trim() || !selectedThread) return;

    const newMessage = {
      id: `msg-${Date.now()}`,
      sender: userData?.name || 'Admin',
      text: message,
      timestamp: new Date().toISOString(),
      senderAvatar: userData?.name?.charAt(0) || 'A'
    };

    const updatedThreads = threads.map(t => {
      if (t.id === selectedThread.id) {
        return {
          ...t,
          messages: [...(t.messages || []), newMessage],
          lastMessage: message,
          lastMessageTime: new Date().toISOString()
        };
      }
      return t;
    });

    setThreads(updatedThreads);
    localStorage.setItem('adminChatThreads', JSON.stringify(updatedThreads));
    setSelectedThread(updatedThreads.find(t => t.id === selectedThread.id));
    setMessage('');
  };

  const handleCreateThread = (name: string, type: 'channel' | 'direct') => {
    const newThread = {
      id: `thread-${Date.now()}`,
      name,
      type,
      members: ['Admin'],
      unread: 0,
      lastMessage: '',
      lastMessageTime: new Date().toISOString(),
      messages: []
    };

    const updated = [...threads, newThread];
    setThreads(updated);
    localStorage.setItem('adminChatThreads', JSON.stringify(updated));
    setShowNewThreadModal(false);
    toast.success(`${type === 'channel' ? 'Channel' : 'Conversation'} created`);
  };

  const filteredThreads = threads.filter(t =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <AdminPageLayout
      title="QA Chat"
      description="Team collaboration and messaging"
      actions={
        <Button 
          onClick={() => setShowNewThreadModal(true)}
          className="bg-[#eb7825] hover:bg-[#d6691f] text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Thread
        </Button>
      }
    >
      {/* Chat Interface */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[600px]">
        {/* Threads Sidebar */}
        <Card className="lg:col-span-1 border border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search threads..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            <AnimatePresence>
              {filteredThreads.map(thread => (
                <motion.div
                  key={thread.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <button
                    onClick={() => setSelectedThread(thread)}
                    className={`w-full text-left p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                      selectedThread?.id === thread.id ? 'bg-orange-50 border-l-4 border-l-[#eb7825]' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center text-white flex-shrink-0">
                          {thread.type === 'channel' ? <Hash className="w-5 h-5" /> : <User className="w-5 h-5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-[#111827] truncate">{thread.name}</p>
                            {thread.unread > 0 && (
                              <Badge className="bg-[#eb7825] text-white text-xs px-2">
                                {thread.unread}
                              </Badge>
                            )}
                          </div>
                          <p className="text-[#6B7280] text-sm truncate">{thread.lastMessage || 'No messages yet'}</p>
                        </div>
                      </div>
                    </div>
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </Card>

        {/* Messages Area */}
        <Card className="lg:col-span-3 border border-gray-200 flex flex-col">
          {!selectedThread ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <MessageCircle className="w-12 h-12 text-[#6B7280] mx-auto mb-4" />
                <p className="text-[#6B7280]">Select a thread to start messaging</p>
              </div>
            </div>
          ) : (
            <>
              {/* Thread Header */}
              <div className="p-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center text-white">
                      {selectedThread.type === 'channel' ? <Hash className="w-5 h-5" /> : <User className="w-5 h-5" />}
                    </div>
                    <div>
                      <h3 className="text-[#111827]">{selectedThread.name}</h3>
                      <p className="text-[#6B7280] text-sm">
                        {selectedThread.members.length} member{selectedThread.members.length > 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="w-5 h-5" />
                  </Button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {selectedThread.messages && selectedThread.messages.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-[#6B7280]">No messages yet. Start the conversation!</p>
                  </div>
                ) : (
                  selectedThread.messages?.map((msg: any) => (
                    <div key={msg.id} className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center text-white text-sm flex-shrink-0">
                        {msg.senderAvatar}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-baseline gap-2">
                          <p className="text-[#111827]">{msg.sender}</p>
                          <p className="text-[#6B7280] text-xs">
                            {new Date(msg.timestamp).toLocaleTimeString()}
                          </p>
                        </div>
                        <p className="text-[#6B7280] mt-1">{msg.text}</p>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Message Input */}
              <div className="p-4 border-t border-gray-200">
                <div className="flex gap-2">
                  <Button variant="ghost" size="icon">
                    <Paperclip className="w-5 h-5" />
                  </Button>
                  <Input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                    placeholder={`Message ${selectedThread.name}`}
                    className="flex-1"
                  />
                  <Button variant="ghost" size="icon">
                    <Smile className="w-5 h-5" />
                  </Button>
                  <Button 
                    onClick={handleSendMessage}
                    className="bg-[#eb7825] hover:bg-[#d6691f] text-white"
                    disabled={!message.trim()}
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* New Thread Modal */}
      {showNewThreadModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[#111827]">Create New Thread</h2>
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => setShowNewThreadModal(false)}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-[#6B7280]">Thread Name</label>
                <Input 
                  placeholder="e.g., Bug Reports" 
                  id="threadName"
                />
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    const input = document.getElementById('threadName') as HTMLInputElement;
                    if (input.value) handleCreateThread(input.value, 'channel');
                  }}
                >
                  <Hash className="w-4 h-4 mr-2" />
                  Channel
                </Button>
                <Button 
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    const input = document.getElementById('threadName') as HTMLInputElement;
                    if (input.value) handleCreateThread(input.value, 'direct');
                  }}
                >
                  <User className="w-4 h-4 mr-2" />
                  Direct Message
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </AdminPageLayout>
  );
}
