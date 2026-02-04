import React from 'react';
import { 
  CheckCircle2, AlertCircle, Sparkles, MapPin, 
  Clock, DollarSign, TrendingUp 
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { MessageBubbleProps } from './types';
import { formatTime } from './utils';

export default function MessageBubble({
  message,
  currentUserId,
  currentUserType,
  onAcceptNegotiation,
  onRejectNegotiation
}: MessageBubbleProps) {
  const isMe = message.senderId === currentUserId;
  const isSystem = message.senderId === 'system';

  // System messages (welcome, etc.)
  if (isSystem) {
    return (
      <div className="flex justify-center my-4">
        <div className="bg-gray-100 text-gray-600 px-4 py-2 rounded-full text-sm max-w-md text-center">
          {message.content}
        </div>
      </div>
    );
  }

  // Negotiation messages
  if (message.type === 'negotiation') {
    const { proposedCommission, finalCommission, status } = message.metadata || {};
    
    return (
      <div className={`flex ${isMe ? 'justify-end' : 'justify-start'} mb-4`}>
        <div className={`max-w-md ${isMe ? 'bg-[#eb7825]/10' : 'bg-gray-100'} rounded-2xl p-4 space-y-3`}>
          <div className="flex items-center gap-2">
            {status === 'proposed' && <TrendingUp className="h-5 w-5 text-[#eb7825]" />}
            {status === 'accepted' && <CheckCircle2 className="h-5 w-5 text-green-600" />}
            {status === 'rejected' && <AlertCircle className="h-5 w-5 text-red-600" />}
            <span className="font-medium text-gray-900">
              {status === 'proposed' && 'Commission Proposal'}
              {status === 'accepted' && 'Commission Accepted'}
              {status === 'rejected' && 'Proposal Declined'}
              {status === 'counter' && 'Counter Proposal'}
            </span>
          </div>

          {proposedCommission && (
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-gray-600" />
              <span className="text-sm text-gray-700">
                Proposed Rate: <span className="font-semibold">{proposedCommission}%</span>
              </span>
            </div>
          )}

          {finalCommission && (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-sm text-gray-700">
                Agreed Rate: <span className="font-semibold text-green-600">{finalCommission}%</span>
              </span>
            </div>
          )}

          {message.content && message.content !== 'Negotiation Summary' && (
            <p className="text-sm text-gray-600">{message.content}</p>
          )}

          {/* Action buttons for proposals (only for receiver) */}
          {!isMe && status === 'proposed' && proposedCommission && onAcceptNegotiation && onRejectNegotiation && (
            <div className="flex gap-2 pt-2">
              <Button
                size="sm"
                onClick={() => onAcceptNegotiation(message.id, proposedCommission)}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRejectNegotiation(message.id)}
                className="flex-1"
              >
                Decline
              </Button>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-gray-500 pt-1">
            <span>{message.senderName}</span>
            <span>{formatTime(message.timestamp)}</span>
          </div>
        </div>
      </div>
    );
  }

  // Experience tag messages
  if (message.type === 'experience') {
    const { experienceName, experiencePrice, experienceLocation } = message.metadata || {};
    
    return (
      <div className={`flex ${isMe ? 'justify-end' : 'justify-start'} mb-4`}>
        <div className={`max-w-md ${isMe ? 'bg-[#eb7825]/10' : 'bg-gray-100'} rounded-2xl p-4 space-y-3`}>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#eb7825]" />
            <span className="font-medium text-gray-900">Experience Tagged</span>
          </div>

          {experienceName && (
            <div className="bg-white rounded-lg p-3 space-y-2">
              <h4 className="font-semibold text-gray-900">{experienceName}</h4>
              
              {experienceLocation && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <MapPin className="h-4 w-4" />
                  <span>{experienceLocation}</span>
                </div>
              )}
              
              {experiencePrice && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <DollarSign className="h-4 w-4" />
                  <span>${experiencePrice}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{message.senderName}</span>
            <span>{formatTime(message.timestamp)}</span>
          </div>
        </div>
      </div>
    );
  }

  // Regular text messages
  return (
    <div className={`flex ${isMe ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-md ${
        isMe 
          ? 'bg-[#eb7825] text-white' 
          : 'bg-gray-100 text-gray-900'
      } rounded-2xl px-4 py-2 space-y-1`}>
        <p className="text-sm break-words">{message.content}</p>
        <div className={`flex items-center justify-between text-xs ${
          isMe ? 'text-white/70' : 'text-gray-500'
        }`}>
          {!isMe && <span>{message.senderName}</span>}
          <span className={!isMe ? 'ml-auto' : ''}>{formatTime(message.timestamp)}</span>
        </div>
      </div>
    </div>
  );
}
