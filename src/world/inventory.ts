import { getDb } from "../db";
import {
  createItem,
  getEntity,
  updateEntity,
  type ItemData,
  type Entity,
} from "../db/entities";
import { createRelationship, getRelationshipsFrom, deleteRelationshipsBetween, RelTypes } from "../db/relationships";

export interface InventoryItem {
  entityId: number;
  name: string;
  description: string;
  quantity: number;
  stats?: Record<string, number>;
}

// Get all items owned by an entity (character)
export function getInventory(ownerId: number): InventoryItem[] {
  const relationships = getRelationshipsFrom(ownerId, RelTypes.OWNS);
  const items: InventoryItem[] = [];

  for (const rel of relationships) {
    const item = getEntity<ItemData>(rel.targetId);
    if (item && item.type === "item") {
      items.push({
        entityId: item.id,
        name: item.name,
        description: item.data.description,
        quantity: (rel.data?.quantity as number) ?? 1,
        stats: item.data.stats,
      });
    }
  }

  return items;
}

// Add item to inventory (creates item if it doesn't exist)
export function addToInventory(
  ownerId: number,
  item: { name: string; description: string; stats?: Record<string, number> },
  quantity = 1,
  worldId?: number
): InventoryItem {
  // Create the item entity
  const itemEntity = createItem(
    item.name,
    {
      description: item.description,
      stats: item.stats,
    },
    worldId
  );

  // Create ownership relationship with quantity
  createRelationship(ownerId, itemEntity.id, RelTypes.OWNS, { quantity });

  return {
    entityId: itemEntity.id,
    name: itemEntity.name,
    description: itemEntity.data.description,
    quantity,
    stats: itemEntity.data.stats,
  };
}

// Add existing item entity to inventory
export function giveItem(
  ownerId: number,
  itemId: number,
  quantity = 1
): boolean {
  const item = getEntity<ItemData>(itemId);
  if (!item || item.type !== "item") return false;

  // Check if already owns this item
  const existing = getRelationshipsFrom(ownerId, RelTypes.OWNS).find(
    (r) => r.targetId === itemId
  );

  if (existing) {
    // Update quantity
    const db = getDb();
    const newQty = ((existing.data?.quantity as number) ?? 1) + quantity;
    const stmt = db.prepare(
      "UPDATE relationships SET data = ? WHERE id = ?"
    );
    stmt.run(JSON.stringify({ quantity: newQty }), existing.id);
  } else {
    // Create new ownership
    createRelationship(ownerId, itemId, RelTypes.OWNS, { quantity });
  }

  return true;
}

// Remove item from inventory
export function removeFromInventory(
  ownerId: number,
  itemId: number,
  quantity = 1
): boolean {
  const relationships = getRelationshipsFrom(ownerId, RelTypes.OWNS);
  const rel = relationships.find((r) => r.targetId === itemId);

  if (!rel) return false;

  const currentQty = (rel.data?.quantity as number) ?? 1;
  const newQty = currentQty - quantity;

  if (newQty <= 0) {
    // Remove ownership entirely
    deleteRelationshipsBetween(ownerId, itemId, RelTypes.OWNS);
  } else {
    // Update quantity
    const db = getDb();
    const stmt = db.prepare(
      "UPDATE relationships SET data = ? WHERE id = ?"
    );
    stmt.run(JSON.stringify({ quantity: newQty }), rel.id);
  }

  return true;
}

// Update item stats
export function updateItemStats(
  itemId: number,
  stats: Record<string, number>
): Entity<ItemData> | null {
  return updateEntity<ItemData>(itemId, {
    data: { stats },
  });
}

// Format inventory for context
export function formatInventoryForContext(ownerId: number): string {
  const inventory = getInventory(ownerId);
  if (inventory.length === 0) {
    return "Inventory: Empty";
  }

  const lines = ["## Inventory"];
  for (const item of inventory) {
    let line = `- **${item.name}**`;
    if (item.quantity > 1) {
      line += ` (x${item.quantity})`;
    }
    line += `: ${item.description}`;
    if (item.stats && Object.keys(item.stats).length > 0) {
      const statsStr = Object.entries(item.stats)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      line += ` [${statsStr}]`;
    }
    lines.push(line);
  }

  return lines.join("\n");
}
