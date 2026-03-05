import { supabase } from "../services/supabase";

/**
 * Username Utilities
 * Provides functions for generating and validating usernames
 */

/**
 * Sanitizes a string to be a valid username
 * - Converts to lowercase
 * - Removes all characters except alphanumeric and underscore
 * - Removes leading/trailing underscores
 */
export function sanitizeUsername(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^_+|_+$/g, "");
}

/**
 * Generates a username based on a user's name
 * Format: firstname_lastname + random 4-digit number
 * Falls back to "user" + random number if name is invalid
 */
export function generateUsernameFromName(name: string): string {
  if (!name || name.trim().length === 0) {
    // Fallback if no name provided
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    return `user${randomNum}`;
  }

  // Split name into parts
  const nameParts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);

  if (nameParts.length === 0) {
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    return `user${randomNum}`;
  }

  // Use first and last name if available, otherwise just first name
  let baseUsername = "";
  if (nameParts.length >= 2) {
    baseUsername = `${sanitizeUsername(nameParts[0])}_${sanitizeUsername(
      nameParts[nameParts.length - 1]
    )}`;
  } else {
    baseUsername = sanitizeUsername(nameParts[0]);
  }

  // Ensure minimum length
  if (baseUsername.length < 3) {
    baseUsername = baseUsername + "123";
  }

  // Add random 4-digit number to ensure uniqueness
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  const username = `${baseUsername}${randomNum}`;

  // Ensure total length doesn't exceed 30 characters
  return username.substring(0, 30);
}

/**
 * Checks if a username is available in the database
 * Returns true if available, false if taken
 */
export async function checkUsernameAvailability(
  username: string
): Promise<boolean> {
  if (!username || username.trim().length === 0) {
    return false;
  }

  try {
    const sanitized = sanitizeUsername(username);
    if (sanitized.length < 3) {
      return false; // Too short
    }

    // Direct query to check username availability
    // Query for exact match (sanitized username is already lowercase)
    const { data, error } = await supabase
      .from("profiles")
      .select("username")
      .eq("username", sanitized)
      .not("username", "is", null)
      .limit(1);

    if (error) {
      console.error("Error checking username availability:", error);
      
      // If RLS blocks the query, fetch all usernames as fallback
      // This requires the RLS policy to allow SELECT on profiles
      try {
        const { data: allUsernames, error: allError } = await supabase
          .from("profiles")
          .select("username")
          .not("username", "is", null);

        if (allError) {
          console.error("Error in fallback username check:", allError);
          // On error, assume available to not block user flow
          return true;
        }

        if (allUsernames) {
          // Check if any username matches case-insensitively
          const usernameExists = allUsernames.some(
            (profile) =>
              profile.username &&
              profile.username.toLowerCase().trim() === sanitized.toLowerCase().trim()
          );
          
          return !usernameExists;
        }
      } catch (fallbackError) {
        console.error("Exception in fallback username check:", fallbackError);
      }
      
      // If all methods fail, assume available to not block user flow
      return true;
    }

    // If exact match found, username is taken
    if (data && data.length > 0) {
      return false;
    }

    // Username is available (no exact match found)
    return true;
  } catch (error) {
    console.error("Exception checking username availability:", error);
    // On exception, assume it's available
    return true;
  }
}

/**
 * Generates a unique username by checking availability
 * Tries multiple variations if the generated username is taken
 */
export async function generateUniqueUsername(name: string): Promise<string> {
  let baseUsername = generateUsernameFromName(name);
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const isAvailable = await checkUsernameAvailability(baseUsername);
    if (isAvailable) {
      return baseUsername;
    }

    // If taken, regenerate with different random number
    const nameParts = name
      .trim()
      .split(/\s+/)
      .filter((part) => part.length > 0);
    let base = "";
    if (nameParts.length >= 2) {
      base = `${sanitizeUsername(nameParts[0])}_${sanitizeUsername(
        nameParts[nameParts.length - 1]
      )}`;
    } else if (nameParts.length === 1) {
      base = sanitizeUsername(nameParts[0]);
    } else {
      base = "user";
    }

    if (base.length < 3) {
      base = base + "123";
    }

    const randomNum = Math.floor(1000 + Math.random() * 9000);
    baseUsername = `${base}${randomNum}`.substring(0, 30);
    attempts++;
  }

  // Fallback: use timestamp if all attempts fail
  const timestamp = Date.now().toString().slice(-6);
  return `user${timestamp}`;
}
