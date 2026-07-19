/**
 * editor kotoba — web code-editor record types.
 *
 * Per ADR-2606011400. editor is a v0.dev-style web code editor + project
 * manager: projects + files (FK→project, content-addressed by CID). Registry on
 * AT PDS records (replaces the yata SQL graph). ADR-2605172000 kotoba.
 *
 * AXIS NOTE (ADR-2605172400): axis-clean — project/file metadata is user work
 * product, not personal PII. File content is referenced by CID (a content-
 * addressed blob — IPFS in the etzhayyim deployment; may be encrypted), not
 * inlined. No settlement, no fulfillment liability. The v0-style LLM-gen compute
 * + blob backend are separate.
 *
 * AT-Lexicon: no float. File size is an integer (bytes).
 *
 * Identity hierarchy:
 *   did:web:editor.etzhayyim.com                       — controller
 *   did:web:editor.etzhayyim.com:project:{projectId}   — a project
 *   did:web:editor.etzhayyim.com:file:{fileId}         — a file
 */

export const EDITOR_DID_PREFIX = "did:web:editor.etzhayyim.com:" as const;

export const PROJECT_COLLECTION = "com.etzhayyim.apps.editor.editorProject";
export const FILE_COLLECTION = "com.etzhayyim.apps.editor.editorFile";

// ─── Project ────────────────────────────────────────────────────────

export type Framework = "react" | "vue" | "svelte" | "vanilla" | "node" | "other";
export type ProjectStatus = "active" | "archived";

export interface ProjectRecord {
  did: string;
  projectId: string;
  name: string;
  ownerDid?: string;
  framework?: Framework;
  status: ProjectStatus;
  createdAt: string;
}
export interface ProjectView extends ProjectRecord {
  projectUri: string;
}
export interface CreateProjectInput {
  projectId: string;
  name: string;
  ownerDid?: string;
  framework?: Framework;
}
export interface CreateProjectOutput {
  status: "created" | "alreadyExists" | "rejected";
  projectUri?: string;
  did?: string;
  projectId?: string;
  error?: string;
}
export interface GetProjectInput {
  projectId: string;
}
export interface GetProjectOutput {
  project?: ProjectView;
  error?: string;
}
export interface ListProjectsInput {
  ownerDid?: string;
  framework?: Framework;
  status?: ProjectStatus;
  /** App-layer substring match over name. */
  q?: string;
  limit?: number;
  cursor?: string;
}
export interface ListProjectsOutput {
  items: ProjectView[];
  cursor?: string;
  total: number;
}
export interface ArchiveProjectInput {
  projectId: string;
}
export interface ArchiveProjectOutput {
  status: "archived" | "notFound" | "rejected";
  projectId?: string;
  error?: string;
}

// ─── File ───────────────────────────────────────────────────────────

export interface FileRecord {
  did: string;
  fileId: string;
  /** FK → project projectId. */
  projectId: string;
  /** Path within the project, e.g. "src/App.tsx". */
  path: string;
  /** Content-addressed CID of the file blob, optional (empty file). */
  contentCid?: string;
  /** Size in bytes (integer), optional. */
  sizeBytes?: number;
  /** Bumps on each put. */
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface FileView extends FileRecord {
  fileUri: string;
}
export interface PutFileInput {
  fileId: string;
  projectId: string;
  path: string;
  contentCid?: string;
  sizeBytes?: number;
}
export interface PutFileOutput {
  status: "created" | "updated" | "rejected" | "projectNotFound";
  fileUri?: string;
  did?: string;
  fileId?: string;
  version?: number;
  error?: string;
}
export interface GetFileInput {
  fileId: string;
}
export interface GetFileOutput {
  file?: FileView;
  error?: string;
}
export interface ListFilesInput {
  projectId?: string;
  /** App-layer prefix match over path (e.g. "src/"). */
  pathPrefix?: string;
  limit?: number;
  cursor?: string;
}
export interface ListFilesOutput {
  items: FileView[];
  cursor?: string;
  total: number;
}

// ─── Coverage ───────────────────────────────────────────────────────

export interface CoverageInput {
  maxScan?: number;
}
export interface CoverageOutput {
  projectCount?: number;
  fileCount?: number;
  projectsByFramework?: Record<string, number>;
  totalBytes?: number;
  truncated?: boolean;
  error?: string;
}

// ─── Validation + helpers ───────────────────────────────────────────

export const FRAMEWORKS: ReadonlySet<string> = new Set(["react", "vue", "svelte", "vanilla", "node", "other"]);

export function isNonNegInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}
export function looksLikeCid(s: string): boolean {
  return /^b[a-z2-7]{20,}$/.test(s) || /^Qm[1-9A-HJ-NP-Za-km-z]{20,}$/.test(s);
}

export function projectDidFor(id: string): string {
  return `${EDITOR_DID_PREFIX}project:${id.toLowerCase()}`;
}
export function projectRkey(id: string): string {
  return `project-${id.toLowerCase()}`;
}
export function fileDidFor(id: string): string {
  return `${EDITOR_DID_PREFIX}file:${id.toLowerCase()}`;
}
export function fileRkey(id: string): string {
  return `file-${id.toLowerCase()}`;
}
