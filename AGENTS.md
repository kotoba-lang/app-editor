# etzhayyim-project-editor — editor.etzhayyim.com

**Web code editor + project manager (v0.dev-like).** CodeMirror 6 + Sandpack in-browser preview。Pattern 1 (Single Worker + B2 content-addressed blob + yata SQL graph), platform-compliant 修正版。P0 = single user, no realtime collab。

## Components

| Component | Folder | nanoid | Role |
|---|---|---|---|
| editor | `wasm/etzhayyim-wasm-editor-ed1t0r00/` | `ed1t0r00` | XRPC API + Hono router + Svelte CSR (P0b) |

## Architecture (Pattern 1, platform-compliant)

```
Browser (CodeMirror 6 + Sandpack iframe preview)
  │
  │ XRPC /xrpc/com.etzhayyim.apps.editor.*
  ▼
editor Worker (createWorkerExport + @etzhayyim/kotodama-host-sdk)
  ├─ createProject  → ComAtprotoRepoCreateRecord(collection: "project")
  ├─ listProjects   → G("EditorProject").Match({ownerDid}).Return(...)
  ├─ writeFile      → uploadBlob (SHA-256 content-addressed → R2)
  │                 → ComAtprotoRepoCreateRecord(collection: "file", { projectId, path, blobRef })
  ├─ readFile       → resolve blob via /api/blob/{sha256}
  ├─ listFiles      → G("EditorFile").Match({projectId}).Return(...)
  └─ generate       → env.AI (Workers AI, llm-model-registry SSoT) → loop writeFile
```

## Design E 3-Tier Write

- **Tier 1 Social**: project create / file commit は PDS commit pipeline の derive rule で自動 `app.bsky.feed.post` 化 (Write-Only Derived)
- **Tier 2 Domain**: `com.etzhayyim.apps.editor.project` / `com.etzhayyim.apps.editor.file` records
- **Tier 3 State**: editor preferences (theme, keymap, recent files) → `Preferences()`

## Storage

| Layer | Location | Purpose |
|---|---|---|
| Blob | B2 `blobs/{repo}/{sha256hex}` | File content (SHA-256 dedup, PDS uploadBlob) |
| Graph | yata `:EditorProject`, `:EditorFile` | Project tree, file metadata, ownership |
| State | `Preferences()` | per-user editor settings (PII-safe) |

## SQL Graph

| Label | Key | Properties |
|---|---|---|
| `:EditorProject` | `projectId` | name, ownerDid, createdAt, template |
| `:EditorFile` | `projectId,path` | blobRef (sha256), mimeType, sizeBytes, updatedAt |

## Lexicons

`00-contracts/lexicons/com/etzhayyim/editor/`:
- `project.json` — record schema
- `file.json` — record schema
- `createProject.json` — procedure
- `listProjects.json` — query
- `writeFile.json` — procedure
- `readFile.json` — query
- `listFiles.json` — query
- `generate.json` — procedure (LLM gen)

## Build & Deploy

```bash
cd 60-apps/etzhayyim-project-editor/wasm/etzhayyim-wasm-editor-ed1t0r00
mkdir -p build && npx esbuild src/app.ts --bundle --outfile=build/worker.mjs --format=esm --platform=browser --target=es2022 --external:cloudflare:workers
pnpm wrangler deploy
curl https://editor.etzhayyim.com/health
```

## Roadmap

- **P0a (this scaffold)**: backend XRPC API + lexicons + kotodama.jsonld
- **P0b**: frontend (CodeMirror 6 + Sandpack), Hono static serve
- **P1**: multi-user wRPC stream collab (`handleStream("file-updates", ...)`)
- **P2**: LLM inline diff patch (Cursor 風)
- **P3**: optional W Protocol full integration (Pattern 3, project = ActorDID)
