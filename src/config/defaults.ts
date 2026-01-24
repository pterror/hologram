import type {
  WorldConfig,
  PartialWorldConfig,
  ChronicleConfig,
  SceneConfig,
  InventoryConfig,
  LocationConfig,
  TimeConfig,
  CharacterStateConfig,
  DiceConfig,
  RelationshipConfig,
  ContextConfig,
} from "./types";
import { getDb } from "../db";

// === Default Configurations ===

export const DEFAULT_CHRONICLE: ChronicleConfig = {
  enabled: true,
  autoExtract: true,
  extractImportance: 6,
  periodicSummary: true,
  summaryInterval: 20,
  explicitMarkers: true,
  perspectiveAware: true,
};

export const DEFAULT_SCENES: SceneConfig = {
  enabled: true,
  autoPause: true,
  pauseAfterMinutes: 60,
  boundaries: {
    onLocationChange: "continue",
    onTimeSkip: "continue",
    timeSkipThreshold: 8,
  },
};

export const DEFAULT_INVENTORY: InventoryConfig = {
  enabled: true,
  useCapacity: false,
  useEquipment: false,
  equipmentSlots: ["mainhand", "offhand", "head", "body", "hands", "feet", "accessory"],
  useDurability: false,
};

export const DEFAULT_LOCATIONS: LocationConfig = {
  enabled: true,
  useRegions: false,
  useZones: false,
  useConnections: true,
  connectionTypes: ["path", "door", "portal", "hidden"],
  trackProperties: false,
  properties: ["indoor", "outdoor", "safe", "dangerous", "dark", "bright"],
  useTravelTime: false,
  defaultTravelTime: 30,
};

export const DEFAULT_TIME: TimeConfig = {
  enabled: true,
  mode: "narrative",
  realtimeRatio: 1,
  useCalendar: false,
  useDayNight: true,
  periods: [
    { name: "dawn", startHour: 5, lightLevel: "dim" },
    { name: "morning", startHour: 7, lightLevel: "bright" },
    { name: "noon", startHour: 11, lightLevel: "bright" },
    { name: "afternoon", startHour: 14, lightLevel: "bright" },
    { name: "evening", startHour: 17, lightLevel: "dim" },
    { name: "night", startHour: 21, lightLevel: "dark" },
  ],
  useScheduledEvents: false,
};

export const DEFAULT_CHARACTER_STATE: CharacterStateConfig = {
  enabled: false,
  useAttributes: false,
  attributes: ["health", "mana", "stamina"],
  attributeRanges: {
    health: [0, 100],
    mana: [0, 100],
    stamina: [0, 100],
  },
  useForms: false,
  bodySchema: ["species", "height", "build", "hair", "eyes", "skin"],
  useEffects: false,
  effectTypes: ["buff", "debuff", "curse", "blessing", "transformation"],
};

export const DEFAULT_DICE: DiceConfig = {
  enabled: false,
  syntax: "standard",
  useCombat: false,
  turnOrder: "initiative",
  useHP: false,
  useAC: false,
};

export const DEFAULT_RELATIONSHIPS: RelationshipConfig = {
  enabled: true,
  useAffinity: false,
  affinityRange: [-100, 100],
  affinityLabels: {
    "-100": "Hatred",
    "-50": "Dislike",
    "0": "Neutral",
    "50": "Friendly",
    "100": "Love",
  },
  useFactions: false,
  relationshipTypes: ["knows", "friend", "enemy", "family", "romantic", "rival"],
};

export const DEFAULT_CONTEXT: ContextConfig = {
  maxTokens: 8000,
  historyMessages: 20,
  ragResults: 10,
  includeWorldLore: true,
  includeWorldRules: true,
  dynamicPriority: true,
};

export const DEFAULT_CONFIG: WorldConfig = {
  multiCharMode: "auto",
  chronicle: DEFAULT_CHRONICLE,
  scenes: DEFAULT_SCENES,
  inventory: DEFAULT_INVENTORY,
  locations: DEFAULT_LOCATIONS,
  time: DEFAULT_TIME,
  characterState: DEFAULT_CHARACTER_STATE,
  dice: DEFAULT_DICE,
  relationships: DEFAULT_RELATIONSHIPS,
  context: DEFAULT_CONTEXT,
};

// === Presets ===

/** Minimal config - just chat with a character, no game mechanics */
export const PRESET_MINIMAL: PartialWorldConfig = {
  multiCharMode: "tagged",
  chronicle: { enabled: false },
  scenes: { enabled: false },
  inventory: { enabled: false },
  locations: { enabled: false },
  time: { enabled: false },
  characterState: { enabled: false },
  dice: { enabled: false },
  relationships: { enabled: false },
};

/** Simple RP - basic features, no complex mechanics */
export const PRESET_SIMPLE: PartialWorldConfig = {
  multiCharMode: "auto",
  chronicle: { enabled: true, autoExtract: false, periodicSummary: false },
  scenes: { enabled: true, autoPause: false },
  inventory: { enabled: true, useEquipment: false, useCapacity: false },
  locations: { enabled: true, useRegions: false },
  time: { enabled: true, useCalendar: false },
  characterState: { enabled: false },
  dice: { enabled: false },
  relationships: { enabled: true, useAffinity: false, useFactions: false },
};

/** Full RP - all features enabled */
export const PRESET_FULL: PartialWorldConfig = {
  multiCharMode: "auto",
  chronicle: { enabled: true, autoExtract: true, perspectiveAware: true },
  scenes: { enabled: true, autoPause: true },
  inventory: { enabled: true, useEquipment: true, useCapacity: true, useDurability: true },
  locations: { enabled: true, useRegions: true, useZones: true, useTravelTime: true },
  time: { enabled: true, useCalendar: true, useDayNight: true, useScheduledEvents: true },
  characterState: { enabled: true, useAttributes: true, useForms: true, useEffects: true },
  dice: { enabled: true, syntax: "advanced", useCombat: true, useHP: true, useAC: true },
  relationships: { enabled: true, useAffinity: true, useFactions: true },
};

/** TF (Transformation) focused - forms and effects enabled */
export const PRESET_TF: PartialWorldConfig = {
  multiCharMode: "auto",
  chronicle: { enabled: true, autoExtract: true },
  scenes: { enabled: true },
  inventory: { enabled: true, useEquipment: true },
  locations: { enabled: true },
  time: { enabled: true },
  characterState: { enabled: true, useAttributes: true, useForms: true, useEffects: true },
  dice: { enabled: false },
  relationships: { enabled: true, useAffinity: true },
};

/** Tabletop RPG - dice and combat focused */
export const PRESET_TABLETOP: PartialWorldConfig = {
  multiCharMode: "auto",
  chronicle: { enabled: true },
  scenes: { enabled: true },
  inventory: { enabled: true, useEquipment: true, useCapacity: true },
  locations: { enabled: true, useConnections: true },
  time: { enabled: true, mode: "manual" },
  characterState: { enabled: true, useAttributes: true, useEffects: true },
  dice: { enabled: true, syntax: "advanced", useCombat: true, useHP: true, useAC: true },
  relationships: { enabled: true, useFactions: true },
};

export const PRESETS: Record<string, PartialWorldConfig> = {
  minimal: PRESET_MINIMAL,
  simple: PRESET_SIMPLE,
  full: PRESET_FULL,
  tf: PRESET_TF,
  tabletop: PRESET_TABLETOP,
};

// === Config Utilities ===

/** Deep merge config with defaults */
export function mergeConfig(
  partial: PartialWorldConfig | null | undefined,
  base: WorldConfig = DEFAULT_CONFIG
): WorldConfig {
  if (!partial) return { ...base };

  return {
    multiCharMode: partial.multiCharMode ?? base.multiCharMode,
    chronicle: { ...base.chronicle, ...partial.chronicle },
    scenes: {
      ...base.scenes,
      ...partial.scenes,
      boundaries: {
        ...base.scenes.boundaries,
        ...partial.scenes?.boundaries,
      },
    },
    inventory: { ...base.inventory, ...partial.inventory },
    locations: { ...base.locations, ...partial.locations },
    time: { ...base.time, ...partial.time },
    characterState: { ...base.characterState, ...partial.characterState },
    dice: { ...base.dice, ...partial.dice },
    relationships: { ...base.relationships, ...partial.relationships },
    context: { ...base.context, ...partial.context },
  };
}

/** Apply a preset on top of defaults */
export function applyPreset(presetName: string): WorldConfig {
  const preset = PRESETS[presetName];
  if (!preset) {
    throw new Error(`Unknown preset: ${presetName}. Valid: ${Object.keys(PRESETS).join(", ")}`);
  }
  return mergeConfig(preset);
}

/** Get a nested config value by path (e.g., "chronicle.autoExtract") */
export function getConfigValue(config: WorldConfig, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = config;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/** Set a nested config value by path */
export function setConfigValue(
  config: WorldConfig,
  path: string,
  value: unknown
): WorldConfig {
  const parts = path.split(".");
  const result = JSON.parse(JSON.stringify(config)) as WorldConfig;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = result;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (typeof current[part] !== "object" || current[part] === null) {
      current[part] = {};
    }
    current = current[part];
  }

  const lastPart = parts[parts.length - 1];
  current[lastPart] = value;

  return result;
}

/** Parse a string value to the appropriate type */
export function parseConfigValue(value: string): unknown {
  // Boolean
  if (value === "true") return true;
  if (value === "false") return false;

  // Number
  const num = Number(value);
  if (!isNaN(num)) return num;

  // Array (comma-separated)
  if (value.includes(",")) {
    return value.split(",").map((s) => parseConfigValue(s.trim()));
  }

  // String
  return value;
}

// === Feature Flags ===

/** Check if a feature is enabled */
export function isFeatureEnabled(
  config: WorldConfig,
  feature: keyof WorldConfig
): boolean {
  const section = config[feature];
  if (typeof section === "object" && section !== null && "enabled" in section) {
    return (section as { enabled: boolean }).enabled;
  }
  return true; // Non-subsystem features are always "enabled"
}

/** Feature flag helpers for common checks */
export const features = {
  chronicle: (config: WorldConfig) => config.chronicle.enabled,
  scenes: (config: WorldConfig) => config.scenes.enabled,
  inventory: (config: WorldConfig) => config.inventory.enabled,
  locations: (config: WorldConfig) => config.locations.enabled,
  time: (config: WorldConfig) => config.time.enabled,
  characterState: (config: WorldConfig) => config.characterState.enabled,
  dice: (config: WorldConfig) => config.dice.enabled,
  relationships: (config: WorldConfig) => config.relationships.enabled,

  // Sub-features
  autoExtract: (config: WorldConfig) =>
    config.chronicle.enabled && config.chronicle.autoExtract,
  perspectiveAware: (config: WorldConfig) =>
    config.chronicle.enabled && config.chronicle.perspectiveAware,
  equipment: (config: WorldConfig) =>
    config.inventory.enabled && config.inventory.useEquipment,
  capacity: (config: WorldConfig) =>
    config.inventory.enabled && config.inventory.useCapacity,
  regions: (config: WorldConfig) =>
    config.locations.enabled && config.locations.useRegions,
  connections: (config: WorldConfig) =>
    config.locations.enabled && config.locations.useConnections,
  calendar: (config: WorldConfig) =>
    config.time.enabled && config.time.useCalendar,
  dayNight: (config: WorldConfig) =>
    config.time.enabled && config.time.useDayNight,
  attributes: (config: WorldConfig) =>
    config.characterState.enabled && config.characterState.useAttributes,
  forms: (config: WorldConfig) =>
    config.characterState.enabled && config.characterState.useForms,
  effects: (config: WorldConfig) =>
    config.characterState.enabled && config.characterState.useEffects,
  combat: (config: WorldConfig) =>
    config.dice.enabled && config.dice.useCombat,
  affinity: (config: WorldConfig) =>
    config.relationships.enabled && config.relationships.useAffinity,
  factions: (config: WorldConfig) =>
    config.relationships.enabled && config.relationships.useFactions,
};

/** Get the resolved config for a world (DB config merged with defaults) */
export function getWorldConfig(worldId: number): WorldConfig {
  const db = getDb();
  const row = db.prepare("SELECT config FROM worlds WHERE id = ?").get(worldId) as {
    config: string | null;
  } | null;

  if (!row?.config) return { ...DEFAULT_CONFIG };

  try {
    const partial = JSON.parse(row.config) as PartialWorldConfig;
    return mergeConfig(partial);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Save config for a world */
export function setWorldConfig(worldId: number, config: PartialWorldConfig): void {
  const db = getDb();
  db.prepare("UPDATE worlds SET config = ? WHERE id = ?").run(
    JSON.stringify(config),
    worldId
  );
}
