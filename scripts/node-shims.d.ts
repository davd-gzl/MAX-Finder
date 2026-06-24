// Minimal ambient declarations for Node built-ins used by fetch-data.ts.
// These substitute for @types/node which is not installed in this project.

type BufferEncoding = "utf-8" | "utf8" | "ascii" | "binary" | "base64" | "hex";

declare module "fs" {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function writeFileSync(file: string, data: string, encoding: BufferEncoding): void;
}

declare module "path" {
  export function resolve(...paths: string[]): string;
  export function dirname(p: string): string;
}

declare namespace NodeJS {
  interface ProcessEnv {
    [key: string]: string | undefined;
  }
}

declare const process: {
  cwd(): string;
  exit(code?: number): never;
  env: NodeJS.ProcessEnv;
};
