import {
  asAgentTool,
  createWorkerExport,
  createKyselyDb,
  decodeJson,
  genID,
  nowISO,
  rlsDefaults,
  withCapabilityTags,
  withOCELEvent,
  resolveModelId,
  type HostSDK,
  nsid,
  parseLexiconInput,
} from "@etzhayyim/kotodama-host-sdk";

// Module-level refs (set inside createWorkerExport callback)
let _env: Record<string, unknown> = {};
let actorNanoid = "";

// ── SHA-256 content-addressed blob key ──

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function projectRkey(projectId: string): string { return `proj-${projectId}`; }
function fileRkey(projectId: string, path: string): string {
  return `file-${projectId}-${path.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
}

// ── Commands ──

async function cmdCreateProject(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const args = parseLexiconInput("com.etzhayyim.apps.editor.createProject", body);
  if (!args.name) return { error: "name required" };
  const projectId = genID("proj");
  const rls = rlsDefaults(actorNanoid);
  const record = {
    projectId,
    name: args.name,
    template: args.template || "vanilla",
    createdAt: nowISO(),
    ...rls,
  };
  await sdk.pds.createRecord("editorProject", record, projectRkey(projectId));
  return { projectId, ...record };
}

async function cmdListProjects(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const args = parseLexiconInput("com.etzhayyim.apps.editor.listProjects", body);
  const limit = Math.min(Number(args.limit) || 50, 100);
  const offset = Number(args.offset) || 0;
  const db = createKyselyDb();
  const rows = await db.selectFrom("vertex_editor_project").selectAll().where("actor_id","=",actorNanoid).orderBy("created_at","desc").offset(offset).limit(limit).execute();
  return { projects: rows, offset, limit };
}

interface WriteFileArgs {
  projectId: string;
  path: string;
  content: string;
  mimeType?: string;
}

async function writeFileImpl(sdk: HostSDK, args: WriteFileArgs): Promise<Record<string, unknown>> {
  const bytes = new TextEncoder().encode(args.content);
  const sha256 = await sha256Hex(bytes);
  const mimeType = args.mimeType || "text/plain";
  const blobRef = `editor/${sha256}`;

  // Content-addressed upload (idempotent — same SHA → same key)
  await sdk.pds.cdnUpload("editor", sha256, bytes, mimeType);

  const rls = rlsDefaults(actorNanoid);
  const record = {
    projectId: args.projectId,
    path: args.path,
    blobRef,
    sha256,
    sizeBytes: bytes.length,
    mimeType,
    updatedAt: nowISO(),
    ...rls,
  };
  await sdk.pds.createRecord("editorFile", record, fileRkey(args.projectId, args.path));
  return record;
}

async function cmdWriteFile(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const args = parseLexiconInput("com.etzhayyim.apps.editor.writeFile", body) as WriteFileArgs;
  if (!args.projectId || !args.path) return { error: "projectId and path required" };
  return writeFileImpl(sdk, args);
}

async function cmdReadFile(_sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const args = parseLexiconInput("com.etzhayyim.apps.editor.readFile", body);
  if (!args.projectId || !args.path) return { error: "projectId and path required" };
  const db = createKyselyDb();
  const rows = await db.selectFrom("vertex_editor_file").selectAll().where("project_id","=",args.projectId as string).where("path","=",args.path as string).where("actor_id","=",actorNanoid).orderBy("updated_at","desc").limit(1).execute();
  return rows[0] ?? { error: "not found" };
}

async function cmdListFiles(_sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const args = parseLexiconInput("com.etzhayyim.apps.editor.listFiles", body);
  if (!args.projectId) return { error: "projectId required" };
  const limit = Math.min(Number(args.limit) || 200, 1000);
  const offset = Number(args.offset) || 0;
  const db = createKyselyDb();
  const rows = await db.selectFrom("vertex_editor_file").selectAll().where("project_id","=",args.projectId as string).where("actor_id","=",actorNanoid).orderBy("path","asc").offset(offset).limit(limit).execute();
  return { projectId: args.projectId, files: rows, offset, limit };
}

async function cmdGenerate(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const args = parseLexiconInput("com.etzhayyim.apps.editor.generate", body);
  if (!args.projectId || !args.prompt) return { error: "projectId and prompt required" };

  const ai = (_env as any).AI;
  if (!ai) throw new Error("AI binding missing");

  const framework = (args.framework as string) || "react";
  const targetPath = (args.targetPath as string) || (framework === "svelte" ? "src/App.svelte" : "src/App.jsx");
  const cfModel = "@cf/qwen/qwen2.5-coder-32b-instruct";

  const sys = `You are a v0.dev-style code generator. Output ONLY the complete file content for ${targetPath} (${framework}). No prose, no code fences, no explanations.`;
  const result = await ai.run(cfModel, {
    messages: [
      { role: "system", content: sys },
      { role: "user", content: String(args.prompt) },
    ],
    max_tokens: 4096,
  }) as { response?: string };

  const code = (result.response ?? "").trim();
  const writeRes = await writeFileImpl(sdk, {
    projectId: String(args.projectId),
    path: targetPath,
    content: code,
    mimeType: framework === "svelte" ? "text/x-svelte" : "text/jsx",
  });

  return { path: targetPath, framework, code, model: resolveModelId("qwen2.5-coder-32b", "code"), write: writeRes };
}

// ── UI: GET / → inline single-page editor (CodeMirror 6 + Sandpack) ──

const UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Editor — editor.etzhayyim.com</title>
<style>
  :root { --bg:#0b0d10; --fg:#e6e6e6; --panel:#15181d; --border:#262a31; --accent:#7aa2ff; }
  * { box-sizing:border-box; }
  html,body { margin:0; padding:0; height:100%; background:var(--bg); color:var(--fg); font-family:ui-monospace,Menlo,Consolas,monospace; font-size:13px; }
  #app { display:grid; grid-template-columns:220px 1fr 1fr; grid-template-rows:1fr 140px; height:100vh; gap:1px; background:var(--border); }
  aside { background:var(--panel); padding:10px; overflow:auto; grid-row:1/3; }
  aside h2 { font-size:11px; text-transform:uppercase; color:#888; margin:12px 0 6px; }
  aside h2:first-child { margin-top:0; }
  aside ul { list-style:none; padding:0; margin:0; }
  aside li { padding:4px 6px; cursor:pointer; border-radius:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  aside li:hover { background:#1e232b; }
  aside li.active { background:#2a3140; color:var(--accent); }
  aside button { width:100%; background:#1e232b; color:var(--fg); border:1px solid var(--border); padding:6px; border-radius:3px; cursor:pointer; margin-bottom:6px; font-family:inherit; font-size:12px; }
  aside button:hover { background:#2a3140; }
  main { background:var(--panel); display:flex; flex-direction:column; overflow:hidden; }
  main header { padding:8px 12px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; }
  main header span { color:#888; }
  main header button { background:var(--accent); color:#0b0d10; border:0; padding:4px 12px; border-radius:3px; cursor:pointer; font-weight:600; }
  #editor { flex:1; overflow:auto; }
  .cm-editor { height:100%; font-size:13px; }
  #preview { background:#fff; overflow:hidden; }
  #sandpack { width:100%; height:100%; border:0; }
  footer { grid-column:2/4; background:var(--panel); border-top:1px solid var(--border); padding:10px; display:flex; gap:8px; }
  footer textarea { flex:1; background:#0b0d10; color:var(--fg); border:1px solid var(--border); border-radius:3px; padding:8px; font-family:inherit; font-size:13px; resize:none; }
  footer select, footer button { background:#1e232b; color:var(--fg); border:1px solid var(--border); padding:8px 12px; border-radius:3px; cursor:pointer; font-family:inherit; }
  footer button { background:var(--accent); color:#0b0d10; font-weight:600; border:0; }
  footer button:disabled { opacity:.5; cursor:wait; }
  .toast { position:fixed; bottom:160px; right:20px; background:#2a3140; padding:10px 16px; border-radius:4px; border:1px solid var(--accent); font-size:12px; }
</style>
</head>
<body>
<div id="app">
  <aside>
    <button id="newProject">+ New Project</button>
    <h2>Projects</h2>
    <ul id="projectList"></ul>
    <button id="newFile" style="margin-top:12px">+ New File</button>
    <h2>Files</h2>
    <ul id="fileList"></ul>
  </aside>
  <main>
    <header>
      <span id="currentPath">no file selected</span>
      <button id="saveBtn">Save</button>
    </header>
    <div id="editor"></div>
  </main>
  <section id="preview"><iframe id="sandpack"></iframe></section>
  <footer>
    <textarea id="prompt" placeholder="Describe what to build (v0.dev-style). e.g. 'a todo list with dark mode toggle'"></textarea>
    <select id="framework">
      <option value="react">React</option>
      <option value="svelte">Svelte</option>
      <option value="vanilla">Vanilla</option>
    </select>
    <button id="generateBtn">Generate</button>
  </footer>
</div>
<script type="module">
import { EditorView, basicSetup } from "https://esm.sh/codemirror@6.0.1";
import { javascript } from "https://esm.sh/@codemirror/lang-javascript@6.2.2";
import { oneDark } from "https://esm.sh/@codemirror/theme-one-dark@6.1.2";
import { EditorState } from "https://esm.sh/@codemirror/state@6.4.1";
import { loadSandpackClient } from "https://esm.sh/@codesandbox/sandpack-client@2.19.8";

const xrpc = (nsid, body) => fetch("/xrpc/" + nsid, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body || {}),
}).then(r => r.json());

const state = {
  projectId: localStorage.getItem("editor.projectId"),
  projectName: localStorage.getItem("editor.projectName"),
  currentPath: null,
  files: {},
};

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ── CodeMirror 6 ──
const initialDoc = "// Welcome to editor.etzhayyim.com\\n// Create a project and start coding, or describe what you want below.\\n";
let view = new EditorView({
  state: EditorState.create({
    doc: initialDoc,
    extensions: [basicSetup, javascript({ jsx: true, typescript: true }), oneDark],
  }),
  parent: document.getElementById("editor"),
});

function setEditorContent(text) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

// ── Sandpack ──
let sandpackClient = null;
async function mountSandpack(entry) {
  const iframe = document.getElementById("sandpack");
  const files = {};
  for (const [p, content] of Object.entries(state.files)) {
    files[p.startsWith("/") ? p : "/" + p] = { code: content };
  }
  if (!files["/src/App.jsx"] && !files["/src/App.tsx"] && !files["/App.svelte"]) {
    files["/src/App.jsx"] = { code: 'export default () => <div style={{padding:20,fontFamily:"sans-serif"}}>Generate code to see preview</div>;' };
  }
  const entryFile = entry || "/src/App.jsx";
  const template = entryFile.endsWith(".svelte") ? "svelte" : "react";
  try {
    sandpackClient = await loadSandpackClient(iframe, {
      files,
      entry: entryFile,
      dependencies: template === "svelte" ? {} : { "react": "^18.0.0", "react-dom": "^18.0.0" },
    }, { showOpenInCodeSandbox: false, template });
  } catch (e) {
    console.error("sandpack mount failed", e);
  }
}

async function refreshSandpack() {
  if (!sandpackClient) { await mountSandpack(); return; }
  const files = {};
  for (const [p, content] of Object.entries(state.files)) {
    files[p.startsWith("/") ? p : "/" + p] = { code: content };
  }
  sandpackClient.updateSandbox({ files, entry: "/src/App.jsx" });
}

// ── UI rendering ──
function renderFiles() {
  const ul = document.getElementById("fileList");
  ul.innerHTML = "";
  for (const path of Object.keys(state.files).sort()) {
    const li = document.createElement("li");
    li.textContent = path;
    if (path === state.currentPath) li.classList.add("active");
    li.onclick = () => openFile(path);
    ul.appendChild(li);
  }
}

function renderProjects() {
  const ul = document.getElementById("projectList");
  ul.innerHTML = "";
  if (state.projectId) {
    const li = document.createElement("li");
    li.textContent = (state.projectName || "Project") + " (" + state.projectId.slice(0, 8) + ")";
    li.classList.add("active");
    ul.appendChild(li);
  }
}

function openFile(path) {
  state.currentPath = path;
  document.getElementById("currentPath").textContent = path;
  setEditorContent(state.files[path] || "");
  renderFiles();
}

// ── Actions ──
document.getElementById("newProject").onclick = async () => {
  const name = prompt("Project name?");
  if (!name) return;
  const res = await xrpc("com.etzhayyim.apps.editor.createProject", { name, template: "react" });
  if (!res.projectId) { toast("create failed: " + JSON.stringify(res)); return; }
  state.projectId = res.projectId;
  state.projectName = name;
  state.files = {};
  state.currentPath = null;
  localStorage.setItem("editor.projectId", res.projectId);
  localStorage.setItem("editor.projectName", name);
  renderProjects(); renderFiles();
  toast("Created " + name);
};

document.getElementById("newFile").onclick = () => {
  if (!state.projectId) return toast("create a project first");
  const path = prompt("File path?", "src/App.jsx");
  if (!path) return;
  state.files[path] = "";
  openFile(path);
};

document.getElementById("saveBtn").onclick = async () => {
  if (!state.projectId || !state.currentPath) return toast("no file selected");
  const content = view.state.doc.toString();
  state.files[state.currentPath] = content;
  const res = await xrpc("com.etzhayyim.apps.editor.writeFile", {
    projectId: state.projectId,
    path: state.currentPath,
    content,
    mimeType: state.currentPath.endsWith(".svelte") ? "text/x-svelte" : "text/jsx",
  });
  toast(res.sha256 ? "Saved " + res.sha256.slice(0, 8) : "save failed");
  await refreshSandpack();
};

document.getElementById("generateBtn").onclick = async () => {
  if (!state.projectId) return toast("create a project first");
  const btn = document.getElementById("generateBtn");
  const promptText = document.getElementById("prompt").value.trim();
  if (!promptText) return toast("enter a prompt");
  const framework = document.getElementById("framework").value;
  btn.disabled = true; btn.textContent = "Generating...";
  try {
    const res = await xrpc("com.etzhayyim.apps.editor.generate", {
      projectId: state.projectId, prompt: promptText, framework,
    });
    if (!res.code) { toast("generate failed: " + JSON.stringify(res).slice(0, 100)); return; }
    state.files[res.path] = res.code;
    openFile(res.path);
    await refreshSandpack();
    toast("Generated " + res.path);
  } finally {
    btn.disabled = false; btn.textContent = "Generate";
  }
};

// ── Init ──
renderProjects(); renderFiles();
mountSandpack();
</script>
</body>
</html>`;

function handleUIPath(request: Request): Response | null {
  const url = new URL(request.url);
  if (request.method !== "GET") return null;
  if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/editor") {
    return new Response(UI_HTML, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=60",
      },
    });
  }
  return null;
}

// ── Blob proxy: GET /api/blob/{sha256hex} → cdn.etzhayyim.com ──
//
// Files are uploaded via `sdk.pds.cdnUpload("editor", sha256, ...)`,
// which writes to the PDS-owned B2 bucket. Reads are served by the
// canonical public CDN endpoint at `https://cdn.etzhayyim.com/editor/{sha256}`
// (cdnPublicUrl convention). This route stays for backward
// compatibility and same-origin requests; it 302-redirects so the
// browser caches the canonical URL directly.
function handleBlobPath(request: Request): Response | null {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/api\/blob\/([a-f0-9]{64})$/);
  if (!m || request.method !== "GET") return null;
  return Response.redirect(`https://cdn.etzhayyim.com/editor/${m[1]}`, 302);
}

// ── Worker export ──

const _inner = createWorkerExport((sdk) => {
  actorNanoid = sdk.pds.selfNanoid ?? "";
  sdk.app
    .command(nsid("com.etzhayyim.apps.editor.createProject"), (_ctx, body) => cmdCreateProject(sdk, body),
      asAgentTool("Create a new code editor project"),
      withCapabilityTags("editor", "project", "create"),
      withOCELEvent("editor.project.created"),
    )
    .query(nsid("com.etzhayyim.apps.editor.listProjects"), (_ctx, body) => cmdListProjects(sdk, body))
    .command(nsid("com.etzhayyim.apps.editor.writeFile"), (_ctx, body) => cmdWriteFile(sdk, body),
      asAgentTool("Write or update a file in a project (content-addressed blob)"),
      withCapabilityTags("editor", "file", "write"),
      withOCELEvent("editor.file.written"),
    )
    .query(nsid("com.etzhayyim.apps.editor.readFile"), (_ctx, body) => cmdReadFile(sdk, body))
    .query(nsid("com.etzhayyim.apps.editor.listFiles"), (_ctx, body) => cmdListFiles(sdk, body))
    .command(nsid("com.etzhayyim.apps.editor.generate"), (_ctx, body) => cmdGenerate(sdk, body),
      asAgentTool("v0.dev-style code generation from a natural-language prompt"),
      withCapabilityTags("editor", "llm", "codegen"),
      withOCELEvent("editor.code.generated"),
    );
  return sdk;
});

export default {
  async fetch(request: Request, env: Record<string, unknown>, ctx?: { waitUntil(p: Promise<unknown>): void }) {
    _env = env;
    const uiResp = handleUIPath(request);
    if (uiResp) return uiResp;
    const blobResp = handleBlobPath(request);
    if (blobResp) return blobResp;
    return _inner.fetch(request, env, ctx);
  },
};
