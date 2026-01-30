declare module "nunjucks" {
  export class Environment {
    constructor(loader?: Loader | null, opts?: EnvironmentOptions);
    addFilter(
      name: string,
      fn: (...args: unknown[]) => unknown,
      async?: boolean,
    ): void;
    addGlobal(name: string, value: unknown): void;
    renderString(src: string, ctx?: Record<string, unknown>): string;
  }

  export interface EnvironmentOptions {
    autoescape?: boolean;
    trimBlocks?: boolean;
    lstripBlocks?: boolean;
    throwOnUndefined?: boolean;
  }

  export class Loader {
    cache: Record<string, unknown>;
    getSource(name: string): { src: string; path: string; noCache: boolean } | null;
  }

  export const runtime: {
    memberLookup: (obj: unknown, val: unknown) => unknown;
    callWrap: (
      obj: unknown,
      name: string,
      context: unknown,
      args: unknown[],
    ) => unknown;
    fromIterator: (arr: unknown) => unknown;
  };
}
