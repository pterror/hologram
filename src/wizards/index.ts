import { getDb } from "../db";
import type { WorldConfig } from "../config/types";
import { getWorldConfig } from "../config";

export type WizardType = "character" | "world" | "location" | "item";

export interface WizardSession {
  id: string;
  type: WizardType;
  userId: string;
  channelId: string;
  worldId: number | null;
  step: number;
  data: Record<string, unknown>;
  aiSuggestions: string[] | null;
  createdAt: number;
  expiresAt: number;
}

interface WizardRow {
  id: string;
  type: string;
  user_id: string;
  channel_id: string;
  world_id: number | null;
  step: number;
  data: string;
  ai_suggestions: string | null;
  created_at: number;
  expires_at: number;
}

function mapRow(row: WizardRow): WizardSession {
  return {
    id: row.id,
    type: row.type as WizardType,
    userId: row.user_id,
    channelId: row.channel_id,
    worldId: row.world_id,
    step: row.step,
    data: JSON.parse(row.data),
    aiSuggestions: row.ai_suggestions ? JSON.parse(row.ai_suggestions) : null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

// In-memory cache for fast lookups
const sessionCache = new Map<string, WizardSession>();

/** Generate a unique session ID */
function generateId(): string {
  return `wiz_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Create a new wizard session */
export function createWizardSession(
  type: WizardType,
  userId: string,
  channelId: string,
  options?: {
    worldId?: number;
    data?: Record<string, unknown>;
    expiresInMinutes?: number;
  }
): WizardSession {
  const db = getDb();
  const id = generateId();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (options?.expiresInMinutes ?? 30) * 60;
  const data = JSON.stringify(options?.data ?? {});

  // Cancel any existing session for this user + channel
  cancelUserSession(userId, channelId);

  db.prepare(`
    INSERT INTO wizard_sessions (id, type, user_id, channel_id, world_id, step, data, expires_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)
  `).run(id, type, userId, channelId, options?.worldId ?? null, data, expiresAt);

  const session: WizardSession = {
    id,
    type,
    userId,
    channelId,
    worldId: options?.worldId ?? null,
    step: 0,
    data: options?.data ?? {},
    aiSuggestions: null,
    createdAt: now,
    expiresAt,
  };

  sessionCache.set(id, session);
  return session;
}

/** Get a wizard session by ID */
export function getWizardSession(id: string): WizardSession | null {
  // Check cache first
  const cached = sessionCache.get(id);
  if (cached) {
    if (isExpired(cached)) {
      deleteSession(id);
      return null;
    }
    return cached;
  }

  const db = getDb();
  const row = db.prepare("SELECT * FROM wizard_sessions WHERE id = ?").get(id) as WizardRow | null;
  if (!row) return null;

  const session = mapRow(row);
  if (isExpired(session)) {
    deleteSession(id);
    return null;
  }

  sessionCache.set(id, session);
  return session;
}

/** Get the active wizard session for a user in a channel */
export function getActiveWizard(userId: string, channelId: string): WizardSession | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM wizard_sessions
    WHERE user_id = ? AND channel_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, channelId) as WizardRow | null;

  if (!row) return null;

  const session = mapRow(row);
  if (isExpired(session)) {
    deleteSession(session.id);
    return null;
  }

  sessionCache.set(session.id, session);
  return session;
}

/** Update wizard session step and data */
export function updateWizardSession(
  id: string,
  updates: {
    step?: number;
    data?: Record<string, unknown>;
    aiSuggestions?: string[] | null;
  }
): WizardSession | null {
  const session = getWizardSession(id);
  if (!session) return null;

  const db = getDb();
  const newStep = updates.step ?? session.step;
  const newData = updates.data ? { ...session.data, ...updates.data } : session.data;
  const newSuggestions = updates.aiSuggestions !== undefined
    ? updates.aiSuggestions
    : session.aiSuggestions;

  db.prepare(`
    UPDATE wizard_sessions
    SET step = ?, data = ?, ai_suggestions = ?
    WHERE id = ?
  `).run(
    newStep,
    JSON.stringify(newData),
    newSuggestions ? JSON.stringify(newSuggestions) : null,
    id
  );

  const updated: WizardSession = {
    ...session,
    step: newStep,
    data: newData,
    aiSuggestions: newSuggestions,
  };

  sessionCache.set(id, updated);
  return updated;
}

/** Cancel/delete a wizard session */
export function cancelWizard(id: string): boolean {
  return deleteSession(id);
}

/** Cancel any active wizard for a user in a channel */
export function cancelUserSession(userId: string, channelId: string): boolean {
  const db = getDb();
  const rows = db.prepare(
    "SELECT id FROM wizard_sessions WHERE user_id = ? AND channel_id = ?"
  ).all(userId, channelId) as Array<{ id: string }>;

  for (const row of rows) {
    deleteSession(row.id);
  }

  return rows.length > 0;
}

/** Clean up all expired sessions */
export function cleanupExpiredSessions(): number {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // Get IDs to clean from cache
  const rows = db.prepare(
    "SELECT id FROM wizard_sessions WHERE expires_at < ?"
  ).all(now) as Array<{ id: string }>;

  for (const row of rows) {
    sessionCache.delete(row.id);
  }

  const result = db.prepare("DELETE FROM wizard_sessions WHERE expires_at < ?").run(now);
  return result.changes;
}

function deleteSession(id: string): boolean {
  sessionCache.delete(id);
  const db = getDb();
  const result = db.prepare("DELETE FROM wizard_sessions WHERE id = ?").run(id);
  return result.changes > 0;
}

function isExpired(session: WizardSession): boolean {
  return Math.floor(Date.now() / 1000) > session.expiresAt;
}

// === Wizard Step Definitions ===

export interface WizardStep {
  name: string;
  prompt: string;
  field: string;           // Key in session.data to store the answer
  required: boolean;
  inputType: "text" | "select" | "number";
  options?: string[];      // For select type
  aiAssist?: boolean;      // Whether to offer AI suggestions
  aiPrompt?: string;       // Prompt for AI suggestions
}

// === Static wizard flows (non-config-dependent) ===

const CHARACTER_FLOW: WizardStep[] = [
  {
    name: "Name",
    prompt: "What is the character's name?",
    field: "name",
    required: true,
    inputType: "text",
    aiAssist: true,
    aiPrompt: "Suggest 5 fantasy character names",
  },
  {
    name: "Persona",
    prompt: "Describe the character's personality, background, and key traits.",
    field: "persona",
    required: true,
    inputType: "text",
    aiAssist: true,
    aiPrompt: "Given the character name '{name}', suggest a brief character persona (personality, background, traits)",
  },
  {
    name: "Scenario",
    prompt: "What is the character's current situation or goals? (Optional)",
    field: "scenario",
    required: false,
    inputType: "text",
    aiAssist: true,
    aiPrompt: "Given character '{name}' with persona '{persona}', suggest a scenario (current situation/goals)",
  },
  {
    name: "Example Dialogue",
    prompt: "Provide example dialogue to establish voice/style. (Optional)",
    field: "exampleDialogue",
    required: false,
    inputType: "text",
    aiAssist: true,
    aiPrompt: "Given character '{name}' with persona '{persona}', write 2-3 example dialogue lines showing their voice",
  },
];

const WORLD_FLOW: WizardStep[] = [
  {
    name: "Name",
    prompt: "What is the world's name?",
    field: "name",
    required: true,
    inputType: "text",
    aiAssist: true,
    aiPrompt: "Suggest 5 fantasy world/setting names",
  },
  {
    name: "Description",
    prompt: "Describe the world's setting, genre, and atmosphere.",
    field: "description",
    required: true,
    inputType: "text",
    aiAssist: true,
    aiPrompt: "Given world name '{name}', suggest a world description (setting, genre, atmosphere)",
  },
  {
    name: "Lore",
    prompt: "Any background lore or history? (Optional)",
    field: "lore",
    required: false,
    inputType: "text",
    aiAssist: true,
    aiPrompt: "Given world '{name}': {description}, suggest background lore/history",
  },
  {
    name: "Rules",
    prompt: "Any special rules or tone guidelines for AI? (Optional, always in context)",
    field: "rules",
    required: false,
    inputType: "text",
  },
];

const LOCATION_FLOW: WizardStep[] = [
  {
    name: "Name",
    prompt: "What is the location's name?",
    field: "name",
    required: true,
    inputType: "text",
    aiAssist: true,
    aiPrompt: "Suggest 5 fantasy location names",
  },
  {
    name: "Description",
    prompt: "Describe this location.",
    field: "description",
    required: true,
    inputType: "text",
    aiAssist: true,
    aiPrompt: "Given location name '{name}', suggest a vivid description",
  },
  {
    name: "Type",
    prompt: "What type of location is this?",
    field: "locationType",
    required: false,
    inputType: "select",
    options: ["location", "region", "zone"],
  },
  {
    name: "Ambience",
    prompt: "Default ambient description when entering. (Optional)",
    field: "ambience",
    required: false,
    inputType: "text",
    aiAssist: true,
    aiPrompt: "Given location '{name}': {description}, write a short ambient description for when someone enters",
  },
];

// === Dynamic item wizard flow (config-dependent) ===

/** Build item wizard steps based on world config. TF features only appear when enabled. */
function buildItemFlow(config?: WorldConfig): WizardStep[] {
  const steps: WizardStep[] = [
    {
      name: "Name",
      prompt: "What is the item's name?",
      field: "name",
      required: true,
      inputType: "text",
      aiAssist: true,
      aiPrompt: "Suggest 5 fantasy item names",
    },
    {
      name: "Description",
      prompt: "Describe the item.",
      field: "description",
      required: true,
      inputType: "text",
      aiAssist: true,
      aiPrompt: "Given item name '{name}', suggest a description",
    },
    {
      name: "Type",
      prompt: "What type of item is this?",
      field: "itemType",
      required: false,
      inputType: "select",
      options: ["consumable", "equipment", "quest", "currency", "misc"],
    },
  ];

  // Equipment slot (only if equipment system is enabled)
  if (config?.inventory?.useEquipment) {
    const slots = config.inventory.equipmentSlots;
    steps.push({
      name: "Equipment Slot",
      prompt: "Which equipment slot does this item use? (Optional)",
      field: "equipSlot",
      required: false,
      inputType: "select",
      options: slots.length > 0 ? slots : ["mainhand", "offhand", "head", "body", "hands", "feet", "accessory"],
    });
    steps.push({
      name: "Stat Bonuses",
      prompt: "Stat bonuses when equipped (e.g., 'strength +5, defense +3'). (Optional)",
      field: "stats",
      required: false,
      inputType: "text",
      aiAssist: true,
      aiPrompt: "Given item '{name}': {description}, suggest stat bonuses when equipped",
    });
  }

  // Effect on use (always shown - basic item effect, not TF-specific)
  steps.push({
    name: "Effect",
    prompt: "What effect does using this item have? (Optional)",
    field: "effect",
    required: false,
    inputType: "text",
    aiAssist: true,
    aiPrompt: "Given item '{name}': {description}, suggest an effect when used",
  });

  // Effects system (buffs/debuffs - only if effects enabled)
  if (config?.characterState?.useEffects) {
    steps.push({
      name: "Applied Effect",
      prompt: "Status effect applied on use (e.g., buff/debuff name and duration). (Optional)",
      field: "appliedEffect",
      required: false,
      inputType: "text",
      aiAssist: true,
      aiPrompt: "Given item '{name}': {description}, suggest a status effect (buff/debuff) it applies",
    });
  }

  // Body requirements and transformation (only if forms enabled - TF opt-in)
  if (config?.characterState?.useForms) {
    steps.push({
      name: "Body Requirements",
      prompt: "Body/form requirements to use (e.g., species, size, flags). (Optional)",
      field: "requirements",
      required: false,
      inputType: "text",
      aiAssist: true,
      aiPrompt: "Given item '{name}': {description}, suggest body requirements (species, form, size) to use it",
    });
    steps.push({
      name: "Transformation",
      prompt: "Body changes when used (e.g., species change, new traits). (Optional)",
      field: "transformation",
      required: false,
      inputType: "text",
      aiAssist: true,
      aiPrompt: "Given item '{name}': {description}, describe a transformation effect when used",
    });
  }

  // Durability (only if durability system enabled)
  if (config?.inventory?.useDurability) {
    steps.push({
      name: "Durability",
      prompt: "Maximum durability (number). (Optional)",
      field: "maxDurability",
      required: false,
      inputType: "number",
    });
  }

  return steps;
}

/** Kept for backward compatibility - static flows without config */
export const WIZARD_FLOWS: Record<WizardType, WizardStep[]> = {
  character: CHARACTER_FLOW,
  world: WORLD_FLOW,
  location: LOCATION_FLOW,
  item: buildItemFlow(), // Default: no config = base steps only
};

/** Get the wizard flow for a type, optionally using world config for dynamic flows */
export function getWizardFlow(type: WizardType, config?: WorldConfig): WizardStep[] {
  switch (type) {
    case "item":
      return buildItemFlow(config);
    case "character":
      return CHARACTER_FLOW;
    case "world":
      return WORLD_FLOW;
    case "location":
      return LOCATION_FLOW;
  }
}

/** Resolve WorldConfig from a session's worldId */
function resolveConfig(session: WizardSession): WorldConfig | undefined {
  if (session.worldId) {
    try {
      return getWorldConfig(session.worldId);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Get the current step definition for a wizard session */
export function getCurrentStep(session: WizardSession, config?: WorldConfig): WizardStep | null {
  const resolvedConfig = config ?? resolveConfig(session);
  const flow = getWizardFlow(session.type, resolvedConfig);
  if (session.step >= flow.length) return null;
  return flow[session.step];
}

/** Get total steps for a wizard type */
export function getTotalSteps(type: WizardType, config?: WorldConfig): number {
  return getWizardFlow(type, config).length;
}

/** Check if a wizard session is complete (all required steps filled) */
export function isWizardComplete(session: WizardSession, config?: WorldConfig): boolean {
  const resolvedConfig = config ?? resolveConfig(session);
  const flow = getWizardFlow(session.type, resolvedConfig);

  for (const step of flow) {
    if (step.required && !session.data[step.field]) {
      return false;
    }
  }

  return true;
}

/** Interpolate AI prompt template with session data */
export function interpolatePrompt(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const val = data[key];
    return val !== undefined ? String(val) : `{${key}}`;
  });
}

/** Format wizard progress for Discord display */
export function formatWizardProgress(session: WizardSession, config?: WorldConfig): string {
  const resolvedConfig = config ?? resolveConfig(session);
  const flow = getWizardFlow(session.type, resolvedConfig);
  if (flow.length === 0) return "";

  const lines: string[] = [];
  lines.push(`**${session.type.charAt(0).toUpperCase() + session.type.slice(1)} Builder** - Step ${session.step + 1}/${flow.length}\n`);

  for (let i = 0; i < flow.length; i++) {
    const step = flow[i];
    const value = session.data[step.field];
    const marker = i < session.step ? "✅" : i === session.step ? "▶" : "⬜";

    let line = `${marker} **${step.name}**`;
    if (value) {
      const preview = String(value).length > 40
        ? String(value).slice(0, 40) + "..."
        : String(value);
      line += `: ${preview}`;
    } else if (step.required) {
      line += " *(required)*";
    } else {
      line += " *(optional)*";
    }
    lines.push(line);
  }

  return lines.join("\n");
}

/** Encode a wizard action into a custom_id for Discord components */
export function encodeWizardAction(sessionId: string, action: string): string {
  return `wizard:${sessionId}:${action}`;
}

/** Decode a wizard custom_id */
export function decodeWizardAction(customId: string): {
  sessionId: string;
  action: string;
} | null {
  if (!customId.startsWith("wizard:")) return null;
  const parts = customId.split(":");
  if (parts.length < 3) return null;
  return {
    sessionId: parts[1],
    action: parts.slice(2).join(":"),
  };
}
