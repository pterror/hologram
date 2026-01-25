import { getDb } from "../db";
import type { Scene } from "../scene";
import { getSceneCharacters } from "../scene";
import { getTimePeriod, getSeason, type CalendarConfig } from "../world/time";
import type { WorldConfig } from "../config/types";

export interface EventConditions {
  timeOfDay?: string[];      // ["night", "evening"] - time period names
  season?: string[];         // ["winter", "spring"]
  location?: number[];       // Location entity IDs
  weather?: string[];        // ["rain", "storm"]
  minCharacters?: number;    // Min characters present in scene
  hasEffect?: string[];      // At least one character has these effect names
  notEffect?: string[];      // No character has these effect names
}

/** Evaluate whether conditions are met for the current scene */
export function evaluateConditions(
  conditions: EventConditions,
  scene: Scene,
  config: WorldConfig | { time: { periods: Array<{ name: string; startHour: number; lightLevel?: string }> } },
  calendar?: CalendarConfig
): boolean {
  // Time of day check
  if (conditions.timeOfDay && conditions.timeOfDay.length > 0) {
    const period = getTimePeriod(scene.time.hour, config.time.periods);
    if (!conditions.timeOfDay.includes(period.name)) {
      return false;
    }
  }

  // Season check
  if (conditions.season && conditions.season.length > 0 && calendar) {
    const season = getSeason(scene.time.day, calendar);
    if (!season || !conditions.season.includes(season.toLowerCase())) {
      return false;
    }
  }

  // Location check
  if (conditions.location && conditions.location.length > 0) {
    if (!scene.locationId || !conditions.location.includes(scene.locationId)) {
      return false;
    }
  }

  // Weather check
  if (conditions.weather && conditions.weather.length > 0) {
    if (!scene.weather || !conditions.weather.includes(scene.weather.toLowerCase())) {
      return false;
    }
  }

  // Min characters check
  if (conditions.minCharacters && conditions.minCharacters > 0) {
    const chars = getSceneCharacters(scene.id);
    if (chars.length < conditions.minCharacters) {
      return false;
    }
  }

  // Effect checks require querying character_effects
  if (conditions.hasEffect && conditions.hasEffect.length > 0) {
    if (!hasAnyEffect(scene.id, conditions.hasEffect)) {
      return false;
    }
  }

  if (conditions.notEffect && conditions.notEffect.length > 0) {
    if (hasAnyEffect(scene.id, conditions.notEffect)) {
      return false;
    }
  }

  return true;
}

/** Check if any character in the scene has any of the named effects */
function hasAnyEffect(sceneId: number, effectNames: string[]): boolean {
  const db = getDb();
  const placeholders = effectNames.map(() => "?").join(",");
  const row = db.prepare(`
    SELECT COUNT(*) as count
    FROM character_effects
    WHERE scene_id = ? AND name IN (${placeholders})
  `).get(sceneId, ...effectNames) as { count: number };

  return row.count > 0;
}
