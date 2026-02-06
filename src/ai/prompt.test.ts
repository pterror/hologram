import { describe, expect, test } from "bun:test";
import { withToJSON, processRawFacts } from "./prompt";

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
