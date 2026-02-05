import React from 'react';
import { MessageCircle, Search, Building2, User as UserIcon } from 'lucide-react';
import { Input } from '../ui/input';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { motion } from 'motion/react';
import { ConversationListProps } from './types';
import { filterCollaborations, getInitials, formatDate } from './utils';

export default function ConversationList({
  collaborations,
  selectedCollaboration,
  unreadCounts,
  searchQuery,
  currentUserType,
  isMobileView,
  hideHeader = false,
  onSelectCollaboration,
  onSearchChange
}: ConversationListProps) {
  const filteredCollaborations = filterCollaborations(collaborations, searchQuery, currentUserType);

  return (
    <div className={`bg-white border-r border-gray-200 flex flex-col ${
      isMobileView ? 'w-full' : 'w-96'
    }`}>
      {/* Mobile Header */}
      {isMobileView && (
        <div className="border-b border-gray-200 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center">
              <MessageCircle className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-gray-900">Messages</h1>
              <p className="text-gray-500 text-sm">
                {collaborations.length} conversation{collaborations.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <Input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
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
              const otherName = currentUserType === 'curator' 
                ? collab.businessName 
                : collab.curatorName;
              const unreadCount = unreadCounts[collab.id] || 0;
              const isSelected = selectedCollaboration?.id === collab.id;

              return (
                <motion.button
                  key={collab.id}
                  onClick={() => onSelectCollaboration(collab)}
                  className={`w-full px-4 py-4 hover:bg-gray-50 transition-colors flex items-center gap-3 text-left ${
                    isSelected ? 'bg-[#eb7825]/5 border-l-4 border-[#eb7825]' : ''
                  }`}
                  whileHover={{ x: 4 }}
                >
                  <Avatar className="h-12 w-12 flex-shrink-0 border-2 border-[#eb7825]">
                    <AvatarFallback className="bg-gradient-to-br from-[#eb7825] to-[#d6691f] text-white">
                      {getInitials(otherName)}
                    </AvatarFallback>
                  </Avatar>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-gray-900 truncate">
                        {otherName}
                      </h3>
                      {currentUserType === 'curator' ? (
                        <Building2 className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      ) : (
                        <UserIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      )}
                    </div>
                    
                    <p className="text-sm text-gray-600 truncate mb-1">
                      {collab.experienceName}
                    </p>
                    
                    <div className="flex items-center justify-between">
                      <Badge 
                        variant={collab.status === 'active' ? 'default' : 'secondary'}
                        className={collab.status === 'active' ? 'bg-green-500' : ''}
                      >
                        {collab.status}
                      </Badge>
                      
                      {unreadCount > 0 && (
                        <Badge className="bg-[#eb7825] text-white">
                          {unreadCount}
                        </Badge>
                      )}
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
