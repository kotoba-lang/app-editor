/**
 * editor kotoba — barrel.
 *
 * Per ADR-2606011400. Web code editor (projects + content-addressed files) on
 * the etzhayyim substrate (AT PDS records; no RW).
 *
 *   project : createProject / getProject / listProjects (q = app-layer search) / archiveProject
 *   file    : putFile (upsert, FK→project, content CID) / getFile / listFiles (pathPrefix)
 *   coverage
 *
 * File content is content-addressed by CID (IPFS blob); records hold metadata.
 */

export * from "./types.js";
export {
  createProject,
  getProject,
  listProjects,
  archiveProject,
  putFile,
  getFile,
  listFiles,
  coverage,
} from "./registry.js";
