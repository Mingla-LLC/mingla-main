import React from 'react';
import { Heart, Sparkles } from 'lucide-react';

interface EmptyStateProps {
  onGenerateMore?: () => void;
}

export default function EmptyState({ onGenerateMore }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="w-20 h-20 bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-full flex items-center justify-center mb-6 shadow-lg">
        <Heart className="w-10 h-10 text-white" />
      </div>
      
      <h3 className="text-xl font-bold text-gray-900 mb-2">
        You've seen all cards!
      </h3>
      
      <p className="text-gray-600 mb-6 max-w-sm">
        Check back soon for new experiences, or adjust your preferences to see different recommendations.
      </p>

      {onGenerateMore && (
        <button
          onClick={onGenerateMore}
          className="bg-[#eb7825] text-white px-6 py-3 rounded-xl font-semibold hover:bg-[#d6691f] transition-colors flex items-center gap-2 shadow-md hover:shadow-lg"
        >
          <Sparkles className="w-5 h-5" />
          Generate More Cards
        </button>
      )}
    </div>
  );
}
