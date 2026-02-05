import React from 'react';
import { Shield, Check, X } from 'lucide-react';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { motion } from 'motion/react';

interface PoliciesStepProps {
  cancellationPolicy: string;
  setCancellationPolicy: (value: string) => void;
  additionalPolicies: string;
  setAdditionalPolicies: (value: string) => void;
  requirements: string;
  setRequirements: (value: string) => void;
  accessibilityInfo: string;
  setAccessibilityInfo: (value: string) => void;
  expandedSections: Set<string>;
  toggleSection: (section: string) => void;
}

export function PoliciesStep({
  cancellationPolicy,
  setCancellationPolicy,
  additionalPolicies,
  setAdditionalPolicies,
  requirements,
  setRequirements,
  accessibilityInfo,
  setAccessibilityInfo,
}: PoliciesStepProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-6"
    >
      <div>
        <label className="block text-gray-700 mb-2">Cancellation Policy</label>
        <Textarea
          value={cancellationPolicy}
          onChange={(e) => setCancellationPolicy(e.target.value)}
          placeholder="e.g., Free cancellation up to 24 hours before..."
          rows={3}
          className="rounded-xl"
        />
      </div>

      <div>
        <label className="block text-gray-700 mb-2">Additional Policies</label>
        <Textarea
          value={additionalPolicies}
          onChange={(e) => setAdditionalPolicies(e.target.value)}
          placeholder="e.g., Rain or shine, indoor backup available..."
          rows={3}
          className="rounded-xl"
        />
      </div>

      <div>
        <label className="block text-gray-700 mb-2">Requirements</label>
        <Textarea
          value={requirements}
          onChange={(e) => setRequirements(e.target.value)}
          placeholder="e.g., Comfortable walking shoes, Valid ID (21+)"
          rows={3}
          className="rounded-xl"
        />
      </div>

      <div>
        <label className="block text-gray-700 mb-2">Accessibility Information</label>
        <Textarea
          value={accessibilityInfo}
          onChange={(e) => setAccessibilityInfo(e.target.value)}
          placeholder="e.g., Wheelchair accessible, Service animals welcome"
          rows={3}
          className="rounded-xl"
        />
      </div>
    </motion.div>
  );
}