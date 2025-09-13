import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { 
  Send, 
  Search, 
  ArrowLeft,
  MoreVertical,
  Image as ImageIcon,
  Paperclip
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMessages } from '@/hooks/useMessages';

export const Inbox = () => {
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    conversations,
    currentConversation,
    loading,
    sending,
    loadConversations,
    loadMessages,
    sendMessage,
    setCurrentConversation,
  } = useMessages();

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const filteredConversations = conversations.filter(conv =>
    conv.participants.some(p => 
      `${p.first_name} ${p.last_name}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.username.toLowerCase().includes(searchQuery.toLowerCase())
    )
  );

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [currentConversation?.messages]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !currentConversation || sending) return;
    
    const success = await sendMessage(currentConversation.id, newMessage);
    if (success) {
      setNewMessage('');
    }
  };

  const handleSelectConversation = (conversationId: string) => {
    loadMessages(conversationId);
  };

  const getDisplayName = (participant: { username: string; first_name?: string; last_name?: string }) => {
    if (participant.first_name && participant.last_name) {
      return `${participant.first_name} ${participant.last_name}`;
    } else if (participant.first_name) {
      return participant.first_name;
    } else if (participant.last_name) {
      return participant.last_name;
    }
    return participant.username;
  };

  if (currentConversation) {
    return (
      <div className="flex flex-col h-[calc(100vh-200px)]">
        {/* Chat Header */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setCurrentConversation(null)}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <Avatar>
                <AvatarFallback>
                  {currentConversation.participants[0] ? 
                    getDisplayName(currentConversation.participants[0]).split(' ').map(n => n[0]).join('') : 
                    'U'
                  }
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="font-medium">{getDisplayName(currentConversation.participants[0])}</p>
                <p className="text-sm text-muted-foreground">
                  {currentConversation.participants[0]?.is_online ? 'Online' : 'Last seen recently'}
                </p>
              </div>
              <Button variant="ghost" size="sm">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
        </Card>

        {/* Messages */}
        <Card className="flex-1 flex flex-col">
          <CardContent className="flex-1 p-4 overflow-y-auto space-y-4">
            {currentConversation.messages.map(message => (
              <div
                key={message.id}
                className={cn(
                  "flex gap-2 max-w-[70%]",
                  message.sender_id === currentConversation.participants[0]?.id ? "" : "ml-auto flex-row-reverse"
                )}
              >
                {message.sender_id !== currentConversation.participants[0]?.id && (
                  <Avatar className="w-8 h-8">
                    <AvatarFallback className="text-xs">
                      {currentConversation.participants[0] ? 
                        getDisplayName(currentConversation.participants[0]).split(' ').map(n => n[0]).join('') : 
                        'U'
                      }
                    </AvatarFallback>
                  </Avatar>
                )}
                <div className={cn(
                  "rounded-lg p-3 space-y-1",
                  message.sender_id === currentConversation.participants[0]?.id
                    ? "bg-muted" 
                    : "bg-primary text-primary-foreground"
                )}>
                  <p className="text-sm">{message.content}</p>
                  <p className={cn(
                    "text-xs",
                    message.sender_id === currentConversation.participants[0]?.id
                      ? "text-muted-foreground" 
                      : "text-primary-foreground/70"
                  )}>
                    {new Date(message.created_at).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </CardContent>

          {/* Message Input */}
          <div className="p-4 border-t">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm">
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm">
                <ImageIcon className="h-4 w-4" />
              </Button>
              <Input
                placeholder="Type a message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                className="flex-1"
              />
              <Button onClick={handleSendMessage}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {/* Conversations List */}
      <Card>
        <CardHeader>
          <CardTitle>Messages</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {filteredConversations.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {searchQuery ? 'No conversations found' : 'No messages yet'}
            </p>
          ) : (
            filteredConversations.map(conversation => (
              <div
                key={conversation.id}
                className="flex items-center gap-3 p-3 hover:bg-muted/50 rounded-lg cursor-pointer transition-colors"
                onClick={() => handleSelectConversation(conversation.id)}
              >
                <div className="relative">
                  <Avatar>
                    <AvatarFallback>
                      {conversation.participants[0] ? 
                        getDisplayName(conversation.participants[0]).split(' ').map(n => n[0]).join('') : 
                        'U'
                      }
                    </AvatarFallback>
                  </Avatar>
                  {conversation.participants[0]?.is_online && (
                    <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-background" />
                  )}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-medium truncate">
                      {conversation.participants[0] ? getDisplayName(conversation.participants[0]) : 'Unknown'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {conversation.last_message ? new Date(conversation.last_message.created_at).toLocaleTimeString() : ''}
                    </p>
                  </div>
                  <p className={cn(
                    "text-sm truncate",
                    conversation.unread_count > 0 ? "font-medium" : "text-muted-foreground"
                  )}>
                    {conversation.last_message?.content || 'No messages yet'}
                  </p>
                </div>
                
                {conversation.unread_count > 0 && (
                  <Badge className="bg-primary text-primary-foreground">
                    {conversation.unread_count}
                  </Badge>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
};