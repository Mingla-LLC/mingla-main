import React, { useState } from 'react';
import { X, Share2, Calendar, MapPin, Star, Clock, Users, Copy, Check } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { formatCurrency } from './utils/formatters';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  experienceData: any;
  dateTimePreferences: any;
  userPreferences?: any;
  accountPreferences?: any;
}

export default function ShareModal({ 
  isOpen, 
  onClose, 
  experienceData, 
  dateTimePreferences,
  userPreferences,
  accountPreferences 
}: ShareModalProps) {
  const [linkCopied, setLinkCopied] = useState(false);
  const [messageCopied, setMessageCopied] = useState(false);
  
  if (!isOpen) return null;

  // Generate shareable link
  const shareableLink = `https://mingla.app/experience/${experienceData.id}?date=${encodeURIComponent(JSON.stringify(dateTimePreferences))}`;

  const handleCopyLink = async () => {
    try {
      // Try modern Clipboard API first
      await navigator.clipboard.writeText(shareableLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
      return;
    } catch (err) {
      // Fallback to legacy method
      try {
        const textArea = document.createElement('textarea');
        textArea.value = shareableLink;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        
        if (successful) {
          setLinkCopied(true);
          setTimeout(() => setLinkCopied(false), 2000);
        } else {
          throw new Error('Copy command failed');
        }
      } catch (fallbackErr) {
        console.error('Failed to copy link:', fallbackErr);
        // Show user-friendly error by prompting them to manually copy
        const userAgent = navigator.userAgent.toLowerCase();
        if (userAgent.includes('mobile') || userAgent.includes('android') || userAgent.includes('iphone')) {
          // On mobile, show the link in an alert so they can copy it
          alert(`Please copy this link manually:\n\n${shareableLink}`);
        } else {
          // On desktop, create a prompt with pre-selected text
          prompt('Copy this link:', shareableLink);
        }
      }
    }
  };

  const handleCopyMessage = async () => {
    const message = `Check out this amazing experience I found on Mingla! ${experienceData.title} - Join me for ${dateTimePreferences.timeOfDay} on ${dateTimePreferences.dayOfWeek}\n\n${shareableLink}`;
    try {
      // Try modern Clipboard API first
      await navigator.clipboard.writeText(message);
      setMessageCopied(true);
      setTimeout(() => setMessageCopied(false), 2000);
      return;
    } catch (err) {
      // Fallback to legacy method
      try {
        const textArea = document.createElement('textarea');
        textArea.value = message;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        
        if (successful) {
          setMessageCopied(true);
          setTimeout(() => setMessageCopied(false), 2000);
        } else {
          throw new Error('Copy command failed');
        }
      } catch (fallbackErr) {
        console.error('Failed to copy message:', fallbackErr);
        // Show user-friendly error by prompting them to manually copy
        const userAgent = navigator.userAgent.toLowerCase();
        if (userAgent.includes('mobile') || userAgent.includes('android') || userAgent.includes('iphone')) {
          // On mobile, show the link in an alert so they can copy it
          alert(`Please copy this message manually:\n\n${message}`);
        } else {
          // On desktop, create a prompt with pre-selected text
          prompt('Copy this message:', message);
        }
      }
    }
  };

  const handleSocialShare = (platform: string) => {
    const text = `Check out this amazing experience I found on Mingla! ${experienceData.title} - Join me for ${dateTimePreferences.timeOfDay} on ${dateTimePreferences.dayOfWeek}`;
    const url = shareableLink;
    
    let shareUrl = '';
    
    switch (platform) {
      case 'twitter':
        shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
        break;
      case 'facebook':
        shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
        break;
      case 'instagram':
        // Instagram doesn't support URL sharing directly, so we'll copy to clipboard
        handleCopyLink();
        return;
      case 'whatsapp':
        shareUrl = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
        break;
      case 'messages':
        if (navigator.share) {
          try {
            navigator.share({
              title: experienceData.title,
              text: text,
              url: url
            });
          } catch (err) {
            console.error('Share failed:', err);
            // Fallback to copying link
            handleCopyLink();
          }
          return;
        }
        break;
    }
    
    if (shareUrl) {
      window.open(shareUrl, '_blank', 'width=600,height=400');
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${experienceData.title} - Mingla Experience`,
          text: `Check out this amazing experience I found on Mingla! Join me for ${dateTimePreferences.timeOfDay} on ${dateTimePreferences.dayOfWeek}`,
          url: shareableLink
        });
      } catch (err) {
        console.error('Native share failed:', err);
        // Fallback to copying link
        handleCopyLink();
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Share Experience</h3>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors flex items-center justify-center"
          >
            <X className="w-4 h-4 text-gray-600" />
          </button>
        </div>

        <div className="overflow-y-auto max-h-[calc(90vh-80px)]">
          {/* Card Preview */}
          <div className="p-4">
            <div className="bg-gradient-to-br from-[#FF7043] to-[#FF5722] rounded-xl p-1">
              <div className="bg-white rounded-lg overflow-hidden">
                {/* Experience Image */}
                <div className="relative h-48">
                  <ImageWithFallback
                    src={experienceData.image}
                    alt={experienceData.title}
                    className="w-full h-full object-cover"
                  />
                  {/* Mingla Badge */}
                  <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm rounded-lg px-2 py-1">
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 bg-gradient-to-r from-[#FF7043] to-[#FF5722] rounded-full"></div>
                      <span className="text-xs font-medium text-gray-800">Mingla</span>
                    </div>
                  </div>
                  {/* Rating */}
                  <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm rounded-lg px-2 py-1 flex items-center gap-1">
                    <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                    <span className="text-xs font-medium">{experienceData.rating}</span>
                  </div>
                </div>

                {/* Experience Details */}
                <div className="p-4">
                  <h4 className="font-semibold text-gray-900 mb-2">{experienceData.title}</h4>
                  
                  <div className="flex items-center gap-4 text-sm text-gray-600 mb-3">
                    <div className="flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      <span>{experienceData.distance} away</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Users className="w-4 h-4" />
                      <span>{experienceData.groupSize || experienceData.priceRange}</span>
                    </div>
                  </div>

                  {/* Scheduled Date/Time */}
                  <div className="bg-[#eb7825]/10 rounded-lg p-3 mb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar className="w-4 h-4 text-[#eb7825]" />
                      <span className="text-sm font-medium text-[#eb7825]">Suggested Schedule</span>
                    </div>
                    <div className="text-sm text-gray-700">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{dateTimePreferences.timeOfDay}</span>
                        </div>
                        <div>
                          <span>{dateTimePreferences.dayOfWeek}</span>
                        </div>
                        <div>
                          <span>{dateTimePreferences.planningTimeframe}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-semibold text-[#eb7825]">
                      {experienceData.priceRange}
                    </span>
                    <span className="text-sm text-gray-500">per person</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Join Mingla CTA */}
            <div className="mt-4 bg-gradient-to-r from-[#eb7825] to-[#d6691f] rounded-xl p-4 text-white text-center relative">
              <p className="text-sm leading-relaxed select-text cursor-text text-left pr-10">
                What do you think about <span className="font-semibold">{experienceData.title}</span>
                {experienceData.address && ` at ${experienceData.address}`}
                {!experienceData.address && experienceData.distance && ` (${experienceData.distance} away)`}? 
                {experienceData.rating && ` It has a ${experienceData.rating} star rating`}
                {(experienceData.groupSize || experienceData.priceRange) && ` and costs ${experienceData.groupSize || experienceData.priceRange}`}.
                {dateTimePreferences.timeOfDay && ` I'm thinking we could go ${dateTimePreferences.timeOfDay}`}
                {dateTimePreferences.dayOfWeek && ` on ${dateTimePreferences.dayOfWeek}`}
                {dateTimePreferences.planningTimeframe && ` (${dateTimePreferences.planningTimeframe})`}.
                {experienceData.description && ` ${experienceData.description}`} Let me know if you're interested!
              </p>
              <button
                onClick={async () => {
                  const text = `What do you think about ${experienceData.title}${
                    experienceData.address ? ` at ${experienceData.address}` : 
                    (!experienceData.address && experienceData.distance ? ` (${experienceData.distance} away)` : '')
                  }?${experienceData.rating ? ` It has a ${experienceData.rating} star rating` : ''}${
                    (experienceData.groupSize || experienceData.priceRange) ? ` and costs ${experienceData.groupSize || experienceData.priceRange}` : ''
                  }.${dateTimePreferences.timeOfDay ? ` I'm thinking we could go ${dateTimePreferences.timeOfDay}` : ''}${
                    dateTimePreferences.dayOfWeek ? ` on ${dateTimePreferences.dayOfWeek}` : ''
                  }${dateTimePreferences.planningTimeframe ? ` (${dateTimePreferences.planningTimeframe})` : ''}.${
                    experienceData.description ? ` ${experienceData.description}` : ''
                  } Let me know if you're interested!`;
                  
                  try {
                    // Try modern Clipboard API first
                    await navigator.clipboard.writeText(text);
                    setMessageCopied(true);
                    setTimeout(() => setMessageCopied(false), 2000);
                    return;
                  } catch (err) {
                    // Fallback to legacy method
                    try {
                      const textArea = document.createElement('textarea');
                      textArea.value = text;
                      textArea.style.position = 'fixed';
                      textArea.style.left = '-999999px';
                      textArea.style.top = '-999999px';
                      document.body.appendChild(textArea);
                      textArea.focus();
                      textArea.select();
                      const successful = document.execCommand('copy');
                      document.body.removeChild(textArea);
                      if (successful) {
                        setMessageCopied(true);
                        setTimeout(() => setMessageCopied(false), 2000);
                      } else {
                        // Show prompt as last resort
                        prompt('Copy this message:', text);
                      }
                    } catch (fallbackErr) {
                      console.error('Failed to copy:', fallbackErr);
                      // Show prompt as last resort
                      prompt('Copy this message:', text);
                    }
                  }
                }}
                className="absolute top-3 right-3 w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 backdrop-blur-sm flex items-center justify-center transition-all"
                title="Copy message"
              >
                {messageCopied ? (
                  <Check className="w-4 h-4 text-white" />
                ) : (
                  <Copy className="w-4 h-4 text-white" />
                )}
              </button>
            </div>
          </div>

          {/* Share Options */}
          <div className="p-4 border-t border-gray-100">
            <h4 className="font-medium text-gray-900 mb-3">Share to:</h4>
            
            {/* Social Media Buttons */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              <button
                onClick={() => handleSocialShare('messages')}
                className="flex flex-col items-center gap-2 p-3 rounded-xl bg-blue-50 hover:bg-blue-100 transition-colors"
              >
                <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
                  <span className="text-white text-xs font-bold">💬</span>
                </div>
                <span className="text-xs text-gray-700">Messages</span>
              </button>

              <button
                onClick={() => handleSocialShare('whatsapp')}
                className="flex flex-col items-center gap-2 p-3 rounded-xl bg-green-50 hover:bg-green-100 transition-colors"
              >
                <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center">
                  <span className="text-white text-xs font-bold">📱</span>
                </div>
                <span className="text-xs text-gray-700">WhatsApp</span>
              </button>

              <button
                onClick={() => handleSocialShare('instagram')}
                className="flex flex-col items-center gap-2 p-3 rounded-xl bg-pink-50 hover:bg-pink-100 transition-colors"
              >
                <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                  <span className="text-white text-xs font-bold">📷</span>
                </div>
                <span className="text-xs text-gray-700">Instagram</span>
              </button>

              <button
                onClick={() => handleSocialShare('twitter')}
                className="flex flex-col items-center gap-2 p-3 rounded-xl bg-blue-50 hover:bg-blue-100 transition-colors"
              >
                <div className="w-8 h-8 bg-blue-400 rounded-lg flex items-center justify-center">
                  <span className="text-white text-xs font-bold">🐦</span>
                </div>
                <span className="text-xs text-gray-700">Twitter</span>
              </button>
            </div>

            {/* Native Share Button */}
            {navigator.share && (
              <button
                onClick={handleNativeShare}
                className="w-full bg-gray-100 hover:bg-gray-200 transition-colors rounded-xl p-3 mb-3 flex items-center justify-center gap-2"
              >
                <Share2 className="w-4 h-4 text-gray-600" />
                <span className="text-gray-700">More sharing options</span>
              </button>
            )}

            {/* Copy Link */}
            <button
              onClick={handleCopyLink}
              className="w-full border-2 border-gray-200 hover:border-[#eb7825] hover:bg-orange-50 transition-all rounded-xl p-3 flex items-center justify-center gap-2"
            >
              {linkCopied ? (
                <>
                  <Check className="w-4 h-4 text-[#eb7825]" />
                  <span className="text-[#eb7825] font-medium">Link Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-gray-600" />
                  <span className="text-gray-700">Copy Link</span>
                </>
              )}
            </button>

            {/* Copy Message */}
            <button
              onClick={handleCopyMessage}
              className="w-full border-2 border-gray-200 hover:border-[#eb7825] hover:bg-orange-50 transition-all rounded-xl p-3 flex items-center justify-center gap-2"
            >
              {messageCopied ? (
                <>
                  <Check className="w-4 h-4 text-[#eb7825]" />
                  <span className="text-[#eb7825] font-medium">Message Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-gray-600" />
                  <span className="text-gray-700">Copy Message</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}