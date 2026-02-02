/**
 * Browser shim for src/ai/context.ts — provides only the constants
 * that src/logic/expr.ts imports.
 */

/** Hard cap on context size (~250k tokens) */
export const MAX_CONTEXT_CHAR_LIMIT = 1_000_000;
