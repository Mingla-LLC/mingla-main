# Admin Dashboard - Quick Start Guide

## How to Access

1. **Sign in as Admin**
   - Email: `david.admin@mingla.com`
   - Password: `password123`

2. **The dashboard will load automatically**

## Navigation Overview

The admin dashboard has a left sidebar (desktop) or hamburger menu (mobile) with 10 main sections:

### 1. 🏠 Overview
**What it does**: Shows platform statistics at a glance
- View total users (Explorers, Curators, Businesses, QA)
- See live experiences and revenue
- Check recent activity
- View top performing creators

**Quick Actions**:
- Just view the data - no actions needed to start

---

### 2. 💬 QA Chat
**What it does**: Team messaging like Slack or Teams
- Chat with QA managers and team members
- Create channels or direct messages
- View message history

**How to Use**:
1. Click "New Thread" button
2. Enter thread name
3. Choose "Channel" or "Direct Message"
4. Start chatting!

---

### 3. ✨ My Cards
**What it does**: Create and manage your experience cards
- Same functionality as Curator's "My Cards"
- Create, edit, preview, delete cards
- Search and filter your cards

**How to Create a Card**:
1. Click "Create Card" button
2. Fill in all required fields
3. Add images, pricing, availability
4. Save as draft or submit for review

---

### 4. 🛡️ Moderate
**What it does**: Manage ALL experiences on the platform
- See every card (API, curator, business, QA, admin)
- Approve or return cards with feedback
- Edit or delete any experience

**How to Moderate**:
1. Browse all experiences
2. Click "Approve" to publish
3. Click "Return" to send back with feedback
4. Use filters to find specific cards

---

### 5. 👥 User Management
**What it does**: Manage all platform users
- Add new users
- Edit user details
- Suspend or delete users
- Filter by role

**How to Add a User**:
1. Click "Add User" button
2. Enter name, email, and role
3. Click "Add User" to save

**How to Edit a User**:
1. Click edit icon on user row
2. Update details
3. Save changes

---

### 6. 📊 Analytics
**What it does**: Deep insights into platform metrics
- View KPIs (revenue, users, views, conversion)
- See charts (user growth, categories, revenue)
- Export reports

**How to Use**:
1. Select time range (7d, 30d, 90d, 1y)
2. View charts and tables
3. Click "Export" to download reports

---

### 7. 📣 Marketing
**What it does**: Audience segmentation and campaigns
- Create user segments
- Export contact lists
- Prepare for integrations (Customer.io, etc.)

**How to Create a Segment**:
1. Click "Create Segment" button
2. Name your segment
3. Set filters (role, activity, purchases)
4. Click "Create Segment"

**How to Export Contacts**:
1. Click "Export" on any segment
2. CSV file downloads automatically

---

### 8. 💰 Finances
**What it does**: Track all transactions and revenue
- View all purchases
- See revenue breakdown
- Track platform fees
- Export financial data

**How to Use**:
1. Browse transaction table
2. Use search and filters
3. Click "Export" for CSV

---

### 9. 🎧 Support
**What it does**: Manage customer support tickets
- View all tickets
- Respond to users
- Update ticket status
- Track resolution

**How to Respond to Ticket**:
1. Click on ticket in list
2. Read ticket details
3. Type response in text area
4. Click "Send Response"
5. Update status dropdown if needed

---

### 10. ⚙️ Settings
**What it does**: Manage your admin account
- Update profile (name, email)
- Change password
- Set notification preferences

**How to Update Profile**:
1. Edit name or email
2. Click "Save Profile"

**How to Change Password**:
1. Enter current password
2. Enter new password (min 8 characters)
3. Confirm new password
4. Click "Change Password"

---

## Common Tasks

### Task: Approve a New Experience
1. Go to "Moderate" tab
2. Filter by "In Review"
3. Click on experience card
4. Review details
5. Click "Approve" button

### Task: Create Marketing Segment
1. Go to "Marketing" tab
2. Click "Create Segment"
3. Name it (e.g., "Active SF Explorers")
4. Set filters (role: explorer, location: San Francisco)
5. Click "Create Segment"
6. Click "Export" to download contacts

### Task: View Platform Revenue
1. Go to "Finances" tab
2. View "Total Revenue" card
3. Scroll to transaction table
4. Use date filter for specific period
5. Click "Export" for detailed report

### Task: Respond to Support Ticket
1. Go to "Support" tab
2. Click on ticket with "Open" status
3. Read user's message
4. Type your response
5. Click "Send Response"
6. Update status to "In Progress" or "Resolved"

### Task: Suspend a User
1. Go to "User Management" tab
2. Search for user by name or email
3. Click suspend icon (ban icon)
4. User status changes to "Suspended"

### Task: View Top Creators
1. Go to "Overview" tab
2. Scroll to "Top Performers" card
3. See rankings by views and cards created

---

## Mobile Usage

### Access Menu
1. Tap hamburger icon (☰) in top-right
2. Menu slides in from right
3. Tap any section to navigate
4. Menu automatically closes

### Navigate Sections
- All features work on mobile
- Tables scroll horizontally
- Cards stack vertically
- Forms are touch-optimized

---

## Tips & Best Practices

### Moderation
- ✅ Always provide feedback when returning cards
- ✅ Check all card details before approving
- ✅ Use filters to prioritize "In Review" cards

### User Management
- ✅ Verify email before adding users
- ✅ Assign correct roles
- ✅ Use suspend instead of delete when possible

### Support
- ✅ Respond to tickets within 24 hours
- ✅ Update status as you work on tickets
- ✅ Mark as "Resolved" only when user confirms

### Analytics
- ✅ Check daily for unusual patterns
- ✅ Export weekly reports for records
- ✅ Monitor conversion rate trends

### Marketing
- ✅ Create targeted segments
- ✅ Export and backup contact lists
- ✅ Prepare for email marketing integrations

---

## Keyboard Shortcuts (Future)

Coming soon:
- `Cmd/Ctrl + K` - Quick search
- `Cmd/Ctrl + N` - New (card/user/ticket)
- `Cmd/Ctrl + E` - Export
- `Cmd/Ctrl + F` - Focus search
- `Esc` - Close modals

---

## Troubleshooting

### Problem: Can't see new data
**Solution**: Refresh the page or navigate away and back

### Problem: Filter not working
**Solution**: Clear all filters and try again

### Problem: Export button not working
**Solution**: Ensure there's data to export

### Problem: Mobile menu won't close
**Solution**: Tap the X button or tap outside menu

### Problem: Changes not saving
**Solution**: Check that all required fields are filled

---

## Data Locations (Development)

All data is stored in browser localStorage:
- **users** - All platform users
- **platformCards** - All experiences
- **userPurchases** - All transactions
- **supportTickets** - Support tickets
- **adminChatThreads** - Chat conversations
- **currentUser** - Logged-in user info

---

## Getting Help

For technical support:
1. Check `/ADMIN_DASHBOARD_COMPLETE.md` for detailed documentation
2. Review component code in `/components/admin/`
3. Check browser console for errors

---

## Quick Reference

| Section | Primary Action | Icon |
|---------|---------------|------|
| Overview | View stats | 🏠 |
| QA Chat | Send messages | 💬 |
| My Cards | Create cards | ✨ |
| Moderate | Approve/reject | 🛡️ |
| Users | Manage users | 👥 |
| Analytics | View insights | 📊 |
| Marketing | Build segments | 📣 |
| Finances | Track revenue | 💰 |
| Support | Answer tickets | 🎧 |
| Settings | Update profile | ⚙️ |

---

## Success! 🎉

You're now ready to use the Mingla Admin Dashboard. Start with the Overview tab to familiarize yourself with platform metrics, then explore each section as needed.

**Remember**: You have full control over the platform as an admin - use your powers wisely!
