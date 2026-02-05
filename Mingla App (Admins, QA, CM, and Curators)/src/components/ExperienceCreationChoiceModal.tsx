import React from 'react';
import { X, Edit3, Sparkles } from 'lucide-react';
import { Button } from './ui/button';

interface ExperienceCreationChoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectManual: () => void;
  onSelectAI: () => void;
}

export default function ExperienceCreationChoiceModal({
  isOpen,
  onClose,
  onSelectManual,
  onSelectAI
}: ExperienceCreationChoiceModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="relative bg-gradient-to-r from-[#eb7825] to-[#d6691f] p-6">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
          <h2 className="text-2xl font-bold text-white mb-2">Create Experience</h2>
          <p className="text-white/90 text-sm">Choose how you'd like to create your experience</p>
        </div>

        {/* Content */}
        <div className="p-6 grid md:grid-cols-2 gap-4">
          {/* Manual Creation Option */}
          <button
            onClick={onSelectManual}
            className="group relative bg-white border-2 border-gray-200 rounded-xl p-6 hover:border-[#eb7825] hover:shadow-lg transition-all duration-200 text-left"
          >
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-12 h-12 bg-gray-100 group-hover:bg-[#eb7825]/10 rounded-lg flex items-center justify-center transition-colors">
                <Edit3 className="w-6 h-6 text-gray-600 group-hover:text-[#eb7825] transition-colors" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Create Manually</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Use our step-by-step form to add all details yourself. Perfect for precise control over every aspect of your experience.
                </p>
                <div className="mt-4 space-y-1">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <div className="w-1 h-1 bg-gray-400 rounded-full" />
                    <span>Full control over details</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <div className="w-1 h-1 bg-gray-400 rounded-full" />
                    <span>4-step guided process</span>
                  </div>
                </div>
              </div>
            </div>
          </button>

          {/* AI Creation Option */}
          <button
            onClick={onSelectAI}
            className="group relative bg-gradient-to-br from-[#eb7825]/5 to-[#d6691f]/5 border-2 border-[#eb7825]/30 rounded-xl p-6 hover:border-[#eb7825] hover:shadow-lg transition-all duration-200 text-left"
          >
            <div className="absolute top-3 right-3">
              <span className="bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white text-xs px-2 py-1 rounded-full">
                AI Powered
              </span>
            </div>
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-[#eb7825]/20 to-[#d6691f]/20 group-hover:from-[#eb7825]/30 group-hover:to-[#d6691f]/30 rounded-lg flex items-center justify-center transition-colors">
                <Sparkles className="w-6 h-6 text-[#eb7825]" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Generate with AI</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Upload your menu or describe your business, and AI will generate multiple experiences for you to review and customize.
                </p>
                <div className="mt-4 space-y-1">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <div className="w-1 h-1 bg-[#eb7825] rounded-full" />
                    <span>Quick & effortless</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <div className="w-1 h-1 bg-[#eb7825] rounded-full" />
                    <span>Multiple experiences at once</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <div className="w-1 h-1 bg-[#eb7825] rounded-full" />
                    <span>Edit & refine after generation</span>
                  </div>
                </div>
              </div>
            </div>
          </button>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6">
          <div className="bg-gradient-to-r from-[#eb7825]/10 to-[#d6691f]/10 border border-[#eb7825]/30 rounded-lg p-4">
            <p className="text-xs text-gray-900">
              <strong>💡 Tip:</strong> AI generation is perfect when you have a menu or multiple offerings. You can always edit the details manually after AI creates the initial experiences.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}