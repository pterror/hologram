import {
  getEntity,
  getEntitiesByType,
  createLocation,
  updateEntity,
  type LocationData,
  type LocationConnection,
  type LocationType,
  type Entity,
} from "../db/entities";

/** Get a location by ID */
export function getLocation(id: number): Entity<LocationData> | null {
  const entity = getEntity<LocationData>(id);
  if (!entity || entity.type !== "location") return null;
  return entity;
}

/** Get all locations in a world */
export function getLocationsInWorld(worldId: number): Entity<LocationData>[] {
  return getEntitiesByType<LocationData>("location", worldId);
}

/** Get child locations (those with this as parent) */
export function getChildLocations(
  parentId: number,
  worldId: number
): Entity<LocationData>[] {
  const all = getLocationsInWorld(worldId);
  return all.filter((loc) => loc.data.parentId === parentId);
}

/** Get parent location */
export function getParentLocation(
  locationId: number
): Entity<LocationData> | null {
  const location = getLocation(locationId);
  if (!location || !location.data.parentId) return null;
  return getLocation(location.data.parentId);
}

/** Get location hierarchy (from current up to world) */
export function getLocationHierarchy(
  locationId: number
): Entity<LocationData>[] {
  const hierarchy: Entity<LocationData>[] = [];
  let current = getLocation(locationId);

  while (current) {
    hierarchy.push(current);
    if (!current.data.parentId) break;
    current = getLocation(current.data.parentId);
  }

  return hierarchy;
}

/** Get connected locations */
export function getConnectedLocations(
  locationId: number
): Array<{
  location: Entity<LocationData>;
  connection: LocationConnection;
}> {
  const location = getLocation(locationId);
  if (!location) return [];

  const results: Array<{
    location: Entity<LocationData>;
    connection: LocationConnection;
  }> = [];

  // New format connections
  if (location.data.connections) {
    for (const conn of location.data.connections) {
      const target = getLocation(conn.targetId);
      if (target && !conn.hidden) {
        results.push({ location: target, connection: conn });
      }
    }
  }

  // Legacy format (connectedTo array)
  if (location.data.connectedTo) {
    for (const targetId of location.data.connectedTo) {
      // Skip if already in new format connections
      if (results.find((r) => r.location.id === targetId)) continue;

      const target = getLocation(targetId);
      if (target) {
        results.push({
          location: target,
          connection: { targetId, bidirectional: true },
        });
      }
    }
  }

  // Check for bidirectional connections from other locations
  const worldId = location.worldId;
  if (worldId) {
    const allLocations = getLocationsInWorld(worldId);
    for (const other of allLocations) {
      if (other.id === locationId) continue;

      // Check new format
      if (other.data.connections) {
        const conn = other.data.connections.find(
          (c) => c.targetId === locationId && c.bidirectional !== false
        );
        if (conn && !results.find((r) => r.location.id === other.id)) {
          results.push({
            location: other,
            connection: { ...conn, targetId: other.id },
          });
        }
      }

      // Check legacy format
      if (other.data.connectedTo?.includes(locationId)) {
        if (!results.find((r) => r.location.id === other.id)) {
          results.push({
            location: other,
            connection: { targetId: other.id, bidirectional: true },
          });
        }
      }
    }
  }

  return results;
}

/** Check if two locations are connected */
export function areConnected(
  fromId: number,
  toId: number
): { connected: boolean; connection?: LocationConnection } {
  const connections = getConnectedLocations(fromId);
  const match = connections.find((c) => c.location.id === toId);
  if (match) {
    return { connected: true, connection: match.connection };
  }
  return { connected: false };
}

/** Add a connection between locations */
export function addConnection(
  fromId: number,
  toId: number,
  options?: {
    type?: string;
    bidirectional?: boolean;
    travelTime?: number;
    description?: string;
    hidden?: boolean;
  }
): boolean {
  const from = getLocation(fromId);
  if (!from) return false;

  const to = getLocation(toId);
  if (!to) return false;

  const connection: LocationConnection = {
    targetId: toId,
    type: options?.type,
    bidirectional: options?.bidirectional ?? true,
    travelTime: options?.travelTime,
    description: options?.description,
    hidden: options?.hidden,
  };

  const connections = from.data.connections ?? [];
  const existingIndex = connections.findIndex((c) => c.targetId === toId);

  if (existingIndex >= 0) {
    connections[existingIndex] = connection;
  } else {
    connections.push(connection);
  }

  updateEntity<LocationData>(fromId, { data: { connections } });
  return true;
}

/** Remove a connection */
export function removeConnection(fromId: number, toId: number): boolean {
  const from = getLocation(fromId);
  if (!from) return false;

  const connections = from.data.connections ?? [];
  const newConnections = connections.filter((c) => c.targetId !== toId);

  if (newConnections.length === connections.length) {
    // Check legacy format
    if (from.data.connectedTo?.includes(toId)) {
      const newConnectedTo = from.data.connectedTo.filter((id) => id !== toId);
      updateEntity<LocationData>(fromId, { data: { connectedTo: newConnectedTo } });
      return true;
    }
    return false;
  }

  updateEntity<LocationData>(fromId, { data: { connections: newConnections } });
  return true;
}

/** Reveal a hidden connection */
export function revealConnection(fromId: number, toId: number): boolean {
  const from = getLocation(fromId);
  if (!from || !from.data.connections) return false;

  const connections = [...from.data.connections];
  const conn = connections.find((c) => c.targetId === toId);
  if (!conn || !conn.hidden) return false;

  conn.hidden = false;
  updateEntity<LocationData>(fromId, { data: { connections } });
  return true;
}

/** Get travel time between two connected locations */
export function getTravelTime(fromId: number, toId: number): number | null {
  const result = areConnected(fromId, toId);
  if (!result.connected) return null;
  return result.connection?.travelTime ?? null;
}

/** Set location property */
export function setLocationProperty(
  locationId: number,
  key: string,
  value: boolean | string | number
): boolean {
  const location = getLocation(locationId);
  if (!location) return false;

  const properties = { ...location.data.properties, [key]: value };
  updateEntity<LocationData>(locationId, { data: { properties } });
  return true;
}

/** Get location property */
export function getLocationProperty(
  locationId: number,
  key: string
): boolean | string | number | undefined {
  const location = getLocation(locationId);
  return location?.data.properties?.[key];
}

/** Create a new location */
export function createNewLocation(
  name: string,
  description: string,
  worldId: number,
  options?: {
    parentId?: number;
    locationType?: LocationType;
    properties?: Record<string, boolean | string | number>;
    ambience?: string;
    enterMessage?: string;
  }
): Entity<LocationData> {
  return createLocation(
    name,
    {
      description,
      parentId: options?.parentId,
      locationType: options?.locationType ?? "location",
      properties: options?.properties,
      ambience: options?.ambience,
      enterMessage: options?.enterMessage,
    },
    worldId
  );
}

/** Format location for display */
export function formatLocationForDisplay(
  location: Entity<LocationData>
): string {
  const lines: string[] = [];

  lines.push(`**${location.name}**`);

  // Show type if not basic location
  if (location.data.locationType && location.data.locationType !== "location") {
    lines.push(`*${location.data.locationType}*`);
  }

  lines.push("");
  lines.push(location.data.description);

  // Show properties
  if (location.data.properties && Object.keys(location.data.properties).length > 0) {
    lines.push("");
    const propList = Object.entries(location.data.properties)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    lines.push(`Properties: ${propList}`);
  }

  // Show connections
  const connections = getConnectedLocations(location.id);
  if (connections.length > 0) {
    lines.push("");
    lines.push("**Exits:**");
    for (const conn of connections) {
      let exit = `- ${conn.location.name}`;
      if (conn.connection.type) {
        exit += ` (${conn.connection.type})`;
      }
      if (conn.connection.description) {
        exit += ` - ${conn.connection.description}`;
      }
      lines.push(exit);
    }
  }

  return lines.join("\n");
}

/** Format location for context */
export function formatLocationForContext(
  location: Entity<LocationData>
): string {
  const lines: string[] = [];

  lines.push(`## Location: ${location.name}`);
  lines.push(location.data.description);

  if (location.data.ambience) {
    lines.push(`\n*${location.data.ambience}*`);
  }

  // Properties as context hints
  if (location.data.properties) {
    const props = location.data.properties;
    const hints: string[] = [];

    if (props.indoor) hints.push("indoors");
    if (props.outdoor) hints.push("outdoors");
    if (props.lightLevel) hints.push(`${props.lightLevel} lighting`);
    if (props.temperature) hints.push(`${props.temperature}`);
    if (props.safe) hints.push("safe area");
    if (props.dangerous) hints.push("dangerous area");

    if (hints.length > 0) {
      lines.push(`(${hints.join(", ")})`);
    }
  }

  // Show exits briefly
  const connections = getConnectedLocations(location.id);
  if (connections.length > 0) {
    const exits = connections.map((c) => c.location.name).join(", ");
    lines.push(`\nExits: ${exits}`);
  }

  return lines.join("\n");
}

/** Generate a simple text map of connected locations */
export function generateTextMap(
  centerId: number,
  depth: number = 1
): string {
  const center = getLocation(centerId);
  if (!center) return "Location not found.";

  const visited = new Set<number>();
  const lines: string[] = [];

  function explore(id: number, level: number, linePrefix: string, childBasePrefix: string) {
    if (visited.has(id) || level > depth) return;
    visited.add(id);

    const loc = getLocation(id);
    if (!loc) return;

    const marker = level === 0 ? "[*]" : "[ ]";
    lines.push(`${linePrefix}${marker} ${loc.name}`);

    if (level < depth) {
      const connections = getConnectedLocations(id);
      const unvisited = connections.filter((c) => !visited.has(c.location.id));
      for (let i = 0; i < unvisited.length; i++) {
        const conn = unvisited[i];
        const isLast = i === unvisited.length - 1;
        const branch = isLast ? "`-- " : "|-- ";
        const continuation = isLast ? "    " : "|   ";
        explore(
          conn.location.id,
          level + 1,
          childBasePrefix + branch,
          childBasePrefix + continuation
        );
      }
    }
  }

  explore(centerId, 0, "", "");
  return lines.join("\n") || "No map available.";
}
