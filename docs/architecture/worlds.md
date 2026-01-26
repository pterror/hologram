# Worlds Architecture

This document describes what a "world" represents in Hologram's architecture and how worlds interact with entities, guilds, and users.

## What is a World?

A world is a **named collection of entities** with associated configuration and lore. Worlds serve as:

1. **Organizational containers** - Group related entities (characters, locations, items)
2. **Configuration scopes** - Apply rulesets, modes, and settings
3. **Access boundaries** - Control who can see and modify content
4. **Narrative contexts** - Define lore, rules, and setting

### Worlds as Views, Not Containers

In the new model, worlds are more like **views** or **filters** than strict containers:

- An entity can exist in multiple worlds simultaneously
- Worlds "see" entities through the `entity_worlds` join table
- The same character can appear in both "Kingdom of Ardenia" and "Kingdom of Brynn"
- A magical artifact can be visible in all worlds that know about it

This is fundamentally different from the old model where `entities.world_id` created strict one-world-per-entity ownership.

## World Anatomy

### Database Schema

```sql
CREATE TABLE worlds (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  lore TEXT,
  rules TEXT,
  config JSON,
  data JSON,
  creator_id TEXT,           -- Discord user who created this world
  created_at INTEGER DEFAULT (unixepoch())
);
```

### Configuration

Each world has a `WorldConfig` that controls:

- **Mode** - Which plugin preset is active (minimal, sillytavern, mud, etc.)
- **Chronicle** - Memory extraction settings
- **Scenes** - Scene lifecycle configuration
- **Inventory** - Items, equipment, capacity
- **Locations** - Hierarchy, connections, travel time
- **Time** - Calendar, day/night, realtime sync
- **Character State** - Attributes, body/form, effects
- **Dice** - Dice syntax, combat integration
- **Relationships** - Affinity, factions
- **Context** - Token budget, history depth, RAG settings

See [Configuration Guide](../guide/configuration.md) for details.

### Lore and Rules

- **Lore** - Background information included in AI context
- **Rules** - Explicit instructions for AI behavior ("never break character", "use archaic speech", etc.)

## World-Entity Relationships

### entity_worlds Table

```sql
CREATE TABLE entity_worlds (
  entity_id INTEGER REFERENCES entities(id),
  world_id INTEGER REFERENCES worlds(id),
  is_primary BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (entity_id, world_id)
);
```

| Column | Purpose |
|--------|---------|
| `entity_id` | The entity being linked |
| `world_id` | The world it appears in |
| `is_primary` | Is this the entity's "home" world? |

### Primary World

Every entity has one primary world (enforced by application logic):

- Determines which world's config applies when ambiguous
- Default display context in UI
- Where the entity was originally created

### Multi-World Entities

Entities can be linked to multiple worlds:

```
Character "Ember the Wanderer":
  - Primary: "The Crossroads" (her home tavern)
  - Also in: "Kingdom of Ardenia", "Kingdom of Brynn", "The Underdark"
```

This models:
- Traveling characters
- Shared locations (border towns, trade routes)
- Legendary items known across regions
- NPCs that appear in multiple campaigns

## World Access Control

### Access Sources

Users gain access to worlds through:

1. **Creator** - The user who created the world (`worlds.creator_id`)
2. **User grants** - Direct grants via `user_worlds` table
3. **Guild membership** - Indirect access via `guild_worlds` table

### guild_worlds Table

```sql
CREATE TABLE guild_worlds (
  guild_id TEXT NOT NULL,
  world_id INTEGER REFERENCES worlds(id),
  role TEXT,       -- 'owner' | 'admin' | 'editor' | 'member' | 'viewer'
  data JSON,
  PRIMARY KEY (guild_id, world_id)
);
```

Allows multiple guilds to share a world with different permission levels:

```
World "Shared Campaign Setting":
  - Guild A: role='owner'   -- full control
  - Guild B: role='member'  -- can participate, can't edit
  - Guild C: role='viewer'  -- read-only observers
```

### user_worlds Table

```sql
CREATE TABLE user_worlds (
  user_id TEXT NOT NULL,
  world_id INTEGER REFERENCES worlds(id),
  role TEXT DEFAULT 'owner',
  PRIMARY KEY (user_id, world_id)
);
```

For personal/DM worlds not linked to any guild:

```
World "Alice's Solo Adventure":
  user_worlds: [('alice_id', world_id, 'owner')]
  guild_worlds: []  -- no guild links
```

## World Types

### Guild Worlds

Linked to one or more guilds via `guild_worlds`:
- Created via `/setup` or `/world create` in a guild
- Access controlled by guild membership and role
- Can be shared across multiple guilds

### Personal Worlds

Linked to users via `user_worlds`, no guild links:
- Created in DMs or personal channels
- Private by default
- Can share with specific users

### Shared Worlds

Multiple access sources (guilds and/or users):
- Central campaign setting used by multiple groups
- Collaborative worldbuilding between friends
- Public world with viewer access for observers

## Multi-Guild Scenarios

### Adjacent Territories

Two guilds each control part of a larger region:

```
World "Kingdom of Ardenia"
  guild_worlds: [('ardenia_guild', 'owner')]

World "Kingdom of Brynn"
  guild_worlds: [('brynn_guild', 'owner')]

Entity "Riverside Market" (border town)
  entity_worlds:
    - (riverside, ardenia, is_primary=true)
    - (riverside, brynn, is_primary=false)
```

Both guilds see the border town. Access is granted via union - users from either guild can interact with it.

### Shared Campaign Setting

Multiple gaming groups use the same setting:

```
World "The Forgotten Realms"
  guild_worlds:
    - ('monday_night_group', 'admin')
    - ('saturday_group', 'admin')
    - ('dm_planning_server', 'owner')
```

All groups share the same locations, NPCs, and lore, but run separate scenes and have different player characters.

### Observers and Spectators

A stream or audience can watch a campaign:

```
World "Actual Play Campaign"
  guild_worlds:
    - ('players_server', 'owner')
    - ('audience_server', 'viewer')
```

Audience can see but not modify.

## World Inheritance

### Entity Inheritance from Worlds

When an entity doesn't have explicit `entity_access` grants, it inherits access from its worlds:

```
Entity in World A (role='editor')
   + Entity in World B (role='viewer')
   = User gets max(editor, viewer) = editor
```

### Location Hierarchy Inheritance

Locations inherit from parent locations, which ultimately inherit from worlds:

```
World "Dungeon Crawl"
  └── Region "The Underdark"
        └── Location "Forgotten Temple"
              └── Location "Inner Sanctum"
```

Access to "Inner Sanctum" can come from:
1. Direct `entity_access` on Inner Sanctum
2. Inherited from "Forgotten Temple"
3. Inherited from "The Underdark"
4. Inherited from "Dungeon Crawl" world

## Configuration Inheritance

### World Config Precedence

When an entity exists in multiple worlds with different configs:
1. Use primary world's config
2. For scene-specific settings, use the scene's world config

### Scene World Context

Scenes are always in exactly one world:

```sql
CREATE TABLE scenes (
  ...
  world_id INTEGER REFERENCES worlds(id),
  ...
);
```

The scene's world config determines:
- Which plugins are active
- Chronicle extraction rules
- Time/calendar settings
- Context assembly rules

## API Reference

### World CRUD

```typescript
// Create
function createWorld(
  name: string,
  description?: string,
  creatorId?: string,
  data?: Record<string, unknown>
): { id: number; name: string }

// Read
function getWorld(id: number): World | null
function getWorldsForGuild(guildId: string): World[]
function getWorldsForUser(userId: string): World[]

// Update
function updateWorld(id: number, updates: Partial<World>): World | null

// Delete
function deleteWorld(id: number): boolean
```

### World Linking

```typescript
// Guild links
function linkGuildToWorld(guildId: string, worldId: number, role?: Role): void
function unlinkGuildFromWorld(guildId: string, worldId: number): void
function getGuildsForWorld(worldId: number): Array<{ guildId: string; role: Role }>

// User links
function linkUserToWorld(userId: string, worldId: number, role?: Role): void
function unlinkUserFromWorld(userId: string, worldId: number): void
function getUsersForWorld(worldId: number): Array<{ userId: string; role: Role }>
```

### Entity-World Linking

```typescript
// Link entity to world
function linkEntityToWorld(entityId: number, worldId: number, isPrimary?: boolean): void
function unlinkEntityFromWorld(entityId: number, worldId: number): void

// Query
function getWorldsForEntity(entityId: number): Array<{ world: World; isPrimary: boolean }>
function getEntitiesInWorld(worldId: number, type?: EntityType): Entity[]

// Set primary
function setEntityPrimaryWorld(entityId: number, worldId: number): void
```

## Best Practices

### When to Create a New World

- Different narrative context (fantasy vs sci-fi)
- Different ruleset/mode requirements
- Different ownership/access needs
- Separate timelines or continuities

### When to Share Entities Across Worlds

- Recurring characters across campaigns
- Shared locations (crossover events)
- Universal items or concepts
- Meta-narrative elements

### When to Use Private Access

Use `entity_access` overrides for:
- Player secrets (hidden characters, private notes)
- GM-only content (unrevealed plots)
- Work-in-progress entities
- Personal test content

## Migration Notes

### From Single-World Model

Existing entities with `world_id`:
1. Create `entity_worlds` row with `is_primary=true`
2. Legacy `world_id` column becomes nullable
3. Queries updated to use `entity_worlds` join

### Preserving Behavior

For backwards compatibility:
- `getEntitiesByType(type, worldId)` still works, queries `entity_worlds`
- `createEntity()` with `worldId` creates the `entity_worlds` link
- Primary world is set automatically on creation
