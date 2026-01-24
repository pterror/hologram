import { getDb } from "../db";
import { getEntity, type LocationData } from "../db/entities";
import type { WorldConfig } from "../config";
import { DEFAULT_CONFIG, mergeConfig } from "../config";

// Scene status lifecycle
export type SceneStatus = "active" | "paused" | "ended";

export interface TimeState {
  day: number;
  hour: number;
  minute: number;
}

export interface Scene {
  id: number;
  worldId: number;
  channelId: string;
  locationId: number | null;
  time: TimeState;
  weather: string | null;
  ambience: string | null;
  status: SceneStatus;
  config: Partial<WorldConfig> | null;
  createdAt: number;
  lastActiveAt: number;
  endedAt: number | null;
}

export interface SceneCharacter {
  sceneId: number;
  characterId: number;
  isAI: boolean;
  isActive: boolean;  // AI is voicing this character
  isPresent: boolean; // Character is in the scene
  playerId: string | null;
  joinedAt: number;
}

// In-memory cache of active scenes per channel
const channelScenes = new Map<string, Scene>();

/** Create a new scene */
export function createScene(
  worldId: number,
  channelId: string,
  options?: {
    locationId?: number;
    time?: TimeState;
    weather?: string;
    ambience?: string;
    config?: Partial<WorldConfig>;
  }
): Scene {
  const db = getDb();

  const time = options?.time ?? { day: 1, hour: 8, minute: 0 };

  const stmt = db.prepare(`
    INSERT INTO scenes (world_id, channel_id, location_id, time_day, time_hour, time_minute, weather, ambience, config)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id, created_at, last_active_at
  `);

  const row = stmt.get(
    worldId,
    channelId,
    options?.locationId ?? null,
    time.day,
    time.hour,
    time.minute,
    options?.weather ?? null,
    options?.ambience ?? null,
    options?.config ? JSON.stringify(options.config) : null
  ) as { id: number; created_at: number; last_active_at: number };

  const scene: Scene = {
    id: row.id,
    worldId,
    channelId,
    locationId: options?.locationId ?? null,
    time,
    weather: options?.weather ?? null,
    ambience: options?.ambience ?? null,
    status: "active",
    config: options?.config ?? null,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    endedAt: null,
  };

  channelScenes.set(channelId, scene);
  return scene;
}

/** Get scene by ID from database */
export function getSceneById(id: number): Scene | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, world_id, channel_id, location_id, time_day, time_hour, time_minute,
           weather, ambience, status, config, created_at, last_active_at, ended_at
    FROM scenes WHERE id = ?
  `);

  const row = stmt.get(id) as {
    id: number;
    world_id: number;
    channel_id: string;
    location_id: number | null;
    time_day: number;
    time_hour: number;
    time_minute: number;
    weather: string | null;
    ambience: string | null;
    status: string;
    config: string | null;
    created_at: number;
    last_active_at: number;
    ended_at: number | null;
  } | null;

  if (!row) return null;

  return {
    id: row.id,
    worldId: row.world_id,
    channelId: row.channel_id,
    locationId: row.location_id,
    time: {
      day: row.time_day,
      hour: row.time_hour,
      minute: row.time_minute,
    },
    weather: row.weather,
    ambience: row.ambience,
    status: row.status as SceneStatus,
    config: row.config ? JSON.parse(row.config) : null,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    endedAt: row.ended_at,
  };
}

/** Get active scene for a channel (from cache or DB) */
export function getActiveScene(channelId: string): Scene | null {
  // Check cache first
  const cached = channelScenes.get(channelId);
  if (cached && cached.status === "active") {
    return cached;
  }

  // Check database
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, world_id, channel_id, location_id, time_day, time_hour, time_minute,
           weather, ambience, status, config, created_at, last_active_at, ended_at
    FROM scenes
    WHERE channel_id = ? AND status = 'active'
    ORDER BY last_active_at DESC
    LIMIT 1
  `);

  const row = stmt.get(channelId) as {
    id: number;
    world_id: number;
    channel_id: string;
    location_id: number | null;
    time_day: number;
    time_hour: number;
    time_minute: number;
    weather: string | null;
    ambience: string | null;
    status: string;
    config: string | null;
    created_at: number;
    last_active_at: number;
    ended_at: number | null;
  } | null;

  if (!row) return null;

  const scene: Scene = {
    id: row.id,
    worldId: row.world_id,
    channelId: row.channel_id,
    locationId: row.location_id,
    time: {
      day: row.time_day,
      hour: row.time_hour,
      minute: row.time_minute,
    },
    weather: row.weather,
    ambience: row.ambience,
    status: row.status as SceneStatus,
    config: row.config ? JSON.parse(row.config) : null,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    endedAt: row.ended_at,
  };

  // Cache it
  channelScenes.set(channelId, scene);
  return scene;
}

/** List paused scenes for a channel */
export function listPausedScenes(channelId: string): Scene[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, world_id, channel_id, location_id, time_day, time_hour, time_minute,
           weather, ambience, status, config, created_at, last_active_at, ended_at
    FROM scenes
    WHERE channel_id = ? AND status = 'paused'
    ORDER BY last_active_at DESC
  `);

  const rows = stmt.all(channelId) as Array<{
    id: number;
    world_id: number;
    channel_id: string;
    location_id: number | null;
    time_day: number;
    time_hour: number;
    time_minute: number;
    weather: string | null;
    ambience: string | null;
    status: string;
    config: string | null;
    created_at: number;
    last_active_at: number;
    ended_at: number | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    worldId: row.world_id,
    channelId: row.channel_id,
    locationId: row.location_id,
    time: {
      day: row.time_day,
      hour: row.time_hour,
      minute: row.time_minute,
    },
    weather: row.weather,
    ambience: row.ambience,
    status: row.status as SceneStatus,
    config: row.config ? JSON.parse(row.config) : null,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    endedAt: row.ended_at,
  }));
}

/** Update scene in database and cache */
export function updateScene(scene: Scene): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE scenes SET
      location_id = ?,
      time_day = ?,
      time_hour = ?,
      time_minute = ?,
      weather = ?,
      ambience = ?,
      status = ?,
      config = ?,
      last_active_at = unixepoch(),
      ended_at = ?
    WHERE id = ?
  `);

  stmt.run(
    scene.locationId,
    scene.time.day,
    scene.time.hour,
    scene.time.minute,
    scene.weather,
    scene.ambience,
    scene.status,
    scene.config ? JSON.stringify(scene.config) : null,
    scene.endedAt,
    scene.id
  );

  // Update cache
  if (scene.status === "active") {
    channelScenes.set(scene.channelId, scene);
  } else {
    channelScenes.delete(scene.channelId);
  }
}

/** Pause the current scene */
export function pauseScene(channelId: string): Scene | null {
  const scene = getActiveScene(channelId);
  if (!scene) return null;

  scene.status = "paused";
  updateScene(scene);
  return scene;
}

/** Resume a paused scene */
export function resumeScene(sceneId: number): Scene | null {
  const scene = getSceneById(sceneId);
  if (!scene || scene.status !== "paused") return null;

  // Pause any active scene in this channel first
  const activeScene = getActiveScene(scene.channelId);
  if (activeScene) {
    pauseScene(scene.channelId);
  }

  scene.status = "active";
  updateScene(scene);
  return scene;
}

/** End a scene permanently */
export function endScene(channelId: string): Scene | null {
  const scene = getActiveScene(channelId);
  if (!scene) return null;

  scene.status = "ended";
  scene.endedAt = Math.floor(Date.now() / 1000);
  updateScene(scene);
  return scene;
}

// Scene character management

/** Add a character to a scene */
export function addCharacterToScene(
  sceneId: number,
  characterId: number,
  options?: {
    isAI?: boolean;
    isActive?: boolean;
    playerId?: string;
  }
): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO scene_characters (scene_id, character_id, is_ai, is_active, is_present, player_id)
    VALUES (?, ?, ?, ?, 1, ?)
  `);

  stmt.run(
    sceneId,
    characterId,
    options?.isAI ?? true ? 1 : 0,
    options?.isActive ?? false ? 1 : 0,
    options?.playerId ?? null
  );
}

/** Remove a character from a scene */
export function removeCharacterFromScene(
  sceneId: number,
  characterId: number
): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE scene_characters SET is_present = 0
    WHERE scene_id = ? AND character_id = ?
  `);
  stmt.run(sceneId, characterId);
}

/** Set which AI character(s) are being actively voiced */
export function setActiveCharacter(
  sceneId: number,
  characterId: number,
  active: boolean
): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE scene_characters SET is_active = ?
    WHERE scene_id = ? AND character_id = ?
  `);
  stmt.run(active ? 1 : 0, sceneId, characterId);
}

/** Get all characters in a scene */
export function getSceneCharacters(sceneId: number): SceneCharacter[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT scene_id, character_id, is_ai, is_active, is_present, player_id, joined_at
    FROM scene_characters
    WHERE scene_id = ? AND is_present = 1
  `);

  const rows = stmt.all(sceneId) as Array<{
    scene_id: number;
    character_id: number;
    is_ai: number;
    is_active: number;
    is_present: number;
    player_id: string | null;
    joined_at: number;
  }>;

  return rows.map((row) => ({
    sceneId: row.scene_id,
    characterId: row.character_id,
    isAI: row.is_ai === 1,
    isActive: row.is_active === 1,
    isPresent: row.is_present === 1,
    playerId: row.player_id,
    joinedAt: row.joined_at,
  }));
}

/** Get active (being voiced) AI characters in a scene */
export function getActiveCharacters(sceneId: number): SceneCharacter[] {
  return getSceneCharacters(sceneId).filter((c) => c.isAI && c.isActive);
}

// Time management

/** Advance time in a scene */
export function advanceSceneTime(scene: Scene, minutes: number): Scene {
  scene.time.minute += minutes;

  while (scene.time.minute >= 60) {
    scene.time.minute -= 60;
    scene.time.hour += 1;
  }
  while (scene.time.hour >= 24) {
    scene.time.hour -= 24;
    scene.time.day += 1;
  }

  updateScene(scene);
  return scene;
}

/** Get time period (morning, afternoon, etc.) */
export function getTimePeriod(hour: number): string {
  if (hour >= 5 && hour < 7) return "dawn";
  if (hour >= 7 && hour < 12) return "morning";
  if (hour >= 12 && hour < 14) return "noon";
  if (hour >= 14 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

/** Format time for display */
export function formatTime(time: TimeState): string {
  const period = getTimePeriod(time.hour);
  const hourDisplay = time.hour % 12 || 12;
  const ampm = time.hour < 12 ? "AM" : "PM";
  return `Day ${time.day}, ${hourDisplay}:${time.minute.toString().padStart(2, "0")} ${ampm} (${period})`;
}

// Context formatting

/** Get effective config for a scene (scene overrides + world defaults) */
export function getSceneConfig(scene: Scene, worldConfig?: WorldConfig): WorldConfig {
  const base = worldConfig ?? DEFAULT_CONFIG;
  return mergeConfig(scene.config, base);
}

/** Format scene for context assembly */
export function formatSceneForContext(scene: Scene): string {
  const lines: string[] = [];

  lines.push(`## Scene`);
  lines.push(`**Time:** ${formatTime(scene.time)}`);

  if (scene.weather) {
    lines.push(`**Weather:** ${scene.weather}`);
  }

  if (scene.locationId) {
    const location = getEntity<LocationData>(scene.locationId);
    if (location) {
      lines.push(`\n### Location: ${location.name}`);
      lines.push(location.data.description);
    }
  }

  if (scene.ambience) {
    lines.push(`\n*${scene.ambience}*`);
  }

  return lines.join("\n");
}
