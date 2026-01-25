# TODO

## Tech Debt

### Type Safety
- [ ] Replace `AnyBot` and `AnyInteraction` types with proper Discordeno types
  - Currently using `any` with eslint-disable as workaround for complex Discord types
  - Files affected: all command handlers in `src/bot/commands/`
  - Should use proper Bot and Interaction types from @discordeno/bot

### Build Tooling
- [ ] Consider using tsgo (native TS compiler) via @typescript/native-preview
  - Should be significantly faster than standard tsc
  - Package: @typescript/native-preview on npm

---

## Integration Layer (Critical Path)

These are the glue pieces that connect existing subsystems into a working bot.

### 1. Message Handler Integration

The current `src/bot/events/message.ts` is a basic skeleton. It needs to pull from all subsystems.

**Files:** `src/bot/events/message.ts`, `src/ai/context.ts`

- [ ] Scene-aware context assembly in message handler
  - Get active scene for channel → pull world rules, location, time, weather, ambience
  - Get scene characters → pull personas, relationships, active effects
  - Get user persona → inject into context as "the player"
- [ ] Proxy interception
  - Before generating AI response, check if incoming message matches a user proxy
  - If matched: strip trigger, rewrite message attribution to proxy name
  - Delete original Discord message, send via webhook with proxy name/avatar
  - If no scene/webhook support: just rewrite the name in context
- [ ] Chronicle integration
  - After each exchange: fire `autoExtract` if enabled (async, non-blocking)
  - Every N messages: fire `periodicSummary` if enabled
  - On RAG query: search chronicle with perspective filter
- [ ] State extraction from AI response
  - Parse response for implicit state changes (location moves, item usage, relationship shifts)
  - Feed back into: chronicle entries, character state, relationship affinity
  - This is the "state extraction glue layer" - needs LLM call or heuristic parsing
- [ ] Multi-character response routing
  - Config `multiCharMode`: tagged / webhooks / narrator / auto
  - `webhooks`: parse AI response for character attributions, send each via webhook
  - `tagged`: return as-is with `**Name:** dialogue` format
  - `auto`: use webhooks if guild + permission, else tagged

### 2. Proxy Webhook Execution

Proxy system (`src/proxies/`) has CRUD and matching, but no webhook execution.

**Files:** new `src/proxies/webhook.ts`, modify `src/bot/events/message.ts`

- [ ] Webhook creation/caching per channel+proxy
  - Reuse `character_webhooks` table pattern (or add `proxy_webhooks` table)
  - Create webhook on first use, cache ID+token
- [ ] Message intercept flow
  1. User sends message
  2. `parseProxyMessage(userId, content, worldId)` → match found
  3. Delete original message (`bot.helpers.deleteMessage`)
  4. Send via webhook with proxy name/avatar
  5. Add to message history with proxy name attribution
- [ ] DM fallback: webhooks don't work in DMs, use tagged format instead

### 3. Testing

- [ ] Dice parser unit tests (expression parsing, keep/drop, explode, variables)
- [ ] Time math tests (advance, skip, calendar rollover, season detection)
- [ ] Proxy matching tests (prefix, suffix, brackets, priority ordering)
- [ ] Config merge tests (deep merge, presets, feature flags)
- [ ] Wizard session lifecycle tests (create, step, expire, cleanup)

---

## Feature: Config-Aware Item Wizard

The `/build item` wizard should present different steps based on world config. TF features (body requirements, transformation effects, species/form constraints) must be **opt-in** via `characterState.useForms` or `characterState.useEffects` - never shown to non-TF users.

### Design

```
Wizard Step Flow (config-aware):

ALWAYS:
  1. Name (required)
  2. Description (required)
  3. Type (optional: consumable, equipment, quest, currency, misc)

IF inventory.useEquipment:
  4. Equipment Slot (optional: mainhand, offhand, head, body, ...)
  5. Stat Bonuses (optional: freeform key:value)

IF characterState.useEffects:
  6. Effect on Use (optional: buff/debuff name, duration, modifiers)

IF characterState.useForms:
  7. Body Requirements (optional: species, bodyType, size, flags)
  8. Transformation Effect (optional: bodyChanges on use)

IF inventory.useDurability:
  9. Durability (optional: max durability value)
```

**Implementation:**

```typescript
// In src/wizards/index.ts, change WIZARD_FLOWS from static to dynamic:
export function getWizardFlow(type: WizardType, config?: WorldConfig): WizardStep[] {
  switch (type) {
    case "item":
      return buildItemWizardFlow(config);
    // ... others remain static
  }
}

function buildItemWizardFlow(config?: WorldConfig): WizardStep[] {
  const steps: WizardStep[] = [
    { name: "Name", field: "name", required: true, ... },
    { name: "Description", field: "description", required: true, ... },
    { name: "Type", field: "itemType", required: false, inputType: "select", options: [...] },
  ];

  if (config?.inventory?.useEquipment) {
    steps.push({ name: "Equipment Slot", field: "equipSlot", ... });
    steps.push({ name: "Stat Bonuses", field: "stats", ... });
  }

  if (config?.characterState?.useEffects) {
    steps.push({ name: "Effect on Use", field: "effect", ... });
  }

  if (config?.characterState?.useForms) {
    steps.push({ name: "Body Requirements", field: "requirements", ... });
    steps.push({ name: "Transformation", field: "transformation", ... });
  }

  if (config?.inventory?.useDurability) {
    steps.push({ name: "Durability", field: "maxDurability", inputType: "number", ... });
  }

  return steps;
}
```

**Files to modify:**
- `src/wizards/index.ts` - Make `WIZARD_FLOWS` dynamic via function, accept `WorldConfig`
- `src/bot/commands/build.ts` - Pass world config when creating wizard session
- `src/db/entities.ts` - Ensure `ItemData` interface accommodates all optional fields

---

## Feature: Random Events System

Currently `scheduled_events` only supports deterministic triggers at specific times. Need probability-based random events that can fire during time advancement or on message activity.

### Design

```sql
-- New table: random event templates
CREATE TABLE random_event_tables (
  id INTEGER PRIMARY KEY,
  world_id INTEGER REFERENCES worlds(id),
  name TEXT NOT NULL,           -- "Forest Encounters", "Weather Changes"
  trigger TEXT NOT NULL,        -- "time_advance" | "message" | "location_enter" | "manual"
  enabled BOOLEAN DEFAULT 1,

  -- Probability
  chance REAL NOT NULL,         -- 0.0-1.0, checked per trigger
  cooldown_minutes INTEGER,     -- Min game-time between fires (prevents spam)
  last_fired_at INTEGER,        -- Game-time (day*1440 + hour*60 + minute) of last fire

  -- Conditions (optional, JSON)
  conditions JSON,              -- See below
  -- {
  --   "timeOfDay": ["night", "evening"],     -- Only fire during these periods
  --   "season": ["winter"],                   -- Only during these seasons
  --   "location": [5, 12],                    -- Only at these location IDs
  --   "weather": ["rain", "storm"],           -- Only during this weather
  --   "minCharacters": 2,                     -- Min characters present
  --   "hasEffect": ["cursed"],                -- A character has this effect
  --   "notEffect": ["safe_camp"],             -- No character has this effect
  -- }

  data JSON,                    -- Template-specific data
  created_at INTEGER DEFAULT (unixepoch())
);

-- Event table entries (the actual outcomes)
CREATE TABLE random_event_entries (
  id INTEGER PRIMARY KEY,
  table_id INTEGER REFERENCES random_event_tables(id) ON DELETE CASCADE,
  weight INTEGER DEFAULT 1,     -- Relative weight for selection
  content TEXT NOT NULL,         -- Event description/narration
  type TEXT DEFAULT 'narration', -- "narration" | "weather_change" | "npc_arrival" | "item_drop" | "effect"

  -- Side effects (optional, JSON)
  effects JSON,
  -- {
  --   "weatherChange": "storm",
  --   "spawnCharacter": 15,         -- Bring NPC into scene
  --   "giveItem": { "entityId": 8, "characterId": "random_present" },
  --   "applyEffect": { "name": "Chilled", "type": "debuff", "duration": "temporary" },
  --   "advanceTime": { "hours": 1 },
  --   "chronicleEntry": { "type": "event", "importance": 7 },
  -- }

  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX idx_random_tables_world ON random_event_tables(world_id);
CREATE INDEX idx_random_entries_table ON random_event_entries(table_id);
```

### Trigger Points

```typescript
// Called from multiple places:

// 1. Time advancement (src/world/time.ts → advanceSceneTime)
//    Check all tables with trigger="time_advance"
function checkRandomEvents(scene: Scene, trigger: "time_advance" | "message" | "location_enter"): RandomEventResult[]

// 2. Each message (src/bot/events/message.ts)
//    Check tables with trigger="message" (low chance, e.g., 0.05)

// 3. Location change (src/scene/index.ts → moveToLocation or equivalent)
//    Check tables with trigger="location_enter"

// 4. Manual roll: /event random [table_name]
//    Force-roll from a specific table
```

### Config Integration

```typescript
// Add to TimeConfig:
interface TimeConfig {
  // ... existing ...
  useRandomEvents: boolean;        // Master toggle
  randomEventCheckOnMessage: boolean; // Check on each message (can be noisy)
}

// Add feature flag:
features.randomEvents = (config) => config.time.enabled && config.time.useRandomEvents;
```

### Commands

```
/event random [table]          -- Force-roll from a random event table
/event table list              -- List all event tables for this world
/event table create <name> <trigger> <chance>
/event table entry add <table> <content> [weight] [type]
/event table entry list <table>
/event table enable/disable <table>
```

**Files to create/modify:**
- New `src/events/random.ts` - Random event engine (condition checking, weighted selection, cooldowns)
- `src/db/schema.ts` - Add tables
- `src/config/types.ts` - Add `useRandomEvents`, `randomEventCheckOnMessage` to `TimeConfig`
- `src/config/defaults.ts` - Defaults (both false)
- `src/world/time.ts` - Hook into `advanceSceneTime` and `checkTriggeredEvents`
- `src/bot/commands/time.ts` - Add `/event random`, `/event table` subcommands
- `src/bot/events/message.ts` - Optional per-message random event check

---

## Feature: Real-Time Sync

Support syncing game time with real-world time. Three aspects:

### A. IRL Time Tracking

Store real-world timestamps on scenes and messages to enable time-gap awareness.

```typescript
// Scene already has lastActiveAt (unix timestamp)
// On each message, update lastActiveAt
// On next message, compute gap:

function getTimeSinceLastActivity(scene: Scene): {
  realSeconds: number;
  realMinutes: number;
  realHours: number;
  realDays: number;
  formatted: string; // "3 hours ago" / "2 days ago"
} {
  const now = Math.floor(Date.now() / 1000);
  const gap = now - scene.lastActiveAt;
  // ...
}
```

### B. Auto Time Advancement (Realtime Mode)

When `time.mode === "realtime"`, game time advances proportionally to real time.

```typescript
// In message handler, before assembling context:
function syncRealtimeIfNeeded(scene: Scene, config: WorldConfig): void {
  if (config.time.mode !== "realtime") return;

  const now = Math.floor(Date.now() / 1000);
  const realSeconds = now - scene.lastActiveAt;
  const realHours = realSeconds / 3600;
  const gameHours = realHours * config.time.realtimeRatio;

  if (gameHours >= 0.0167) { // At least 1 game-minute passed
    advanceSceneTime(scene.channelId, { hours: Math.floor(gameHours), minutes: Math.floor((gameHours % 1) * 60) });
  }
}
```

Config already has `time.realtimeRatio` (game hours per real hour). Default 1 = 1:1.

### C. Time-Skip Narration

When the user returns after absence, optionally narrate what happened during the gap.

```typescript
interface TimeConfig {
  // ... existing ...
  useRealtimeSync: boolean;         // Auto-advance on activity gap
  narrateTimeSkips: boolean;        // LLM narrates what happened during absence
  timeSkipNarrationThreshold: number; // Real minutes before narrating (e.g., 60 = narrate if >1hr gap)
}

// On message after gap:
async function narrateTimeSkip(
  scene: Scene,
  gameTimeAdvanced: { hours: number; minutes: number; days: number },
  config: WorldConfig
): Promise<string | null> {
  if (!config.time.narrateTimeSkips) return null;

  const totalMinutes = (gameTimeAdvanced.days * 24 * 60) + (gameTimeAdvanced.hours * 60) + gameTimeAdvanced.minutes;
  if (totalMinutes < config.time.timeSkipNarrationThreshold) return null;

  // Ask LLM to summarize what happened during the gap
  const prompt = buildTimeSkipPrompt(scene, gameTimeAdvanced);
  const narration = await generateText({ model, system: prompt, messages: [] });
  return narration.text;
}
```

**Files to modify:**
- `src/config/types.ts` - Add `useRealtimeSync`, `narrateTimeSkips`, `timeSkipNarrationThreshold`
- `src/config/defaults.ts` - Defaults: all false/60
- `src/bot/events/message.ts` - Call `syncRealtimeIfNeeded` before context assembly
- `src/world/time.ts` - Add `syncRealtimeIfNeeded`, `narrateTimeSkip` helpers
- `src/scene/index.ts` - Ensure `lastActiveAt` is updated on every message

---

## Feature: Inter-Message Timestamps

Optionally inject timestamps between messages in the AI context window, so the AI can reason about time gaps between messages (e.g., "the player was silent for 3 hours").

### Design

```typescript
interface ContextConfig {
  // ... existing ...
  showTimestamps: boolean;          // Inject timestamps between messages
  timestampFormat: "relative" | "absolute" | "both";
  timestampThreshold: number;       // Only show if gap > N seconds (default 300 = 5 min)
}
```

### Context Assembly

```typescript
// In src/ai/context.ts, when formatting messages:
function formatMessagesWithTimestamps(
  messages: Message[],
  config: ContextConfig
): Message[] {
  if (!config.showTimestamps) return messages;

  const result: Message[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const prev = i > 0 ? messages[i - 1] : null;

    if (prev && msg.timestamp && prev.timestamp) {
      const gapSeconds = (msg.timestamp - prev.timestamp) / 1000;
      if (gapSeconds >= config.timestampThreshold) {
        // Inject a system message noting the time gap
        const gapText = formatTimeGap(gapSeconds); // "5 minutes later" / "3 hours later" / "2 days later"
        result.push({
          role: "system",
          content: `[${gapText}]`,
        });
      }
    }

    result.push(msg);
  }
  return result;
}

function formatTimeGap(seconds: number): string {
  if (seconds < 120) return `${Math.round(seconds)} seconds later`;
  if (seconds < 7200) return `${Math.round(seconds / 60)} minutes later`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} hours later`;
  return `${Math.round(seconds / 86400)} days later`;
}
```

The `timestamp` field already exists on `Message` in `src/ai/context.ts` and is set to `Date.now()` in the message handler.

**Files to modify:**
- `src/config/types.ts` - Add `showTimestamps`, `timestampFormat`, `timestampThreshold` to `ContextConfig`
- `src/config/defaults.ts` - Defaults: `showTimestamps: false`, `timestampThreshold: 300`
- `src/ai/context.ts` - Add `formatMessagesWithTimestamps`, apply during context assembly

---

## Summary: Implementation Order

Recommended order based on dependencies:

1. **Inter-message timestamps** - Small, self-contained, high value for AI reasoning
2. **Config-aware item wizard** - Refactor wizard flow to be dynamic, config-gated
3. **Message handler integration** - The critical glue: proxy interception, scene context, multi-char routing
4. **Real-time sync** - Builds on message handler (time gap detection on each message)
5. **Random events** - New tables + engine, hooks into time advancement + message handler
6. **Proxy webhook execution** - Webhook lifecycle management
7. **State extraction layer** - LLM-based extraction of state changes from responses
8. **Testing** - Unit tests for all parsers and math-heavy code
