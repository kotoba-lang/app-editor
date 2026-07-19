import { MURAKUMO_DEFAULT_MODEL, resolveModelId as resolveSharedModelId } from "@etzhayyim/llm-models";

// Local shim for @etzhayyim/llm-models until the package is published.
// Keep the same surface but delegate to the repo-wide model registry.
export function resolveModelId(modelHint?: string, useCase?: string): string {
  return resolveSharedModelId(modelHint, useCase) || MURAKUMO_DEFAULT_MODEL;
}
