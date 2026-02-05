import React from 'react';
import { 
  Building2, MapPin, Clock, DollarSign, Tag, 
  Calendar, Sparkles, TrendingUp 
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../ui/sheet';
import { Separator } from '../ui/separator';
import { CollaborationDetailsProps } from './types';
import { formatDate } from './utils';

export default function CollaborationDetails({
  isOpen,
  collaboration,
  sharedExperiences,
  currentUserType,
  onClose
}: CollaborationDetailsProps) {
  if (!collaboration) return null;

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Collaboration Details</SheetTitle>
          <SheetDescription>
            Information about this partnership
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Experience Info */}
          <div className="bg-gradient-to-br from-[#eb7825]/10 to-[#d6691f]/10 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-[#eb7825]" />
              <h3 className="font-semibold text-gray-900">Experience</h3>
            </div>
            <p className="text-gray-900">{collaboration.experienceName}</p>
            
            {collaboration.experienceCategory && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Tag className="h-4 w-4" />
                <span>{collaboration.experienceCategory}</span>
              </div>
            )}
            
            {collaboration.experienceLocation && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <MapPin className="h-4 w-4" />
                <span>{collaboration.experienceLocation}</span>
              </div>
            )}
            
            {collaboration.experienceDuration && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Clock className="h-4 w-4" />
                <span>{collaboration.experienceDuration}</span>
              </div>
            )}
            
            {collaboration.experiencePrice && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <DollarSign className="h-4 w-4" />
                <span>${collaboration.experiencePrice}</span>
              </div>
            )}
          </div>

          <Separator />

          {/* Collaboration Status */}
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900">Status</h3>
            <div className="flex items-center gap-2">
              <Badge 
                variant={collaboration.status === 'active' ? 'default' : 'secondary'}
                className={collaboration.status === 'active' ? 'bg-green-500' : ''}
              >
                {collaboration.status}
              </Badge>
              <span className="text-sm text-gray-600">
                Since {formatDate(collaboration.createdAt)}
              </span>
            </div>
          </div>

          {/* Commission */}
          {collaboration.commission && (
            <>
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-[#eb7825]" />
                  <h3 className="font-semibold text-gray-900">Commission</h3>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">Current Rate</span>
                    <span className="text-2xl font-bold text-green-700">
                      {collaboration.commission}%
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Partners */}
          <Separator />
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900">Partners</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="outline" className="bg-blue-50">Curator</Badge>
                <span className="text-gray-700">{collaboration.curatorName}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="outline" className="bg-purple-50">Business</Badge>
                <span className="text-gray-700">{collaboration.businessName}</span>
              </div>
            </div>
          </div>

          {/* Shared Experiences */}
          {sharedExperiences.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3">
                <h3 className="font-semibold text-gray-900">
                  Shared Experiences ({sharedExperiences.length})
                </h3>
                <div className="space-y-2">
                  {sharedExperiences.map((exp) => (
                    <div
                      key={exp.id}
                      className="bg-gray-50 rounded-lg p-3 space-y-1"
                    >
                      <p className="text-sm font-medium text-gray-900">
                        {exp.title || exp.name}
                      </p>
                      {exp.category && (
                        <div className="flex items-center gap-1 text-xs text-gray-600">
                          <Tag className="h-3 w-3" />
                          <span>{exp.category}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Collaboration ID */}
          <Separator />
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-700">Collaboration ID</h3>
            <p className="text-xs text-gray-500 font-mono bg-gray-50 p-2 rounded">
              {collaboration.id}
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
