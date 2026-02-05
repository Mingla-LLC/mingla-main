import React from 'react';

interface SwipeIndicatorProps {
  direction: 'left' | 'right';
}

export default function SwipeIndicator({ direction }: SwipeIndicatorProps) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
      <div className={`
        px-6 py-3 rounded-2xl border-4 font-bold text-xl transform rotate-12
        ${direction === 'right' 
          ? 'border-[#eb7825] text-[#eb7825] bg-orange-50' 
          : 'border-gray-500 text-gray-500 bg-gray-50'
        }
      `}>
        {direction === 'right' ? 'LIKE' : 'PASS'}
      </div>
    </div>
  );
}
