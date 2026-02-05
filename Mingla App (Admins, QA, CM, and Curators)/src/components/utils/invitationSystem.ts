/**
 * Email Invitation System for Mingla
 * Manages user invitations and password reset tokens
 */

export interface Invitation {
  id: string;
  userId: string;
  email: string;
  token: string;
  sentAt: string;
  expiresAt: string;
  status: 'pending' | 'accepted' | 'expired';
  welcomeMessage?: string;
}

/**
 * Generate a secure random token for password reset
 */
export const generateResetToken = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Create an invitation for a new user
 */
export const createInvitation = (
  userId: string,
  email: string,
  welcomeMessage?: string
): Invitation => {
  const token = generateResetToken();
  const sentAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  const invitation: Invitation = {
    id: `inv-${Date.now()}`,
    userId,
    email,
    token,
    sentAt,
    expiresAt,
    status: 'pending',
    welcomeMessage
  };

  // Store invitation
  const invitations = JSON.parse(localStorage.getItem('invitations') || '[]');
  invitations.push(invitation);
  localStorage.setItem('invitations', JSON.stringify(invitations));

  return invitation;
};

/**
 * Send invitation email (simulated)
 */
export const sendInvitationEmail = (invitation: Invitation, userName: string): void => {
  // In a real app, this would call an email service API
  // For now, we'll store it in a simulated email outbox
  
  const resetLink = `${window.location.origin}/#/reset-password?token=${invitation.token}`;
  
  const emailContent = {
    to: invitation.email,
    subject: 'Welcome to Mingla - Set Your Password',
    body: `
      Hi ${userName},

      Welcome to Mingla! You've been invited to join our platform.

      ${invitation.welcomeMessage ? `\nMessage from admin:\n"${invitation.welcomeMessage}"\n` : ''}

      To get started, please click the link below to set your password:
      ${resetLink}

      This link will expire in 7 days.

      If you didn't expect this invitation, please ignore this email.

      Best regards,
      The Mingla Team
    `,
    sentAt: new Date().toISOString(),
    invitationId: invitation.id
  };

  // Store in simulated outbox
  const outbox = JSON.parse(localStorage.getItem('emailOutbox') || '[]');
  outbox.push(emailContent);
  localStorage.setItem('emailOutbox', JSON.stringify(outbox));

  console.log('📧 Invitation email sent:', emailContent);
};

/**
 * Get invitation by token
 */
export const getInvitationByToken = (token: string): Invitation | null => {
  const invitations: Invitation[] = JSON.parse(localStorage.getItem('invitations') || '[]');
  const invitation = invitations.find(inv => inv.token === token);
  
  if (!invitation) return null;

  // Check if expired
  if (new Date(invitation.expiresAt) < new Date()) {
    invitation.status = 'expired';
    updateInvitation(invitation);
    return null;
  }

  return invitation;
};

/**
 * Update invitation status
 */
export const updateInvitation = (invitation: Invitation): void => {
  const invitations: Invitation[] = JSON.parse(localStorage.getItem('invitations') || '[]');
  const updated = invitations.map(inv => 
    inv.id === invitation.id ? invitation : inv
  );
  localStorage.setItem('invitations', JSON.stringify(updated));
};

/**
 * Mark invitation as accepted
 */
export const acceptInvitation = (token: string): boolean => {
  const invitation = getInvitationByToken(token);
  
  if (!invitation) return false;

  invitation.status = 'accepted';
  updateInvitation(invitation);

  return true;
};

/**
 * Get all pending invitations
 */
export const getPendingInvitations = (): Invitation[] => {
  const invitations: Invitation[] = JSON.parse(localStorage.getItem('invitations') || '[]');
  return invitations.filter(inv => inv.status === 'pending');
};

/**
 * Get user's invitation
 */
export const getUserInvitation = (userId: string): Invitation | null => {
  const invitations: Invitation[] = JSON.parse(localStorage.getItem('invitations') || '[]');
  return invitations.find(inv => inv.userId === userId) || null;
};

/**
 * Resend invitation
 */
export const resendInvitation = (userId: string, userName: string): boolean => {
  const invitation = getUserInvitation(userId);
  
  if (!invitation) return false;

  // Create new invitation with new token
  const newInvitation = createInvitation(userId, invitation.email, invitation.welcomeMessage);
  
  // Mark old invitation as expired
  invitation.status = 'expired';
  updateInvitation(invitation);

  // Send new email
  sendInvitationEmail(newInvitation, userName);

  return true;
};
