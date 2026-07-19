import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  createProject,
  getProject,
  listProjects,
  archiveProject,
  putFile,
  getFile,
  listFiles,
  coverage,
} from "../src/index.js";

const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const CID2 = "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";
const OWNER = "did:web:dev.example.com";

describe("editor kotoba", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: "did:web:editor.etzhayyim.com" });
  });

  describe("project", () => {
    it("creates, reads, lists by framework + app-layer search; archives", async () => {
      expect((await createProject(e, { projectId: "P-1", name: "My App", framework: "react", ownerDid: OWNER })).status).toBe("created");
      expect((await getProject(e, { projectId: "P-1" })).project?.framework).toBe("react");
      expect((await createProject(e, { projectId: "P-1", name: "dup" })).status).toBe("alreadyExists");
      expect((await createProject(e, { projectId: "P-X", name: "x", framework: "cobol" as any })).status).toBe("rejected");
      expect((await listProjects(e, { framework: "react" })).total).toBe(1);
      expect((await listProjects(e, { q: "my app" })).total).toBe(1);
      expect((await archiveProject(e, { projectId: "P-1" })).status).toBe("archived");
      expect((await listProjects(e, { status: "active" })).total).toBe(0);
      expect((await archiveProject(e, { projectId: "P-1" })).status).toBe("rejected");
    });
  });

  describe("files (upsert) against a project", () => {
    beforeEach(async () => {
      await createProject(e, { projectId: "P-1", name: "My App", framework: "react" });
    });
    it("creates then updates a file (version bump, FK→project), rejects bad cid/missing project", async () => {
      const c = await putFile(e, { fileId: "F-1", projectId: "P-1", path: "src/App.tsx", contentCid: CID, sizeBytes: 1024 });
      expect(c.status).toBe("created");
      expect(c.version).toBe(1);
      const u = await putFile(e, { fileId: "F-1", projectId: "P-1", path: "src/App.tsx", contentCid: CID2, sizeBytes: 2048 });
      expect(u.status).toBe("updated");
      expect(u.version).toBe(2);
      expect((await getFile(e, { fileId: "F-1" })).file?.contentCid).toBe(CID2);
      expect((await putFile(e, { fileId: "F-X", projectId: "P-1", path: "x", contentCid: "nope" })).status).toBe("rejected");
      expect((await putFile(e, { fileId: "F-X", projectId: "GHOST", path: "x" })).status).toBe("projectNotFound");
    });
    it("lists files by project + path prefix", async () => {
      await putFile(e, { fileId: "F-1", projectId: "P-1", path: "src/App.tsx", sizeBytes: 100 });
      await putFile(e, { fileId: "F-2", projectId: "P-1", path: "src/lib/util.ts", sizeBytes: 50 });
      await putFile(e, { fileId: "F-3", projectId: "P-1", path: "README.md", sizeBytes: 20 });
      expect((await listFiles(e, { projectId: "P-1" })).total).toBe(3);
      expect((await listFiles(e, { pathPrefix: "src/" })).total).toBe(2);
    });
    it("coverage rolls up projects + files + total bytes", async () => {
      await putFile(e, { fileId: "F-1", projectId: "P-1", path: "a", sizeBytes: 100 });
      await putFile(e, { fileId: "F-2", projectId: "P-1", path: "b", sizeBytes: 50 });
      const cov = await coverage(e);
      expect(cov.projectCount).toBe(1);
      expect(cov.fileCount).toBe(2);
      expect(cov.totalBytes).toBe(150);
      expect(cov.projectsByFramework?.react).toBe(1);
    });
  });
});
