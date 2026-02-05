import React, { useState, useEffect } from 'react';
import { MessageCircle, Search, X, User, Building2 } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import CollaborationChatModal from './CollaborationChatModal';

interface Collaboration {
  id: string;
  experienceId: string;
  experienceName: string;
  curatorId: string;
  curatorName: string;
  businessId: string;
  businessName: string;
  status: 'pending' | 'active' | 'completed';
  createdAt: string;
}

interface CollaborationChatListProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserId: string;
  currentUserType: 'curator' | 'business';
  currentUserName: string;
}

export default function CollaborationChatList({
  isOpen,
  onClose,
  currentUserId,
  currentUserType,
  currentUserName
}: CollaborationChatListProps) {
  const [collaborations, setCollaborations] = useState<Collaboration[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCollaboration, setSelectedCollaboration] = useState<Collaboration | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (isOpen) {
      loadCollaborations();
      loadUnreadCounts();
    }
  }, [isOpen]);

  const loadCollaborations = () => {
    // Load collaborations from localStorage
    // In a real app, this would come from your backend
    const allCards = JSON.parse(localStorage.getItem('platformCards') || '[]');
    const allBusinesses = JSON.parse(localStorage.getItem('businesses') || '[]');
    
    // Find experiences where current user is involved
    const userCollaborations: Collaboration[] = [];
    
    allCards.forEach((card: any) => {
      // For curators: find their created experiences with businesses
      if (currentUserType === 'curator' && card.createdBy === currentUserId) {
        if (card.businessId) {
          const business = allBusinesses.find((b: any) => b.id === card.businessId);
          if (business) {
            userCollaborations.push({
              id: `collab_${card.id}`,
              experienceId: card.id,
              experienceName: card.title,
              curatorId: currentUserId,
              curatorName: currentUserName,
              businessId: business.id,
              businessName: business.name,
              status: 'active',
              createdAt: card.createdAt || new Date().toISOString()
            });
          }
        }
      }
      
      // For businesses: find experiences created for them
      if (currentUserType === 'business' && card.businessId === currentUserId) {
        userCollaborations.push({
          id: `collab_${card.id}`,
          experienceId: card.id,
          experienceName: card.title,
          curatorId: card.createdBy || 'unknown',
          curatorName: card.curatorName || 'Curator',
          businessId: currentUserId,
          businessName: currentUserName,
          status: 'active',
          createdAt: card.createdAt || new Date().toISOString()
        });
      }
    });

    setCollaborations(userCollaborations);
  };

  const loadUnreadCounts = () => {
    const counts: Record<string, number> = {};
    
    collaborations.forEach(collab => {
      const storageKey = `collaboration_chat_${collab.id}`;
      const messages = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const unread = messages.filter((m: any) => 
        m.senderId !== currentUserId && !m.read
      ).length;
      counts[collab.id] = unread;
    });

    setUnreadCounts(counts);
  };

  const filteredCollaborations = collaborations.filter(collab => {
    const searchLower = searchQuery.toLowerCase();
    return (
      collab.experienceName.toLowerCase().includes(searchLower) ||
      (currentUserType === 'curator' 
        ? collab.businessName.toLowerCase().includes(searchLower)
        : collab.curatorName.toLowerCase().includes(searchLower)
      )
    );
  });

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / 86400000);
    
    if (days < 1) return 'Today';
    if (days < 2) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl h-[90vh] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-[#eb7825]/10 to-[#d6691f]/10">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center">
                <MessageCircle className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-gray-900">Collaboration Chats</h2>
                <p className="text-gray-500 text-sm">
                  {collaborations.length} active conversation{collaborations.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-gray-600 hover:text-gray-900 hover:bg-gray-100"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Search */}
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <Input
                type="text"
                placeholder="Search collaborations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {/* Collaboration List */}
          <ScrollArea className="flex-1">
            {filteredCollaborations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-12 px-6 text-center">
                <div className="h-16 w-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                  <MessageCircle className="h-8 w-8 text-gray-400" />
                </div>
                <h3 className="text-gray-900 mb-2">No active collaborations</h3>
                <p className="text-gray-500 text-sm max-w-sm">
                  {currentUserType === 'curator' 
                    ? 'Create experiences for businesses to start collaborating'
                    : 'When curators create experiences for your business, you can chat with them here'
                  }
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {filteredCollaborations.map((collab) => {
                  const otherPartyName = currentUserType === 'curator' 
                    ? collab.businessName 
                    : collab.curatorName;
                  const unreadCount = unreadCounts[collab.id] || 0;

                  return (
                    <button
                      key={collab.id}
                      onClick={() => setSelectedCollaboration(collab)}
                      className="w-full px-6 py-4 hover:bg-gray-50 transition-colors flex items-center gap-4 text-left"
                    >
                      <Avatar className="h-12 w-12 flex-shrink-0 border-2 border-[#eb7825]">
                        <AvatarFallback className="bg-gradient-to-br from-[#eb7825] to-[#d6691f] text-white">
                          {getInitials(otherPartyName)}
                        </AvatarFallback>
                      </Avatar>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-gray-900 truncate">
                            {otherPartyName}
                          </h3>
                          {currentUserType === 'curator' ? (
                            <Building2 className="h-4 w-4 text-gray-400 flex-shrink-0" />
                          ) : (
                            <User className="h-4 w-4 text-gray-400 flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-gray-600 text-sm truncate">
                          {collab.experienceName}
                        </p>
                        <p className="text-gray-400 text-xs mt-1">
                          Created {formatDate(collab.createdAt)}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        {unreadCount > 0 && (
                          <Badge className="bg-red-500 text-white">
                            {unreadCount > 9 ? '9+' : unreadCount}
                          </Badge>
                        )}
                        <Badge 
                          variant="outline" 
                          className="border-[#eb7825] text-[#eb7825] text-xs"
                        >
                          {collab.status}
                        </Badge>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>

      {/* Chat Modal */}
      {selectedCollaboration && (
        <CollaborationChatModal
          isOpen={!!selectedCollaboration}
          onClose={() => {
            setSelectedCollaboration(null);
            loadUnreadCounts(); // Refresh unread counts after closing chat
          }}
          collaborationId={selectedCollaboration.id}
          currentUserId={currentUserId}
          currentUserType={currentUserType}
          currentUserName={currentUserName}
          otherPartyName={
            currentUserType === 'curator'
              ? selectedCollaboration.businessName
              : selectedCollaboration.curatorName
          }
          experienceTitle={selectedCollaboration.experienceName}
        />
      )}
    </>
  );
}
