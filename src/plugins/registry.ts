/**
 * Plugin Registry
 *
 * Central registry for plugins. Handles:
 * - Plugin registration and dependency resolution
 * - Middleware chain execution
 * - Extractor dispatch
 * - Formatter collection
 * - Command routing
 */

import type {
  Plugin,
  PluginContext,
  Middleware,
  Extractor,
  Formatter,
  Command,
  ContextSection,
  Mode,
} from "./types";
import type { HologramBot, HologramInteraction } from "../bot/types";
import type { Message } from "../ai/context";
import { DEFAULT_CONFIG, mergeConfig } from "../config/defaults";
import type { WorldConfig } from "../config/types";

// =============================================================================
// Registry State
// =============================================================================

const plugins = new Map<string, Plugin>();
const middleware: Middleware[] = [];
const extractors: Extractor[] = [];
const formatters: Formatter[] = [];
const commands = new Map<string, Command>();
const componentHandlers = new Map<string, Command>(); // prefix -> command
const modes = new Map<string, Mode>();
const cleanupFns: Array<() => void> = [];

let middlewareSorted = false;

// =============================================================================
// Plugin Registration
// =============================================================================

/** Register a plugin */
export function registerPlugin(plugin: Plugin): void {
  if (plugins.has(plugin.id)) {
    console.warn(`Plugin ${plugin.id} already registered, skipping`);
    return;
  }

  // Check dependencies
  for (const dep of plugin.dependencies ?? []) {
    if (!plugins.has(dep)) {
      throw new Error(
        `Plugin ${plugin.id} depends on ${dep}, but ${dep} is not registered`
      );
    }
  }

  plugins.set(plugin.id, plugin);

  // Register middleware
  if (plugin.middleware) {
    for (const mw of plugin.middleware) {
      middleware.push(mw);
      middlewareSorted = false;
    }
  }

  // Register extractors
  if (plugin.extractors) {
    extractors.push(...plugin.extractors);
  }

  // Register formatters
  if (plugin.formatters) {
    formatters.push(...plugin.formatters);
  }

  // Register commands
  if (plugin.commands) {
    for (const cmd of plugin.commands) {
      const name = cmd.definition.name;
      if (commands.has(name)) {
        console.warn(`Command ${name} already registered, overwriting`);
      }
      commands.set(name, cmd);

      // Register component handler if present
      if (cmd.componentHandler && cmd.componentPrefix) {
        componentHandlers.set(cmd.componentPrefix, cmd);
      }
    }
  }

  console.log(`Registered plugin: ${plugin.name} (${plugin.id})`);
}

/** Initialize all registered plugins */
export async function initPlugins(): Promise<void> {
  for (const plugin of plugins.values()) {
    if (plugin.init) {
      const cleanup = await plugin.init();
      if (cleanup) {
        cleanupFns.push(cleanup);
      }
    }
  }
}

/** Cleanup all plugins */
export async function cleanupPlugins(): Promise<void> {
  for (const cleanup of cleanupFns) {
    try {
      cleanup();
    } catch (err) {
      console.error("Plugin cleanup error:", err);
    }
  }
  cleanupFns.length = 0;
}

/** Get all registered plugins */
export function getPlugins(): Plugin[] {
  return Array.from(plugins.values());
}

/** Check if a plugin is registered */
export function hasPlugin(id: string): boolean {
  return plugins.has(id);
}

// =============================================================================
// Mode Registration
// =============================================================================

/** Register a mode (plugin preset) */
export function registerMode(mode: Mode): void {
  modes.set(mode.id, mode);
}

/** Get a mode by ID */
export function getMode(id: string): Mode | undefined {
  return modes.get(id);
}

/** Get all registered modes */
export function getModes(): Mode[] {
  return Array.from(modes.values());
}

/** Get the config for a mode (merges mode config with defaults) */
export function getModeConfig(modeId: string): WorldConfig {
  const mode = modes.get(modeId);
  if (!mode) {
    return { ...DEFAULT_CONFIG };
  }
  return mergeConfig(mode.config);
}

// =============================================================================
// Middleware Execution
// =============================================================================

/** Sort middleware by priority (lazy, only when needed) */
function ensureMiddlewareSorted(): void {
  if (!middlewareSorted) {
    middleware.sort((a, b) => a.priority - b.priority);
    middlewareSorted = true;
  }
}

/** Create initial context for a message */
export function createContext(params: {
  channelId: string;
  guildId: string | undefined;
  authorId: string;
  authorName: string;
  content: string;
  isBotMentioned: boolean;
  history?: Message[];
  config?: WorldConfig | null;
}): PluginContext {
  return {
    channelId: params.channelId,
    guildId: params.guildId,
    authorId: params.authorId,
    authorName: params.authorName,
    originalContent: params.content,
    content: params.content,
    effectiveName: params.authorName,
    scene: null,
    worldId: undefined,
    activeCharacterIds: [],
    history: params.history ?? [],
    systemPrompt: "",
    response: null,
    narrationParts: [],
    userContext: undefined,
    isBotMentioned: params.isBotMentioned,
    data: new Map(),
    config: params.config ?? null,
  };
}

/** Run the middleware chain */
export async function runMiddleware(ctx: PluginContext): Promise<void> {
  ensureMiddlewareSorted();

  let index = 0;

  const next = async (): Promise<void> => {
    if (index >= middleware.length) {
      return;
    }

    const mw = middleware[index++];
    await mw.fn(ctx, next);
  };

  await next();
}

// =============================================================================
// Extractor Execution
// =============================================================================

/** Default timeout for extractors (30 seconds) */
const EXTRACTOR_TIMEOUT_MS = 30_000;

/** Create a timeout promise that rejects after the given duration */
function createTimeout(ms: number, name: string): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Extractor ${name} timed out after ${ms}ms`)), ms)
  );
}

/** Run all applicable extractors with timeout protection */
export async function runExtractors(
  ctx: PluginContext,
  timeoutMs: number = EXTRACTOR_TIMEOUT_MS
): Promise<void> {
  const applicable = extractors.filter((e) => e.shouldRun(ctx));

  // Run extractors in parallel (they should be independent)
  await Promise.all(
    applicable.map(async (extractor) => {
      try {
        await Promise.race([
          extractor.fn(ctx),
          createTimeout(timeoutMs, extractor.name),
        ]);
      } catch (err) {
        console.error(`Extractor ${extractor.name} failed:`, err);
      }
    })
  );
}

// =============================================================================
// Formatter Execution
// =============================================================================

/** Run all applicable formatters and collect context sections */
export async function runFormatters(ctx: PluginContext): Promise<ContextSection[]> {
  const applicable = formatters.filter((f) => f.shouldRun(ctx));
  const sections: ContextSection[] = [];

  // Run formatters in parallel
  const results = await Promise.all(
    applicable.map(async (formatter) => {
      try {
        return await formatter.fn(ctx);
      } catch (err) {
        console.error(`Formatter ${formatter.name} failed:`, err);
        return [];
      }
    })
  );

  for (const result of results) {
    sections.push(...result);
  }

  // Sort by priority (lower = earlier in context)
  sections.sort((a, b) => a.priority - b.priority);

  return sections;
}

// =============================================================================
// Command Routing
// =============================================================================

/** Get all command definitions for Discord registration */
export function getCommandDefinitions(): import("@discordeno/bot").CreateApplicationCommand[] {
  return Array.from(commands.values()).map((c) => c.definition);
}

/** Handle a command interaction */
export async function handleCommand(
  bot: HologramBot,
  interaction: HologramInteraction,
  commandName: string
): Promise<boolean> {
  const cmd = commands.get(commandName);
  if (!cmd) {
    return false;
  }

  await cmd.handler(bot, interaction);
  return true;
}

/** Handle a component interaction (button, select, modal) */
export async function handleComponent(
  bot: HologramBot,
  interaction: HologramInteraction,
  customId: string
): Promise<boolean> {
  // Find handler by prefix match
  for (const [prefix, cmd] of componentHandlers) {
    if (customId.startsWith(prefix) && cmd.componentHandler) {
      const handled = await cmd.componentHandler(bot, interaction);
      if (handled) return true;
    }
  }
  return false;
}

// =============================================================================
// Utility: Plugin-scoped data access
// =============================================================================

/** Get plugin data from context (legacy, prefer definePluginData for type safety) */
export function getPluginData<T>(ctx: PluginContext, key: string): T | undefined {
  return ctx.data.get(key) as T | undefined;
}

/** Set plugin data in context (legacy, prefer definePluginData for type safety) */
export function setPluginData<T>(ctx: PluginContext, key: string, value: T): void {
  ctx.data.set(key, value);
}

/**
 * Type-safe accessor for plugin-specific context data.
 * Use this to define strongly-typed data slots for your plugin.
 *
 * @example
 * ```ts
 * // Define once in your plugin
 * const deliveryData = definePluginData<DeliveryResult>("delivery:result");
 *
 * // Use with full type safety
 * deliveryData.set(ctx, { segments: [...] });
 * const result = deliveryData.get(ctx); // DeliveryResult | undefined
 * ```
 */
export interface PluginDataAccessor<T> {
  /** Get the data from context (undefined if not set) */
  get(ctx: PluginContext): T | undefined;
  /** Set the data in context */
  set(ctx: PluginContext, value: T): void;
  /** Check if data exists in context */
  has(ctx: PluginContext): boolean;
  /** Remove data from context */
  clear(ctx: PluginContext): void;
  /** The key used for storage */
  readonly key: string;
}

/** Create a type-safe accessor for plugin-specific context data */
export function definePluginData<T>(key: string): PluginDataAccessor<T> {
  return {
    get(ctx: PluginContext): T | undefined {
      return ctx.data.get(key) as T | undefined;
    },
    set(ctx: PluginContext, value: T): void {
      ctx.data.set(key, value);
    },
    has(ctx: PluginContext): boolean {
      return ctx.data.has(key);
    },
    clear(ctx: PluginContext): void {
      ctx.data.delete(key);
    },
    key,
  };
}
