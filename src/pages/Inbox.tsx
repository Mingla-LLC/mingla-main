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

interface Message {
  id: string;
  senderId: string;
  content: string;
  timestamp: string;
  read: boolean;
  type: 'text' | 'image' | 'file';
}

interface Conversation {
  id: string;
  participant: {
    id: string;
    name: string;
    username: string;
    avatar: string;
    isOnline: boolean;
  };
  lastMessage: Message;
  unreadCount: number;
  messages: Message[];
}

export const Inbox = () => {
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Mock data
  const [conversations] = useState<Conversation[]>([
    {
      id: '1',
      participant: {
        id: '1',
        name: 'Emma Wilson',
        username: 'emmawilson',
        avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80',
        isOnline: true
      },
      lastMessage: {
        id: '1',
        senderId: '1',
        content: 'Hey! Are you free for that pottery workshop tomorrow?',
        timestamp: '2 min ago',
        read: false,
        type: 'text'
      },
      unreadCount: 2,
      messages: [
        {
          id: '1',
          senderId: '1',
          content: 'Hi! How are you doing?',
          timestamp: '10:30 AM',
          read: true,
          type: 'text'
        },
        {
          id: '2',
          senderId: 'current',
          content: 'Hey Emma! I\'m doing great, thanks for asking!',
          timestamp: '10:35 AM',
          read: true,
          type: 'text'
        },
        {
          id: '3',
          senderId: '1',
          content: 'Hey! Are you free for that pottery workshop tomorrow?',
          timestamp: '2 min ago',
          read: false,
          type: 'text'
        }
      ]
    },
    {
      id: '2',
      participant: {
        id: '2',
        name: 'James Rodriguez',
        username: 'jamesrodriguez',
        avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e',
        isOnline: false
      },
      lastMessage: {
        id: '2',
        senderId: 'current',
        content: 'Sounds like a plan! See you there.',
        timestamp: '1 hour ago',
        read: true,
        type: 'text'
      },
      unreadCount: 0,
      messages: [
        {
          id: '1',
          senderId: '2',
          content: 'Want to check out that new art gallery opening?',
          timestamp: '2:15 PM',
          read: true,
          type: 'text'
        },
        {
          id: '2',
          senderId: 'current',
          content: 'Sounds like a plan! See you there.',
          timestamp: '1 hour ago',
          read: true,
          type: 'text'
        }
      ]
    }
  ]);

  const currentConversation = conversations.find(conv => conv.id === selectedConversation);
  const filteredConversations = conversations.filter(conv =>
    conv.participant.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    conv.participant.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [currentConversation?.messages]);

  const sendMessage = () => {
    if (!newMessage.trim() || !selectedConversation) return;
    
    // Mock sending message
    console.log(`Sending message: ${newMessage}`);
    setNewMessage('');
  };

  const formatTime = (timestamp: string) => {
    // This would normally parse the actual timestamp
    return timestamp;
  };

  if (selectedConversation && currentConversation) {
    return (
      <div className="flex flex-col h-[calc(100vh-200px)]">
        {/* Chat Header */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setSelectedConversation(null)}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <Avatar>
                <AvatarImage src={currentConversation.participant.avatar} />
                <AvatarFallback>
                  {currentConversation.participant.name.split(' ').map(n => n[0]).join('')}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="font-medium">{currentConversation.participant.name}</p>
                <p className="text-sm text-muted-foreground">
                  {currentConversation.participant.isOnline ? 'Online' : 'Last seen recently'}
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
                  message.senderId === 'current' ? "ml-auto flex-row-reverse" : ""
                )}
              >
                {message.senderId !== 'current' && (
                  <Avatar className="w-8 h-8">
                    <AvatarImage src={currentConversation.participant.avatar} />
                    <AvatarFallback className="text-xs">
                      {currentConversation.participant.name.split(' ').map(n => n[0]).join('')}
                    </AvatarFallback>
                  </Avatar>
                )}
                <div className={cn(
                  "rounded-lg p-3 space-y-1",
                  message.senderId === 'current' 
                    ? "bg-primary text-primary-foreground" 
                    : "bg-muted"
                )}>
                  <p className="text-sm">{message.content}</p>
                  <p className={cn(
                    "text-xs",
                    message.senderId === 'current' 
                      ? "text-primary-foreground/70" 
                      : "text-muted-foreground"
                  )}>
                    {formatTime(message.timestamp)}
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
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                className="flex-1"
              />
              <Button onClick={sendMessage}>
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
                onClick={() => setSelectedConversation(conversation.id)}
              >
                <div className="relative">
                  <Avatar>
                    <AvatarImage src={conversation.participant.avatar} />
                    <AvatarFallback>
                      {conversation.participant.name.split(' ').map(n => n[0]).join('')}
                    </AvatarFallback>
                  </Avatar>
                  {conversation.participant.isOnline && (
                    <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-background" />
                  )}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-medium truncate">{conversation.participant.name}</p>
                    <p className="text-xs text-muted-foreground">{conversation.lastMessage.timestamp}</p>
                  </div>
                  <p className={cn(
                    "text-sm truncate",
                    conversation.unreadCount > 0 ? "font-medium" : "text-muted-foreground"
                  )}>
                    {conversation.lastMessage.content}
                  </p>
                </div>
                
                {conversation.unreadCount > 0 && (
                  <Badge className="bg-primary text-primary-foreground">
                    {conversation.unreadCount}
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