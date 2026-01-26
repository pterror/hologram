# Entity Ownership & Access Control

This document describes Hologram's ownership and access control model, including the rationale for its design and migration path from the legacy model.

## Overview

Hologram uses a flexible, inheritance-based access control system where:
- **Entities are independent** - not owned by worlds, but can be *visible in* multiple worlds
- **Access is inherited** from containers (locations, worlds) with optional overrides
- **Union semantics** - if ANY source grants permission, the user has it
- **Creator tracking** - creators always have owner-level access to their creations

## Legacy Model (Pre-Refactor)

```
entities.world_id → worlds.id         (single world ownership)
guild_worlds(guild_id, world_id, role)  (guild → world access)
```

### Limitations

1. **Single-world entities**: Every entity belongs to exactly one world. A border town between two kingdoms must pick one.

2. **World-level granularity**: Sharing means sharing the entire world. Can't give someone access to just one region.

3. **No creator tracking**: No record of who created an entity, making it impossible to let users export their own creations.

4. **No personal worlds**: Worlds must be linked to guilds. DM-based personal play isn't well supported.

5. **No overlapping territories**: Two guilds can't both have access to the same geographic area unless they share the entire world.

## New Model

### Schema

```sql
-- Entity world membership (many-to-many)
CREATE TABLE entity_worlds (
  entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
  world_id INTEGER REFERENCES worlds(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (entity_id, world_id)
);

-- Direct access grants
CREATE TABLE entity_access (
  entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
  accessor_type TEXT NOT NULL,  -- 'user' | 'guild'
  accessor_id TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (entity_id, accessor_type, accessor_id)
);

-- Creator tracking
ALTER TABLE entities ADD COLUMN creator_id TEXT;
ALTER TABLE worlds ADD COLUMN creator_id TEXT;

-- User-level world access
CREATE TABLE user_worlds (
  user_id TEXT NOT NULL,
  world_id INTEGER REFERENCES worlds(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'owner',
  PRIMARY KEY (user_id, world_id)
);
```

### Role Hierarchy

Roles are ordered from most to least permissive:

| Role | Description |
|------|-------------|
| `owner` | Full control, can delete, can grant any role to others |
| `admin` | Full control except deletion and ownership transfer |
| `editor` | Can modify content, can only export own creations |
| `member` | Can view and participate, can only export own creations |
| `viewer` | Read-only access, cannot export |

### Access Resolution Algorithm

Access is resolved by checking multiple sources and taking the highest role (union semantics):

```
getEntityRole(userId, entityId) -> Role | null:
  roles = []

  // 1. Direct entity grants
  if entity_access(entityId, 'user', userId) exists:
    roles.push(that role)

  // 2. Creator always has owner access
  if entities[entityId].creator_id == userId:
    roles.push('owner')

  // 3. Guild-based entity grants
  for each guild user is a member of:
    if entity_access(entityId, 'guild', guildId) exists:
      roles.push(that role)

  // 4. Inherited from worlds
  for each world in entity_worlds(entityId):
    role = getWorldRole(userId, worldId)
    if role: roles.push(role)

  // 5. Inherited from parent (location hierarchy)
  if entity has parentId:
    role = getEntityRole(userId, parentId)  // recurse
    if role: roles.push(role)

  // Return highest role, or null if no access
  return max(roles) or null


getWorldRole(userId, worldId) -> Role | null:
  roles = []

  // 1. Direct user grants
  if user_worlds(userId, worldId) exists:
    roles.push(that role)

  // 2. Creator always has owner access
  if worlds[worldId].creator_id == userId:
    roles.push('owner')

  // 3. Guild-based grants
  for each guild user is a member of:
    if guild_worlds(guildId, worldId) exists:
      roles.push(that role)

  return max(roles) or null
```

## Examples

### Border Town Between Two Kingdoms

A town that sits on the border of two kingdoms, each controlled by a different guild:

```
entity: "Riverside Market" (location, id=42)
entity_worlds:
  - (42, Kingdom_Ardenia, is_primary=true)
  - (42, Kingdom_Brynn, is_primary=false)
entity_access: []  -- no direct grants, inherits from worlds

guild_worlds:
  - (guild_ardenia, Kingdom_Ardenia, 'owner')
  - (guild_brynn, Kingdom_Brynn, 'owner')
```

**Access resolution for a user in Guild Ardenia:**
1. No direct entity_access for this user
2. Not the creator
3. No guild-based entity_access
4. World inheritance: user has 'owner' via guild_worlds for Kingdom_Ardenia
5. Result: **owner**

**Access resolution for a user in Guild Brynn:**
- Same result via Kingdom_Brynn

Both guilds can fully access this location through their respective world memberships.

### Private Character in Shared World

A player's secret alt character that shouldn't be visible to others:

```
entity: "Shadow Infiltrator" (character, id=100)
entity_worlds:
  - (100, MainCampaign, is_primary=true)
entity_access:
  - (100, 'user', 'alice_discord_id', 'owner')
creator_id: 'alice_discord_id'
```

The `entity_access` grant creates an **override**. Other users have world access but this character is explicitly restricted.

**Access resolution for Alice:**
1. Direct entity_access gives 'owner'
2. Result: **owner**

**Access resolution for another player (Bob) with world access:**
1. No direct entity_access for Bob
2. Bob is not the creator
3. No guild-based entity_access
4. World inheritance would normally give access, BUT...

Wait - the current model as described doesn't have an explicit "deny" mechanism. Let me revise:

### Access Override Semantics

There are two modes for `entity_access`:

1. **Additive mode** (default): entity_access grants ADD to inherited access
2. **Restrictive mode**: If ANY entity_access row exists for an entity, inheritance is disabled for that entity

For private characters, we use restrictive mode:
- If `entity_access` has any rows for an entity, ONLY those rows grant access
- No inheritance from worlds or parents
- This allows "opt-in only" access patterns

```
getEntityRole(userId, entityId) -> Role | null:
  // Check if entity has explicit access rules
  has_explicit_access = entity_access rows exist for entityId

  if has_explicit_access:
    // Restrictive mode: only explicit grants
    role = check entity_access and creator_id
    return role
  else:
    // Additive mode: inherit from worlds and parents
    return normal resolution with inheritance
```

**Revised access for Bob on private character:**
1. entity_access rows exist for this entity → restrictive mode
2. No entity_access for Bob
3. Bob is not the creator
4. Result: **null** (no access)

### Shared Item Across Containers

An artifact that exists in multiple worlds and can move between locations:

```
entity: "Crown of Ages" (item, id=200)
entity_worlds:
  - (200, Kingdom_Ardenia, is_primary=true)
  - (200, Kingdom_Brynn, is_primary=false)
relationship: (200, LOCATED_AT, throne_room_ardenia)
```

The item:
- Is visible in both kingdoms' world views
- Currently located in Ardenia's throne room
- Access comes from world membership (no restrictive overrides)

### Personal DM World

A user running a solo adventure in DMs:

```
world: "Alice's Sandbox" (id=10)
worlds.creator_id: 'alice_discord_id'
user_worlds:
  - ('alice_discord_id', 10, 'owner')
guild_worlds: []  -- no guild links
```

Alice has full access via `user_worlds`. No guilds are involved.

## Permission Matrix

| Action | owner | admin | editor | member | viewer |
|--------|-------|-------|--------|--------|--------|
| View entity | Yes | Yes | Yes | Yes | Yes |
| Edit entity | Yes | Yes | Yes | No | No |
| Delete entity | Yes | Yes | No | No | No |
| Export any | Yes | Yes | No | No | No |
| Export own | Yes | Yes | Yes | Yes | No |
| Grant roles | Yes | Yes (not owner) | No | No | No |
| Delete world | Yes | No | No | No | No |

"Export own" = can export entities where user is the `creator_id`

## Migration Path

### Phase 1: Add New Columns (Non-Breaking)

```sql
ALTER TABLE entities ADD COLUMN creator_id TEXT;
ALTER TABLE worlds ADD COLUMN creator_id TEXT;
```

- Nullable columns, existing code continues to work
- Start populating `creator_id` on new entities

### Phase 2: Create New Tables

```sql
CREATE TABLE entity_worlds (...);
CREATE TABLE entity_access (...);
CREATE TABLE user_worlds (...);
```

- Empty tables initially
- New code can start using them

### Phase 3: Migrate Data

```sql
-- For each entity with world_id, create entity_worlds row
INSERT INTO entity_worlds (entity_id, world_id, is_primary)
SELECT id, world_id, TRUE FROM entities WHERE world_id IS NOT NULL;

-- Set existing guild_worlds roles to 'owner' where NULL
UPDATE guild_worlds SET role = 'owner' WHERE role IS NULL;
```

### Phase 4: Update Queries

- Change `getEntitiesByType(type, worldId)` to query `entity_worlds`
- Change `createEntity()` to populate `entity_worlds` and `creator_id`
- Update all entity listing/filtering code

### Phase 5: Deprecate world_id

```sql
-- Make nullable (soft deprecation)
-- Eventually drop column in future version
```

## API Reference

### Core Functions

```typescript
// Get user's role for an entity
function getEntityRole(userId: string, entityId: number): Role | null

// Get user's role for a world
function getWorldRole(userId: string, worldId: number): Role | null

// Check if user can perform action
function canView(userId: string, entityId: number): boolean
function canEdit(userId: string, entityId: number): boolean
function canDelete(userId: string, entityId: number): boolean
function canExport(userId: string, entityId: number): boolean

// Grant access
function grantEntityAccess(entityId: number, accessorType: 'user' | 'guild', accessorId: string, role: Role): void
function grantWorldAccess(worldId: number, userId: string, role: Role): void

// Revoke access
function revokeEntityAccess(entityId: number, accessorType: 'user' | 'guild', accessorId: string): void
function revokeWorldAccess(worldId: number, userId: string): void
```

### Types

```typescript
type Role = 'owner' | 'admin' | 'editor' | 'member' | 'viewer';

interface AccessGrant {
  entityId: number;
  accessorType: 'user' | 'guild';
  accessorId: string;
  role: Role;
}

interface WorldAccess {
  worldId: number;
  userId: string;
  role: Role;
}
```

## Design Decisions

### Why Union Semantics?

We chose "highest role wins" rather than "most restrictive wins" because:
1. Easier to reason about - more access sources = more access
2. Matches user expectations from other systems (Discord roles work this way)
3. Simpler to implement and debug
4. Restrictive overrides are opt-in via `entity_access`

### Why Restrictive Mode for entity_access?

Without restrictive mode, there's no way to make something truly private. If any `entity_access` row exists for an entity, we assume the creator explicitly chose who can access it, disabling inheritance.

### Why Separate entity_worlds vs entity_access?

- `entity_worlds` answers: "Which worlds can see this entity?"
- `entity_access` answers: "Who has explicit permission grants?"

These are different concepts:
- An entity can be in a world without anyone in that world having access (private)
- An entity can have access grants from users not in any of its worlds (direct share)

### Why is_primary in entity_worlds?

When an entity exists in multiple worlds, we need to know:
- Which world's configuration to use for display
- Where to list it by default in UI
- Which world's rules apply when there's conflict

`is_primary` designates the "home" world for these purposes.
