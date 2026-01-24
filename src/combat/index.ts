import { getDb } from "../db";
import { getEntity } from "../db/entities";
import { roll } from "../dice";
import { getComputedAttributes } from "../state";

export interface CombatParticipant {
  id: number;
  combatId: number;
  characterId: number;
  initiative: number;
  hp: number | null;
  maxHp: number | null;
  ac: number | null;
  conditions: string[];
  isActive: boolean;
  turnOrder: number;
}

export interface CombatState {
  id: number;
  sceneId: number;
  active: boolean;
  round: number;
  currentTurn: number;
  createdAt: number;
}

export interface CombatLogEntry {
  id: number;
  combatId: number;
  round: number;
  turn: number;
  actorId: number | null;
  action: string;
  details: string | null;
  createdAt: number;
}

// === Combat Lifecycle ===

/** Start combat in a scene */
export function startCombat(sceneId: number): CombatState {
  const db = getDb();

  // End any existing combat
  db.prepare("UPDATE combats SET active = 0 WHERE scene_id = ? AND active = 1").run(sceneId);

  const row = db.prepare(`
    INSERT INTO combats (scene_id)
    VALUES (?)
    RETURNING id, scene_id, active, round, current_turn, created_at
  `).get(sceneId) as {
    id: number;
    scene_id: number;
    active: number;
    round: number;
    current_turn: number;
    created_at: number;
  };

  return {
    id: row.id,
    sceneId: row.scene_id,
    active: row.active === 1,
    round: row.round,
    currentTurn: row.current_turn,
    createdAt: row.created_at,
  };
}

/** Get active combat for a scene */
export function getActiveCombat(sceneId: number): CombatState | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT id, scene_id, active, round, current_turn, created_at
    FROM combats WHERE scene_id = ? AND active = 1
  `).get(sceneId) as {
    id: number;
    scene_id: number;
    active: number;
    round: number;
    current_turn: number;
    created_at: number;
  } | null;

  if (!row) return null;

  return {
    id: row.id,
    sceneId: row.scene_id,
    active: row.active === 1,
    round: row.round,
    currentTurn: row.current_turn,
    createdAt: row.created_at,
  };
}

/** End combat */
export function endCombat(combatId: number): void {
  const db = getDb();
  db.prepare("UPDATE combats SET active = 0 WHERE id = ?").run(combatId);

  addLogEntry(combatId, null, "combat_end", "Combat ended.");
}

// === Participants ===

/** Add a participant to combat */
export function addParticipant(
  combatId: number,
  characterId: number,
  options?: {
    hp?: number;
    maxHp?: number;
    ac?: number;
    initiative?: number;
  }
): CombatParticipant {
  const db = getDb();

  // Auto-roll initiative if not provided
  const initiative = options?.initiative ?? roll("d20").total;

  // Get attributes for HP/AC defaults
  const attrs = getComputedAttributes(characterId, null);
  const hp = options?.hp ?? (attrs.hp as number | undefined) ?? null;
  const maxHp = options?.maxHp ?? (attrs.maxHp as number | undefined) ?? hp;
  const ac = options?.ac ?? (attrs.ac as number | undefined) ?? null;

  // Calculate turn order
  const maxOrder = db.prepare(
    "SELECT MAX(turn_order) as m FROM combat_participants WHERE combat_id = ?"
  ).get(combatId) as { m: number | null };
  const turnOrder = (maxOrder?.m ?? -1) + 1;

  const row = db.prepare(`
    INSERT INTO combat_participants (combat_id, character_id, initiative, hp, max_hp, ac, turn_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(combat_id, character_id) DO UPDATE SET
      initiative = excluded.initiative, hp = excluded.hp, max_hp = excluded.max_hp, ac = excluded.ac, is_active = 1
    RETURNING id, combat_id, character_id, initiative, hp, max_hp, ac, conditions, is_active, turn_order
  `).get(combatId, characterId, initiative, hp, maxHp, ac, turnOrder) as {
    id: number;
    combat_id: number;
    character_id: number;
    initiative: number;
    hp: number | null;
    max_hp: number | null;
    ac: number | null;
    conditions: string;
    is_active: number;
    turn_order: number;
  };

  addLogEntry(combatId, characterId, "join", `Joined combat (Initiative: ${initiative})`);

  return {
    id: row.id,
    combatId: row.combat_id,
    characterId: row.character_id,
    initiative: row.initiative,
    hp: row.hp,
    maxHp: row.max_hp,
    ac: row.ac,
    conditions: JSON.parse(row.conditions),
    isActive: row.is_active === 1,
    turnOrder: row.turn_order,
  };
}

/** Remove participant from combat */
export function removeParticipant(combatId: number, characterId: number): boolean {
  const db = getDb();
  const result = db.prepare(
    "UPDATE combat_participants SET is_active = 0 WHERE combat_id = ? AND character_id = ?"
  ).run(combatId, characterId);

  if (result.changes > 0) {
    addLogEntry(combatId, characterId, "leave", "Left combat.");
  }

  return result.changes > 0;
}

/** Get all active participants sorted by initiative */
export function getParticipants(combatId: number): CombatParticipant[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, combat_id, character_id, initiative, hp, max_hp, ac, conditions, is_active, turn_order
    FROM combat_participants WHERE combat_id = ? AND is_active = 1
    ORDER BY initiative DESC, turn_order ASC
  `).all(combatId) as Array<{
    id: number;
    combat_id: number;
    character_id: number;
    initiative: number;
    hp: number | null;
    max_hp: number | null;
    ac: number | null;
    conditions: string;
    is_active: number;
    turn_order: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    combatId: row.combat_id,
    characterId: row.character_id,
    initiative: row.initiative,
    hp: row.hp,
    maxHp: row.max_hp,
    ac: row.ac,
    conditions: JSON.parse(row.conditions),
    isActive: row.is_active === 1,
    turnOrder: row.turn_order,
  }));
}

/** Get the current participant whose turn it is */
export function getCurrentParticipant(combatId: number): CombatParticipant | null {
  const combat = getActiveCombatById(combatId);
  if (!combat) return null;

  const participants = getParticipants(combatId);
  if (participants.length === 0) return null;

  const idx = combat.currentTurn % participants.length;
  return participants[idx];
}

function getActiveCombatById(combatId: number): CombatState | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT id, scene_id, active, round, current_turn, created_at FROM combats WHERE id = ?"
  ).get(combatId) as {
    id: number;
    scene_id: number;
    active: number;
    round: number;
    current_turn: number;
    created_at: number;
  } | null;

  if (!row) return null;

  return {
    id: row.id,
    sceneId: row.scene_id,
    active: row.active === 1,
    round: row.round,
    currentTurn: row.current_turn,
    createdAt: row.created_at,
  };
}

// === Turn Management ===

/** Advance to next turn */
export function nextTurn(combatId: number): {
  combat: CombatState;
  participant: CombatParticipant | null;
  newRound: boolean;
} {
  const db = getDb();
  const participants = getParticipants(combatId);

  if (participants.length === 0) {
    return {
      combat: getActiveCombatById(combatId)!,
      participant: null,
      newRound: false,
    };
  }

  const combat = getActiveCombatById(combatId)!;
  const nextIdx = combat.currentTurn + 1;
  const newRound = nextIdx >= participants.length;
  const newRoundNum = newRound ? combat.round + 1 : combat.round;
  const newTurn = newRound ? 0 : nextIdx;

  db.prepare("UPDATE combats SET round = ?, current_turn = ? WHERE id = ?").run(
    newRoundNum,
    newTurn,
    combatId
  );

  const updated = getActiveCombatById(combatId)!;
  const current = participants[newTurn % participants.length];

  if (newRound) {
    addLogEntry(combatId, null, "round", `Round ${newRoundNum} begins.`);
  }

  return {
    combat: updated,
    participant: current,
    newRound,
  };
}

/** Roll initiative for all participants and sort */
export function rollInitiative(combatId: number): CombatParticipant[] {
  const db = getDb();
  const participants = getParticipants(combatId);

  for (const p of participants) {
    const initRoll = roll("d20").total;
    db.prepare("UPDATE combat_participants SET initiative = ? WHERE id = ?").run(
      initRoll,
      p.id
    );

    addLogEntry(combatId, p.characterId, "initiative", `Rolled initiative: ${initRoll}`);
  }

  // Reset to turn 0
  db.prepare("UPDATE combats SET current_turn = 0, round = 1 WHERE id = ?").run(combatId);

  return getParticipants(combatId);
}

// === HP Management ===

/** Apply damage to a participant */
export function applyDamage(
  combatId: number,
  characterId: number,
  amount: number
): { participant: CombatParticipant; downed: boolean } | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT id, hp, max_hp FROM combat_participants
    WHERE combat_id = ? AND character_id = ? AND is_active = 1
  `).get(combatId, characterId) as { id: number; hp: number | null; max_hp: number | null } | null;

  if (!row || row.hp === null) return null;

  const newHp = Math.max(0, row.hp - amount);
  db.prepare("UPDATE combat_participants SET hp = ? WHERE id = ?").run(newHp, row.id);

  const downed = newHp <= 0;

  const entity = getEntity(characterId);
  const name = entity?.name ?? `Character ${characterId}`;
  addLogEntry(
    combatId,
    characterId,
    "damage",
    `${name} takes ${amount} damage (HP: ${row.hp} → ${newHp}/${row.max_hp ?? "?"})`
  );

  if (downed) {
    addLogEntry(combatId, characterId, "downed", `${name} is downed!`);
  }

  const participant = getParticipants(combatId).find((p) => p.characterId === characterId);
  return participant ? { participant, downed } : null;
}

/** Heal a participant */
export function applyHealing(
  combatId: number,
  characterId: number,
  amount: number
): CombatParticipant | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT id, hp, max_hp FROM combat_participants
    WHERE combat_id = ? AND character_id = ? AND is_active = 1
  `).get(combatId, characterId) as { id: number; hp: number | null; max_hp: number | null } | null;

  if (!row || row.hp === null) return null;

  const maxHp = row.max_hp ?? Infinity;
  const newHp = Math.min(maxHp, row.hp + amount);
  db.prepare("UPDATE combat_participants SET hp = ? WHERE id = ?").run(newHp, row.id);

  const entity = getEntity(characterId);
  const name = entity?.name ?? `Character ${characterId}`;
  addLogEntry(
    combatId,
    characterId,
    "heal",
    `${name} heals ${amount} HP (HP: ${row.hp} → ${newHp}/${row.max_hp ?? "?"})`
  );

  return getParticipants(combatId).find((p) => p.characterId === characterId) ?? null;
}

/** Set HP directly */
export function setHp(
  combatId: number,
  characterId: number,
  hp: number,
  maxHp?: number
): boolean {
  const db = getDb();
  if (maxHp !== undefined) {
    db.prepare(
      "UPDATE combat_participants SET hp = ?, max_hp = ? WHERE combat_id = ? AND character_id = ?"
    ).run(hp, maxHp, combatId, characterId);
  } else {
    db.prepare(
      "UPDATE combat_participants SET hp = ? WHERE combat_id = ? AND character_id = ?"
    ).run(hp, combatId, characterId);
  }
  return true;
}

// === Conditions ===

/** Add a condition to a participant */
export function addCondition(
  combatId: number,
  characterId: number,
  condition: string
): boolean {
  const db = getDb();
  const row = db.prepare(
    "SELECT id, conditions FROM combat_participants WHERE combat_id = ? AND character_id = ?"
  ).get(combatId, characterId) as { id: number; conditions: string } | null;

  if (!row) return false;

  const conditions: string[] = JSON.parse(row.conditions);
  if (!conditions.includes(condition)) {
    conditions.push(condition);
    db.prepare("UPDATE combat_participants SET conditions = ? WHERE id = ?").run(
      JSON.stringify(conditions),
      row.id
    );

    const entity = getEntity(characterId);
    addLogEntry(combatId, characterId, "condition", `${entity?.name ?? characterId} gains condition: ${condition}`);
  }

  return true;
}

/** Remove a condition from a participant */
export function removeCondition(
  combatId: number,
  characterId: number,
  condition: string
): boolean {
  const db = getDb();
  const row = db.prepare(
    "SELECT id, conditions FROM combat_participants WHERE combat_id = ? AND character_id = ?"
  ).get(combatId, characterId) as { id: number; conditions: string } | null;

  if (!row) return false;

  const conditions: string[] = JSON.parse(row.conditions);
  const newConditions = conditions.filter((c) => c !== condition);

  if (newConditions.length === conditions.length) return false;

  db.prepare("UPDATE combat_participants SET conditions = ? WHERE id = ?").run(
    JSON.stringify(newConditions),
    row.id
  );

  const entity = getEntity(characterId);
  addLogEntry(combatId, characterId, "condition", `${entity?.name ?? characterId} loses condition: ${condition}`);

  return true;
}

// === Combat Log ===

function addLogEntry(
  combatId: number,
  actorId: number | null,
  action: string,
  details: string
): void {
  const db = getDb();
  const combat = getActiveCombatById(combatId);
  db.prepare(`
    INSERT INTO combat_log (combat_id, round, turn, actor_id, action, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(combatId, combat?.round ?? 0, combat?.currentTurn ?? 0, actorId, action, details);
}

/** Get recent combat log entries */
export function getCombatLog(combatId: number, limit = 20): CombatLogEntry[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, combat_id, round, turn, actor_id, action, details, created_at
    FROM combat_log WHERE combat_id = ?
    ORDER BY id DESC LIMIT ?
  `).all(combatId, limit) as Array<{
    id: number;
    combat_id: number;
    round: number;
    turn: number;
    actor_id: number | null;
    action: string;
    details: string | null;
    created_at: number;
  }>;

  return rows.reverse().map((row) => ({
    id: row.id,
    combatId: row.combat_id,
    round: row.round,
    turn: row.turn,
    actorId: row.actor_id,
    action: row.action,
    details: row.details,
    createdAt: row.created_at,
  }));
}

// === Formatting ===

/** Format combat state for display */
export function formatCombatForDisplay(combatId: number): string {
  const combat = getActiveCombatById(combatId);
  if (!combat) return "No active combat.";

  const participants = getParticipants(combatId);
  const current = getCurrentParticipant(combatId);

  const lines: string[] = [];
  lines.push(`**Combat** - Round ${combat.round}`);
  lines.push("");

  for (let i = 0; i < participants.length; i++) {
    const p = participants[i];
    const entity = getEntity(p.characterId);
    const name = entity?.name ?? `Character ${p.characterId}`;
    const isCurrent = current?.characterId === p.characterId;

    let line = isCurrent ? "▶ " : "  ";
    line += `**${name}**`;
    line += ` (Init: ${p.initiative})`;

    if (p.hp !== null) {
      const hpStr = p.maxHp !== null ? `${p.hp}/${p.maxHp}` : `${p.hp}`;
      line += ` | HP: ${hpStr}`;
    }

    if (p.ac !== null) {
      line += ` | AC: ${p.ac}`;
    }

    if (p.conditions.length > 0) {
      line += ` | ${p.conditions.join(", ")}`;
    }

    lines.push(line);
  }

  return lines.join("\n");
}

/** Format combat for context (AI consumption) */
export function formatCombatForContext(combatId: number): string {
  const combat = getActiveCombatById(combatId);
  if (!combat) return "";

  const participants = getParticipants(combatId);
  const current = getCurrentParticipant(combatId);
  const log = getCombatLog(combatId, 10);

  const lines: string[] = [];
  lines.push(`## Active Combat - Round ${combat.round}`);

  lines.push("\nParticipants (by initiative):");
  for (const p of participants) {
    const entity = getEntity(p.characterId);
    const name = entity?.name ?? `Unknown`;
    const isCurrent = current?.characterId === p.characterId;

    let line = `- ${name}`;
    if (isCurrent) line += " [CURRENT TURN]";
    if (p.hp !== null && p.maxHp !== null) line += ` (HP: ${p.hp}/${p.maxHp})`;
    if (p.ac !== null) line += ` (AC: ${p.ac})`;
    if (p.conditions.length > 0) line += ` [${p.conditions.join(", ")}]`;
    lines.push(line);
  }

  if (log.length > 0) {
    lines.push("\nRecent actions:");
    for (const entry of log.slice(-5)) {
      if (entry.details) {
        lines.push(`- ${entry.details}`);
      }
    }
  }

  return lines.join("\n");
}
