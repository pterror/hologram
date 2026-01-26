/**
 * Access Control Module
 *
 * Provides role-based access control for entities and worlds with:
 * - Inheritance from containers (locations, worlds)
 * - Direct access grants with optional override semantics
 * - Union access (highest role from any source wins)
 * - Creator tracking
 */

import {
  type Role,
  type AccessorType,
  maxRole,
  ROLE_PERMISSIONS,
} from "./types";
import {
  getEntityAccessGrants,
  getEntityAccessGrant,
  grantEntityAccess as grantEntityAccessDb,
  revokeEntityAccess as revokeEntityAccessDb,
  entityHasExplicitAccess,
  getUserWorldRole,
  grantUserWorldAccess as grantUserWorldAccessDb,
  revokeUserWorldAccess as revokeUserWorldAccessDb,
  getGuildWorldRole,
  getEntityWorlds,
  getEntityCreator,
  getWorldCreator,
  getEntityParent,
  linkEntityToWorld as linkEntityToWorldDb,
  unlinkEntityFromWorld as unlinkEntityFromWorldDb,
  setEntityPrimaryWorld as setEntityPrimaryWorldDb,
} from "./queries";

// Re-export types
export * from "./types";
export * from "./queries";

// === World Role Resolution ===

/**
 * Get user's role for a world.
 *
 * Checks (in order, takes highest):
 * 1. Direct user_worlds grant
 * 2. World creator (gets 'owner')
 * 3. Guild membership via guild_worlds
 *
 * @param userId - Discord user ID
 * @param worldId - World ID
 * @param userGuilds - List of guild IDs the user is a member of
 */
export function getWorldRole(
  userId: string,
  worldId: number,
  userGuilds: string[] = []
): Role | null {
  const roles: Role[] = [];

  // 1. Direct user grant
  const userRole = getUserWorldRole(userId, worldId);
  if (userRole) {
    roles.push(userRole);
  }

  // 2. Creator check
  const creator = getWorldCreator(worldId);
  if (creator === userId) {
    roles.push("owner");
  }

  // 3. Guild membership
  for (const guildId of userGuilds) {
    const guildRole = getGuildWorldRole(guildId, worldId);
    if (guildRole) {
      roles.push(guildRole);
    }
  }

  return maxRole(roles);
}

// === Entity Role Resolution ===

/**
 * Get user's role for an entity.
 *
 * If the entity has explicit access grants (entity_access rows exist),
 * uses RESTRICTIVE mode: only explicit grants apply, no inheritance.
 *
 * Otherwise uses ADDITIVE mode with inheritance:
 * 1. Entity creator (gets 'owner')
 * 2. Inherited from entity's worlds
 * 3. Inherited from parent entity (location hierarchy)
 *
 * @param userId - Discord user ID
 * @param entityId - Entity ID
 * @param userGuilds - List of guild IDs the user is a member of
 * @param visited - Set of already-visited entity IDs (prevents cycles)
 */
export function getEntityRole(
  userId: string,
  entityId: number,
  userGuilds: string[] = [],
  visited: Set<number> = new Set()
): Role | null {
  // Prevent infinite recursion in cyclic hierarchies
  if (visited.has(entityId)) {
    return null;
  }
  visited.add(entityId);

  const roles: Role[] = [];

  // Check if entity has explicit access grants (restrictive mode)
  const hasExplicit = entityHasExplicitAccess(entityId);

  if (hasExplicit) {
    // RESTRICTIVE MODE: Only explicit grants + creator

    // Direct user grant
    const userGrant = getEntityAccessGrant(entityId, "user", userId);
    if (userGrant) {
      roles.push(userGrant.role);
    }

    // Guild grants
    for (const guildId of userGuilds) {
      const guildGrant = getEntityAccessGrant(entityId, "guild", guildId);
      if (guildGrant) {
        roles.push(guildGrant.role);
      }
    }

    // Creator always has owner
    const creator = getEntityCreator(entityId);
    if (creator === userId) {
      roles.push("owner");
    }

    return maxRole(roles);
  }

  // ADDITIVE MODE: Inherit from worlds and parent

  // Creator always has owner
  const creator = getEntityCreator(entityId);
  if (creator === userId) {
    roles.push("owner");
  }

  // Inherited from worlds
  const entityWorlds = getEntityWorlds(entityId);
  for (const link of entityWorlds) {
    const worldRole = getWorldRole(userId, link.worldId, userGuilds);
    if (worldRole) {
      roles.push(worldRole);
    }
  }

  // Inherited from parent (location hierarchy)
  const parentId = getEntityParent(entityId);
  if (parentId !== null) {
    const parentRole = getEntityRole(userId, parentId, userGuilds, visited);
    if (parentRole) {
      roles.push(parentRole);
    }
  }

  return maxRole(roles);
}

// === Permission Checks ===

/** Check if user can view an entity */
export function canView(
  userId: string,
  entityId: number,
  userGuilds: string[] = []
): boolean {
  const role = getEntityRole(userId, entityId, userGuilds);
  return role !== null && ROLE_PERMISSIONS[role].canView;
}

/** Check if user can edit an entity */
export function canEdit(
  userId: string,
  entityId: number,
  userGuilds: string[] = []
): boolean {
  const role = getEntityRole(userId, entityId, userGuilds);
  return role !== null && ROLE_PERMISSIONS[role].canEdit;
}

/** Check if user can delete an entity */
export function canDelete(
  userId: string,
  entityId: number,
  userGuilds: string[] = []
): boolean {
  const role = getEntityRole(userId, entityId, userGuilds);
  return role !== null && ROLE_PERMISSIONS[role].canDelete;
}

/**
 * Check if user can export an entity.
 *
 * User can export if:
 * - They have owner/admin role (can export anything), OR
 * - They are the creator of the entity (can export own)
 */
export function canExport(
  userId: string,
  entityId: number,
  userGuilds: string[] = []
): boolean {
  const role = getEntityRole(userId, entityId, userGuilds);
  if (role !== null && ROLE_PERMISSIONS[role].canExportAll) {
    return true;
  }

  // Check if user is creator (can export own)
  const creator = getEntityCreator(entityId);
  if (creator === userId) {
    return true;
  }

  // Check role allows exporting own creations
  return role !== null && ROLE_PERMISSIONS[role].canExportOwn && creator === userId;
}

/** Check if user can view a world */
export function canViewWorld(
  userId: string,
  worldId: number,
  userGuilds: string[] = []
): boolean {
  const role = getWorldRole(userId, worldId, userGuilds);
  return role !== null && ROLE_PERMISSIONS[role].canView;
}

/** Check if user can export a world */
export function canExportWorld(
  userId: string,
  worldId: number,
  userGuilds: string[] = []
): boolean {
  const role = getWorldRole(userId, worldId, userGuilds);
  if (role !== null && ROLE_PERMISSIONS[role].canExportAll) {
    return true;
  }

  // Check if user is creator
  const creator = getWorldCreator(worldId);
  return creator === userId;
}

// === Access Management ===

/** Grant access to an entity */
export function grantEntityAccess(
  entityId: number,
  accessorType: AccessorType,
  accessorId: string,
  role: Role
): void {
  grantEntityAccessDb(entityId, accessorType, accessorId, role);
}

/** Revoke access from an entity */
export function revokeEntityAccess(
  entityId: number,
  accessorType: AccessorType,
  accessorId: string
): boolean {
  return revokeEntityAccessDb(entityId, accessorType, accessorId);
}

/** Grant user access to a world */
export function grantUserWorldAccess(
  userId: string,
  worldId: number,
  role: Role
): void {
  grantUserWorldAccessDb(userId, worldId, role);
}

/** Revoke user's world access */
export function revokeUserWorldAccess(
  userId: string,
  worldId: number
): boolean {
  return revokeUserWorldAccessDb(userId, worldId);
}

// === Entity-World Management ===

/** Link an entity to a world */
export function linkEntityToWorld(
  entityId: number,
  worldId: number,
  isPrimary: boolean = false
): void {
  linkEntityToWorldDb(entityId, worldId, isPrimary);
}

/** Unlink an entity from a world */
export function unlinkEntityFromWorld(
  entityId: number,
  worldId: number
): boolean {
  return unlinkEntityFromWorldDb(entityId, worldId);
}

/** Set the primary world for an entity */
export function setEntityPrimaryWorld(
  entityId: number,
  worldId: number
): void {
  setEntityPrimaryWorldDb(entityId, worldId);
}
