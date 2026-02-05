import React, { useState } from 'react';
import { Sparkles, Plus, CheckCircle2 } from 'lucide-react';
import { Button } from '../../ui/button';
import { BusinessOnboardingStepProps } from '../types';
import CardCreatorModal from '../../CardCreatorModal';

interface FirstExperienceStepProps extends BusinessOnboardingStepProps {
  onShowExperienceCreator: () => void;
}

export default function FirstExperienceStep({ 
  data, 
  onUpdate,
  onShowExperienceCreator
}: FirstExperienceStepProps) {
  const [showCardCreator, setShowCardCreator] = useState(false);

  const handleCreateExperience = () => {
    setShowCardCreator(true);
  };

  const handleExperienceCreated = (card: any) => {
    // Save the experience
    const platformCards = JSON.parse(localStorage.getItem('platformCards') || '[]');
    platformCards.push(card);
    localStorage.setItem('platformCards', JSON.stringify(platformCards));

    // Mark as completed
    onUpdate({ 
      firstExperienceCreated: true,
      firstExperienceId: card.id
    });

    setShowCardCreator(false);
  };

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-[#eb7825]/10 rounded-full">
            <Sparkles className="w-7 h-7 text-[#eb7825]" />
          </div>
          <h2 className="text-2xl text-black">
            Create Your First Experience
          </h2>
          <p className="text-gray-600">
            Let's create your first experience offering to get started
          </p>
        </div>

        {/* Content */}
        <div className="bg-white rounded-xl p-6 border border-gray-200 space-y-6">
          {!data.firstExperienceCreated ? (
            <>
              {/* Why Create an Experience */}
              <div className="space-y-3">
                <h3 className="font-medium text-black">Why create an experience?</h3>
                <ul className="space-y-2 text-sm text-gray-700">
                  <li className="flex items-start gap-2">
                    <span className="text-[#eb7825] mt-0.5">✓</span>
                    <span>Showcase what makes your business unique</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#eb7825] mt-0.5">✓</span>
                    <span>Reach customers actively looking for experiences like yours</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#eb7825] mt-0.5">✓</span>
                    <span>Set your own pricing, availability, and policies</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#eb7825] mt-0.5">✓</span>
                    <span>Start accepting bookings right after verification</span>
                  </li>
                </ul>
              </div>

              {/* What to Include */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-900">
                  💡 <strong>First Experience Tips:</strong> Start with your most popular offering! Include great photos, clear descriptions, and competitive pricing. You can create more experiences anytime from your dashboard.
                </p>
              </div>

              {/* Create Button */}
              <Button
                onClick={handleCreateExperience}
                className="w-full bg-[#eb7825] hover:bg-[#d6691f] text-white flex items-center justify-center gap-2"
              >
                <Plus className="w-5 h-5" />
                Create Your First Experience
              </Button>

              {/* Skip Option */}
              <div className="text-center">
                <button
                  onClick={() => onUpdate({ firstExperienceCreated: true })}
                  className="text-sm text-gray-500 hover:text-gray-700 hover:underline"
                >
                  I'll do this later from my dashboard
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Success State */}
              <div className="text-center space-y-4">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full">
                  <CheckCircle2 className="w-8 h-8 text-green-600" />
                </div>
                <div>
                  <h3 className="font-medium text-black mb-2">
                    Experience Created! 🎉
                  </h3>
                  <p className="text-sm text-gray-600">
                    Great job! Your first experience has been created. You can edit it or create more from your dashboard.
                  </p>
                </div>
              </div>

              {/* Create Another Option */}
              <div className="pt-4 border-t border-gray-200">
                <Button
                  onClick={handleCreateExperience}
                  variant="outline"
                  className="w-full flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Create Another Experience
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Card Creator Modal */}
      {showCardCreator && (
        <CardCreatorModal
          onClose={() => setShowCardCreator(false)}
          onSave={handleExperienceCreated}
          existingExperiences={JSON.parse(localStorage.getItem('platformCards') || '[]')}
        />
      )}
    </>
  );
}
