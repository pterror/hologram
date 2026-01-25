import { getDb } from "../db";

export interface UserProxy {
  id: number;
  userId: string;
  worldId: number | null;
  name: string;
  prefix: string | null;
  suffix: string | null;
  bracketOpen: string | null;
  bracketClose: string | null;
  avatar: string | null;
  persona: string | null;
  data: Record<string, unknown> | null;
  createdAt: number;
}

interface ProxyRow {
  id: number;
  user_id: string;
  world_id: number | null;
  name: string;
  prefix: string | null;
  suffix: string | null;
  bracket_open: string | null;
  bracket_close: string | null;
  avatar: string | null;
  persona: string | null;
  data: string | null;
  created_at: number;
}

function mapRow(row: ProxyRow): UserProxy {
  return {
    id: row.id,
    userId: row.user_id,
    worldId: row.world_id,
    name: row.name,
    prefix: row.prefix,
    suffix: row.suffix,
    bracketOpen: row.bracket_open,
    bracketClose: row.bracket_close,
    avatar: row.avatar,
    persona: row.persona,
    data: row.data ? JSON.parse(row.data) : null,
    createdAt: row.created_at,
  };
}

/** Get all proxies for a user (optionally filtered by world) */
export function getUserProxies(userId: string, worldId?: number | null): UserProxy[] {
  const db = getDb();

  // Get world-specific and global proxies
  const rows = db.prepare(`
    SELECT * FROM user_proxies
    WHERE user_id = ? AND (world_id IS NULL OR world_id = ?)
    ORDER BY created_at ASC
  `).all(userId, worldId ?? null) as ProxyRow[];

  return rows.map(mapRow);
}

/** Get a proxy by ID */
export function getProxy(id: number): UserProxy | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM user_proxies WHERE id = ?").get(id) as ProxyRow | null;
  return row ? mapRow(row) : null;
}

/** Get a proxy by name for a user */
export function getProxyByName(userId: string, name: string): UserProxy | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM user_proxies WHERE user_id = ? AND name = ?"
  ).get(userId, name) as ProxyRow | null;
  return row ? mapRow(row) : null;
}

/** Create a new proxy */
export function createProxy(
  userId: string,
  name: string,
  options?: {
    worldId?: number | null;
    prefix?: string;
    suffix?: string;
    bracketOpen?: string;
    bracketClose?: string;
    avatar?: string;
    persona?: string;
  }
): UserProxy {
  const db = getDb();
  const row = db.prepare(`
    INSERT INTO user_proxies (user_id, world_id, name, prefix, suffix, bracket_open, bracket_close, avatar, persona)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    userId,
    options?.worldId ?? null,
    name,
    options?.prefix ?? null,
    options?.suffix ?? null,
    options?.bracketOpen ?? null,
    options?.bracketClose ?? null,
    options?.avatar ?? null,
    options?.persona ?? null
  ) as ProxyRow;

  return mapRow(row);
}

/** Delete a proxy */
export function deleteProxy(id: number): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM user_proxies WHERE id = ?").run(id);
  return result.changes > 0;
}

/** Update a proxy's settings */
export function updateProxy(
  id: number,
  updates: Partial<{
    name: string;
    prefix: string | null;
    suffix: string | null;
    bracketOpen: string | null;
    bracketClose: string | null;
    avatar: string | null;
    persona: string | null;
  }>
): boolean {
  const db = getDb();
  const sets: string[] = [];
  const params: (string | null)[] = [];

  if (updates.name !== undefined) {
    sets.push("name = ?");
    params.push(updates.name);
  }
  if (updates.prefix !== undefined) {
    sets.push("prefix = ?");
    params.push(updates.prefix);
  }
  if (updates.suffix !== undefined) {
    sets.push("suffix = ?");
    params.push(updates.suffix);
  }
  if (updates.bracketOpen !== undefined) {
    sets.push("bracket_open = ?");
    params.push(updates.bracketOpen);
  }
  if (updates.bracketClose !== undefined) {
    sets.push("bracket_close = ?");
    params.push(updates.bracketClose);
  }
  if (updates.avatar !== undefined) {
    sets.push("avatar = ?");
    params.push(updates.avatar);
  }
  if (updates.persona !== undefined) {
    sets.push("persona = ?");
    params.push(updates.persona);
  }

  if (sets.length === 0) return false;

  params.push(id.toString());
  const result = db.prepare(
    `UPDATE user_proxies SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return result.changes > 0;
}

/** Parse a message to check if it matches any proxy pattern */
export function parseProxyMessage(
  userId: string,
  content: string,
  worldId?: number | null
): { proxy: UserProxy; content: string } | null {
  const proxies = getUserProxies(userId, worldId);

  for (const proxy of proxies) {
    // Check brackets first (most specific)
    if (proxy.bracketOpen && proxy.bracketClose) {
      if (content.startsWith(proxy.bracketOpen) && content.endsWith(proxy.bracketClose)) {
        return {
          proxy,
          content: content.slice(proxy.bracketOpen.length, -proxy.bracketClose.length).trim(),
        };
      }
    }

    // Check prefix
    if (proxy.prefix && content.startsWith(proxy.prefix)) {
      return {
        proxy,
        content: content.slice(proxy.prefix.length).trim(),
      };
    }

    // Check suffix
    if (proxy.suffix && content.endsWith(proxy.suffix)) {
      return {
        proxy,
        content: content.slice(0, -proxy.suffix.length).trim(),
      };
    }
  }

  return null;
}

/** Format proxy trigger pattern for display */
export function formatProxyTrigger(proxy: UserProxy): string {
  const triggers: string[] = [];

  if (proxy.prefix) {
    triggers.push(`Prefix: \`${proxy.prefix}text\``);
  }
  if (proxy.suffix) {
    triggers.push(`Suffix: \`text${proxy.suffix}\``);
  }
  if (proxy.bracketOpen && proxy.bracketClose) {
    triggers.push(`Brackets: \`${proxy.bracketOpen}text${proxy.bracketClose}\``);
  }

  return triggers.length > 0 ? triggers.join(" | ") : "No trigger set";
}

/** Format proxy for context (used in AI prompt when proxied) */
export function formatProxyForContext(proxy: UserProxy): string {
  const lines: string[] = [`## User (as ${proxy.name})`];

  if (proxy.persona) {
    lines.push(proxy.persona);
  }

  return lines.join("\n");
}
