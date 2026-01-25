import { getDb } from "../db";
import type { Scene } from "../scene";
import type { EventEffects } from "./random";
import { evaluateConditions, type EventConditions } from "./conditions";
import { getWorldConfig } from "../config";

// === Types ===

export interface BehaviorTrack {
  id: number;
  worldId: number | null;
  characterId: number;
  name: string;
  description: string | null;
  createdAt: number;
}

export interface BehaviorState {
  id: number;
  trackId: number;
  name: string;
  description: string | null;
  minDurationMinutes: number | null;
  maxDurationMinutes: number | null;
  conditions: EventConditions | null;
  createdAt: number;
}

export interface BehaviorTransition {
  id: number;
  fromStateId: number;
  toStateId: number;
  weight: number;
  narration: string;
  conditions: EventConditions | null;
  effects: EventEffects | null;
  createdAt: number;
}

export interface CharacterBehavior {
  characterId: number;
  trackId: number;
  currentStateId: number | null;
  stateEnteredAt: number;
  gameTimeEntered: number;
}

export interface BehaviorTransitionResult {
  characterId: number;
  trackName: string;
  fromState: BehaviorState;
  toState: BehaviorState;
  transition: BehaviorTransition;
}

// === Row types ===

interface TrackRow {
  id: number;
  world_id: number | null;
  character_id: number;
  name: string;
  description: string | null;
  created_at: number;
}

interface StateRow {
  id: number;
  track_id: number;
  name: string;
  description: string | null;
  min_duration_minutes: number | null;
  max_duration_minutes: number | null;
  conditions: string | null;
  created_at: number;
}

interface TransitionRow {
  id: number;
  from_state_id: number;
  to_state_id: number;
  weight: number;
  narration: string;
  conditions: string | null;
  effects: string | null;
  created_at: number;
}

interface BehaviorRow {
  character_id: number;
  track_id: number;
  current_state_id: number | null;
  state_entered_at: number;
  game_time_entered: number;
}

function mapTrack(row: TrackRow): BehaviorTrack {
  return {
    id: row.id,
    worldId: row.world_id,
    characterId: row.character_id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
  };
}

function mapState(row: StateRow): BehaviorState {
  return {
    id: row.id,
    trackId: row.track_id,
    name: row.name,
    description: row.description,
    minDurationMinutes: row.min_duration_minutes,
    maxDurationMinutes: row.max_duration_minutes,
    conditions: row.conditions ? JSON.parse(row.conditions) : null,
    createdAt: row.created_at,
  };
}

function mapTransition(row: TransitionRow): BehaviorTransition {
  return {
    id: row.id,
    fromStateId: row.from_state_id,
    toStateId: row.to_state_id,
    weight: row.weight,
    narration: row.narration,
    conditions: row.conditions ? JSON.parse(row.conditions) : null,
    effects: row.effects ? JSON.parse(row.effects) : null,
    createdAt: row.created_at,
  };
}

// === CRUD ===

/** Create a behavior track for a character */
export function createTrack(
  characterId: number,
  name: string,
  options?: { worldId?: number; description?: string }
): BehaviorTrack {
  const db = getDb();
  const row = db.prepare(`
    INSERT INTO behavior_tracks (world_id, character_id, name, description)
    VALUES (?, ?, ?, ?)
    RETURNING *
  `).get(
    options?.worldId ?? null,
    characterId,
    name,
    options?.description ?? null
  ) as TrackRow;
  return mapTrack(row);
}

/** Get all tracks for a character */
export function getCharacterTracks(characterId: number): BehaviorTrack[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM behavior_tracks WHERE character_id = ? ORDER BY name"
  ).all(characterId) as TrackRow[];
  return rows.map(mapTrack);
}

/** Create a state within a track */
export function createState(
  trackId: number,
  name: string,
  options?: {
    description?: string;
    minDurationMinutes?: number;
    maxDurationMinutes?: number;
    conditions?: EventConditions;
  }
): BehaviorState {
  const db = getDb();
  const row = db.prepare(`
    INSERT INTO behavior_states (track_id, name, description, min_duration_minutes, max_duration_minutes, conditions)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    trackId,
    name,
    options?.description ?? null,
    options?.minDurationMinutes ?? null,
    options?.maxDurationMinutes ?? null,
    options?.conditions ? JSON.stringify(options.conditions) : null
  ) as StateRow;
  return mapState(row);
}

/** Get all states in a track */
export function getTrackStates(trackId: number): BehaviorState[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM behavior_states WHERE track_id = ? ORDER BY name"
  ).all(trackId) as StateRow[];
  return rows.map(mapState);
}

/** Get a state by ID */
export function getState(id: number): BehaviorState | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM behavior_states WHERE id = ?").get(id) as StateRow | null;
  return row ? mapState(row) : null;
}

/** Add a transition between states */
export function createTransition(
  fromStateId: number,
  toStateId: number,
  narration: string,
  options?: {
    weight?: number;
    conditions?: EventConditions;
    effects?: EventEffects;
  }
): BehaviorTransition {
  const db = getDb();
  const row = db.prepare(`
    INSERT INTO behavior_transitions (from_state_id, to_state_id, weight, narration, conditions, effects)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    fromStateId,
    toStateId,
    options?.weight ?? 1,
    narration,
    options?.conditions ? JSON.stringify(options.conditions) : null,
    options?.effects ? JSON.stringify(options.effects) : null
  ) as TransitionRow;
  return mapTransition(row);
}

/** Get transitions from a state */
export function getTransitionsFrom(stateId: number): BehaviorTransition[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM behavior_transitions WHERE from_state_id = ?"
  ).all(stateId) as TransitionRow[];
  return rows.map(mapTransition);
}

/** Initialize a character's track to a starting state */
export function initBehavior(
  characterId: number,
  trackId: number,
  stateId: number,
  gameTimeMinutes = 0
): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO character_behaviors (character_id, track_id, current_state_id, state_entered_at, game_time_entered)
    VALUES (?, ?, ?, unixepoch(), ?)
  `).run(characterId, trackId, stateId, gameTimeMinutes);
}

/** Get current behaviors for a character (all tracks) */
export function getCharacterBehaviors(characterId: number): CharacterBehavior[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM character_behaviors WHERE character_id = ?"
  ).all(characterId) as BehaviorRow[];

  return rows.map((row) => ({
    characterId: row.character_id,
    trackId: row.track_id,
    currentStateId: row.current_state_id,
    stateEnteredAt: row.state_entered_at,
    gameTimeEntered: row.game_time_entered,
  }));
}

// === State Machine Engine ===

/**
 * Tick all behavior state machines for characters in a scene.
 * Each character can have multiple independent tracks (mood, activity, energy, etc.)
 * running at different timescales.
 */
export function tickBehaviors(scene: Scene): BehaviorTransitionResult[] {
  const db = getDb();
  const results: BehaviorTransitionResult[] = [];
  const now = Math.floor(Date.now() / 1000);

  const worldConfig = getWorldConfig(scene.worldId);
  const calendar = worldConfig.time.useCalendar ? worldConfig.time.calendar : undefined;

  // Get all behavior entries for characters present in this scene
  const behaviors = db.prepare(`
    SELECT cb.character_id, cb.track_id, cb.current_state_id, cb.state_entered_at, cb.game_time_entered
    FROM character_behaviors cb
    JOIN scene_characters sc ON sc.character_id = cb.character_id
    WHERE sc.scene_id = ? AND sc.is_present = 1 AND cb.current_state_id IS NOT NULL
  `).all(scene.id) as BehaviorRow[];

  for (const behavior of behaviors) {
    if (!behavior.current_state_id) continue;

    const currentState = getState(behavior.current_state_id);
    if (!currentState) continue;

    // Get track info for the result
    const track = db.prepare("SELECT * FROM behavior_tracks WHERE id = ?").get(behavior.track_id) as TrackRow | null;
    if (!track) continue;

    // Check if minimum duration has elapsed (real minutes)
    const elapsedMinutes = (now - behavior.state_entered_at) / 60;

    if (currentState.minDurationMinutes && elapsedMinutes < currentState.minDurationMinutes) {
      continue;
    }

    // Past max duration forces transition
    const pastMax = currentState.maxDurationMinutes
      ? elapsedMinutes >= currentState.maxDurationMinutes
      : false;

    // Get possible transitions
    const transitions = getTransitionsFrom(currentState.id);
    if (transitions.length === 0) continue;

    // Filter by conditions
    const validTransitions = transitions.filter((t) => {
      if (!t.conditions) return true;
      return evaluateConditions(t.conditions, scene, worldConfig, calendar);
    });

    if (validTransitions.length === 0) continue;

    // If not past max duration, apply probability
    if (!pastMax) {
      let chance = 0.3;
      if (currentState.maxDurationMinutes) {
        const progress = elapsedMinutes / currentState.maxDurationMinutes;
        chance = Math.min(0.9, 0.1 + progress * 0.8);
      }
      if (Math.random() > chance) continue;
    }

    // Weighted random selection
    const totalWeight = validTransitions.reduce((sum, t) => sum + t.weight, 0);
    let roll = Math.random() * totalWeight;
    let selected = validTransitions[0];

    for (const t of validTransitions) {
      roll -= t.weight;
      if (roll <= 0) {
        selected = t;
        break;
      }
    }

    const toState = getState(selected.toStateId);
    if (!toState) continue;

    // Execute transition
    const gameTimeMinutes = scene.time.day * 24 * 60 + scene.time.hour * 60 + scene.time.minute;
    db.prepare(`
      UPDATE character_behaviors
      SET current_state_id = ?, state_entered_at = unixepoch(), game_time_entered = ?
      WHERE character_id = ? AND track_id = ?
    `).run(toState.id, gameTimeMinutes, behavior.character_id, behavior.track_id);

    results.push({
      characterId: behavior.character_id,
      trackName: track.name,
      fromState: currentState,
      toState,
      transition: selected,
    });
  }

  return results;
}

