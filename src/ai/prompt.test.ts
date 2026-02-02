import { describe, expect, test } from "bun:test";
import { withToJSON } from "./prompt";

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
