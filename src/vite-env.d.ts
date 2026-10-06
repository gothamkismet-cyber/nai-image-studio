/// <reference types="vite/client" />

declare module "*library-runtime.mjs" {
  export const libraryFrameHtml: string;
  export function runLibrarySandbox(codes: { name: string; code: string }[], html: string, timeoutMs?: number): Promise<{ data: Record<string, unknown>; failedFiles: string[] }>;
}
