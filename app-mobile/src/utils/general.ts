/**
 * Truncates a string to a specified length and adds an ellipsis if truncated.
 * @param str - The string to truncate
 * @param maxLength - Maximum length of the resulting string (including ellipsis)
 * @param ellipsis - The string to append when truncated (default: "...")
 * @returns The truncated string
 */
export const truncateString = (
  str: string,
  maxLength: number,
  ellipsis: string = "..."
): string => {
  if (!str) return "";
  if (str.length <= maxLength) return str;
  
  const truncatedLength = maxLength - ellipsis.length;
  if (truncatedLength <= 0) return ellipsis.slice(0, maxLength);
  
  return str.slice(0, truncatedLength) + ellipsis;
};
