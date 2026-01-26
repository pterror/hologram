/**
 * Export Module
 *
 * Main orchestration for exporting data from Hologram in various formats.
 */

import { getEntity, type CharacterData } from "../db/entities";
import { canExport, canExportWorld } from "../access";
import { ExportStorage, getExportStorage, formatForDiscord } from "./storage";
import { toTavernCardV2 } from "./formats/ccv2";
import { exportCharacter as exportHologramCharacter } from "./formats/hologram";
import { exportWorld as exportWorldData } from "./formats/world";
import { exportChronicleAsJsonl, type ChronicleExportOptions } from "./formats/chronicle";
import type {
  ExportResult,
  CharacterExportFormat,
  CharacterExportOptions,
  WorldExportOptions,
  CCv2ComplianceLevel,
} from "./types";

// Re-export types
export * from "./types";
export * from "./formats";
export { ExportStorage, getExportStorage, formatForDiscord } from "./storage";

/**
 * Export a character in the specified format.
 */
export async function exportCharacter(
  characterId: number,
  userId: string,
  userGuilds: string[] = [],
  options: CharacterExportOptions = {}
): Promise<ExportResult> {
  const { format = "hologram", compliance = "lenient" } = options;

  // Check permission
  if (!canExport(userId, characterId, userGuilds)) {
    return {
      success: false,
      format,
      filename: "",
      error: "You don't have permission to export this character",
    };
  }

  // Get character
  const character = getEntity<CharacterData>(characterId);
  if (!character || character.type !== "character") {
    return {
      success: false,
      format,
      filename: "",
      error: "Character not found",
    };
  }

  // Generate export data
  let data: string;
  let contentType: string;
  let filename: string;

  switch (format) {
    case "ccv2":
    case "ccv2-extended": {
      const extendedData =
        format === "ccv2-extended"
          ? exportHologramCharacter(characterId, options) ?? undefined
          : undefined;
      const card = toTavernCardV2(
        character,
        format === "ccv2-extended" ? "extended" : compliance,
        extendedData
      );
      data = JSON.stringify(card, null, 2);
      contentType = "application/json";
      filename = `${sanitizeFilename(character.name)}.json`;
      break;
    }

    case "hologram": {
      const hologramData = exportHologramCharacter(characterId, options);
      if (!hologramData) {
        return {
          success: false,
          format,
          filename: "",
          error: "Failed to export character data",
        };
      }
      data = JSON.stringify(hologramData, null, 2);
      contentType = "application/json";
      filename = `${sanitizeFilename(character.name)}.hologram.json`;
      break;
    }

    case "charx": {
      // CharX requires additional implementation for ZIP creation
      return {
        success: false,
        format,
        filename: "",
        error: "CharX format not yet implemented",
      };
    }

    default:
      return {
        success: false,
        format,
        filename: "",
        error: `Unknown format: ${format}`,
      };
  }

  // Upload to S3 if configured, otherwise return for Discord embed
  const storage = getExportStorage();
  if (storage) {
    return storage.upload(data, filename, contentType);
  }

  // No S3 - return formatted for Discord
  const formatted = formatForDiscord(data, contentType);
  return {
    success: true,
    format,
    filename,
    url: formatted.content, // Contains the code block
    error: formatted.truncated ? "Output truncated. Configure S3 for full exports." : undefined,
  };
}

/**
 * Export a world and all its entities.
 */
export async function exportWorldFull(
  worldId: number,
  userId: string,
  userGuilds: string[] = [],
  options: WorldExportOptions = {}
): Promise<ExportResult> {
  // Check permission
  if (!canExportWorld(userId, worldId, userGuilds)) {
    return {
      success: false,
      format: "hologram",
      filename: "",
      error: "You don't have permission to export this world",
    };
  }

  // Generate export data
  const worldData = exportWorldData(worldId, options);
  if (!worldData) {
    return {
      success: false,
      format: "hologram",
      filename: "",
      error: "World not found",
    };
  }

  const data = JSON.stringify(worldData, null, 2);
  const filename = `${sanitizeFilename(worldData.world.name)}.world.json`;

  // Upload to S3 if configured
  const storage = getExportStorage();
  if (storage) {
    return storage.upload(data, filename, "application/json");
  }

  // No S3 - return formatted for Discord
  const formatted = formatForDiscord(data, "application/json");
  return {
    success: true,
    format: "hologram",
    filename,
    url: formatted.content,
    error: formatted.truncated ? "Output truncated. Configure S3 for full exports." : undefined,
  };
}

/**
 * Export chronicle entries as JSONL.
 */
export async function exportChronicle(
  worldId: number,
  userId: string,
  userGuilds: string[] = [],
  options: Omit<ChronicleExportOptions, "worldId"> = {}
): Promise<ExportResult> {
  // Check permission
  if (!canExportWorld(userId, worldId, userGuilds)) {
    return {
      success: false,
      format: "jsonl",
      filename: "",
      error: "You don't have permission to export this world's chronicle",
    };
  }

  const data = exportChronicleAsJsonl({ ...options, worldId });
  const filename = `chronicle-${worldId}.jsonl`;

  // Upload to S3 if configured
  const storage = getExportStorage();
  if (storage) {
    return storage.upload(data, filename, "application/x-ndjson");
  }

  // No S3 - return formatted for Discord
  const formatted = formatForDiscord(data, "application/json");
  return {
    success: true,
    format: "jsonl",
    filename,
    url: formatted.content,
    error: formatted.truncated ? "Output truncated. Configure S3 for full exports." : undefined,
  };
}

/**
 * Sanitize a string for use in a filename.
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 50);
}
