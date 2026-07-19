// Stub for @etzhayyim/kami-engine-sdk/genko — the editor Worker never invokes
// genkoEmbedHTML, but host-web-router imports it at module load time. Svelte 5
// runes ($state) in the real dist break Worker bundling, so we short-circuit here.
export function genkoEmbedHTML(_opts?: unknown): string {
  return "";
}
