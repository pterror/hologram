/**
 * Access Control Types
 *
 * Defines the role hierarchy and access grant structures for the
 * entity ownership and permission system.
 */

/** Role hierarchy from most to least permissive */
export type Role = "owner" | "admin" | "editor" | "member" | "viewer";

/** Ordered list of roles for comparison (higher index = higher permission) */
export const ROLE_HIERARCHY: readonly Role[] = [
  "viewer",
  "member",
  "editor",
  "admin",
  "owner",
] as const;

/** Get numeric priority for a role (higher = more permissive) */
export function getRolePriority(role: Role): number {
  return ROLE_HIERARCHY.indexOf(role);
}

/** Compare two roles, returns positive if a > b, negative if a < b, 0 if equal */
export function compareRoles(a: Role, b: Role): number {
  return getRolePriority(a) - getRolePriority(b);
}

/** Get the highest role from a list */
export function maxRole(roles: Role[]): Role | null {
  if (roles.length === 0) return null;
  return roles.reduce((max, r) => (compareRoles(r, max) > 0 ? r : max));
}

/** Type of accessor for entity_access grants */
export type AccessorType = "user" | "guild";

/** A direct access grant on an entity */
export interface EntityAccessGrant {
  entityId: number;
  accessorType: AccessorType;
  accessorId: string;
  role: Role;
  createdAt: number;
}

/** A user's world access grant */
export interface UserWorldAccess {
  userId: string;
  worldId: number;
  role: Role;
  createdAt: number;
}

/** A guild's world access grant */
export interface GuildWorldAccess {
  guildId: string;
  worldId: number;
  role: Role;
  data: Record<string, unknown> | null;
}

/** An entity-world membership link */
export interface EntityWorldLink {
  entityId: number;
  worldId: number;
  isPrimary: boolean;
}

/** Permission check result with explanation */
export interface AccessResult {
  allowed: boolean;
  role: Role | null;
  reason: string;
  sources: string[];
}

/** Permissions for each role */
export const ROLE_PERMISSIONS: Record<
  Role,
  {
    canView: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canExportAll: boolean;
    canExportOwn: boolean;
    canGrantRoles: boolean;
  }
> = {
  owner: {
    canView: true,
    canEdit: true,
    canDelete: true,
    canExportAll: true,
    canExportOwn: true,
    canGrantRoles: true,
  },
  admin: {
    canView: true,
    canEdit: true,
    canDelete: true,
    canExportAll: true,
    canExportOwn: true,
    canGrantRoles: true, // but not owner role
  },
  editor: {
    canView: true,
    canEdit: true,
    canDelete: false,
    canExportAll: false,
    canExportOwn: true,
    canGrantRoles: false,
  },
  member: {
    canView: true,
    canEdit: false,
    canDelete: false,
    canExportAll: false,
    canExportOwn: true,
    canGrantRoles: false,
  },
  viewer: {
    canView: true,
    canEdit: false,
    canDelete: false,
    canExportAll: false,
    canExportOwn: false,
    canGrantRoles: false,
  },
};
