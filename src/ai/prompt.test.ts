import { describe, expect, test, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";

// =============================================================================
// DB mock for expandEntityRefs (entity lookup)
// =============================================================================

let testDb: Database;

mock.module("../db/index", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

import { withToJSON, processRawFacts, expandEntityRefs, type MacroMeta } from "./prompt";
import type { ExprContext } from "../logic/expr";

function createTestSchema(db: Database) {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owned_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      template TEXT,
      system_template TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS effects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      source TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function createEntity(name: string): number {
  const row = testDb.prepare(`INSERT INTO entities (name) VALUES (?) RETURNING id`).get(name) as { id: number };
  return row.id;
}

function addFact(entityId: number, content: string): void {
  testDb.prepare(`INSERT INTO facts (entity_id, content) VALUES (?, ?)`).run(entityId, content);
}

// =============================================================================
// Pure function tests (no DB needed)
// =============================================================================

describe("withToJSON", () => {
  test("array toJSON() returns JSON string of original items", () => {
    const arr = [{ a: 1 }, { a: 2 }];
    const result = withToJSON(arr);
    expect(result.toJSON()).toBe(JSON.stringify([{ a: 1 }, { a: 2 }]));
  });

  test("element toJSON() returns JSON string of that element", () => {
    const arr = [{ title: "hello", description: "world" }];
    const result = withToJSON(arr);
    expect(result[0].toJSON()).toBe(JSON.stringify({ title: "hello", description: "world" }));
  });

  test("element toJSON() does not cause infinite recursion", () => {
    const arr = [{ a: 1 }, { b: 2 }];
    const result = withToJSON(arr);
    // This would stack overflow if toJSON references the mutated object
    expect(() => result[0].toJSON()).not.toThrow();
    expect(() => result[1].toJSON()).not.toThrow();
    expect(() => result.toJSON()).not.toThrow();
  });

  test("element toJSON() output does not include toJSON property", () => {
    const arr = [{ x: 42 }];
    const result = withToJSON(arr);
    const parsed = JSON.parse(result[0].toJSON());
    expect(parsed).toEqual({ x: 42 });
    expect(parsed.toJSON).toBeUndefined();
  });

  test("array toJSON() output does not include toJSON on elements", () => {
    const arr = [{ x: 1 }, { y: 2 }];
    const result = withToJSON(arr);
    const parsed = JSON.parse(result.toJSON());
    expect(parsed).toEqual([{ x: 1 }, { y: 2 }]);
    expect(parsed[0].toJSON).toBeUndefined();
  });

  test("element properties are accessible directly", () => {
    const arr = [{ title: "test", url: "https://example.com" }];
    const result = withToJSON(arr);
    expect(result[0].title).toBe("test");
    expect(result[0].url).toBe("https://example.com");
  });

  test("handles empty array", () => {
    const result = withToJSON([]);
    expect(result.toJSON()).toBe("[]");
    expect(result.length).toBe(0);
  });

  test("handles nested objects", () => {
    const arr = [{ footer: { text: "hi", icon_url: "http://x" }, fields: [{ name: "a", value: "b" }] }];
    const result = withToJSON(arr);
    expect(result[0].footer).toEqual({ text: "hi", icon_url: "http://x" });
    const parsed = JSON.parse(result[0].toJSON());
    expect(parsed.footer).toEqual({ text: "hi", icon_url: "http://x" });
    expect(parsed.fields).toEqual([{ name: "a", value: "b" }]);
  });

  test("does not mutate original array", () => {
    const original = [{ a: 1 }];
    withToJSON(original);
    expect((original[0] as any).toJSON).toBeUndefined();
    expect((original as any).toJSON).toBeUndefined();
  });
});

describe("processRawFacts", () => {
  test("passes through plain facts unchanged", () => {
    const facts = ["is a character", "has silver hair", "is friendly"];
    expect(processRawFacts(facts)).toEqual(["is a character", "has silver hair", "is friendly"]);
  });

  test("strips $if prefix from conditional facts, keeping content", () => {
    const facts = [
      "$if mentioned: is alert and ready to fight",
      "has blue eyes",
      "$if time.is_night: glows faintly",
    ];
    expect(processRawFacts(facts)).toEqual([
      "is alert and ready to fight",
      "has blue eyes",
      "glows faintly",
    ]);
  });

  test("removes $respond directives", () => {
    const facts = [
      "is a guard",
      "$respond",
      "$if mentioned: $respond",
    ];
    expect(processRawFacts(facts)).toEqual(["is a guard"]);
  });

  test("removes $model directives", () => {
    const facts = [
      "is a wizard",
      "$model google:gemini-2.0-flash",
    ];
    expect(processRawFacts(facts)).toEqual(["is a wizard"]);
  });

  test("removes $stream directives", () => {
    const facts = [
      "speaks slowly",
      "$stream full",
    ];
    expect(processRawFacts(facts)).toEqual(["speaks slowly"]);
  });

  test("removes $memory directives", () => {
    const facts = [
      "remembers everything",
      "$memory channel",
    ];
    expect(processRawFacts(facts)).toEqual(["remembers everything"]);
  });

  test("removes $context directives", () => {
    const facts = [
      "is verbose",
      "$context 8000",
    ];
    expect(processRawFacts(facts)).toEqual(["is verbose"]);
  });

  test("removes $avatar directives", () => {
    const facts = [
      "looks fierce",
      "$avatar https://example.com/avatar.png",
    ];
    expect(processRawFacts(facts)).toEqual(["looks fierce"]);
  });

  test("removes $freeform directives", () => {
    const facts = [
      "is creative",
      "$freeform",
    ];
    expect(processRawFacts(facts)).toEqual(["is creative"]);
  });

  test("removes $strip directives", () => {
    const facts = [
      "is clean",
      '$strip "</blockquote>"',
    ];
    expect(processRawFacts(facts)).toEqual(["is clean"]);
  });

  test("strips comments ($#)", () => {
    const facts = [
      "$# this is a comment",
      "is visible",
      "$# another comment",
    ];
    expect(processRawFacts(facts)).toEqual(["is visible"]);
  });

  test("preserves $locked facts (content visible, just marked locked)", () => {
    const facts = [
      "$locked is immutable",
      "is normal",
    ];
    expect(processRawFacts(facts)).toEqual(["is immutable", "is normal"]);
  });

  test("removes pure $locked directive (locks entity, not a visible fact)", () => {
    const facts = [
      "$locked",
      "is a character",
    ];
    expect(processRawFacts(facts)).toEqual(["is a character"]);
  });

  test("removes conditional $retry directives", () => {
    const facts = [
      "is patient",
      "$if idle_ms > 60000: $retry 5000",
    ];
    expect(processRawFacts(facts)).toEqual(["is patient"]);
  });

  test("handles mixed facts with all types", () => {
    const facts = [
      "$# comment",
      "is a character",
      "$if mentioned: has a temper",
      "$respond",
      "$if time.is_night: $respond false",
      "$model google:gemini-2.0-flash",
      "$memory channel",
      "$context 4000",
      "$stream full",
      "$avatar https://example.com/avatar.png",
      "$freeform",
      "$locked is core identity",
      "$locked",
      "has green eyes",
    ];
    expect(processRawFacts(facts)).toEqual([
      "is a character",
      "has a temper",
      "is core identity",
      "has green eyes",
    ]);
  });
});

// =============================================================================
// expandEntityRefs (macro expansion)
// =============================================================================

describe("expandEntityRefs", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  // --- Simple text macros ---

  test("{{char}} expands to entity name", () => {
    const entity = { name: "Aria", facts: ["{{char}} is a character"] };
    expandEntityRefs(entity, new Set());
    expect(entity.facts[0]).toBe("Aria is a character");
  });

  test("{{char}} is case-insensitive", () => {
    const entity = { name: "Aria", facts: ["{{CHAR}} speaks", "{{Char}} walks"] };
    expandEntityRefs(entity, new Set());
    expect(entity.facts[0]).toBe("Aria speaks");
    expect(entity.facts[1]).toBe("Aria walks");
  });

  test("{{user}} expands to literal 'user'", () => {
    const entity = { name: "Aria", facts: ["talks to {{user}}"] };
    expandEntityRefs(entity, new Set());
    expect(entity.facts[0]).toBe("talks to user");
  });

  test("{{noop}} expands to empty string", () => {
    const entity = { name: "Aria", facts: ["hello{{noop}} world"] };
    expandEntityRefs(entity, new Set());
    expect(entity.facts[0]).toBe("hello world");
  });

  test("{{newline}} expands to newline character", () => {
    const entity = { name: "Aria", facts: ["line1{{newline}}line2"] };
    expandEntityRefs(entity, new Set());
    expect(entity.facts[0]).toBe("line1\nline2");
  });

  test("{{newline::N}} expands to N newlines", () => {
    const entity = { name: "Aria", facts: ["a{{newline::3}}b"] };
    expandEntityRefs(entity, new Set());
    expect(entity.facts[0]).toBe("a\n\n\nb");
  });

  test("{{space}} expands to single space", () => {
    const entity = { name: "Aria", facts: ["a{{space}}b"] };
    expandEntityRefs(entity, new Set());
    expect(entity.facts[0]).toBe("a b");
  });

  test("{{space::N}} expands to N spaces", () => {
    const entity = { name: "Aria", facts: ["a{{space::4}}b"] };
    expandEntityRefs(entity, new Set());
    expect(entity.facts[0]).toBe("a    b");
  });

  test("{{trim}} trims surrounding whitespace from the fact", () => {
    const entity = { name: "Aria", facts: ["  {{trim}} hello world  "] };
    expandEntityRefs(entity, new Set());
    expect(entity.facts[0]).toBe("hello world");
  });

  // --- Parameterized macros ---

  test("{{random:A,B,C}} returns one of the items", () => {
    const entity = { name: "Aria", facts: ["likes {{random:red,blue,green}}"] };
    expandEntityRefs(entity, new Set());
    expect(["likes red", "likes blue", "likes green"]).toContain(entity.facts[0]);
  });

  test("{{roll:1d6}} returns a number in valid range", () => {
    const entity = { name: "Aria", facts: ["rolled {{roll:1d6}}"] };
    expandEntityRefs(entity, new Set());
    const match = entity.facts[0].match(/^rolled (\d+)$/);
    expect(match).not.toBeNull();
    const num = parseInt(match![1]);
    expect(num).toBeGreaterThanOrEqual(1);
    expect(num).toBeLessThanOrEqual(6);
  });

  // --- Entity reference macros ---

  test("{{entity:ID}} expands to entity name with ID", () => {
    const refId = createEntity("Forest");
    addFact(refId, "is a dense forest");
    const entity = { name: "Aria", facts: [`is in {{entity:${refId}}}`] };
    const seenIds = new Set<number>();
    const refs = expandEntityRefs(entity, seenIds);
    expect(entity.facts[0]).toBe(`is in Forest [${refId}]`);
    expect(refs.length).toBe(1);
    expect(refs[0].name).toBe("Forest");
    expect(seenIds.has(refId)).toBe(true);
  });

  test("{{entity:ID}} does not add duplicate references", () => {
    const refId = createEntity("Forest");
    const entity = { name: "Aria", facts: [`near {{entity:${refId}}}`, `in {{entity:${refId}}}`] };
    const seenIds = new Set<number>();
    const refs = expandEntityRefs(entity, seenIds);
    // Only one reference added even though macro appears twice
    expect(refs.length).toBe(1);
  });

  test("{{entity:ID}} skips already-seen entities", () => {
    const refId = createEntity("Forest");
    const entity = { name: "Aria", facts: [`in {{entity:${refId}}}`] };
    const seenIds = new Set([refId]); // Already seen
    const refs = expandEntityRefs(entity, seenIds);
    expect(refs.length).toBe(0);
    // But still expands the name
    expect(entity.facts[0]).toBe(`in Forest [${refId}]`);
  });

  test("{{entity:ID}} keeps original when entity not found", () => {
    const entity = { name: "Aria", facts: ["in {{entity:99999}}"] };
    expandEntityRefs(entity, new Set());
    expect(entity.facts[0]).toBe("in {{entity:99999}}");
  });

  // --- Metadata macros ---

  test("{{model}} uses evalMeta model spec", () => {
    const entity = { name: "Aria", facts: ["using {{model}}"] };
    const meta: MacroMeta = { modelSpec: "google:gemini-2.0-flash", contextExpr: null, respondingNames: [] };
    expandEntityRefs(entity, new Set(), undefined, meta);
    expect(entity.facts[0]).toBe("using google:gemini-2.0-flash");
  });

  test("{{maxPrompt}} uses evalMeta context expr", () => {
    const entity = { name: "Aria", facts: ["limit: {{maxPrompt}}"] };
    const meta: MacroMeta = { modelSpec: null, contextExpr: "chars < 8000", respondingNames: [] };
    expandEntityRefs(entity, new Set(), undefined, meta);
    expect(entity.facts[0]).toBe("limit: chars < 8000");
  });

  test("{{groupnotmuted}} lists responding names", () => {
    const entity = { name: "Aria", facts: ["group: {{groupnotmuted}}"] };
    const meta: MacroMeta = { modelSpec: null, contextExpr: null, respondingNames: ["Aria", "Bob"] };
    expandEntityRefs(entity, new Set(), undefined, meta);
    expect(entity.facts[0]).toBe("group: Aria, Bob");
  });

  // --- ExprContext-dependent macros ---

  test("{{charifnotgroup}} returns name for single entity", () => {
    const exprContext = { chars: ["Aria"] } as unknown as ExprContext;
    const entity = { name: "Aria", facts: ["{{charifnotgroup}} responds"] };
    expandEntityRefs(entity, new Set(), exprContext);
    expect(entity.facts[0]).toBe("Aria responds");
  });

  test("{{charifnotgroup}} returns empty for group", () => {
    const exprContext = { chars: ["Aria", "Bob"] } as unknown as ExprContext;
    const entity = { name: "Aria", facts: ["{{charifnotgroup}}responds"] };
    expandEntityRefs(entity, new Set(), exprContext);
    expect(entity.facts[0]).toBe("responds");
  });

  test("{{notchar}} lists other character names", () => {
    const exprContext = { chars: ["Aria", "Bob", "Carol"] } as unknown as ExprContext;
    const entity = { name: "Aria", facts: ["others: {{notchar}}"] };
    expandEntityRefs(entity, new Set(), exprContext);
    expect(entity.facts[0]).toBe("others: Bob, Carol");
  });

  test("{{date}} returns a date string", () => {
    const entity = { name: "Aria", facts: ["today is {{date}}"] };
    expandEntityRefs(entity, new Set());
    // Should have expanded to something like "today is Fri, Feb 7, 2026"
    expect(entity.facts[0]).not.toContain("{{date}}");
    expect(entity.facts[0].startsWith("today is ")).toBe(true);
  });

  test("{{time}} returns a time string", () => {
    const entity = { name: "Aria", facts: ["now is {{time}}"] };
    expandEntityRefs(entity, new Set());
    expect(entity.facts[0]).not.toContain("{{time}}");
    expect(entity.facts[0].startsWith("now is ")).toBe(true);
  });

  // --- Multiple macros in one fact ---

  test("expands multiple macros in a single fact", () => {
    const entity = { name: "Aria", facts: ["{{char}} talks to {{user}}"] };
    expandEntityRefs(entity, new Set());
    expect(entity.facts[0]).toBe("Aria talks to user");
  });

  test("expands macros across multiple facts", () => {
    const entity = { name: "Aria", facts: ["name: {{char}}", "greeting to {{user}}"] };
    expandEntityRefs(entity, new Set());
    expect(entity.facts[0]).toBe("name: Aria");
    expect(entity.facts[1]).toBe("greeting to user");
  });

  // --- Unrecognized macros ---

  test("keeps unrecognized macros as-is without exprContext", () => {
    const entity = { name: "Aria", facts: ["value: {{some.unknown.var}}"] };
    expandEntityRefs(entity, new Set());
    expect(entity.facts[0]).toBe("value: {{some.unknown.var}}");
  });
});
