/**
 * Character Import System
 *
 * Supports importing characters from:
 * - CCv1 (TavernAI/SillyTavern V1 cards)
 * - CCv2 (Character Card V2 spec)
 * - CharX (ZIP-based character cards)
 * - Hologram native format
 *
 * Can import from:
 * - URL (direct JSON or PNG with embedded data)
 * - Discord attachment
 * - Raw JSON string
 */

import { createCharacter, type CharacterData } from "../db/entities";
import { fromTavernCardV2, validateTavernCardV2 } from "../export/formats/ccv2";
import type { TavernCardV2 } from "../export/types";
import { debug, error, warn } from "../logger";

// === Types ===

export type ImportFormat = "ccv1" | "ccv2" | "charx" | "hologram" | "auto";

export interface ImportOptions {
  format?: ImportFormat;
  worldId?: number;
  creatorId?: string;
}

export interface ImportResult {
  success: boolean;
  characterId?: number;
  characterName?: string;
  format?: string;
  error?: string;
  warnings?: string[];
}

/** CCv1 (TavernAI V1) card format */
export interface TavernCardV1 {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  // Optional fields
  avatar?: string;
  chat?: string;
  create_date?: string;
}

/** Hologram native export format */
export interface HologramImport {
  version: string;
  character: {
    name: string;
    data: CharacterData;
  };
}

// === Main Import Functions ===

/**
 * Import a character from a URL (JSON, PNG, or CharX ZIP)
 */
export async function importFromUrl(
  url: string,
  options: ImportOptions = {}
): Promise<ImportResult> {
  try {
    debug(`Importing character from URL: ${url}`);

    // Fetch the content
    const response = await fetch(url);
    if (!response.ok) {
      return { success: false, error: `Failed to fetch: ${response.statusText}` };
    }

    const contentType = response.headers.get("content-type") || "";
    const contentDisposition = response.headers.get("content-disposition") || "";

    // Determine format from URL/content type
    let format = options.format || "auto";
    if (format === "auto") {
      if (url.endsWith(".charx") || url.endsWith(".zip") || contentType.includes("application/zip")) {
        format = "charx";
      } else if (url.endsWith(".png") || contentType.includes("image/png")) {
        // PNG with embedded character data
        const buffer = await response.arrayBuffer();
        return importFromPng(Buffer.from(buffer), options);
      } else if (contentType.includes("application/json") || url.endsWith(".json")) {
        format = "auto"; // Will detect from content
      }
    }

    // Handle CharX (ZIP) format
    if (format === "charx") {
      const buffer = await response.arrayBuffer();
      return importFromCharX(Buffer.from(buffer), options);
    }

    // Handle JSON content
    const text = await response.text();
    return importFromJson(text, options);
  } catch (err) {
    error("Import from URL failed", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to import from URL",
    };
  }
}

/**
 * Import a character from raw JSON string
 */
export function importFromJson(
  json: string,
  options: ImportOptions = {}
): ImportResult {
  try {
    const data = JSON.parse(json);
    return importFromObject(data, options);
  } catch (err) {
    return {
      success: false,
      error: "Invalid JSON: " + (err instanceof Error ? err.message : "parse error"),
    };
  }
}

/**
 * Import a character from a parsed object
 */
export function importFromObject(
  data: unknown,
  options: ImportOptions = {}
): ImportResult {
  const warnings: string[] = [];

  // Try to detect format
  const format = options.format || detectFormat(data);

  let characterData: CharacterData;
  let name: string;

  switch (format) {
    case "ccv2": {
      if (!validateTavernCardV2(data)) {
        return { success: false, error: "Invalid CCv2 card format" };
      }
      const card = data as TavernCardV2;
      name = card.data.name;
      characterData = fromTavernCardV2(card);
      break;
    }

    case "ccv1": {
      if (!validateTavernCardV1(data)) {
        return { success: false, error: "Invalid CCv1 card format" };
      }
      const card = data as TavernCardV1;
      name = card.name;
      characterData = fromTavernCardV1(card);
      break;
    }

    case "hologram": {
      if (!validateHologramImport(data)) {
        return { success: false, error: "Invalid Hologram format" };
      }
      const hologram = data as HologramImport;
      name = hologram.character.name;
      characterData = hologram.character.data;
      break;
    }

    default:
      return { success: false, error: `Unknown format: ${format}` };
  }

  // Create the character
  try {
    const character = createCharacter(
      name,
      characterData,
      options.worldId
    );

    return {
      success: true,
      characterId: character.id,
      characterName: character.name,
      format,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to create character: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}

/**
 * Import a character from a PNG with embedded character data
 */
export async function importFromPng(
  buffer: Buffer,
  options: ImportOptions = {}
): Promise<ImportResult> {
  try {
    // PNG files can have embedded character data in:
    // 1. tEXt chunk with "chara" keyword (base64 JSON)
    // 2. iTXt chunk with "chara" keyword

    const characterData = extractPngCharacterData(buffer);
    if (!characterData) {
      return { success: false, error: "No character data found in PNG" };
    }

    return importFromJson(characterData, options);
  } catch (err) {
    error("Import from PNG failed", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to read PNG",
    };
  }
}

/**
 * Import a character from a CharX ZIP file
 */
export async function importFromCharX(
  buffer: Buffer,
  options: ImportOptions = {}
): Promise<ImportResult> {
  try {
    // CharX is a ZIP containing:
    // - card.json (required) - the character card
    // - avatar.png (optional) - character image
    // - assets/ (optional) - additional assets

    // Parse ZIP using a minimal approach
    const cardJson = extractCardJsonFromZip(buffer);

    if (!cardJson) {
      return { success: false, error: "No card.json found in CharX archive" };
    }

    return importFromJson(cardJson, options);
  } catch (err) {
    error("Import from CharX failed", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to read CharX archive",
    };
  }
}

/**
 * Extract card.json from a ZIP buffer using minimal ZIP parsing
 */
function extractCardJsonFromZip(buffer: Buffer): string | null {
  // ZIP file format constants
  const LOCAL_FILE_HEADER = 0x04034b50;
  const CENTRAL_DIR_HEADER = 0x02014b50;

  let offset = 0;

  while (offset < buffer.length - 4) {
    const signature = buffer.readUInt32LE(offset);

    if (signature === LOCAL_FILE_HEADER) {
      // Parse local file header
      const compressionMethod = buffer.readUInt16LE(offset + 8);
      const compressedSize = buffer.readUInt32LE(offset + 18);
      const uncompressedSize = buffer.readUInt32LE(offset + 22);
      const fileNameLength = buffer.readUInt16LE(offset + 26);
      const extraFieldLength = buffer.readUInt16LE(offset + 28);

      const fileName = buffer.subarray(offset + 30, offset + 30 + fileNameLength).toString("utf-8");
      const dataStart = offset + 30 + fileNameLength + extraFieldLength;
      const fileData = buffer.subarray(dataStart, dataStart + compressedSize);

      // Check if this is card.json
      if (fileName === "card.json" || fileName.endsWith("/card.json")) {
        if (compressionMethod === 0) {
          // Stored (no compression)
          return fileData.toString("utf-8");
        } else if (compressionMethod === 8) {
          // Deflate - use zlib
          try {
            const zlib = require("zlib");
            const decompressed = zlib.inflateRawSync(fileData);
            return decompressed.toString("utf-8");
          } catch {
            warn("Failed to decompress card.json");
            return null;
          }
        }
      }

      // Move to next entry
      offset = dataStart + compressedSize;
    } else if (signature === CENTRAL_DIR_HEADER) {
      // Reached central directory, no more local files
      break;
    } else {
      offset++;
    }
  }

  return null;
}

// === Format Detection and Validation ===

/**
 * Detect the format of a character card object
 */
function detectFormat(data: unknown): ImportFormat {
  if (!data || typeof data !== "object") return "auto";

  const obj = data as Record<string, unknown>;

  // CCv2: has spec and spec_version fields
  if (obj.spec === "chara_card_v2" && obj.spec_version === "2.0") {
    return "ccv2";
  }

  // Hologram: has version and character fields
  if (obj.version && obj.character && typeof obj.character === "object") {
    return "hologram";
  }

  // CCv1: has name, description, personality at top level
  if (obj.name && obj.description && obj.personality !== undefined) {
    return "ccv1";
  }

  return "auto";
}

/**
 * Validate CCv1 format
 */
function validateTavernCardV1(data: unknown): data is TavernCardV1 {
  if (!data || typeof data !== "object") return false;

  const obj = data as Record<string, unknown>;
  return (
    typeof obj.name === "string" &&
    typeof obj.description === "string" &&
    typeof obj.personality === "string"
  );
}

/**
 * Validate Hologram import format
 */
function validateHologramImport(data: unknown): data is HologramImport {
  if (!data || typeof data !== "object") return false;

  const obj = data as Record<string, unknown>;
  if (!obj.version || !obj.character) return false;

  const char = obj.character as Record<string, unknown>;
  return typeof char.name === "string" && typeof char.data === "object";
}

/**
 * Convert CCv1 card to CharacterData
 */
function fromTavernCardV1(card: TavernCardV1): CharacterData {
  // Combine description and personality for persona
  let persona = card.description;
  if (card.personality && !card.description.includes(card.personality)) {
    persona += `\n\nPersonality: ${card.personality}`;
  }

  const data: CharacterData = {
    persona,
    scenario: card.scenario || undefined,
    exampleDialogue: card.mes_example || undefined,
  };

  if (card.first_mes) {
    data.firstMessage = card.first_mes;
  }

  return data;
}

/**
 * Extract character data from PNG tEXt/iTXt chunks
 */
function extractPngCharacterData(buffer: Buffer): string | null {
  // PNG signature
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    warn("Not a valid PNG file");
    return null;
  }

  let offset = 8; // Skip signature

  while (offset < buffer.length) {
    // Read chunk length (4 bytes, big-endian)
    const length = buffer.readUInt32BE(offset);
    offset += 4;

    // Read chunk type (4 bytes)
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    offset += 4;

    // Read chunk data
    const data = buffer.subarray(offset, offset + length);
    offset += length;

    // Skip CRC (4 bytes)
    offset += 4;

    // Check for tEXt or iTXt chunks with "chara" keyword
    if (type === "tEXt") {
      // tEXt format: keyword\0text
      const nullIndex = data.indexOf(0);
      if (nullIndex !== -1) {
        const keyword = data.subarray(0, nullIndex).toString("ascii");
        if (keyword === "chara") {
          const text = data.subarray(nullIndex + 1).toString("utf-8");
          // Text is base64 encoded JSON
          try {
            return Buffer.from(text, "base64").toString("utf-8");
          } catch {
            return text;
          }
        }
      }
    } else if (type === "iTXt") {
      // iTXt format: keyword\0compressionFlag\0compressionMethod\0langTag\0translatedKeyword\0text
      const nullIndex = data.indexOf(0);
      if (nullIndex !== -1) {
        const keyword = data.subarray(0, nullIndex).toString("ascii");
        if (keyword === "chara") {
          // Skip compression and language fields
          let textStart = nullIndex + 1;
          // Skip compression flag and method
          textStart += 2;
          // Skip language tag (null-terminated)
          const langEnd = data.indexOf(0, textStart);
          textStart = langEnd + 1;
          // Skip translated keyword (null-terminated)
          const transEnd = data.indexOf(0, textStart);
          textStart = transEnd + 1;
          // Rest is the text
          const text = data.subarray(textStart).toString("utf-8");
          try {
            return Buffer.from(text, "base64").toString("utf-8");
          } catch {
            return text;
          }
        }
      }
    } else if (type === "IEND") {
      // End of image
      break;
    }
  }

  return null;
}
