import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Standalone clones use .env.local or .env. Keep the original workspace fallback.
export function localEnvFile() {
  const candidates = process.env.IRIS_ENV_FILE
    ? [process.env.IRIS_ENV_FILE]
    : [".env.local", ".env", "../.env"];
  return (
    candidates.map((path) => resolve(path)).find(existsSync) ?? resolve(".env")
  );
}
