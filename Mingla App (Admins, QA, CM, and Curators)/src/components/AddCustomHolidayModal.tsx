import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Calendar, Plus, Check } from 'lucide-react';

interface CustomHoliday {
  id: string;
  name: string;
  date: string; // MM-DD format
  description: string;
  category: string;
}

interface AddCustomHolidayModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (holiday: CustomHoliday) => void;
}

const categories = [
  { value: 'Dining Experiences', label: 'Dining Experiences' },
  { value: 'Casual Eats', label: 'Casual Eats' },
  { value: 'Sip & Chill', label: 'Sip & Chill' },
  { value: 'Stroll', label: 'Stroll' },
  { value: 'Picnics', label: 'Picnics' },
  { value: 'Screen & Relax', label: 'Screen & Relax' },
  { value: 'Wellness Dates', label: 'Wellness Dates' },
  { value: 'Creative & Hands-On', label: 'Creative & Hands-On' },
  { value: 'Play & Move', label: 'Play & Move' },
  { value: 'Freestyle', label: 'Freestyle' }
];

export default function AddCustomHolidayModal({ isOpen, onClose, onAdd }: AddCustomHolidayModalProps) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Dining Experiences');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = () => {
    if (!name.trim() || !date) return;

    setIsSubmitting(true);

    // Create the custom holiday
    const newHoliday: CustomHoliday = {
      id: `custom-${Date.now()}`,
      name: name.trim(),
      date: date, // Store in YYYY-MM-DD format from input
      description: description.trim() || `Special day: ${name}`,
      category
    };

    setTimeout(() => {
      onAdd(newHoliday);
      setIsSubmitting(false);
      setIsSubmitted(true);

      // Reset and close after success animation
      setTimeout(() => {
        setName('');
        setDate('');
        setDescription('');
        setCategory('Dining Experiences');
        setIsSubmitted(false);
        onClose();
      }, 1000);
    }, 500);
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setName('');
      setDate('');
      setDescription('');
      setCategory('Dining Experiences');
      setIsSubmitted(false);
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[10002]"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-4 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full sm:max-w-lg z-[10003]"
          >
            {/* Gradient border wrapper */}
            <div className="absolute inset-0 bg-gradient-to-br from-[#eb7825] via-[#d6691f] to-[#eb7825] rounded-3xl blur-sm" />

            {/* Main card */}
            <div className="relative bg-white/98 backdrop-blur-xl rounded-3xl shadow-2xl overflow-hidden border border-white/20 flex flex-col max-h-full">
              {/* Animated background */}
              <motion.div
                animate={{
                  opacity: [0.05, 0.12, 0.05],
                }}
                transition={{
                  duration: 4,
                  repeat: Infinity,
                  ease: 'easeInOut'
                }}
                className="absolute inset-0 bg-gradient-to-br from-[#eb7825]/20 via-[#d6691f]/10 to-[#eb7825]/20 pointer-events-none"
              />

              {/* Header */}
              <div className="relative p-5 sm:p-6 border-b border-gray-200/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center shadow-lg">
                      <Calendar className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-lg sm:text-xl font-bold text-gray-900">Add Custom Day</h3>
                      <p className="text-xs sm:text-sm text-gray-500">Create a personal reminder</p>
                    </div>
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.1, rotate: 90 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={handleClose}
                    disabled={isSubmitting}
                    className="p-2 rounded-full bg-gray-100/80 backdrop-blur-sm text-gray-500 hover:text-gray-700 hover:bg-gray-200/80 transition-all duration-200 disabled:opacity-50"
                  >
                    <X className="w-5 h-5" />
                  </motion.button>
                </div>
              </div>

              {/* Content */}
              <div className="relative p-5 sm:p-6 space-y-4 flex-1 overflow-y-auto">
                {/* Name input */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Day Name *
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Anniversary, Mom's Birthday, etc."
                    disabled={isSubmitting || isSubmitted}
                    className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-[#eb7825] focus:ring-2 focus:ring-[#eb7825]/20 outline-none transition-all duration-200 text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>

                {/* Date input */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Date *
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    disabled={isSubmitting || isSubmitted}
                    className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-[#eb7825] focus:ring-2 focus:ring-[#eb7825]/20 outline-none transition-all duration-200 text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>

                {/* Description input */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Why is this day special?"
                    disabled={isSubmitting || isSubmitted}
                    className="w-full h-24 px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-[#eb7825] focus:ring-2 focus:ring-[#eb7825]/20 outline-none transition-all duration-200 resize-none text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>

                {/* Category dropdown */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    disabled={isSubmitting || isSubmitted}
                    className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-[#eb7825] focus:ring-2 focus:ring-[#eb7825]/20 outline-none transition-all duration-200 text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed bg-white appearance-none cursor-pointer"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                      backgroundPosition: 'right 0.75rem center',
                      backgroundRepeat: 'no-repeat',
                      backgroundSize: '1.5em 1.5em',
                      paddingRight: '2.5rem'
                    }}
                  >
                    {categories.map((cat) => (
                      <option key={cat.value} value={cat.value}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Footer */}
              <div className="relative p-5 sm:p-6 border-t border-gray-200/50">
                <motion.button
                  whileHover={{ scale: !name.trim() || !date || isSubmitting || isSubmitted ? 1 : 1.02 }}
                  whileTap={{ scale: !name.trim() || !date || isSubmitting || isSubmitted ? 1 : 0.98 }}
                  onClick={handleSubmit}
                  disabled={!name.trim() || !date || isSubmitting || isSubmitted}
                  className="w-full py-3.5 sm:py-4 bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white rounded-xl font-bold text-base sm:text-lg shadow-xl hover:shadow-2xl transition-all duration-300 relative overflow-hidden group disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {/* Button shine effect */}
                  {!isSubmitting && !isSubmitted && (
                    <motion.div
                      animate={{
                        x: ['-100%', '200%']
                      }}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                        repeatDelay: 1,
                        ease: 'easeInOut'
                      }}
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                    />
                  )}
                  
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    {isSubmitted && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                      >
                        <Check className="w-5 h-5" />
                      </motion.div>
                    )}
                    {!isSubmitting && !isSubmitted && <Plus className="w-5 h-5" />}
                    {isSubmitting ? 'Adding...' : isSubmitted ? 'Added!' : 'Add Custom Day'}
                  </span>
                </motion.button>
              </div>

              {/* Bottom accent line */}
              <motion.div
                animate={{
                  opacity: [0.5, 1, 0.5],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'easeInOut'
                }}
                className="h-1 bg-gradient-to-r from-[#eb7825] via-[#d6691f] to-[#eb7825]"
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}