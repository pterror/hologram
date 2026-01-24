import { getDb } from "../db";
import { getEntity, type LocationData } from "../db/entities";

export interface TimeState {
  day: number;
  hour: number; // 0-23
  minute: number; // 0-59
}

export interface WorldState {
  id: number;
  name: string;
  description: string | null;
  time: TimeState;
  weather: string | null;
  currentLocationId: number | null;
  activeCharacterIds: number[];
  custom: Record<string, unknown>;
}

// In-memory cache of active world states per channel
const channelWorldStates = new Map<string, WorldState>();

export function getTimePeriod(hour: number): string {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

export function formatTime(time: TimeState): string {
  const period = getTimePeriod(time.hour);
  const hourDisplay = time.hour % 12 || 12;
  const ampm = time.hour < 12 ? "AM" : "PM";
  return `Day ${time.day}, ${hourDisplay}:${time.minute.toString().padStart(2, "0")} ${ampm} (${period})`;
}

export function createWorld(
  name: string,
  description?: string,
  data?: Record<string, unknown>
): { id: number; name: string } {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO worlds (name, description, data)
    VALUES (?, ?, ?)
    RETURNING id, name
  `);
  return stmt.get(name, description ?? null, JSON.stringify(data ?? {})) as {
    id: number;
    name: string;
  };
}

export function getWorld(id: number): {
  id: number;
  name: string;
  description: string | null;
  data: Record<string, unknown>;
} | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, name, description, data FROM worlds WHERE id = ?
  `);
  const row = stmt.get(id) as {
    id: number;
    name: string;
    description: string | null;
    data: string;
  } | null;
  if (!row) return null;
  return {
    ...row,
    data: JSON.parse(row.data),
  };
}

export function linkGuildToWorld(
  guildId: string,
  worldId: number,
  role?: string,
  data?: Record<string, unknown>
): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO guild_worlds (guild_id, world_id, role, data)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(guildId, worldId, role ?? null, JSON.stringify(data ?? {}));
}

export function getWorldForGuild(guildId: string): number | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT world_id FROM guild_worlds WHERE guild_id = ? LIMIT 1
  `);
  const row = stmt.get(guildId) as { world_id: number } | null;
  return row?.world_id ?? null;
}

// Session state management (in-memory, keyed by channel)
export function getWorldState(channelId: string): WorldState | null {
  return channelWorldStates.get(channelId) ?? null;
}

export function setWorldState(channelId: string, state: WorldState): void {
  channelWorldStates.set(channelId, state);
}

export function initWorldState(
  channelId: string,
  worldId: number
): WorldState | null {
  const world = getWorld(worldId);
  if (!world) return null;

  const state: WorldState = {
    id: worldId,
    name: world.name,
    description: world.description,
    time: { day: 1, hour: 8, minute: 0 },
    weather: null,
    currentLocationId: null,
    activeCharacterIds: [],
    custom: world.data,
  };

  channelWorldStates.set(channelId, state);
  return state;
}

export function advanceTime(
  channelId: string,
  minutes: number
): WorldState | null {
  const state = channelWorldStates.get(channelId);
  if (!state) return null;

  state.time.minute += minutes;
  while (state.time.minute >= 60) {
    state.time.minute -= 60;
    state.time.hour += 1;
  }
  while (state.time.hour >= 24) {
    state.time.hour -= 24;
    state.time.day += 1;
  }

  return state;
}

export function setLocation(
  channelId: string,
  locationId: number
): WorldState | null {
  const state = channelWorldStates.get(channelId);
  if (!state) return null;

  const location = getEntity<LocationData>(locationId);
  if (!location || location.type !== "location") return null;

  state.currentLocationId = locationId;
  return state;
}

export function setWeather(
  channelId: string,
  weather: string | null
): WorldState | null {
  const state = channelWorldStates.get(channelId);
  if (!state) return null;

  state.weather = weather;
  return state;
}

export function addActiveCharacter(
  channelId: string,
  characterId: number
): WorldState | null {
  const state = channelWorldStates.get(channelId);
  if (!state) return null;

  if (!state.activeCharacterIds.includes(characterId)) {
    state.activeCharacterIds.push(characterId);
  }
  return state;
}

export function removeActiveCharacter(
  channelId: string,
  characterId: number
): WorldState | null {
  const state = channelWorldStates.get(channelId);
  if (!state) return null;

  state.activeCharacterIds = state.activeCharacterIds.filter(
    (id) => id !== characterId
  );
  return state;
}

export function formatWorldStateForContext(state: WorldState): string {
  const lines: string[] = [];

  lines.push(`## World: ${state.name}`);
  if (state.description) {
    lines.push(state.description);
  }

  lines.push(`\n### Current Time`);
  lines.push(formatTime(state.time));

  if (state.weather) {
    lines.push(`\n### Weather`);
    lines.push(state.weather);
  }

  if (state.currentLocationId) {
    const location = getEntity<LocationData>(state.currentLocationId);
    if (location) {
      lines.push(`\n### Location: ${location.name}`);
      lines.push(location.data.description);
    }
  }

  return lines.join("\n");
}
