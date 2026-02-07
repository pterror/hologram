import { describe, expect, test, beforeEach, spyOn } from "bun:test";
import { debug, info, warn, error, configureLogger, child } from "./logger";

// Reset logger config to known state before each test
beforeEach(() => {
  configureLogger({ level: "debug", timestamps: false, json: false, colors: false });
});

describe("log level filtering", () => {
  test("debug messages pass at debug level", () => {
    const spy = spyOn(console, "debug").mockImplementation(() => {});
    debug("test message");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  test("debug messages filtered at info level", () => {
    configureLogger({ level: "info" });
    const spy = spyOn(console, "debug").mockImplementation(() => {});
    debug("test message");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test("info messages pass at info level", () => {
    configureLogger({ level: "info" });
    const spy = spyOn(console, "info").mockImplementation(() => {});
    info("test message");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  test("info messages filtered at warn level", () => {
    configureLogger({ level: "warn" });
    const spy = spyOn(console, "info").mockImplementation(() => {});
    info("test message");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test("warn messages pass at warn level", () => {
    configureLogger({ level: "warn" });
    const spy = spyOn(console, "warn").mockImplementation(() => {});
    warn("test message");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  test("error messages pass at error level", () => {
    configureLogger({ level: "error" });
    const spy = spyOn(console, "error").mockImplementation(() => {});
    error("test message");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  test("only error passes at error level", () => {
    configureLogger({ level: "error" });
    const debugSpy = spyOn(console, "debug").mockImplementation(() => {});
    const infoSpy = spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    debug("d");
    info("i");
    warn("w");
    error("e");
    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("JSON format", () => {
  beforeEach(() => {
    configureLogger({ json: true, timestamps: false });
  });

  test("outputs valid JSON", () => {
    const spy = spyOn(console, "info").mockImplementation(() => {});
    info("test message");
    const output = spy.mock.calls[0][0] as string;
    expect(() => JSON.parse(output)).not.toThrow();
    spy.mockRestore();
  });

  test("includes level and message", () => {
    const spy = spyOn(console, "info").mockImplementation(() => {});
    info("hello world");
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("hello world");
    spy.mockRestore();
  });

  test("includes context fields", () => {
    const spy = spyOn(console, "info").mockImplementation(() => {});
    info("request", { userId: "123", action: "login" });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.userId).toBe("123");
    expect(parsed.action).toBe("login");
    spy.mockRestore();
  });

  test("includes timestamp when enabled", () => {
    configureLogger({ timestamps: true });
    const spy = spyOn(console, "info").mockImplementation(() => {});
    info("test");
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.timestamp).toBeDefined();
    expect(typeof parsed.timestamp).toBe("string");
    spy.mockRestore();
  });

  test("omits timestamp when disabled", () => {
    const spy = spyOn(console, "info").mockImplementation(() => {});
    info("test");
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.timestamp).toBeUndefined();
    spy.mockRestore();
  });
});

describe("pretty format", () => {
  test("includes level tag in output", () => {
    const spy = spyOn(console, "info").mockImplementation(() => {});
    info("test");
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain("[INFO ");
    spy.mockRestore();
  });

  test("includes message in output", () => {
    const spy = spyOn(console, "warn").mockImplementation(() => {});
    warn("something bad");
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain("something bad");
    spy.mockRestore();
  });

  test("includes context as JSON string", () => {
    const spy = spyOn(console, "info").mockImplementation(() => {});
    info("test", { key: "value" });
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain('"key":"value"');
    spy.mockRestore();
  });

  test("omits context when not provided", () => {
    const spy = spyOn(console, "info").mockImplementation(() => {});
    info("simple message");
    const output = spy.mock.calls[0][0] as string;
    // Output should be just the level tag and message, no JSON context
    expect(output).toMatch(/\[INFO\s*\] simple message$/);
    spy.mockRestore();
  });
});

describe("error logging", () => {
  test("includes error message and stack from Error object", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    configureLogger({ json: true });
    const err = new Error("something broke");
    error("Failed", err);
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.error).toBe("something broke");
    expect(parsed.stack).toBeDefined();
    spy.mockRestore();
  });

  test("stringifies non-Error objects", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    configureLogger({ json: true });
    error("Failed", { code: 42, detail: "bad" });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.error).toContain("42");
    expect(parsed.error).toContain("bad");
    spy.mockRestore();
  });

  test("handles string error", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    configureLogger({ json: true });
    error("Failed", "string error");
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.error).toBe("string error");
    spy.mockRestore();
  });

  test("merges additional context", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    configureLogger({ json: true });
    error("Failed", new Error("oops"), { requestId: "abc" });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.requestId).toBe("abc");
    expect(parsed.error).toBe("oops");
    spy.mockRestore();
  });

  test("works without error parameter", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    configureLogger({ json: true });
    error("Something happened");
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.message).toBe("Something happened");
    expect(parsed.error).toBeUndefined();
    spy.mockRestore();
  });
});

describe("child logger", () => {
  test("merges base context with log call", () => {
    const spy = spyOn(console, "info").mockImplementation(() => {});
    configureLogger({ json: true });
    const log = child({ service: "api" });
    log.info("request", { path: "/foo" });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.service).toBe("api");
    expect(parsed.path).toBe("/foo");
    spy.mockRestore();
  });

  test("call context overrides base context", () => {
    const spy = spyOn(console, "info").mockImplementation(() => {});
    configureLogger({ json: true });
    const log = child({ env: "dev" });
    log.info("test", { env: "prod" });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.env).toBe("prod");
    spy.mockRestore();
  });

  test("all log methods available on child", () => {
    const debugSpy = spyOn(console, "debug").mockImplementation(() => {});
    const infoSpy = spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const log = child({ source: "test" });
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("child error includes base context and error details", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    configureLogger({ json: true });
    const log = child({ module: "auth" });
    log.error("login failed", new Error("invalid token"), { userId: "42" });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.module).toBe("auth");
    expect(parsed.userId).toBe("42");
    expect(parsed.error).toBe("invalid token");
    spy.mockRestore();
  });
});

describe("configureLogger", () => {
  test("changes log level", () => {
    configureLogger({ level: "error" });
    const spy = spyOn(console, "info").mockImplementation(() => {});
    info("filtered");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test("partial config does not reset other options", () => {
    configureLogger({ json: true });
    configureLogger({ level: "warn" }); // should not reset json
    const spy = spyOn(console, "warn").mockImplementation(() => {});
    warn("test");
    const output = spy.mock.calls[0][0] as string;
    expect(() => JSON.parse(output)).not.toThrow(); // still JSON
    spy.mockRestore();
  });
});
