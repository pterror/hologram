/**
 * Export Types
 *
 * Type definitions for the export system including CCv2 character card spec,
 * Hologram native formats, and JSONL export formats.
 */

import type {
  Entity,
  CharacterData,
  LocationData,
  ItemData,
  FactionData,
} from "../db/entities";
import type { WorldConfig } from "../config/types";

// === Export Configuration ===

export interface ExportConfig {
  s3Endpoint?: string;
  s3Bucket?: string;
  s3Region?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3PublicUrl?: string;
  presignedUrlExpiry?: number; // Seconds, default 3600
}

// === Character Export Formats ===

export type CharacterExportFormat =
  | "ccv2"           // Standard CCv2 (strict compliance)
  | "ccv2-extended"  // CCv2 with Hologram extensions
  | "hologram"       // Native Hologram JSON
  | "charx";         // CharX ZIP format

export type CCv2ComplianceLevel =
  | "strict"         // Only CCv2 spec fields
  | "lenient"        // Include common extensions
  | "extended";      // Full Hologram data in extensions

// === CCv2 Spec Types ===

/** Character Card V2 specification */
export interface TavernCardV2 {
  spec: "chara_card_v2";
  spec_version: "2.0";
  data: {
    // Required V1 fields
    name: string;
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;

    // V2 fields
    creator_notes: string;
    system_prompt: string;
    post_history_instructions: string;
    alternate_greetings: string[];
    character_book?: CharacterBook;
    tags: string[];
    creator: string;
    character_version: string;
    extensions: Record<string, unknown>;
  };
}

export interface CharacterBook {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions: Record<string, unknown>;
  entries: CharacterBookEntry[];
}

export interface CharacterBookEntry {
  keys: string[];
  content: string;
  extensions: Record<string, unknown>;
  enabled: boolean;
  insertion_order: number;
  case_sensitive?: boolean;
  name?: string;
  priority?: number;
  id?: number;
  comment?: string;
  selective?: boolean;
  secondary_keys?: string[];
  constant?: boolean;
  position?: "before_char" | "after_char";
}

// === Hologram Native Export Formats ===

/** Hologram character export with optional extended data */
export interface HologramCharacterExport {
  version: "1.0";
  exportedAt: number;
  character: {
    id: number;
    name: string;
    data: CharacterData;
    creatorId: string | null;
    createdAt: number;
  };
  // Optional extended data
  worlds?: Array<{ worldId: number; worldName: string; isPrimary: boolean }>;
  state?: CharacterStateExport | null;
  effects?: EffectExport[];
  equipment?: EquipmentExport[];
  relationships?: RelationshipExport[];
  factions?: FactionMembershipExport[];
  generatedImages?: GeneratedImageExport[];
}

export interface CharacterStateExport {
  attributes: Record<string, number> | null;
  body: Record<string, unknown> | null;
  outfit: Record<string, unknown> | null;
}

export interface EffectExport {
  name: string;
  type: string;
  description: string | null;
  duration: string;
  modifiers: Record<string, number> | null;
  bodyChanges: Record<string, unknown> | null;
  flags: string[] | null;
}

export interface EquipmentExport {
  slot: string;
  itemId: number;
  itemName: string;
}

export interface RelationshipExport {
  targetId: number;
  targetName: string;
  targetType: string;
  relationshipType: string;
  data: Record<string, unknown> | null;
}

export interface FactionMembershipExport {
  factionId: number;
  factionName: string;
  rank: string | null;
  standing: number;
}

export interface GeneratedImageExport {
  url: string;
  imageType: string;
  width: number | null;
  height: number | null;
  createdAt: number;
}

// === World Export ===

export interface WorldExport {
  version: "1.0";
  exportedAt: number;
  world: {
    id: number;
    name: string;
    description: string | null;
    lore: string | null;
    rules: string | null;
    config: WorldConfig | null;
    data: Record<string, unknown>;
    creatorId: string | null;
  };
  entities: {
    characters: Entity<CharacterData>[];
    locations: Entity<LocationData>[];
    items: Entity<ItemData>[];
    concepts: Entity[];
    factions: Entity<FactionData>[];
  };
  relationships: RelationshipExport[];
  facts?: FactExport[];
  chronicle?: ChronicleExportEntry[];
}

export interface FactExport {
  id: number;
  entityId: number | null;
  content: string;
  importance: number;
  createdAt: number;
}

// === JSONL Formats ===

export interface ChronicleExportEntry {
  id: number;
  sceneId: number | null;
  type: string;
  content: string;
  importance: number;
  perspective: string;
  visibility: string;
  source: string;
  createdAt: number;
}

export interface ChatlogExportEntry {
  timestamp: number;
  channelId: string;
  sceneId: number | null;
  speaker: {
    type: "user" | "ai" | "proxy" | "system";
    name: string;
    characterId?: number;
    userId?: string;
  };
  content: string;
  metadata?: Record<string, unknown>;
}

// === Persona/Proxy Export ===

export interface UserDataExport {
  version: "1.0";
  exportedAt: number;
  userId: string;
  personas: PersonaExport[];
  proxies: ProxyExport[];
}

export interface PersonaExport {
  name: string;
  persona: string | null;
  avatar: string | null;
  worldId: number | null;
  worldName: string | null;
}

export interface ProxyExport {
  name: string;
  prefix: string | null;
  suffix: string | null;
  bracketOpen: string | null;
  bracketClose: string | null;
  avatar: string | null;
  persona: string | null;
  worldId: number | null;
  worldName: string | null;
}

// === Export Result ===

export interface ExportResult {
  success: boolean;
  format: string;
  filename: string;
  url?: string;
  size?: number;
  expiresAt?: number;
  error?: string;
}

// === Export Options ===

export interface CharacterExportOptions {
  format?: CharacterExportFormat;
  compliance?: CCv2ComplianceLevel;
  includeState?: boolean;
  includeEffects?: boolean;
  includeRelationships?: boolean;
  includeFactions?: boolean;
  includeImages?: boolean;
}

export interface WorldExportOptions {
  includeChronicle?: boolean;
  includeFacts?: boolean;
}
