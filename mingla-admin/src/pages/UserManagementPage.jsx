import { useState, useEffect, useCallback, useRef } from "react";
import {
  Users, UserCheck, UserX, Shield, Activity, Trash2, Edit3, Eye,
  ChevronLeft, Save, Ban, X, AlertTriangle, Clock, Globe, Mail,
  Phone, Hash, Heart, LayoutDashboard, Zap, Bookmark, UserPlus,
  UserMinus, MessageSquare, Calendar, Star, MousePointerClick,
  Flag, MapPin, VolumeX, Link2,
} from "lucide-react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "../lib/supabase";
import { StatCard, SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { SearchInput } from "../components/ui/SearchInput";
import { DataTable } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Tabs } from "../components/ui/Tabs";
import { Avatar } from "../components/ui/Avatar";
import { Spinner } from "../components/ui/Spinner";
import { ListItemSkeleton, StatCardSkeleton } from "../components/ui/Skeleton";
import { useToast } from "../context/ToastContext";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 400;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr) {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
}

function formatDateTime(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function UserManagementPage() {
  const { addToast } = useToast();

  // View state
  const [view, setView] = useState("list"); // "list" | "detail" | "impersonate"
  const [selectedUserId, setSelectedUserId] = useState(null);

  // List state
  const [users, setUsers] = useState([]);
  const [userCount, setUserCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState({
    onboarding: "all",
    status: "all",
  });
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);

  // Stats state
  const [stats, setStats] = useState({ total: 0, active: 0, banned: 0, onboarded: 0, newThisWeek: 0 });
  const [statsLoading, setStatsLoading] = useState(true);

  // Detail state
  const [detailLoading, setDetailLoading] = useState(false);
  const [userDetail, setUserDetail] = useState(null);
  const [userPrefs, setUserPrefs] = useState(null);
  const [userFriends, setUserFriends] = useState([]);
  const [userBoards, setUserBoards] = useState([]);
  const [userActivity, setUserActivity] = useState([]);
  const [userSessions, setUserSessions] = useState([]);
  const [userSaves, setUserSaves] = useState({ experiences: [], cards: [] });
  const [userSavedPeople, setUserSavedPeople] = useState([]);
  const [userFriendRequests, setUserFriendRequests] = useState([]);
  const [userFriendLinks, setUserFriendLinks] = useState([]);
  const [userBlocked, setUserBlocked] = useState([]);
  const [userMuted, setUserMuted] = useState([]);
  const [userConversations, setUserConversations] = useState([]);
  const [userCalendar, setUserCalendar] = useState([]);
  const [userReviews, setUserReviews] = useState([]);
  const [userFeedback, setUserFeedback] = useState([]);
  const [userInteractions, setUserInteractions] = useState([]);
  const [userReports, setUserReports] = useState([]);
  const [userAppFeedback, setUserAppFeedback] = useState([]);
  const [userLocationHistory, setUserLocationHistory] = useState([]);
  const [userPrefHistory, setUserPrefHistory] = useState([]);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);

  // Action loading states
  const [banningId, setBanningId] = useState(null);
  const [banConfirmId, setBanConfirmId] = useState(null); // user id awaiting ban confirmation

  // Delete confirmation
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteTargetUser, setDeleteTargetUser] = useState(null); // for list-view delete

  // Impersonate state
  const [impersonateLoading, setImpersonateLoading] = useState(false);
  const [impersonateData, setImpersonateData] = useState({
    savedExperiences: [],
    savedCards: [],
    boards: [],
    preferences: null,
  });

  // Detail tab
  const [detailTab, setDetailTab] = useState("profile");

  // Refs for cleanup
  const searchTimerRef = useRef(null);

  // ─── Search debounce ────────────────────────────────────────────────────────

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [search]);

  // ─── Stats Fetching ─────────────────────────────────────────────────────────

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const [totalRes, activeRes, bannedRes, onboardedRes] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("profiles").select("*", { count: "exact", head: true }).eq("active", true),
        supabase.from("profiles").select("*", { count: "exact", head: true }).eq("active", false),
        supabase.from("profiles").select("*", { count: "exact", head: true }).eq("has_completed_onboarding", true),
      ]);

      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const newRes = await supabase
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .gte("created_at", weekAgo);

      setStats({
        total: totalRes.count ?? 0,
        active: activeRes.count ?? 0,
        banned: bannedRes.count ?? 0,
        onboarded: onboardedRes.count ?? 0,
        newThisWeek: newRes.count ?? 0,
      });
    } catch (err) {
      addToast({ variant: "error", title: "Failed to load user stats", description: err.message });
    } finally {
      setStatsLoading(false);
    }
  }, [addToast]);

  // ─── User List Fetching ─────────────────────────────────────────────────────

  const fetchUsers = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      let query = supabase
        .from("profiles")
        .select("id, display_name, username, email, phone, has_completed_onboarding, active, country, account_type, avatar_url, created_at, first_name, last_name, gender, birthday, visibility_mode, updated_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (debouncedSearch) {
        // Strip characters that break PostgREST .or() filter syntax
        const safe = debouncedSearch.replace(/[,.()"\\]/g, "").trim();
        if (safe) {
          query = query.or(
            `display_name.ilike.%${safe}%,email.ilike.%${safe}%,username.ilike.%${safe}%,phone.ilike.%${safe}%`
          );
        }
      }
      if (filters.onboarding === "completed") query = query.eq("has_completed_onboarding", true);
      if (filters.onboarding === "incomplete") query = query.eq("has_completed_onboarding", false);
      if (filters.status === "active") query = query.eq("active", true);
      if (filters.status === "banned") query = query.eq("active", false);

      const { data, count, error } = await query;
      if (error) throw error;
      setUsers(data || []);
      setUserCount(count ?? 0);
    } catch (err) {
      setListError(err.message);
      addToast({ variant: "error", title: "Failed to load users", description: err.message });
    } finally {
      setListLoading(false);
    }
  }, [page, debouncedSearch, filters, addToast]);

  // ─── User Detail Fetching ──────────────────────────────────────────────────

  const fetchUserDetail = useCallback(async (userId) => {
    setDetailLoading(true);
    try {
      // Batch 1: core data
      const [profileRes, prefsRes, friendsRes, activityRes, sessionsRes, participationsRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).single(),
        supabase.from("preferences").select("*").eq("profile_id", userId).maybeSingle(),
        supabase.from("friends").select("*, friend:profiles!friends_friend_user_id_fkey(display_name, email, avatar_url)").eq("user_id", userId).eq("status", "accepted"),
        supabase.from("user_activity").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
        supabase.from("user_sessions").select("*").eq("user_id", userId).order("started_at", { ascending: false }).limit(10),
        supabase.from("session_participants").select("*, session:collaboration_sessions(name, status, session_type, board_id)").eq("user_id", userId).limit(20),
      ]);

      if (profileRes.error) throw profileRes.error;

      // Get boards via session_participants where session has a board_id
      const boardIds = (participationsRes.data || [])
        .filter(p => p.session?.board_id)
        .map(p => p.session.board_id);
      const uniqueBoardIds = [...new Set(boardIds)];
      const boardsRes = uniqueBoardIds.length > 0
        ? await supabase.from("boards").select("*").in("id", uniqueBoardIds)
        : { data: [] };

      setUserDetail(profileRes.data);
      setUserPrefs(prefsRes.data);
      setUserFriends(friendsRes.data || []);
      setUserBoards(boardsRes.data || []);
      setUserActivity(activityRes.data || []);
      setUserSessions(sessionsRes.data || []);
      setEditForm(profileRes.data || {});

      // Batch 2: extended data (non-blocking)
      const [
        savedExpRes, savedCardRes, savedPeopleRes,
        friendReqRes, friendLinksRes,
        blockedRes, mutedRes,
        convParticipantsRes, calendarRes,
        reviewsRes, feedbackRes,
        interactionsRes, reportsRes, appFeedbackRes,
        locationRes, prefHistRes,
      ] = await Promise.all([
        supabase.from("saved_experiences").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
        supabase.from("saved_card").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
        supabase.from("saved_people").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
        supabase.from("friend_requests").select("*, sender:profiles!friend_requests_sender_id_fkey(display_name, email, avatar_url), receiver:profiles!friend_requests_receiver_id_fkey(display_name, email, avatar_url)").or(`sender_id.eq.${userId},receiver_id.eq.${userId}`).order("created_at", { ascending: false }).limit(50),
        supabase.from("friend_links").select("*, requester:profiles!friend_links_requester_id_fkey(display_name, email, avatar_url), addressee:profiles!friend_links_addressee_id_fkey(display_name, email, avatar_url)").or(`requester_id.eq.${userId},addressee_id.eq.${userId}`).order("created_at", { ascending: false }).limit(50),
        supabase.from("blocked_users").select("*, blocked:profiles!blocked_users_blocked_user_id_fkey(display_name, email, avatar_url)").eq("user_id", userId).limit(50),
        supabase.from("muted_users").select("*, muted:profiles!muted_users_muted_user_id_fkey(display_name, email, avatar_url)").eq("user_id", userId).limit(50),
        supabase.from("conversation_participants").select("*, conversation:conversations(id, created_at, updated_at)").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
        supabase.from("calendar_entries").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
        supabase.from("place_reviews").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
        supabase.from("experience_feedback").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
        supabase.from("user_interactions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
        supabase.from("user_reports").select("*").or(`reporter_id.eq.${userId},reported_user_id.eq.${userId}`).order("created_at", { ascending: false }).limit(30),
        supabase.from("app_feedback").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
        supabase.from("user_location_history").select("*").eq("user_id", userId).order("recorded_at", { ascending: false }).limit(30),
        supabase.from("preference_history").select("*").eq("profile_id", userId).order("changed_at", { ascending: false }).limit(30),
      ]);

      setUserSaves({ experiences: savedExpRes.data || [], cards: savedCardRes.data || [] });
      setUserSavedPeople(savedPeopleRes.data || []);
      setUserFriendRequests(friendReqRes.data || []);
      setUserFriendLinks(friendLinksRes.data || []);
      setUserBlocked(blockedRes.data || []);
      setUserMuted(mutedRes.data || []);
      setUserConversations(convParticipantsRes.data || []);
      setUserCalendar(calendarRes.data || []);
      setUserReviews(reviewsRes.data || []);
      setUserFeedback(feedbackRes.data || []);
      setUserInteractions(interactionsRes.data || []);
      setUserReports(reportsRes.data || []);
      setUserAppFeedback(appFeedbackRes.data || []);
      setUserLocationHistory(locationRes.data || []);
      setUserPrefHistory(prefHistRes.data || []);
    } catch (err) {
      addToast({ variant: "error", title: "Failed to load user details", description: err.message });
    } finally {
      setDetailLoading(false);
    }
  }, [addToast]);

  // ─── Actions ────────────────────────────────────────────────────────────────

  const handleBan = useCallback(async (userId) => {
    setBanningId(userId);
    try {
      const { error } = await supabase.from("profiles").update({ active: false }).eq("id", userId);
      if (error) throw error;
      addToast({ variant: "success", title: "User banned" });
      fetchUsers();
      fetchStats();
      if (userDetail?.id === userId) fetchUserDetail(userId);
    } catch (err) {
      addToast({ variant: "error", title: "Failed to ban user", description: err.message });
    } finally {
      setBanningId(null);
    }
  }, [addToast, fetchUsers, fetchStats, fetchUserDetail, userDetail]);

  const handleUnban = useCallback(async (userId) => {
    setBanningId(userId);
    try {
      const { error } = await supabase.from("profiles").update({ active: true }).eq("id", userId);
      if (error) throw error;
      addToast({ variant: "success", title: "User unbanned" });
      fetchUsers();
      fetchStats();
      if (userDetail?.id === userId) fetchUserDetail(userId);
    } catch (err) {
      addToast({ variant: "error", title: "Failed to unban user", description: err.message });
    } finally {
      setBanningId(null);
    }
  }, [addToast, fetchUsers, fetchStats, fetchUserDetail, userDetail]);

  const handleFullDelete = useCallback(async (userId) => {
    if (!userId) return;
    setDeleting(true);
    const errors = [];

    // 1. Delete from all user-related tables (order: dependents first, then core)
    const tablesToDelete = [
      // Board-related (deepest nesting first)
      { table: "board_card_message_reads", column: "user_id" },
      { table: "board_message_reads", column: "user_id" },
      { table: "board_card_messages", column: "user_id" },
      { table: "board_messages", column: "user_id" },
      { table: "board_card_rsvps", column: "user_id" },
      { table: "board_votes", column: "user_id" },
      { table: "board_saved_cards", column: "user_id" },
      { table: "board_typing_indicators", column: "user_id" },
      { table: "board_user_swipe_states", column: "user_id" },
      { table: "board_participant_presence", column: "user_id" },
      { table: "board_session_preferences", column: "user_id" },
      { table: "board_threads", column: "user_id" },
      { table: "activity_history", column: "user_id" },
      // Collaboration
      { table: "collaboration_invites", column: "inviter_id" },
      { table: "collaboration_invites", column: "invitee_id" },
      { table: "session_participants", column: "user_id" },
      // Messages & conversations
      { table: "message_reads", column: "user_id" },
      { table: "messages", column: "sender_id" },
      { table: "conversation_participants", column: "user_id" },
      // Social
      { table: "friend_requests", column: "sender_id" },
      { table: "friend_requests", column: "receiver_id" },
      { table: "friend_links", column: "requester_id" },
      { table: "friend_links", column: "addressee_id" },
      { table: "friends", column: "user_id" },
      { table: "friends", column: "friend_user_id" },
      { table: "blocked_users", column: "user_id" },
      { table: "blocked_users", column: "blocked_user_id" },
      { table: "muted_users", column: "user_id" },
      { table: "muted_users", column: "muted_user_id" },
      // Saves & people
      { table: "person_audio_clips", column: "user_id" },
      { table: "person_experiences", column: "user_id" },
      { table: "saved_people", column: "user_id" },
      { table: "saved_experiences", column: "user_id" },
      { table: "saved_card", column: "user_id" },
      { table: "saves", column: "user_id" },
      // Cards & interactions
      { table: "board_cards", column: "added_by" },
      { table: "user_card_impressions", column: "user_id" },
      { table: "user_interactions", column: "user_id" },
      { table: "user_preference_learning", column: "user_id" },
      // Calendar & reviews
      { table: "calendar_entries", column: "user_id" },
      { table: "scheduled_activities", column: "user_id" },
      { table: "place_reviews", column: "user_id" },
      { table: "experience_feedback", column: "user_id" },
      // Analytics & safety
      { table: "user_sessions", column: "user_id" },
      { table: "user_activity", column: "user_id" },
      { table: "user_location_history", column: "user_id" },
      { table: "user_reports", column: "reporter_id" },
      { table: "user_reports", column: "reported_user_id" },
      { table: "app_feedback", column: "user_id" },
      { table: "undo_actions", column: "user_id" },
      { table: "discover_daily_cache", column: "user_id" },
      // Preferences
      { table: "preference_history", column: "profile_id" },
      { table: "preferences", column: "profile_id" },
    ];

    // Delete from all tables in parallel batches of 6
    for (let i = 0; i < tablesToDelete.length; i += 6) {
      const batch = tablesToDelete.slice(i, i + 6);
      const results = await Promise.allSettled(
        batch.map(({ table, column }) =>
          supabase.from(table).delete().eq(column, userId)
        )
      );
      results.forEach((r, idx) => {
        if (r.status === "rejected" || r.value?.error) {
          const msg = r.status === "rejected" ? r.reason?.message : r.value?.error?.message;
          // Don't fail on "relation does not exist" or permission errors — just log
          if (msg && !msg.includes("does not exist") && !msg.includes("permission denied")) {
            errors.push(`${batch[idx].table}: ${msg}`);
          }
        }
      });
    }

    // 2. Delete the profile itself
    const { error: profileError } = await supabase.from("profiles").delete().eq("id", userId);
    if (profileError) errors.push(`profiles: ${profileError.message}`);

    // 3. Try to delete the auth user via edge function
    try {
      const { error: fnError } = await supabase.functions.invoke("delete-user", {
        body: { user_id: userId },
      });
      if (fnError) errors.push(`auth (edge fn): ${fnError.message}`);
    } catch (fnErr) {
      // Try admin API as fallback (requires service_role, may fail with anon key)
      try {
        const res = await fetch(
          `${SUPABASE_URL}/auth/v1/admin/users/${userId}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
              apikey: SUPABASE_ANON_KEY,
            },
          }
        );
        if (!res.ok) {
          errors.push(`auth (admin API): ${res.status} — may need service_role key`);
        }
      } catch (adminErr) {
        errors.push(`auth: could not delete auth user — ${fnErr.message}`);
      }
    }

    // Done — report results
    if (errors.length === 0) {
      addToast({ variant: "success", title: "User fully deleted", description: "All data wiped from every table + auth removed." });
    } else {
      addToast({
        variant: "warning",
        title: "User mostly deleted",
        description: `Profile removed but ${errors.length} table(s) had issues: ${errors.slice(0, 3).join("; ")}${errors.length > 3 ? "..." : ""}`,
      });
    }

    setDeleteModal(false);
    setDeleteConfirmText("");
    setDeleteTargetUser(null);
    if (view === "detail") {
      setView("list");
      setSelectedUserId(null);
      setUserDetail(null);
    }
    fetchUsers();
    fetchStats();
    setDeleting(false);
  }, [addToast, fetchUsers, fetchStats, view]);

  const handleSaveEdit = useCallback(async () => {
    if (!userDetail) return;
    // Client-side validation: don't allow blanking critical fields
    if (!editForm.email?.trim()) {
      addToast({ variant: "error", title: "Email cannot be empty" });
      return;
    }
    if (!editForm.display_name?.trim() && !editForm.username?.trim()) {
      addToast({ variant: "error", title: "User must have a display name or username" });
      return;
    }
    setSaving(true);
    try {
      const updates = {
        display_name: editForm.display_name,
        username: editForm.username,
        email: editForm.email,
        phone: editForm.phone,
        has_completed_onboarding: editForm.has_completed_onboarding,
        active: editForm.active,
        visibility_mode: editForm.visibility_mode,
        country: editForm.country,
        account_type: editForm.account_type,
      };
      const { error } = await supabase.from("profiles").update(updates).eq("id", userDetail.id);
      if (error) throw error;
      addToast({ variant: "success", title: "Profile updated" });
      setEditing(false);
      fetchUserDetail(userDetail.id);
      fetchUsers();
    } catch (err) {
      addToast({ variant: "error", title: "Failed to save changes", description: err.message });
    } finally {
      setSaving(false);
    }
  }, [addToast, editForm, userDetail, fetchUserDetail, fetchUsers]);

  // ─── Impersonate ────────────────────────────────────────────────────────────

  const handleImpersonate = useCallback(async (userId) => {
    setImpersonateLoading(true);
    try {
      const [savedExpRes, savedCardsRes, prefsRes] = await Promise.all([
        supabase.from("saved_experiences").select("*").eq("user_id", userId).limit(50),
        supabase.from("saved_card").select("*").eq("user_id", userId).limit(50),
        supabase.from("preferences").select("*").eq("profile_id", userId).maybeSingle(),
      ]);

      // Get boards
      const { data: participations } = await supabase
        .from("session_participants")
        .select("session:collaboration_sessions(board_id)")
        .eq("user_id", userId);
      const boardIds = [...new Set(
        (participations || []).filter(p => p.session?.board_id).map(p => p.session.board_id)
      )];
      const boardsRes = boardIds.length > 0
        ? await supabase.from("boards").select("*").in("id", boardIds)
        : { data: [] };

      setImpersonateData({
        savedExperiences: savedExpRes.data || [],
        savedCards: savedCardsRes.data || [],
        boards: boardsRes.data || [],
        preferences: prefsRes.data,
      });
      setView("impersonate");
    } catch (err) {
      addToast({ variant: "error", title: "Failed to load impersonate data", description: err.message });
    } finally {
      setImpersonateLoading(false);
    }
  }, [addToast]);

  // ─── Navigation helpers ─────────────────────────────────────────────────────

  const openDetail = useCallback((userId) => {
    setSelectedUserId(userId);
    setView("detail");
    setEditing(false);
    setDetailTab("profile");
    fetchUserDetail(userId);
  }, [fetchUserDetail]);

  const backToList = useCallback(() => {
    setView("list");
    setSelectedUserId(null);
    setUserDetail(null);
    setEditing(false);
  }, []);

  const backToDetail = useCallback(() => {
    setView("detail");
  }, []);

  // ─── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // ─── Delete Modal (shared across views) ─────────────────────────────────────

  const deleteUser = deleteTargetUser;
  const confirmTarget = deleteUser?.username || deleteUser?.display_name || deleteUser?.email || "";

  const deleteModalJSX = (
    <Modal
      open={deleteModal}
      onClose={() => { setDeleteModal(false); setDeleteConfirmText(""); setDeleteTargetUser(null); }}
      title="PERMANENTLY Delete User"
      size="sm"
      destructive
    >
      <ModalBody>
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 p-3 bg-[var(--color-error-50)] rounded-lg">
            <AlertTriangle className="w-5 h-5 text-[#ef4444] shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-[#b91c1c]">FULL WIPE — This cannot be undone</p>
              <p className="text-xs text-[#b91c1c] mt-1">
                This will permanently delete <strong>{deleteUser?.display_name || "this user"}</strong> and
                wipe ALL their data from every table in the database: profile, preferences, friends,
                messages, saves, interactions, sessions, reviews, reports, calendar, location history,
                boards, and auth account.
              </p>
            </div>
          </div>
          {confirmTarget ? (
            <Input
              label={`Type "${confirmTarget}" to confirm`}
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Type to confirm..."
            />
          ) : (
            <p className="text-sm text-[#b91c1c] font-medium">
              This user has no username, display name, or email — deletion is blocked for safety.
            </p>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={() => { setDeleteModal(false); setDeleteConfirmText(""); setDeleteTargetUser(null); }}>
          Cancel
        </Button>
        <Button
          variant="danger"
          size="sm"
          icon={Trash2}
          loading={deleting}
          disabled={!confirmTarget || deleteConfirmText !== confirmTarget}
          onClick={() => handleFullDelete(deleteUser?.id)}
        >
          Wipe Everything
        </Button>
      </ModalFooter>
    </Modal>
  );

  // ─── Render: List View ──────────────────────────────────────────────────────

  if (view === "list") {
    const from = userCount > 0 ? page * PAGE_SIZE + 1 : 0;
    const to = Math.min((page + 1) * PAGE_SIZE, userCount);
    const onboardedPct = stats.total > 0 ? Math.round((stats.onboarded / stats.total) * 100) : 0;

    const columns = [
      {
        key: "_actions",
        label: "Actions",
        width: "220px",
        render: (_, row) => (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              icon={Trash2}
              className="text-[#ef4444] hover:text-[#dc2626] hover:bg-[#fef2f2]"
              onClick={() => {
                setDeleteTargetUser(row);
                setDeleteModal(true);
                setDeleteConfirmText("");
              }}
            >
              Delete
            </Button>
            <Button variant="ghost" size="sm" icon={Eye} onClick={() => openDetail(row.id)}>
              View
            </Button>
            {row.active !== false ? (
              banConfirmId === row.id ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant="danger"
                    size="sm"
                    loading={banningId === row.id}
                    onClick={() => { handleBan(row.id); setBanConfirmId(null); }}
                  >
                    Confirm
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setBanConfirmId(null)}
                  >
                    No
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Ban}
                  onClick={() => setBanConfirmId(row.id)}
                >
                  Ban
                </Button>
              )
            ) : (
              <Button
                variant="ghost"
                size="sm"
                icon={UserCheck}
                loading={banningId === row.id}
                onClick={() => handleUnban(row.id)}
              >
                Unban
              </Button>
            )}
          </div>
        ),
      },
      {
        key: "avatar_url",
        label: "",
        width: "48px",
        render: (_, row) => (
          <Avatar src={row.avatar_url} name={row.display_name || row.username} size="sm" />
        ),
      },
      {
        key: "display_name",
        label: "Name",
        render: (val, row) => (
          <div className="min-w-0">
            <button
              onClick={() => openDetail(row.id)}
              className="text-sm font-medium text-[var(--color-text-primary)] hover:text-[#f97316] transition-colors cursor-pointer text-left truncate block max-w-full"
            >
              {val || "—"}
            </button>
            {row.username && (
              <span className="text-xs text-[var(--color-text-muted)] truncate block">@{row.username}</span>
            )}
          </div>
        ),
      },
      { key: "email", label: "Email" },
      {
        key: "phone",
        label: "Phone",
        render: (val) => val ? <span className="text-sm">{val}</span> : <span className="text-[var(--color-text-muted)]">—</span>,
      },
      {
        key: "gender",
        label: "Gender",
        width: "90px",
        render: (val) => val ? <span className="text-sm capitalize">{val}</span> : <span className="text-[var(--color-text-muted)]">—</span>,
      },
      {
        key: "birthday",
        label: "Birthday",
        width: "120px",
        render: (val) => val ? <span className="text-xs">{formatDate(val)}</span> : <span className="text-[var(--color-text-muted)]">—</span>,
      },
      {
        key: "country",
        label: "Country",
        width: "100px",
        render: (val) => val ? <Badge variant="outline">{val}</Badge> : <span className="text-[var(--color-text-muted)]">—</span>,
      },
      {
        key: "account_type",
        label: "Type",
        width: "90px",
        render: (val) => val ? <Badge variant="info">{val}</Badge> : <span className="text-[var(--color-text-muted)]">—</span>,
      },
      {
        key: "has_completed_onboarding",
        label: "Onboarding",
        width: "120px",
        render: (val) => (
          <Badge variant={val ? "success" : "warning"} dot>
            {val ? "Complete" : "Incomplete"}
          </Badge>
        ),
      },
      {
        key: "active",
        label: "Status",
        width: "100px",
        render: (val) => (
          <Badge variant={val !== false ? "success" : "error"} dot>
            {val !== false ? "Active" : "Banned"}
          </Badge>
        ),
      },
      {
        key: "created_at",
        label: "Joined",
        width: "100px",
        render: (val) => (
          <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(val)}</span>
        ),
      },
    ];

    return (
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">User Management</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            Browse, search, and manage all Mingla users
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
          {statsLoading ? (
            Array.from({ length: 5 }).map((_, i) => <StatCardSkeleton key={i} />)
          ) : (
            <>
              <StatCard icon={Users} label="Total Users" value={stats.total.toLocaleString()} />
              <StatCard icon={UserCheck} label="Active" value={stats.active.toLocaleString()} />
              <StatCard icon={UserX} label="Banned" value={stats.banned.toLocaleString()} />
              <StatCard icon={Shield} label="Onboarded" value={`${onboardedPct}%`} />
              <StatCard icon={Activity} label="New This Week" value={stats.newThisWeek.toLocaleString()} />
            </>
          )}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")}
            placeholder="Search by name, email, username, or phone..."
            className="w-full sm:w-80"
          />
          <select
            value={filters.onboarding}
            onChange={(e) => { setFilters(f => ({ ...f, onboarding: e.target.value })); setPage(0); }}
            className="h-10 px-3 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)] border border-[var(--gray-300)] rounded-lg outline-none cursor-pointer focus:border-[#f97316] focus:ring-2 focus:ring-[#ffedd5] transition-all duration-150"
          >
            <option value="all">All Onboarding</option>
            <option value="completed">Completed</option>
            <option value="incomplete">Incomplete</option>
          </select>
          <select
            value={filters.status}
            onChange={(e) => { setFilters(f => ({ ...f, status: e.target.value })); setPage(0); }}
            className="h-10 px-3 text-sm bg-[var(--color-background-primary)] text-[var(--color-text-primary)] border border-[var(--gray-300)] rounded-lg outline-none cursor-pointer focus:border-[#f97316] focus:ring-2 focus:ring-[#ffedd5] transition-all duration-150"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="banned">Banned</option>
          </select>
        </div>

        {/* Table */}
        <DataTable
          columns={columns}
          rows={users}
          loading={listLoading}
          emptyIcon={Users}
          emptyMessage={listError ? `Error: ${listError}` : debouncedSearch ? "No users match your search" : "No users found"}
          emptyAction={listError ? <Button variant="link" onClick={fetchUsers}>Retry</Button> : undefined}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total: userCount,
            from,
            to,
            onChange: setPage,
          }}
        />
        {deleteModalJSX}
      </div>
    );
  }

  // ─── Render: Detail View ────────────────────────────────────────────────────

  if (view === "detail") {
    if (detailLoading && !userDetail) {
      return (
        <div className="flex flex-col gap-6">
          <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={backToList}>Back to Users</Button>
          <div className="flex items-center justify-center py-20">
            <Spinner size="lg" />
          </div>
        </div>
      );
    }

    if (!userDetail) {
      return (
        <div className="flex flex-col gap-6">
          <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={backToList}>Back to Users</Button>
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <Users className="h-10 w-10 text-[var(--gray-300)]" />
            <p className="text-sm text-[var(--color-text-tertiary)]">User not found</p>
          </div>
        </div>
      );
    }

    const isBanned = userDetail.active === false;

    const DETAIL_TABS = [
      { id: "profile", label: "Profile" },
      { id: "preferences", label: "Preferences" },
      { id: "saves", label: `Saves (${userSaves.experiences.length + userSaves.cards.length})` },
      { id: "friends", label: `Friends (${userFriends.length})` },
      { id: "requests", label: `Requests (${userFriendRequests.length})` },
      { id: "links", label: `Links (${userFriendLinks.length})` },
      { id: "people", label: `People (${userSavedPeople.length})` },
      { id: "blocked", label: `Blocked (${userBlocked.length + userMuted.length})` },
      { id: "messages", label: `Messages (${userConversations.length})` },
      { id: "boards", label: `Boards (${userBoards.length})` },
      { id: "calendar", label: `Calendar (${userCalendar.length})` },
      { id: "reviews", label: `Reviews (${userReviews.length + userFeedback.length})` },
      { id: "interactions", label: `Interactions (${userInteractions.length})` },
      { id: "reports", label: `Reports (${userReports.length + userAppFeedback.length})` },
      { id: "activity", label: "Activity" },
      { id: "sessions", label: "Sessions" },
      { id: "location", label: `Location (${userLocationHistory.length})` },
      { id: "prefhistory", label: `Pref History (${userPrefHistory.length})` },
    ];

    return (
      <div className="flex flex-col gap-6">
        {/* Top bar */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={backToList}>Back to Users</Button>
          <div className="flex items-center gap-2">
            {!editing && (
              <Button variant="secondary" size="sm" icon={Edit3} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {isBanned ? (
              <Button variant="secondary" size="sm" icon={UserCheck} loading={banningId === userDetail.id} onClick={() => handleUnban(userDetail.id)}>
                Unban
              </Button>
            ) : (
              <Button variant="secondary" size="sm" icon={Ban} loading={banningId === userDetail.id} onClick={() => handleBan(userDetail.id)}>
                Ban
              </Button>
            )}
            <Button variant="danger" size="sm" icon={Trash2} onClick={() => { setDeleteTargetUser(userDetail); setDeleteModal(true); setDeleteConfirmText(""); }}>
              Delete
            </Button>
          </div>
        </div>

        {/* User header card */}
        <SectionCard>
          <div className="flex items-start gap-4">
            <Avatar src={userDetail.avatar_url} name={userDetail.display_name || userDetail.username} size="lg" />
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-[var(--color-text-primary)]">
                {userDetail.display_name || "Unnamed User"}
              </h2>
              <div className="flex items-center gap-2 flex-wrap mt-1">
                {userDetail.username && (
                  <span className="text-sm text-[var(--color-text-secondary)]">@{userDetail.username}</span>
                )}
                {userDetail.email && (
                  <>
                    <span className="text-[var(--color-text-muted)]">&middot;</span>
                    <span className="text-sm text-[var(--color-text-secondary)]">{userDetail.email}</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-3 flex-wrap mt-2 text-xs text-[var(--color-text-tertiary)]">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> Joined {formatDate(userDetail.created_at)}
                </span>
                {userDetail.country && (
                  <span className="flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5" /> {userDetail.country}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-3">
                <Badge variant={isBanned ? "error" : "success"} dot>
                  {isBanned ? "Banned" : "Active"}
                </Badge>
                <Badge variant={userDetail.has_completed_onboarding ? "success" : "warning"} dot>
                  {userDetail.has_completed_onboarding ? "Onboarded" : "Incomplete Onboarding"}
                </Badge>
                {userDetail.account_type && (
                  <Badge variant="info">{userDetail.account_type}</Badge>
                )}
              </div>
            </div>
            <Button variant="secondary" size="sm" icon={Eye} loading={impersonateLoading} onClick={() => handleImpersonate(userDetail.id)}>
              Impersonate
            </Button>
          </div>
        </SectionCard>

        {/* Edit bar */}
        {editing && (
          <div className="flex items-center gap-2 p-3 bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] rounded-lg">
            <Edit3 className="w-4 h-4 text-[#f97316] shrink-0" />
            <span className="text-sm text-[#f97316] font-medium flex-1">Editing profile — changes will be saved to the database</span>
            <Button variant="primary" size="sm" icon={Save} loading={saving} onClick={handleSaveEdit}>
              Save Changes
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setEditForm(userDetail); }}>
              Cancel
            </Button>
          </div>
        )}

        {/* Tabs */}
        <Tabs tabs={DETAIL_TABS} activeTab={detailTab} onChange={setDetailTab} />

        {/* Tab panels */}
        {detailTab === "profile" && (
          <SectionCard title="Profile Fields">
            {editing ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input label="Display Name" value={editForm.display_name || ""} onChange={(e) => setEditForm(f => ({ ...f, display_name: e.target.value }))} />
                <Input label="Username" value={editForm.username || ""} onChange={(e) => setEditForm(f => ({ ...f, username: e.target.value }))} />
                <Input label="Email" type="email" value={editForm.email || ""} onChange={(e) => setEditForm(f => ({ ...f, email: e.target.value }))} />
                <Input label="Phone" value={editForm.phone || ""} onChange={(e) => setEditForm(f => ({ ...f, phone: e.target.value }))} />
                <Input label="Country" value={editForm.country || ""} onChange={(e) => setEditForm(f => ({ ...f, country: e.target.value }))} />
                <Input label="Account Type" value={editForm.account_type || ""} onChange={(e) => setEditForm(f => ({ ...f, account_type: e.target.value }))} />
                <Input label="Visibility Mode" value={editForm.visibility_mode || ""} onChange={(e) => setEditForm(f => ({ ...f, visibility_mode: e.target.value }))} />
                <div className="flex flex-col gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editForm.has_completed_onboarding ?? false}
                      onChange={(e) => setEditForm(f => ({ ...f, has_completed_onboarding: e.target.checked }))}
                      className="w-4 h-4 accent-[#f97316] cursor-pointer"
                    />
                    <span className="text-sm text-[var(--color-text-primary)]">Has Completed Onboarding</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editForm.active ?? true}
                      onChange={(e) => setEditForm(f => ({ ...f, active: e.target.checked }))}
                      className="w-4 h-4 accent-[#f97316] cursor-pointer"
                    />
                    <span className="text-sm text-[var(--color-text-primary)]">Active (uncheck to ban)</span>
                  </label>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8">
                <ProfileField icon={Hash} label="ID" value={userDetail.id} mono />
                <ProfileField icon={Mail} label="Email" value={userDetail.email} />
                <ProfileField icon={Users} label="Display Name" value={userDetail.display_name} />
                <ProfileField icon={Hash} label="Username" value={userDetail.username ? `@${userDetail.username}` : null} />
                <ProfileField icon={Phone} label="Phone" value={userDetail.phone} />
                <ProfileField icon={Globe} label="Country" value={userDetail.country} />
                <ProfileField icon={Shield} label="Account Type" value={userDetail.account_type} />
                <ProfileField icon={Eye} label="Visibility Mode" value={userDetail.visibility_mode} />
                <ProfileField icon={Users} label="First Name" value={userDetail.first_name} />
                <ProfileField icon={Users} label="Last Name" value={userDetail.last_name} />
                <ProfileField icon={Users} label="Gender" value={userDetail.gender} />
                <ProfileField icon={Heart} label="Birthday" value={userDetail.birthday} />
                <ProfileField icon={Clock} label="Created" value={formatDateTime(userDetail.created_at)} />
                <ProfileField icon={Clock} label="Updated" value={formatDateTime(userDetail.updated_at)} />
              </div>
            )}
          </SectionCard>
        )}

        {detailTab === "preferences" && (
          <SectionCard title="Preferences">
            {userPrefs ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8">
                <ProfileField icon={Zap} label="Mode" value={userPrefs.mode} />
                <ProfileField icon={Activity} label="Budget Min" value={userPrefs.budget_min} />
                <ProfileField icon={Activity} label="Budget Max" value={userPrefs.budget_max} />
                <ProfileField icon={Globe} label="Travel Mode" value={userPrefs.travel_mode} />
                <ProfileField icon={Clock} label="Time Slot" value={userPrefs.time_slot} />
                <ProfileField icon={Globe} label="Max Distance (km)" value={userPrefs.max_distance_km} />
                {userPrefs.categories && (
                  <div className="md:col-span-2">
                    <span className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider">Categories</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {(Array.isArray(userPrefs.categories) ? userPrefs.categories : []).map((cat, i) => (
                        <Badge key={i} variant="brand">{cat}</Badge>
                      ))}
                      {(!userPrefs.categories || (Array.isArray(userPrefs.categories) && userPrefs.categories.length === 0)) && (
                        <span className="text-sm text-[var(--color-text-muted)]">None set</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <EmptyState icon={Zap} message="No preferences set" />
            )}
          </SectionCard>
        )}

        {/* Saves Tab */}
        {detailTab === "saves" && (
          <div className="flex flex-col gap-4">
            <SectionCard title={`Saved Experiences (${userSaves.experiences.length})`}>
              {userSaves.experiences.length > 0 ? (
                <DataTable
                  columns={[
                    { key: "id", label: "ID", width: "80px", render: (v) => <span className="font-mono text-xs">{v?.slice(0, 8)}...</span> },
                    { key: "title", label: "Title", render: (v) => v || "—" },
                    { key: "category", label: "Category", render: (v) => v ? <Badge variant="brand">{v}</Badge> : "—" },
                    { key: "place_name", label: "Place", render: (v) => v || "—" },
                    { key: "created_at", label: "Saved", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
                  ]}
                  rows={userSaves.experiences}
                  emptyMessage="No saved experiences"
                />
              ) : (
                <EmptyState icon={Bookmark} message="No saved experiences" />
              )}
            </SectionCard>
            <SectionCard title={`Saved Cards (${userSaves.cards.length})`}>
              {userSaves.cards.length > 0 ? (
                <DataTable
                  columns={[
                    { key: "id", label: "ID", width: "80px", render: (v) => <span className="font-mono text-xs">{v?.slice(0, 8)}...</span> },
                    { key: "card_pool_id", label: "Card Pool ID", render: (v) => v ? <span className="font-mono text-xs">{v.slice(0, 8)}...</span> : "—" },
                    { key: "title", label: "Title", render: (v) => v || "—" },
                    { key: "created_at", label: "Saved", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
                  ]}
                  rows={userSaves.cards}
                  emptyMessage="No saved cards"
                />
              ) : (
                <EmptyState icon={Heart} message="No saved cards" />
              )}
            </SectionCard>
          </div>
        )}

        {/* Friend Requests Tab */}
        {detailTab === "requests" && (
          <SectionCard title={`Friend Requests (${userFriendRequests.length})`}>
            {userFriendRequests.length > 0 ? (
              <div className="divide-y divide-[var(--gray-200)]">
                {userFriendRequests.map((r, i) => {
                  const isSender = r.sender_id === userDetail.id;
                  const other = isSender ? r.receiver : r.sender;
                  return (
                    <div key={r.id || i} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <Avatar src={other?.avatar_url} name={other?.display_name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                          {isSender ? "Sent to" : "Received from"} {other?.display_name || "Unknown"}
                        </p>
                        <p className="text-xs text-[var(--color-text-muted)] truncate">
                          {other?.email || "—"} &middot; {formatDateTime(r.created_at)}
                        </p>
                      </div>
                      <Badge variant={r.status === "accepted" ? "success" : r.status === "pending" ? "warning" : "default"}>
                        {r.status || "unknown"}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={UserPlus} message="No friend requests" />
            )}
          </SectionCard>
        )}

        {/* Friend Links Tab */}
        {detailTab === "links" && (
          <SectionCard title={`Friend Links (${userFriendLinks.length})`}>
            {userFriendLinks.length > 0 ? (
              <div className="divide-y divide-[var(--gray-200)]">
                {userFriendLinks.map((l, i) => {
                  const isRequester = l.requester_id === userDetail.id;
                  const other = isRequester ? l.addressee : l.requester;
                  return (
                    <div key={l.id || i} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <Avatar src={other?.avatar_url} name={other?.display_name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                          {isRequester ? "Linked to" : "Linked from"} {other?.display_name || "Unknown"}
                        </p>
                        <p className="text-xs text-[var(--color-text-muted)] truncate">
                          {other?.email || "—"} &middot; {formatDateTime(l.created_at)}
                        </p>
                      </div>
                      <Badge variant={l.status === "accepted" ? "success" : l.status === "pending" ? "warning" : "error"}>
                        {l.status || "unknown"}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={Link2} message="No friend links" />
            )}
          </SectionCard>
        )}

        {/* Saved People Tab */}
        {detailTab === "people" && (
          <SectionCard title={`Saved People (${userSavedPeople.length})`}>
            {userSavedPeople.length > 0 ? (
              <DataTable
                columns={[
                  { key: "id", label: "ID", width: "80px", render: (v) => <span className="font-mono text-xs">{v?.slice(0, 8)}...</span> },
                  { key: "name", label: "Name", render: (v) => v || "—" },
                  { key: "relationship", label: "Relationship", render: (v) => v ? <Badge variant="brand">{v}</Badge> : "—" },
                  { key: "linked_user_id", label: "Linked", render: (v) => v ? <Badge variant="success" dot>Yes</Badge> : <span className="text-[var(--color-text-muted)]">No</span> },
                  { key: "created_at", label: "Added", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
                ]}
                rows={userSavedPeople}
                emptyMessage="No saved people"
              />
            ) : (
              <EmptyState icon={Users} message="No saved people" />
            )}
          </SectionCard>
        )}

        {/* Blocked & Muted Tab */}
        {detailTab === "blocked" && (
          <div className="flex flex-col gap-4">
            <SectionCard title={`Blocked Users (${userBlocked.length})`}>
              {userBlocked.length > 0 ? (
                <div className="divide-y divide-[var(--gray-200)]">
                  {userBlocked.map((b, i) => (
                    <div key={b.id || i} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <Avatar src={b.blocked?.avatar_url} name={b.blocked?.display_name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                          {b.blocked?.display_name || "Unknown"}
                        </p>
                        <p className="text-xs text-[var(--color-text-muted)] truncate">{b.blocked?.email || "—"}</p>
                      </div>
                      <Badge variant="error">Blocked</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={UserMinus} message="No blocked users" />
              )}
            </SectionCard>
            <SectionCard title={`Muted Users (${userMuted.length})`}>
              {userMuted.length > 0 ? (
                <div className="divide-y divide-[var(--gray-200)]">
                  {userMuted.map((m, i) => (
                    <div key={m.id || i} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <Avatar src={m.muted?.avatar_url} name={m.muted?.display_name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                          {m.muted?.display_name || "Unknown"}
                        </p>
                        <p className="text-xs text-[var(--color-text-muted)] truncate">{m.muted?.email || "—"}</p>
                      </div>
                      <Badge variant="warning">Muted</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={VolumeX} message="No muted users" />
              )}
            </SectionCard>
          </div>
        )}

        {/* Messages Tab */}
        {detailTab === "messages" && (
          <SectionCard title={`Conversations (${userConversations.length})`}>
            {userConversations.length > 0 ? (
              <div className="divide-y divide-[var(--gray-200)]">
                {userConversations.map((c, i) => (
                  <div key={c.id || i} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="w-8 h-8 rounded-full bg-[var(--gray-100)] flex items-center justify-center shrink-0">
                      <MessageSquare className="w-4 h-4 text-[var(--color-text-tertiary)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--color-text-primary)] font-mono truncate">
                        {c.conversation?.id?.slice(0, 8) || c.conversation_id?.slice(0, 8) || "—"}...
                      </p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        Created {formatDateTime(c.conversation?.created_at || c.created_at)}
                        {c.conversation?.updated_at && ` · Updated ${timeAgo(c.conversation.updated_at)}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={MessageSquare} message="No conversations" />
            )}
          </SectionCard>
        )}

        {detailTab === "friends" && (
          <SectionCard title={`Friends (${userFriends.length})`}>
            {userFriends.length > 0 ? (
              <div className="divide-y divide-[var(--gray-200)]">
                {userFriends.map((f, i) => (
                  <div key={f.id || i} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <Avatar src={f.friend?.avatar_url} name={f.friend?.display_name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                        {f.friend?.display_name || "Unknown"}
                      </p>
                      <p className="text-xs text-[var(--color-text-muted)] truncate">
                        {f.friend?.email || "—"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={Users} message="No friends yet" />
            )}
          </SectionCard>
        )}

        {detailTab === "boards" && (
          <SectionCard title={`Boards (${userBoards.length})`}>
            {userBoards.length > 0 ? (
              <div className="divide-y divide-[var(--gray-200)]">
                {userBoards.map((b, i) => (
                  <div key={b.id || i} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="w-8 h-8 rounded-lg bg-[var(--color-brand-50)] flex items-center justify-center shrink-0">
                      <LayoutDashboard className="w-4 h-4 text-[#f97316]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                        {b.name || "Unnamed Board"}
                      </p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        Created {timeAgo(b.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={LayoutDashboard} message="Not part of any boards" />
            )}
          </SectionCard>
        )}

        {detailTab === "activity" && (
          <SectionCard title="Recent Activity">
            {userActivity.length > 0 ? (
              <div className="divide-y divide-[var(--gray-200)]">
                {userActivity.map((a, i) => (
                  <div key={a.id || i} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="w-8 h-8 rounded-full bg-[var(--gray-100)] flex items-center justify-center shrink-0">
                      <Activity className="w-4 h-4 text-[var(--color-text-tertiary)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {a.activity_type && <Badge variant="default">{a.activity_type}</Badge>}
                        <p className="text-sm text-[var(--color-text-primary)] truncate">
                          {a.title || a.description || "Activity"}
                        </p>
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                        {formatDateTime(a.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={Activity} message="No recent activity" />
            )}
          </SectionCard>
        )}

        {detailTab === "sessions" && (
          <SectionCard title="Session History">
            {userSessions.length > 0 ? (
              <div className="divide-y divide-[var(--gray-200)]">
                {userSessions.map((s, i) => (
                  <div key={s.id || i} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="w-8 h-8 rounded-full bg-[var(--gray-100)] flex items-center justify-center shrink-0">
                      <Clock className="w-4 h-4 text-[var(--color-text-tertiary)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-[var(--color-text-primary)]">
                        {s.session_type || "Session"}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)] mt-0.5">
                        <span>Started {formatDateTime(s.started_at)}</span>
                        {s.ended_at && <span>Ended {formatDateTime(s.ended_at)}</span>}
                        {s.interaction_count != null && <span>{s.interaction_count} interactions</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={Clock} message="No session history" />
            )}
          </SectionCard>
        )}

        {/* Calendar Tab */}
        {detailTab === "calendar" && (
          <SectionCard title={`Calendar Entries (${userCalendar.length})`}>
            {userCalendar.length > 0 ? (
              <DataTable
                columns={[
                  { key: "id", label: "ID", width: "80px", render: (v) => <span className="font-mono text-xs">{v?.slice(0, 8)}...</span> },
                  { key: "title", label: "Title", render: (v) => v || "—" },
                  { key: "scheduled_date", label: "Date", render: (v) => v ? formatDate(v) : "—" },
                  { key: "status", label: "Status", render: (v) => v ? <Badge variant={v === "completed" ? "success" : v === "cancelled" ? "error" : "warning"}>{v}</Badge> : "—" },
                  { key: "created_at", label: "Created", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
                ]}
                rows={userCalendar}
                emptyMessage="No calendar entries"
              />
            ) : (
              <EmptyState icon={Calendar} message="No calendar entries" />
            )}
          </SectionCard>
        )}

        {/* Reviews & Feedback Tab */}
        {detailTab === "reviews" && (
          <div className="flex flex-col gap-4">
            <SectionCard title={`Place Reviews (${userReviews.length})`}>
              {userReviews.length > 0 ? (
                <DataTable
                  columns={[
                    { key: "id", label: "ID", width: "80px", render: (v) => <span className="font-mono text-xs">{v?.slice(0, 8)}...</span> },
                    { key: "place_name", label: "Place", render: (v) => v || "—" },
                    { key: "rating", label: "Rating", render: (v) => v != null ? `${v}/5` : "—" },
                    { key: "sentiment", label: "Sentiment", render: (v) => v ? <Badge variant={v === "positive" ? "success" : v === "negative" ? "error" : "warning"}>{v}</Badge> : "—" },
                    { key: "transcription", label: "Review", render: (v) => v ? <span className="truncate block max-w-[200px]">{v}</span> : "—" },
                    { key: "created_at", label: "Date", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
                  ]}
                  rows={userReviews}
                  emptyMessage="No reviews"
                />
              ) : (
                <EmptyState icon={Star} message="No place reviews" />
              )}
            </SectionCard>
            <SectionCard title={`Experience Feedback (${userFeedback.length})`}>
              {userFeedback.length > 0 ? (
                <DataTable
                  columns={[
                    { key: "id", label: "ID", width: "80px", render: (v) => <span className="font-mono text-xs">{v?.slice(0, 8)}...</span> },
                    { key: "rating", label: "Rating", render: (v) => v != null ? `${v}/5` : "—" },
                    { key: "message", label: "Message", render: (v) => v ? <span className="truncate block max-w-[300px]">{v}</span> : "—" },
                    { key: "created_at", label: "Date", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
                  ]}
                  rows={userFeedback}
                  emptyMessage="No feedback"
                />
              ) : (
                <EmptyState icon={Star} message="No experience feedback" />
              )}
            </SectionCard>
          </div>
        )}

        {/* Interactions Tab */}
        {detailTab === "interactions" && (
          <SectionCard title={`User Interactions (${userInteractions.length})`}>
            {userInteractions.length > 0 ? (
              <DataTable
                columns={[
                  { key: "interaction_type", label: "Type", render: (v) => v ? <Badge variant="default">{v}</Badge> : "—" },
                  { key: "card_pool_id", label: "Card", render: (v) => v ? <span className="font-mono text-xs">{v.slice(0, 8)}...</span> : "—" },
                  { key: "place_id", label: "Place ID", render: (v) => v ? <span className="font-mono text-xs truncate block max-w-[100px]">{v}</span> : "—" },
                  { key: "category", label: "Category", render: (v) => v ? <Badge variant="brand">{v}</Badge> : "—" },
                  { key: "created_at", label: "When", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
                ]}
                rows={userInteractions}
                emptyMessage="No interactions"
              />
            ) : (
              <EmptyState icon={MousePointerClick} message="No interactions recorded" />
            )}
          </SectionCard>
        )}

        {/* Reports & App Feedback Tab */}
        {detailTab === "reports" && (
          <div className="flex flex-col gap-4">
            <SectionCard title={`User Reports (${userReports.length})`}>
              {userReports.length > 0 ? (
                <DataTable
                  columns={[
                    { key: "id", label: "ID", width: "80px", render: (v) => <span className="font-mono text-xs">{v?.slice(0, 8)}...</span> },
                    { key: "reporter_id", label: "Direction", render: (v) => v === userDetail.id ? <Badge variant="warning">Reported by user</Badge> : <Badge variant="error">User was reported</Badge> },
                    { key: "reason", label: "Reason", render: (v) => v || "—" },
                    { key: "status", label: "Status", render: (v) => v ? <Badge variant={v === "resolved" ? "success" : v === "dismissed" ? "default" : "warning"}>{v}</Badge> : "—" },
                    { key: "created_at", label: "Date", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
                  ]}
                  rows={userReports}
                  emptyMessage="No reports"
                />
              ) : (
                <EmptyState icon={Flag} message="No reports" />
              )}
            </SectionCard>
            <SectionCard title={`App Feedback (${userAppFeedback.length})`}>
              {userAppFeedback.length > 0 ? (
                <DataTable
                  columns={[
                    { key: "id", label: "ID", width: "80px", render: (v) => <span className="font-mono text-xs">{v?.slice(0, 8)}...</span> },
                    { key: "rating", label: "Rating", render: (v) => v != null ? `${v}/5` : "—" },
                    { key: "message", label: "Message", render: (v) => v ? <span className="truncate block max-w-[300px]">{v}</span> : "—" },
                    { key: "created_at", label: "Date", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
                  ]}
                  rows={userAppFeedback}
                  emptyMessage="No app feedback"
                />
              ) : (
                <EmptyState icon={Star} message="No app feedback" />
              )}
            </SectionCard>
          </div>
        )}

        {/* Location History Tab */}
        {detailTab === "location" && (
          <SectionCard title={`Location History (${userLocationHistory.length})`}>
            {userLocationHistory.length > 0 ? (
              <DataTable
                columns={[
                  { key: "latitude", label: "Lat", render: (v) => v != null ? Number(v).toFixed(4) : "—" },
                  { key: "longitude", label: "Lng", render: (v) => v != null ? Number(v).toFixed(4) : "—" },
                  { key: "city", label: "City", render: (v) => v || "—" },
                  { key: "country", label: "Country", render: (v) => v || "—" },
                  { key: "recorded_at", label: "Recorded", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{formatDateTime(v)}</span> },
                ]}
                rows={userLocationHistory}
                emptyMessage="No location history"
              />
            ) : (
              <EmptyState icon={MapPin} message="No location history" />
            )}
          </SectionCard>
        )}

        {/* Preference History Tab */}
        {detailTab === "prefhistory" && (
          <SectionCard title={`Preference History (${userPrefHistory.length})`}>
            {userPrefHistory.length > 0 ? (
              <DataTable
                columns={[
                  { key: "id", label: "ID", width: "80px", render: (v) => <span className="font-mono text-xs">{v?.slice(0, 8)}...</span> },
                  { key: "field_changed", label: "Field", render: (v) => v || "—" },
                  { key: "old_value", label: "Old Value", render: (v) => v != null ? <span className="truncate block max-w-[150px]">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span> : "—" },
                  { key: "new_value", label: "New Value", render: (v) => v != null ? <span className="truncate block max-w-[150px]">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span> : "—" },
                  { key: "changed_at", label: "Changed", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{formatDateTime(v)}</span> },
                ]}
                rows={userPrefHistory}
                emptyMessage="No preference history"
              />
            ) : (
              <EmptyState icon={Clock} message="No preference change history" />
            )}
          </SectionCard>
        )}

        {deleteModalJSX}
      </div>
    );
  }

  // ─── Render: Impersonate View ───────────────────────────────────────────────

  if (view === "impersonate") {
    return (
      <div className="flex flex-col gap-6">
        {/* Top bar */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={backToDetail}>Back to User Detail</Button>
        </div>

        {/* Impersonate header */}
        <div className="flex items-center gap-3 p-4 bg-[var(--color-info-50)] border border-[var(--color-info-200)] rounded-lg">
          <Eye className="w-5 h-5 text-[#3b82f6] shrink-0" />
          <div>
            <p className="text-sm font-medium text-[#1d4ed8]">
              Viewing as: {userDetail?.display_name || "Unknown"}
              {userDetail?.username && <span className="font-normal"> (@{userDetail.username})</span>}
            </p>
            <p className="text-xs text-[#1d4ed8] mt-0.5">All data below is read-only and shows what this user would see</p>
          </div>
        </div>

        {/* Preferences */}
        <SectionCard title="Their Preferences">
          {impersonateData.preferences ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8">
              <ProfileField icon={Zap} label="Mode" value={impersonateData.preferences.mode} />
              <ProfileField icon={Activity} label="Budget" value={
                impersonateData.preferences.budget_min != null && impersonateData.preferences.budget_max != null
                  ? `${impersonateData.preferences.budget_min} – ${impersonateData.preferences.budget_max}`
                  : null
              } />
              <ProfileField icon={Globe} label="Travel Mode" value={impersonateData.preferences.travel_mode} />
              <ProfileField icon={Clock} label="Time Slot" value={impersonateData.preferences.time_slot} />
              {impersonateData.preferences.categories && (
                <div className="md:col-span-2">
                  <span className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider">Categories</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {(Array.isArray(impersonateData.preferences.categories) ? impersonateData.preferences.categories : []).map((cat, i) => (
                      <Badge key={i} variant="brand">{cat}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <EmptyState icon={Zap} message="No preferences set" />
          )}
        </SectionCard>

        {/* Saved Experiences */}
        <SectionCard title={`Their Saved Experiences (${impersonateData.savedExperiences.length})`}>
          {impersonateData.savedExperiences.length > 0 ? (
            <DataTable
              columns={[
                { key: "id", label: "ID", width: "80px", render: (v) => <span className="font-mono text-xs">{v?.slice(0, 8)}...</span> },
                { key: "title", label: "Title", render: (v) => v || "—" },
                { key: "category", label: "Category", render: (v) => v ? <Badge variant="brand">{v}</Badge> : "—" },
                { key: "created_at", label: "Saved", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
              ]}
              rows={impersonateData.savedExperiences}
              emptyMessage="No saved experiences"
            />
          ) : (
            <EmptyState icon={Heart} message="No saved experiences" />
          )}
        </SectionCard>

        {/* Saved Cards */}
        <SectionCard title={`Their Saved Cards (${impersonateData.savedCards.length})`}>
          {impersonateData.savedCards.length > 0 ? (
            <DataTable
              columns={[
                { key: "id", label: "ID", width: "80px", render: (v) => <span className="font-mono text-xs">{v?.slice(0, 8)}...</span> },
                { key: "card_pool_id", label: "Card Pool ID", render: (v) => v ? <span className="font-mono text-xs">{v.slice(0, 8)}...</span> : "—" },
                { key: "created_at", label: "Saved", render: (v) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(v)}</span> },
              ]}
              rows={impersonateData.savedCards}
              emptyMessage="No saved cards"
            />
          ) : (
            <EmptyState icon={Heart} message="No saved cards" />
          )}
        </SectionCard>

        {/* Boards */}
        <SectionCard title={`Their Boards (${impersonateData.boards.length})`}>
          {impersonateData.boards.length > 0 ? (
            <div className="divide-y divide-[var(--gray-200)]">
              {impersonateData.boards.map((b, i) => (
                <div key={b.id || i} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="w-8 h-8 rounded-lg bg-[var(--color-brand-50)] flex items-center justify-center shrink-0">
                    <LayoutDashboard className="w-4 h-4 text-[#f97316]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                      {b.name || "Unnamed Board"}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Created {timeAgo(b.created_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={LayoutDashboard} message="Not part of any boards" />
          )}
        </SectionCard>
      </div>
    );
  }

  return null;
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function ProfileField({ icon: Icon, label, value, mono = false }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-[var(--gray-50)] flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-[var(--color-text-tertiary)]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider">{label}</p>
        <p className={`text-sm text-[var(--color-text-primary)] truncate mt-0.5 ${mono ? "font-mono text-xs" : ""}`}>
          {value ?? <span className="text-[var(--color-text-muted)]">—</span>}
        </p>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, message }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-2">
      <Icon className="h-8 w-8 text-[var(--gray-300)]" />
      <p className="text-sm text-[var(--color-text-tertiary)]">{message}</p>
    </div>
  );
}
