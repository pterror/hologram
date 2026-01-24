// Seeded RNG for consistent randomness across sessions
// Uses mulberry32 algorithm - fast and good distribution

export class SeededRNG {
  private state: number;
  private initialSeed: number;

  constructor(seed?: number) {
    this.initialSeed = seed ?? Date.now();
    this.state = this.initialSeed;
  }

  // Get current seed (for saving/restoring state)
  getSeed(): number {
    return this.initialSeed;
  }

  // Get current state (for precise restoration)
  getState(): number {
    return this.state;
  }

  // Restore to specific state
  setState(state: number): void {
    this.state = state;
  }

  // Reset to initial seed
  reset(): void {
    this.state = this.initialSeed;
  }

  // Generate random float [0, 1)
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Random integer in range [min, max] inclusive
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  // Random float in range [min, max)
  float(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  // Random boolean with optional probability (default 0.5)
  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  // Pick random element from array
  pick<T>(array: T[]): T | undefined {
    if (array.length === 0) return undefined;
    return array[this.int(0, array.length - 1)];
  }

  // Shuffle array in place (Fisher-Yates)
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  // Roll dice (e.g., "2d6+3")
  roll(notation: string): { total: number; rolls: number[]; modifier: number } {
    const match = notation.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
    if (!match) {
      throw new Error(`Invalid dice notation: ${notation}`);
    }

    const count = parseInt(match[1], 10);
    const sides = parseInt(match[2], 10);
    const modifier = match[3] ? parseInt(match[3], 10) : 0;

    const rolls: number[] = [];
    for (let i = 0; i < count; i++) {
      rolls.push(this.int(1, sides));
    }

    const total = rolls.reduce((a, b) => a + b, 0) + modifier;
    return { total, rolls, modifier };
  }
}

// Per-channel RNG instances
const channelRNGs = new Map<string, SeededRNG>();

export function getRNG(channelId: string, seed?: number): SeededRNG {
  let rng = channelRNGs.get(channelId);
  if (!rng) {
    rng = new SeededRNG(seed);
    channelRNGs.set(channelId, rng);
  }
  return rng;
}

export function resetRNG(channelId: string, seed?: number): SeededRNG {
  const rng = new SeededRNG(seed);
  channelRNGs.set(channelId, rng);
  return rng;
}
