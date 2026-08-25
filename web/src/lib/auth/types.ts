export type Role = "admin" | "pod_leader" | "viewer";
// Not stored — derived server-side from is_active + auth.users.last_sign_in_at
// (see toAdminUserView below). Kept as a type so the UI can keep using one
// "status" field instead of juggling two booleans everywhere.
export type Status = "pending" | "active" | "suspended";

// Mirrors the real public.profiles table — pre-existing, built independently
// of this app (see supabase/migrations/0001_init_profiles_and_auth.sql).
export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  pod_id: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Shape expected by the admin UI (name/status/lastLogin instead of
// full_name/is_active+last_sign_in_at) — status is derived, not stored.
export interface AdminUserView {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: Status;
  lastLogin: string | null;
}

export function toAdminUserView(profile: Profile, lastSignInAt: string | null): AdminUserView {
  const status: Status = !profile.is_active ? "suspended" : lastSignInAt ? "active" : "pending";
  return {
    id: profile.id,
    name: profile.full_name,
    email: profile.email,
    role: profile.role,
    status,
    lastLogin: lastSignInAt,
  };
}

export const ROLES: Role[] = ["admin", "pod_leader", "viewer"];
export const STATUSES: Status[] = ["pending", "active", "suspended"];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  pod_leader: "Pod Leader",
  viewer: "Viewer",
};

// CSS class suffixes — "pod_leader" can't survive the naive
// charAt(0).toUpperCase()+slice(1) trick the UI used to use.
export const ROLE_BADGE_CLASS: Record<Role, string> = {
  admin: "badgeAdmin",
  pod_leader: "badgePodLeader",
  viewer: "badgeViewer",
};
export const STATUS_BADGE_CLASS: Record<Status, string> = {
  pending: "badgePending",
  active: "badgeActive",
  suspended: "badgeSuspended",
};
