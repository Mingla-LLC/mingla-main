import React, { useState, useRef, useEffect } from 'react';
import { 
  ArrowLeft, Send, Paperclip, Image, Video, FileText, 
  Smile, MoreHorizontal, Phone, VideoIcon, X, Download,
  Play, Pause, Volume2, VolumeX, MessageSquare, Users,
  Plus, Bookmark, UserMinus, Shield, Flag
} from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import CollaborationModule from './CollaborationModule';

interface Message {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
  type: 'text' | 'image' | 'video' | 'file';
  fileUrl?: string;
  fileName?: string;
  fileSize?: string;
  isMe: boolean;
}

interface Friend {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  isOnline: boolean;
  lastSeen?: string;
}

interface MessageInterfaceProps {
  friend: Friend;
  onBack: () => void;
  onSendMessage: (content: string, type: 'text' | 'image' | 'video' | 'file', file?: File) => void;
  messages: Message[];
  onSendCollabInvite?: (friend: Friend) => void;
  onAddToBoard?: (sessionIds: string[], friend: any, suppressNotification?: boolean) => void;
  onShareSavedCard?: (friend: any, suppressNotification?: boolean) => void;
  onRemoveFriend?: (friend: any, suppressNotification?: boolean) => void;
  onBlockUser?: (friend: any, suppressNotification?: boolean) => void;
  onReportUser?: (friend: any, suppressNotification?: boolean) => void;
  boardsSessions?: any[];
  currentMode?: 'solo' | string;
  onModeChange?: (mode: 'solo' | string) => void;
  onUpdateBoardSession?: (updatedBoard: any) => void;
  onCreateSession?: (newSession: any) => void;
  onNavigateToBoard?: (board: any, discussionTab?: string) => void;
  availableFriends?: Friend[];
}

export default function MessageInterface({
  friend,
  onBack,
  onSendMessage,
  messages,
  onSendCollabInvite,
  onAddToBoard,
  onShareSavedCard,
  onRemoveFriend,
  onBlockUser,
  onReportUser,
  boardsSessions = [],
  currentMode = 'solo',
  onModeChange,
  onUpdateBoardSession,
  onCreateSession,
  onNavigateToBoard,
  availableFriends = []
}: MessageInterfaceProps) {
  const [newMessage, setNewMessage] = useState('');
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [showMoreOptionsMenu, setShowMoreOptionsMenu] = useState(false);
  const [showBoardSelection, setShowBoardSelection] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showCollaboration, setShowCollaboration] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const moreOptionsMenuRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Clean up preview URL when component unmounts
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // Close attachment menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showAttachmentMenu && attachmentMenuRef.current && !attachmentMenuRef.current.contains(event.target as Node)) {
        setShowAttachmentMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAttachmentMenu]);

  // Close more options menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showMoreOptionsMenu && moreOptionsMenuRef.current && !moreOptionsMenuRef.current.contains(event.target as Node)) {
        setShowMoreOptionsMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMoreOptionsMenu]);

  const handleSendMessage = () => {
    if (newMessage.trim() || selectedFile) {
      if (selectedFile) {
        const fileType = selectedFile.type.startsWith('image/') ? 'image' :
                        selectedFile.type.startsWith('video/') ? 'video' : 'file';
        onSendMessage(newMessage.trim() || selectedFile.name, fileType, selectedFile);
        setSelectedFile(null);
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
          setPreviewUrl('');
        }
      } else {
        onSendMessage(newMessage.trim(), 'text');
      }
      setNewMessage('');
    }
  };

  const handleFileSelect = (type: 'image' | 'video' | 'file') => {
    const accept = type === 'image' ? 'image/*' : 
                  type === 'video' ? 'video/*' : '*/*';
    
    if (fileInputRef.current) {
      fileInputRef.current.accept = accept;
      fileInputRef.current.click();
    }
    setShowAttachmentMenu(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
      }
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl('');
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString();
  };

  // Notification management
  const showNotification = (title: string, message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const notification = {
      id: `local-${Date.now()}`,
      title,
      message,
      type,
      timestamp: Date.now()
    };
    setNotifications(prev => [...prev, notification]);
    
    // Auto-dismiss after 3 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== notification.id));
    }, 3000);
  };

  const dismissNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  // More options handlers
  const handleSendCollabInvite = () => {
    setShowCollaboration(true);
    setShowMoreOptionsMenu(false);
  };

  const handleAddToBoard = () => {
    if (boardsSessions.length === 0) {
      showNotification(
        'No Boards Available',
        'Create a collaboration board first to add friends',
        'info'
      );
      setShowMoreOptionsMenu(false);
      return;
    }
    setShowBoardSelection(true);
    setShowMoreOptionsMenu(false);
  };

  const handleBoardSelection = (selectedBoards: string[]) => {
    if (selectedBoards.length > 0) {
      onAddToBoard?.(selectedBoards, friend, true);
      showNotification(
        'Added to Board!',
        `${friend.name} has been added to ${selectedBoards.length} collaboration board${selectedBoards.length > 1 ? 's' : ''}`
      );
    }
    setShowBoardSelection(false);
  };

  const handleShareSavedCard = () => {
    onShareSavedCard?.(friend, true);
    setShowMoreOptionsMenu(false);
    showNotification(
      'Card Shared!',
      `A saved experience has been shared with ${friend.name}`
    );
  };

  const handleRemoveFriend = () => {
    onRemoveFriend?.(friend, true);
    setShowMoreOptionsMenu(false);
    showNotification(
      'Friend Removed',
      `${friend.name} has been removed from your friends list`
    );
  };

  const handleBlockUser = () => {
    onBlockUser?.(friend, true);
    setShowMoreOptionsMenu(false);
    showNotification(
      'User Blocked',
      `${friend.name} has been blocked`
    );
  };

  const handleReportUser = () => {
    onReportUser?.(friend, true);
    setShowMoreOptionsMenu(false);
    showNotification(
      'User Reported',
      `Thank you for reporting ${friend.name}. Our team will review this report.`
    );
  };

  const renderMessage = (message: Message) => {
    const isMe = message.isMe;
    
    return (
      <div key={message.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'} mb-4`}>
        <div className={`max-w-[70%] ${isMe ? 'order-2' : 'order-1'}`}>
          <div className={`p-3 rounded-2xl ${
            isMe 
              ? 'bg-[#eb7825] text-white' 
              : 'bg-gray-100 text-gray-900'
          }`}>
            {message.type === 'text' && (
              <p className="break-words">{message.content}</p>
            )}
            
            {message.type === 'image' && (
              <div>
                {message.content && message.content !== message.fileName && (
                  <p className="mb-2 break-words">{message.content}</p>
                )}
                <ImageWithFallback
                  src={message.fileUrl || ''}
                  alt="Shared image"
                  className="rounded-lg max-w-full h-auto"
                />
              </div>
            )}
            
            {message.type === 'video' && (
              <div>
                {message.content && message.content !== message.fileName && (
                  <p className="mb-2 break-words">{message.content}</p>
                )}
                <video
                  controls
                  className="rounded-lg max-w-full h-auto"
                  src={message.fileUrl}
                >
                  Your browser does not support video playback.
                </video>
              </div>
            )}
            
            {message.type === 'file' && (
              <div>
                {message.content && message.content !== message.fileName && (
                  <p className="mb-2 break-words">{message.content}</p>
                )}
                <div className={`flex items-center gap-3 p-2 rounded-lg ${
                  isMe ? 'bg-white/20' : 'bg-white'
                }`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    isMe ? 'bg-white/30' : 'bg-[#eb7825]/10'
                  }`}>
                    <FileText className={`w-4 h-4 ${isMe ? 'text-white' : 'text-[#eb7825]'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium truncate ${isMe ? 'text-white' : 'text-gray-900'}`}>
                      {message.fileName}
                    </p>
                    <p className={`text-xs ${isMe ? 'text-white/70' : 'text-gray-500'}`}>
                      {message.fileSize}
                    </p>
                  </div>
                  <Download className={`w-4 h-4 ${isMe ? 'text-white' : 'text-gray-600'}`} />
                </div>
              </div>
            )}
          </div>
          
          <p className={`text-xs text-gray-500 mt-1 ${isMe ? 'text-right' : 'text-left'}`}>
            {formatTimestamp(message.timestamp)}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-white flex flex-col z-[100]">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-4 flex items-center gap-3 flex-shrink-0 safe-area-inset-top">
        <button
          onClick={onBack}
          className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-gray-600" />
        </button>
        
        <div className="relative">
          {friend.avatar ? (
            <ImageWithFallback
              src={friend.avatar}
              alt={friend.name}
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 bg-[#eb7825] rounded-full flex items-center justify-center">
              <span className="text-white font-medium text-sm">
                {friend.name.split(' ').map(n => n[0]).join('')}
              </span>
            </div>
          )}
          {friend.isOnline && (
            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
          )}
        </div>
        
        <div className="flex-1">
          <h3 className="font-medium text-gray-900">{friend.name}</h3>
          <p className="text-sm text-gray-600">
            {friend.isOnline ? 'Online' : `Last seen ${friend.lastSeen || 'recently'}`}
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <button className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors">
            <Phone className="w-4 h-4 text-gray-600" />
          </button>
          <button className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors">
            <VideoIcon className="w-4 h-4 text-gray-600" />
          </button>
          <div className="relative" ref={moreOptionsMenuRef}>
            <button 
              onClick={() => setShowMoreOptionsMenu(!showMoreOptionsMenu)}
              className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors"
            >
              <MoreHorizontal className="w-4 h-4 text-gray-600" />
            </button>
            
            {showMoreOptionsMenu && (
              <div className="absolute top-10 right-0 bg-white border border-gray-200 rounded-xl shadow-lg py-2 min-w-[220px] z-20">
                <button
                  onClick={handleSendCollabInvite}
                  className="w-full px-4 py-3 text-left text-sm text-gray-700 hover:bg-orange-50 hover:text-[#eb7825] flex items-center gap-3 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Send Collaboration Invite
                </button>
                <button
                  onClick={handleAddToBoard}
                  className="w-full px-4 py-3 text-left text-sm text-gray-700 hover:bg-orange-50 hover:text-[#eb7825] flex items-center gap-3 transition-colors"
                >
                  <Users className="w-4 h-4" />
                  Add to Board
                </button>
                <button
                  onClick={handleShareSavedCard}
                  className="w-full px-4 py-3 text-left text-sm text-gray-700 hover:bg-orange-50 hover:text-[#eb7825] flex items-center gap-3 transition-colors"
                >
                  <Bookmark className="w-4 h-4" />
                  Share Saved Card
                </button>
                <div className="border-t border-gray-200 my-2"></div>
                <button
                  onClick={handleRemoveFriend}
                  className="w-full px-4 py-3 text-left text-sm text-gray-700 hover:bg-red-50 hover:text-red-600 flex items-center gap-3 transition-colors"
                >
                  <UserMinus className="w-4 h-4" />
                  Remove Friend
                </button>
                <button
                  onClick={handleBlockUser}
                  className="w-full px-4 py-3 text-left text-sm text-gray-700 hover:bg-red-50 hover:text-red-600 flex items-center gap-3 transition-colors"
                >
                  <Shield className="w-4 h-4" />
                  Block User
                </button>
                <button
                  onClick={handleReportUser}
                  className="w-full px-4 py-3 text-left text-sm text-gray-700 hover:bg-red-50 hover:text-red-600 flex items-center gap-3 transition-colors"
                >
                  <Flag className="w-4 h-4" />
                  Report User
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 bg-[#eb7825]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <MessageSquare className="w-8 h-8 text-[#eb7825]" />
              </div>
              <h3 className="font-medium text-gray-900 mb-2">Start your conversation</h3>
              <p className="text-sm text-gray-600">Send a message to {friend.name}</p>
            </div>
          </div>
        ) : (
          <div>
            {messages.map(renderMessage)}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* File Preview */}
      {selectedFile && (
        <div className="border-t border-gray-200 p-4 bg-gray-50">
          <div className="flex items-center gap-3 bg-white p-3 rounded-lg border">
            {previewUrl && selectedFile.type.startsWith('image/') && (
              <ImageWithFallback
                src={previewUrl}
                alt="Preview"
                className="w-12 h-12 rounded-lg object-cover"
              />
            )}
            {previewUrl && selectedFile.type.startsWith('video/') && (
              <video
                src={previewUrl}
                className="w-12 h-12 rounded-lg object-cover"
                muted
              />
            )}
            {!previewUrl && (
              <div className="w-12 h-12 bg-[#eb7825]/10 rounded-lg flex items-center justify-center">
                <FileText className="w-6 h-6 text-[#eb7825]" />
              </div>
            )}
            
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 truncate">{selectedFile.name}</p>
              <p className="text-sm text-gray-500">{formatFileSize(selectedFile.size)}</p>
            </div>
            
            <button
              onClick={handleRemoveFile}
              className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center hover:bg-gray-300 transition-colors"
            >
              <X className="w-3 h-3 text-gray-600" />
            </button>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t border-gray-200 p-4 bg-white flex-shrink-0 safe-area-inset-bottom">
        <div className="flex items-end gap-3">
          {/* Attachment Menu */}
          <div className="relative" ref={attachmentMenuRef}>
            <button
              onClick={() => setShowAttachmentMenu(!showAttachmentMenu)}
              className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors flex-shrink-0"
            >
              <Paperclip className="w-5 h-5 text-gray-600" />
            </button>
            
            {showAttachmentMenu && (
              <div className="absolute bottom-12 left-0 bg-white border border-gray-200 rounded-xl shadow-lg p-2 min-w-[200px] z-10">
                <button
                  onClick={() => handleFileSelect('image')}
                  className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Image className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="text-left">
                    <p className="font-medium text-gray-900">Photo</p>
                    <p className="text-xs text-gray-500">Share an image</p>
                  </div>
                </button>
                
                <button
                  onClick={() => handleFileSelect('video')}
                  className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                    <Video className="w-4 h-4 text-purple-600" />
                  </div>
                  <div className="text-left">
                    <p className="font-medium text-gray-900">Video</p>
                    <p className="text-xs text-gray-500">Share a video</p>
                  </div>
                </button>
                
                <button
                  onClick={() => handleFileSelect('file')}
                  className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                    <FileText className="w-4 h-4 text-green-600" />
                  </div>
                  <div className="text-left">
                    <p className="font-medium text-gray-900">Document</p>
                    <p className="text-xs text-gray-500">Share a file</p>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Message Input */}
          <div className="flex-1 bg-gray-100 rounded-2xl px-4 py-3 min-h-[44px] flex items-center">
            <textarea
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder={selectedFile ? "Add a caption..." : "Type a message..."}
              className="w-full bg-transparent resize-none outline-none placeholder-gray-500 max-h-20 text-gray-900 text-base leading-normal"
              rows={1}
              style={{ minHeight: '20px', height: 'auto' }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              autoFocus
            />
          </div>

          {/* Send Button */}
          <button
            onClick={handleSendMessage}
            disabled={!newMessage.trim() && !selectedFile}
            className="w-10 h-10 bg-[#eb7825] rounded-full flex items-center justify-center hover:bg-[#d6691f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
          >
            <Send className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Board Selection Modal */}
      {showBoardSelection && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Add to Board</h3>
              <button
                onClick={() => setShowBoardSelection(false)}
                className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors"
              >
                <X className="w-3 h-3 text-gray-600" />
              </button>
            </div>
            
            <p className="text-sm text-gray-600 mb-4">
              Select collaboration boards to add {friend.name} to:
            </p>
            
            <div className="space-y-3 mb-6">
              {boardsSessions.map((board) => (
                <label
                  key={board.id}
                  className="flex items-center gap-3 p-3 border border-gray-200 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    className="w-4 h-4 text-[#eb7825] rounded border-gray-300 focus:ring-[#eb7825] focus:ring-2"
                    onChange={(e) => {
                      const isChecked = e.target.checked;
                      const checkboxes = document.querySelectorAll('#board-selection input[type="checkbox"]:checked') as NodeListOf<HTMLInputElement>;
                      if (isChecked || checkboxes.length > 0) {
                        // Handle selection state if needed
                      }
                    }}
                  />
                  <div className="flex-1">
                    <h4 className="font-medium text-gray-900">{board.name}</h4>
                    <p className="text-xs text-gray-500">{board.participants?.length || 0} participants</p>
                  </div>
                </label>
              ))}
            </div>
            
            <div id="board-selection" className="flex gap-3">
              <button
                onClick={() => setShowBoardSelection(false)}
                className="flex-1 py-3 px-4 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const checkboxes = document.querySelectorAll('#board-selection input[type="checkbox"]:checked') as NodeListOf<HTMLInputElement>;
                  const selectedBoardIds = Array.from(checkboxes).map(cb => 
                    boardsSessions.find(board => 
                      cb.closest('label')?.querySelector('h4')?.textContent === board.name
                    )?.id
                  ).filter(Boolean) as string[];
                  handleBoardSelection(selectedBoardIds);
                }}
                className="flex-1 py-3 px-4 bg-[#eb7825] text-white rounded-xl hover:bg-[#d6691f] transition-colors"
              >
                Add to Board
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Local Notifications */}
      {notifications.length > 0 && (
        <div className="fixed top-20 left-4 right-4 z-50 space-y-2">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className="bg-white border border-gray-200 rounded-xl p-4 shadow-lg flex items-start gap-3 animate-in slide-in-from-top duration-300"
            >
              <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                notification.type === 'success' ? 'bg-green-500' :
                notification.type === 'error' ? 'bg-red-500' : 'bg-blue-500'
              }`} />
              <div className="flex-1 min-w-0">
                <h4 className="font-medium text-gray-900 text-sm">{notification.title}</h4>
                <p className="text-sm text-gray-600 mt-1">{notification.message}</p>
              </div>
              <button
                onClick={() => dismissNotification(notification.id)}
                className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors flex-shrink-0"
              >
                <X className="w-3 h-3 text-gray-600" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Collaboration Module */}
      <CollaborationModule
        isOpen={showCollaboration}
        onClose={() => setShowCollaboration(false)}
        currentMode={currentMode}
        onModeChange={onModeChange || (() => {})}
        preSelectedFriend={friend}
        boardsSessions={boardsSessions}
        onUpdateBoardSession={onUpdateBoardSession || (() => {})}
        onCreateSession={onCreateSession || (() => {})}
        onNavigateToBoard={onNavigateToBoard || (() => {})}
        availableFriends={availableFriends}
      />
    </div>
  );
}