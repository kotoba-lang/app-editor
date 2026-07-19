/**
 * editor kotoba — project + file registries + coverage. AT PDS records (no RW).
 * Files FK-reference an existing project; putFile is an upsert (create/update
 * content CID + path, bumping version). File content is content-addressed by CID.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  FILE_COLLECTION,
  FRAMEWORKS,
  PROJECT_COLLECTION,
  fileDidFor,
  fileRkey,
  isNonNegInt,
  looksLikeCid,
  projectDidFor,
  projectRkey,
  type ArchiveProjectInput,
  type ArchiveProjectOutput,
  type CoverageInput,
  type CoverageOutput,
  type CreateProjectInput,
  type CreateProjectOutput,
  type FileRecord,
  type FileView,
  type GetFileInput,
  type GetFileOutput,
  type GetProjectInput,
  type GetProjectOutput,
  type ListFilesInput,
  type ListFilesOutput,
  type ListProjectsInput,
  type ListProjectsOutput,
  type ProjectRecord,
  type ProjectView,
  type PutFileInput,
  type PutFileOutput,
} from "./types.js";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

async function exists(e: Etzhayyim, collection: string, rkey: string): Promise<boolean> {
  const resp = await e.read({ collection, rkey }).catch(() => ({ records: [] }));
  return Boolean(resp.records[0]?.value);
}

async function scanAll<T>(e: Etzhayyim, collection: string, maxScan: number, onRow: (v: T) => void): Promise<number> {
  let cursor: string | undefined;
  let scanned = 0;
  while (scanned < maxScan) {
    const page = await e.read<T>({ collection, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      if (scanned >= maxScan) break;
      onRow(r.value);
      scanned += 1;
    }
    if (scanned >= maxScan || !page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  return scanned;
}

// ─── Project ────────────────────────────────────────────────────────

export async function createProject(e: Etzhayyim, input: CreateProjectInput): Promise<CreateProjectOutput> {
  if (!input.projectId || !input.name) return { status: "rejected", error: "missingRequiredFields" };
  if (input.ownerDid && !input.ownerDid.startsWith("did:")) return { status: "rejected", error: "invalidOwnerDid" };
  if (input.framework && !FRAMEWORKS.has(input.framework)) return { status: "rejected", error: "invalidFramework" };
  const rkey = projectRkey(input.projectId);
  const existing = await e.read<ProjectRecord>({ collection: PROJECT_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", projectUri: existing.records[0].uri, did: existing.records[0].value.did, projectId: input.projectId };
  }
  const did = projectDidFor(input.projectId);
  const record: ProjectRecord = {
    did,
    projectId: input.projectId,
    name: input.name,
    ownerDid: input.ownerDid,
    framework: input.framework,
    status: "active",
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({ collection: PROJECT_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "created", projectUri: receipt.uri, did, projectId: input.projectId };
}

export async function getProject(e: Etzhayyim, input: GetProjectInput): Promise<GetProjectOutput> {
  if (!input.projectId) return { error: "invalidProjectId" };
  const resp = await e.read<ProjectRecord>({ collection: PROJECT_COLLECTION, rkey: projectRkey(input.projectId) }).catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r) return { error: "notFound" };
  return { project: { ...r.value, projectUri: r.uri } };
}

export async function listProjects(e: Etzhayyim, input: ListProjectsInput = {}): Promise<ListProjectsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<ProjectRecord>({ collection: PROJECT_COLLECTION, cursor: input.cursor, limit });
  const q = input.q?.toLowerCase();
  const items: ProjectView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.ownerDid && v.ownerDid !== input.ownerDid) return false;
      if (input.framework && v.framework !== input.framework) return false;
      if (input.status && v.status !== input.status) return false;
      if (q && !v.name.toLowerCase().includes(q)) return false;
      return true;
    })
    .map((r) => ({ ...r.value, projectUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

export async function archiveProject(e: Etzhayyim, input: ArchiveProjectInput): Promise<ArchiveProjectOutput> {
  if (!input.projectId) return { status: "rejected", error: "invalidProjectId" };
  const rkey = projectRkey(input.projectId);
  const resp = await e.read<ProjectRecord>({ collection: PROJECT_COLLECTION, rkey }).catch(() => ({ records: [] }));
  const project = resp.records[0]?.value;
  if (!project) return { status: "notFound", error: "projectNotFound" };
  if (project.status === "archived") return { status: "rejected", error: "alreadyArchived" };
  await e.write({ collection: PROJECT_COLLECTION, record: { ...project, status: "archived" } as unknown as Record<string, unknown>, rkey });
  return { status: "archived", projectId: input.projectId };
}

// ─── File ───────────────────────────────────────────────────────────

export async function putFile(e: Etzhayyim, input: PutFileInput): Promise<PutFileOutput> {
  if (!input.fileId || !input.projectId || !input.path) return { status: "rejected", error: "missingRequiredFields" };
  if (input.contentCid && !looksLikeCid(input.contentCid)) return { status: "rejected", error: "invalidContentCid" };
  if (input.sizeBytes != null && !isNonNegInt(input.sizeBytes)) return { status: "rejected", error: "sizeBytesMustBeNonNegInt" };
  if (!(await exists(e, PROJECT_COLLECTION, projectRkey(input.projectId)))) {
    return { status: "projectNotFound", error: `projectNotFound:${input.projectId}` };
  }
  const rkey = fileRkey(input.fileId);
  const existing = await e.read<FileRecord>({ collection: FILE_COLLECTION, rkey }).catch(() => ({ records: [] }));
  const prev = existing.records[0]?.value;
  const now = new Date().toISOString();
  if (prev) {
    if (prev.projectId !== input.projectId) return { status: "rejected", error: "projectMismatch" };
    const updated: FileRecord = {
      ...prev,
      path: input.path,
      contentCid: input.contentCid,
      sizeBytes: input.sizeBytes,
      version: prev.version + 1,
      updatedAt: now,
    };
    const receipt = await e.write({ collection: FILE_COLLECTION, record: updated as unknown as Record<string, unknown>, rkey });
    return { status: "updated", fileUri: receipt.uri, did: prev.did, fileId: input.fileId, version: updated.version };
  }
  const did = fileDidFor(input.fileId);
  const record: FileRecord = {
    did,
    fileId: input.fileId,
    projectId: input.projectId,
    path: input.path,
    contentCid: input.contentCid,
    sizeBytes: input.sizeBytes,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const receipt = await e.write({ collection: FILE_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "created", fileUri: receipt.uri, did, fileId: input.fileId, version: 1 };
}

export async function getFile(e: Etzhayyim, input: GetFileInput): Promise<GetFileOutput> {
  if (!input.fileId) return { error: "invalidFileId" };
  const resp = await e.read<FileRecord>({ collection: FILE_COLLECTION, rkey: fileRkey(input.fileId) }).catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r) return { error: "notFound" };
  return { file: { ...r.value, fileUri: r.uri } };
}

export async function listFiles(e: Etzhayyim, input: ListFilesInput = {}): Promise<ListFilesOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<FileRecord>({ collection: FILE_COLLECTION, cursor: input.cursor, limit });
  const items: FileView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.projectId && v.projectId !== input.projectId) return false;
      if (input.pathPrefix && !v.path.startsWith(input.pathPrefix)) return false;
      return true;
    })
    .map((r) => ({ ...r.value, fileUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Coverage ───────────────────────────────────────────────────────

export async function coverage(e: Etzhayyim, input: CoverageInput = {}): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  const projectsByFramework: Record<string, number> = {};
  const projectCount = await scanAll<ProjectRecord>(e, PROJECT_COLLECTION, maxScan, (v) => {
    if (v.framework) projectsByFramework[v.framework] = (projectsByFramework[v.framework] ?? 0) + 1;
  });
  let totalBytes = 0;
  const fileCount = await scanAll<FileRecord>(e, FILE_COLLECTION, maxScan, (v) => {
    if (typeof v.sizeBytes === "number") totalBytes += v.sizeBytes;
  });
  return {
    projectCount,
    fileCount,
    projectsByFramework,
    totalBytes,
    truncated: projectCount >= maxScan || fileCount >= maxScan,
  };
}
