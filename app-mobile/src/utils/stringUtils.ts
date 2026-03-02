/**
 * Generate initials from a name.
 * Single word: first 2 characters.
 * Multiple words: first char of first + last word.
 */
export const generateInitials = (name: string): string => {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].substring(0, 2).toUpperCase();
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
};
