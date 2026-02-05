import React from 'react';
import { MapPin, Trash2, Plus, Check, Sparkles, Wand2 } from 'lucide-react';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Button } from '../ui/button';
import { motion } from 'motion/react';
import GooglePlacesAutocomplete from '../GooglePlacesAutocomplete';
import { RouteStep, PurchaseOption } from './types';

interface RouteTimelineStepProps {
  routeSteps: RouteStep[];
  isMultiStopExperience: boolean;
  calculateTotalDuration: () => number;
  updateRouteStep: (stepId: string, field: keyof RouteStep, value: any) => void;
  removeRouteStep: (stepId: string) => void;
  addRouteStep: () => void;
  purchaseOptions?: PurchaseOption[];
}

export function RouteTimelineStep({
  routeSteps,
  isMultiStopExperience,
  calculateTotalDuration,
  updateRouteStep,
  removeRouteStep,
  addRouteStep,
  purchaseOptions = [],
}: RouteTimelineStepProps) {
  const [isGenerating, setIsGenerating] = React.useState(false);

  // AI Route Generation based on packages
  const generateRouteFromPackages = () => {
    if (purchaseOptions.length === 0) return;
    
    setIsGenerating(true);
    
    // Simulate AI generation with a delay
    setTimeout(() => {
      purchaseOptions.forEach((pkg, index) => {
        setTimeout(() => {
          // Add new route step
          addRouteStep();
          
          // Small delay to let the new step be created
          setTimeout(() => {
            const newStepIndex = routeSteps.length + index;
            if (routeSteps[newStepIndex]) {
              const stepId = routeSteps[newStepIndex].id;
              
              // Extract duration from package duration string (e.g., "2 hours" -> 120 minutes)
              let dwellTime = 60; // default
              if (pkg.duration) {
                const hourMatch = pkg.duration.match(/(\d+\.?\d*)\s*hour/i);
                const minMatch = pkg.duration.match(/(\d+)\s*min/i);
                if (hourMatch) {
                  dwellTime = Math.round(parseFloat(hourMatch[1]) * 60);
                } else if (minMatch) {
                  dwellTime = parseInt(minMatch[1]);
                }
              }
              
              // Generate description from package includes
              let description = pkg.description;
              if (pkg.includes && pkg.includes.length > 0) {
                const includesText = pkg.includes.filter(i => i).join(', ');
                description = `${pkg.description}\n\nIncludes: ${includesText}`;
              }
              
              // Update the route step with package data
              updateRouteStep(stepId, 'name', pkg.title);
              updateRouteStep(stepId, 'description', description);
              updateRouteStep(stepId, 'dwellTime', dwellTime);
              
              // For multi-stop experiences, mark middle stops appropriately
              if (isMultiStopExperience && index > 0 && index < purchaseOptions.length - 1) {
                updateRouteStep(stepId, 'isPassThrough', false);
              }
            }
          }, 300);
        }, index * 400);
      });
      
      setTimeout(() => {
        setIsGenerating(false);
      }, purchaseOptions.length * 400 + 500);
    }, 500);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-gray-900">
          {isMultiStopExperience ? `Route Stops (${routeSteps.length})` : 'Venue Location'}
        </h3>
        <div className="text-sm text-gray-600">
          Total Duration: <span className="font-medium text-[#eb7825]">{calculateTotalDuration()} min</span>
        </div>
      </div>

      {/* AI Route Generator */}
      {purchaseOptions.length > 0 && (
        <motion.div 
          className="mb-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-5"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {isGenerating ? (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-4"
            >
              <div className="flex items-center justify-center gap-2 text-gray-900 mb-3">
                <Sparkles className="w-5 h-5 text-[#eb7825] animate-pulse" />
                <span className="text-sm">Generating route from packages...</span>
              </div>
              <div className="w-full max-w-xs mx-auto bg-gray-100 rounded-full h-1 overflow-hidden">
                <motion.div 
                  className="h-full bg-[#eb7825]"
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 2, ease: "easeInOut" }}
                />
              </div>
            </motion.div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Wand2 className="w-5 h-5 text-[#eb7825]" />
                </div>
                <div className="text-left min-w-0">
                  <p className="text-sm font-medium text-gray-900">AI Route Builder</p>
                  <p className="text-xs text-gray-500">
                    Auto-generate {isMultiStopExperience ? 'route stops' : 'venue details'} from your {purchaseOptions.length} package{purchaseOptions.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              
              <Button
                type="button"
                onClick={generateRouteFromPackages}
                className="w-full sm:w-auto rounded-lg h-10 px-4 bg-[#eb7825] text-white hover:bg-[#d6691f]"
                disabled={isGenerating}
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Generate Route
              </Button>
            </div>
          )}
        </motion.div>
      )}

      <div className="space-y-4">
        {routeSteps.map((step, index) => (
          <div key={step.id} className="bg-gray-50 rounded-xl p-4 border border-gray-200">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  isMultiStopExperience ? (
                    index === 0 ? 'bg-green-500 text-white' :
                    index === routeSteps.length - 1 ? 'bg-red-500 text-white' :
                    'bg-blue-500 text-white'
                  ) : 'bg-[#eb7825] text-white'
                }`}>
                  {isMultiStopExperience ? (index + 1) : <MapPin className="w-4 h-4" />}
                </div>
                <span className="font-medium text-gray-900">
                  {isMultiStopExperience ? (
                    index === 0 ? 'Start Point' : 
                    index === routeSteps.length - 1 ? 'End Point' : 
                    'Stop'
                  ) : (
                    index === 0 ? 'Main Experience' : `Experience Option ${index + 1}`
                  )}
                </span>
              </div>
              {((isMultiStopExperience && routeSteps.length > 3) || (!isMultiStopExperience && routeSteps.length > 1)) && (
                <button
                  onClick={() => removeRouteStep(step.id)}
                  className="text-red-600 hover:text-red-700 p-1"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Input
                    value={step.name}
                    onChange={(e) => updateRouteStep(step.id, 'name', e.target.value)}
                    placeholder={isMultiStopExperience ? "Location name *" : "Experience name *"}
                    className="rounded-xl"
                  />
                  {index > 0 && routeSteps[0].name && (
                    <button
                      type="button"
                      onClick={() => updateRouteStep(step.id, 'name', routeSteps[0].name)}
                      className="text-xs text-[#eb7825] hover:text-[#d6691f] mt-1 flex items-center gap-1"
                    >
                      <Check className="w-3 h-3" />
                      Same as {isMultiStopExperience ? 'Start Point' : 'Main Experience'}
                    </button>
                  )}
                </div>
                <div>
                  <GooglePlacesAutocomplete
                    value={step.address}
                    onChange={(address, placeDetails) => {
                      updateRouteStep(step.id, 'address', address);
                      if (placeDetails) {
                        console.log('Selected place:', placeDetails);
                      }
                    }}
                    placeholder={isMultiStopExperience ? "Search for location *" : "Search for venue *"}
                    className="rounded-xl"
                  />
                  {index > 0 && routeSteps[0].address && (
                    <button
                      type="button"
                      onClick={() => updateRouteStep(step.id, 'address', routeSteps[0].address)}
                      className="text-xs text-[#eb7825] hover:text-[#d6691f] mt-1 flex items-center gap-1"
                    >
                      <MapPin className="w-3 h-3" />
                      Same as {isMultiStopExperience ? 'Start Point' : 'Main Experience'}
                    </button>
                  )}
                </div>
              </div>

              <Textarea
                value={step.description}
                onChange={(e) => updateRouteStep(step.id, 'description', e.target.value)}
                placeholder={isMultiStopExperience 
                  ? "What happens here? (min 20 chars) *" 
                  : "Describe the experience at this venue (min 20 chars) *"
                }
                rows={2}
                className="rounded-xl"
              />

              {!step.isPassThrough && (
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">
                    {isMultiStopExperience ? 'Dwell Time (minutes)' : 'Experience Duration (minutes)'}
                  </label>
                  <Input
                    type="number"
                    value={step.dwellTime}
                    onChange={(e) => updateRouteStep(step.id, 'dwellTime', parseInt(e.target.value) || 0)}
                    min="0"
                    className="rounded-xl"
                  />
                </div>
              )}

              {isMultiStopExperience && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={step.isPassThrough}
                    onChange={(e) => updateRouteStep(step.id, 'isPassThrough', e.target.checked)}
                  />
                  <span>Pass-through (no dwell time)</span>
                </label>
              )}
            </div>
          </div>
        ))}
      </div>

      <Button
        onClick={addRouteStep}
        variant="outline"
        className="w-full rounded-xl border-dashed border-2 border-[#eb7825] text-[#eb7825] hover:bg-[#eb7825]/5"
      >
        <Plus className="w-4 h-4 mr-2" />
        {isMultiStopExperience ? 'Add Route Stop' : 'Add Experience Option'}
      </Button>
    </motion.div>
  );
}