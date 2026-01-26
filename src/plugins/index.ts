/**
 * Plugin System Entry Point
 *
 * Exports:
 * - Plugin types
 * - Registry functions
 * - Built-in plugins
 * - Modes (plugin presets)
 */

// Re-export types
export * from "./types";

// Re-export registry
export {
  registerPlugin,
  initPlugins,
  cleanupPlugins,
  getPlugins,
  hasPlugin,
  registerMode,
  getMode,
  getModes,
  getModeConfig,
  createContext,
  runMiddleware,
  runExtractors,
  runFormatters,
  getCommandDefinitions,
  handleCommand,
  handleComponent,
  getPluginData,
  setPluginData,
  definePluginData,
  type PluginDataAccessor,
} from "./registry";

// Built-in plugins
export { corePlugin } from "./core";
export { scenePlugin, setActiveCharacter, getActiveCharacterLegacy } from "./scene";
export { characterPlugin } from "./character";
export { identityPlugin } from "./identity";
export { chroniclePlugin } from "./chronicle";
export { timePlugin } from "./time";
export { inventoryPlugin } from "./inventory";
export { worldPlugin } from "./world";
export { deliveryPlugin, getDeliveryResult, type CharacterSegment, type DeliveryResult } from "./delivery";
export { imagePlugin, stripImageMarkers } from "./images";

// =============================================================================
// Load all built-in plugins
// =============================================================================

import { registerPlugin, registerMode } from "./registry";
import type { Mode } from "./types";
import { corePlugin } from "./core";
import { scenePlugin } from "./scene";
import { characterPlugin } from "./character";
import { identityPlugin } from "./identity";
import { chroniclePlugin } from "./chronicle";
import { timePlugin } from "./time";
import { inventoryPlugin } from "./inventory";
import { worldPlugin } from "./world";
import { deliveryPlugin } from "./delivery";
import { imagePlugin } from "./images";

/** Register all built-in plugins */
export function loadBuiltinPlugins(): void {
  // Core (no dependencies)
  registerPlugin(corePlugin);

  // First tier (depends on core)
  registerPlugin(scenePlugin);
  registerPlugin(characterPlugin);
  registerPlugin(identityPlugin);
  registerPlugin(worldPlugin);
  registerPlugin(deliveryPlugin);

  // Second tier (depends on core + scene)
  registerPlugin(chroniclePlugin);
  registerPlugin(timePlugin);
  registerPlugin(inventoryPlugin);
  registerPlugin(imagePlugin);
}

// =============================================================================
// Built-in Modes (plugin presets)
// =============================================================================

/** Minimal mode - just chat with a character */
const MODE_MINIMAL: Mode = {
  id: "minimal",
  name: "Minimal",
  description: "Simple chat with a character, no game mechanics",
  plugins: ["core", "identity", "character", "delivery"],
  config: {
    multiCharMode: "tagged",
    chronicle: { enabled: false },
    scenes: { enabled: false },
    inventory: { enabled: false },
    locations: { enabled: false },
    time: { enabled: false },
    characterState: { enabled: false },
    dice: { enabled: false },
    relationships: { enabled: false },
  },
};

/** SillyTavern mode - character chat with memory */
const MODE_SILLYTAVERN: Mode = {
  id: "sillytavern",
  name: "SillyTavern",
  description: "Character chat with personas and memory",
  plugins: ["core", "identity", "character", "scene", "chronicle", "world", "delivery"],
  config: {
    multiCharMode: "webhooks",
    chronicle: { enabled: true, autoExtract: true },
    scenes: { enabled: true },
    inventory: { enabled: false },
    locations: { enabled: false },
    time: { enabled: false },
    characterState: { enabled: false },
    dice: { enabled: false },
    relationships: { enabled: true },
  },
};

/** MUD mode - text adventure with locations and inventory */
const MODE_MUD: Mode = {
  id: "mud",
  name: "MUD",
  description: "Text adventure with locations, inventory, and exploration",
  plugins: [
    "core",
    "identity",
    "character",
    "scene",
    "chronicle",
    "time",
    "inventory",
    "world",
    "delivery",
  ],
  config: {
    multiCharMode: "webhooks",
    chronicle: { enabled: true },
    scenes: { enabled: true },
    inventory: { enabled: true, useCapacity: true, useEquipment: true },
    locations: { enabled: true, useConnections: true, trackProperties: true },
    time: { enabled: true, mode: "narrative" },
    characterState: { enabled: true, useAttributes: true },
    dice: { enabled: false },
    relationships: { enabled: true },
  },
};

/** Survival mode - survival mechanics (Flexible Survival style) */
const MODE_SURVIVAL: Mode = {
  id: "survival",
  name: "Survival",
  description: "Survival mechanics with inventory, hunger, and transformation",
  plugins: [
    "core",
    "identity",
    "character",
    "scene",
    "chronicle",
    "time",
    "inventory",
    "world",
    "delivery",
  ],
  config: {
    multiCharMode: "webhooks",
    chronicle: { enabled: true, autoExtract: true },
    scenes: { enabled: true },
    inventory: { enabled: true, useCapacity: true, useEquipment: true, useDurability: true },
    locations: { enabled: true, useConnections: true },
    time: { enabled: true, mode: "realtime", useRealtimeSync: true, useRandomEvents: true },
    characterState: {
      enabled: true,
      useAttributes: true,
      useForms: true,
      useEffects: true,
      attributes: ["health", "hunger", "thirst", "stamina", "sanity"],
    },
    dice: { enabled: false },
    relationships: { enabled: true, useAffinity: true },
  },
};

/** TiTS mode - adult adventure (Trials in Tainted Space style) */
const MODE_TITS: Mode = {
  id: "tits",
  name: "TiTS",
  description: "Adult adventure with transformation, inventory, and exploration",
  plugins: [
    "core",
    "identity",
    "character",
    "scene",
    "chronicle",
    "time",
    "inventory",
    "world",
    "delivery",
  ],
  config: {
    multiCharMode: "webhooks",
    chronicle: { enabled: true, autoExtract: true },
    scenes: { enabled: true },
    inventory: { enabled: true, useEquipment: true },
    locations: { enabled: true, useRegions: true, useConnections: true },
    time: { enabled: true, mode: "narrative" },
    characterState: {
      enabled: true,
      useAttributes: true,
      useForms: true,
      useEffects: true,
    },
    dice: { enabled: false },
    relationships: { enabled: true, useAffinity: true },
  },
};

/** Tabletop mode - dice and combat focused */
const MODE_TABLETOP: Mode = {
  id: "tabletop",
  name: "Tabletop",
  description: "Tabletop RPG with dice, combat, and turn-based play",
  plugins: [
    "core",
    "identity",
    "character",
    "scene",
    "chronicle",
    "time",
    "inventory",
    "world",
    "delivery",
  ],
  config: {
    multiCharMode: "webhooks",
    chronicle: { enabled: true },
    scenes: { enabled: true },
    inventory: { enabled: true, useEquipment: true, useCapacity: true },
    locations: { enabled: true, useConnections: true },
    time: { enabled: true, mode: "manual" },
    characterState: { enabled: true, useAttributes: true, useEffects: true },
    dice: { enabled: true, syntax: "advanced", useCombat: true, useHP: true, useAC: true },
    relationships: { enabled: true, useFactions: true },
  },
};

/** Parser mode - strict command parsing (Colossal Cave / Counterfeit Monkey style) */
const MODE_PARSER: Mode = {
  id: "parser",
  name: "Parser",
  description: "Classic text adventure with command parsing",
  plugins: [
    "core",
    "identity",
    "character",
    "scene",
    "chronicle",
    "inventory",
    "world",
    "delivery",
  ],
  config: {
    multiCharMode: "narrator",
    chronicle: { enabled: true },
    scenes: { enabled: true },
    inventory: { enabled: true },
    locations: { enabled: true, useConnections: true, trackProperties: true },
    time: { enabled: false },
    characterState: { enabled: false },
    dice: { enabled: false },
    relationships: { enabled: false },
  },
};

/** Full mode - everything enabled */
const MODE_FULL: Mode = {
  id: "full",
  name: "Full",
  description: "All features enabled",
  plugins: [
    "core",
    "identity",
    "character",
    "scene",
    "chronicle",
    "time",
    "inventory",
    "world",
    "delivery",
  ],
  config: {
    multiCharMode: "auto",
    chronicle: { enabled: true, autoExtract: true, perspectiveAware: true },
    scenes: { enabled: true, autoPause: true },
    inventory: { enabled: true, useEquipment: true, useCapacity: true, useDurability: true },
    locations: { enabled: true, useRegions: true, useZones: true, useTravelTime: true },
    time: { enabled: true, useCalendar: true, useDayNight: true, useScheduledEvents: true },
    characterState: { enabled: true, useAttributes: true, useForms: true, useEffects: true },
    dice: { enabled: true, syntax: "advanced", useCombat: true, useHP: true, useAC: true },
    relationships: { enabled: true, useAffinity: true, useFactions: true },
  },
};

/** Register all built-in modes */
export function loadBuiltinModes(): void {
  registerMode(MODE_MINIMAL);
  registerMode(MODE_SILLYTAVERN);
  registerMode(MODE_MUD);
  registerMode(MODE_SURVIVAL);
  registerMode(MODE_TITS);
  registerMode(MODE_TABLETOP);
  registerMode(MODE_PARSER);
  registerMode(MODE_FULL);
}

/** Initialize the plugin system (load plugins and modes) */
export async function initPluginSystem(): Promise<void> {
  loadBuiltinPlugins();
  loadBuiltinModes();
}
