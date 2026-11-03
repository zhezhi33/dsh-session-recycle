/**
 * dsh-session-recycle — Server half.
 *
 * 两段式删除，语义与界面文案一一对应：
 *
 *   ① 移入回收站（可恢复）
 *      - 会话目录整体 rename 进插件回收站，同盘原子操作，不复制；
 *      - 该会话的子代理会话目录随主会话一起搬走（整棵树）；
 *      - 侧栏投影缓存行、工作区账本引用原样备份到 meta 里再摘除，
 *        所以侧栏立刻不再显示，但数据一个字节都没丢；
 *      - 日志、缓存、附件一律不动。
 *
 *   ② 彻底删除（不可恢复）
 *      - 删掉回收站里的整棵会话树（含全部子代理）；
 *      - 清投影缓存行及其 .bak 备份、工作区账本（sessionIds / 归档 / 置顶）；
 *      - 清 logs 里提到这些会话的行、清 cache 下对应条目；
 *      - 清只有它们引用过的附件对象与 files-v3 登记。
 *
 *   ③ 恢复
 *      - 目录搬回原工作区位置，投影缓存行写回原槽位，侧栏原位重现。
 *
 * 会话文件是多帧拼接的 zstd：one-shot 解压只吐第一帧，
 * 这里按帧魔数切开逐帧解，才能拿到完整正文。
 */

import { readdir, stat, mkdir, rename, rm, readFile, writeFile, lstat } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute, sep, dirname, basename, extname } from "node:path";
import { zstdDecompress } from "node:zlib";
import { promisify } from "node:util";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const name = "dsh-session-recycle";
export const inject = ["webServer", "dshHomePath", "workspaceRegistry", "storageDomain", "agents", "sessions"];

const API_PREFIX = "/session-recycle/api";
const zstd = promisify(zstdDecompress);
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/* ───────────────────────── 通用工具 ───────────────────────── */

function getService(ctx, name) {
  try {
    const value = typeof ctx?.get === "function" ? ctx.get(name) : undefined;
    if (value !== undefined) return value;
  } catch { /* fall through */ }
  return ctx && ctx[name];
}

function safeErrorMessage(error) {
  if (error === null || error === undefined) return `<nullish:${typeof error}>`;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    if (typeof error.message === "string" && error.message.length > 0) return error.message;
    if (typeof error.code === "string" && error.code.length > 0) return `[code=${error.code}]`;
  }
  try { return JSON.stringify(error); } catch { return String(error); }
}

function assertSessionId(id) {
  if (typeof id !== "string" || id.trim() === "" || id === "." || id === ".."
    || /[\\/\x00-\x1f<>:"|?*]/.test(id) || /[. ]$/.test(id)) {
    throw Object.assign(new Error("会话标识不合法"), { code: "bad-request" });
  }
  return id;
}

async function decodeZstdFrames(buffer) {
  const starts = [];
  let i = buffer.indexOf(ZSTD_MAGIC, 0);
  while (i !== -1) { starts.push(i); i = buffer.indexOf(ZSTD_MAGIC, i + 4); }
  if (starts.length === 0) return "";
  const parts = [];
  for (let k = 0; k < starts.length; k++) {
    const from = starts[k];
    const to = k + 1 < starts.length ? starts[k + 1] : buffer.length;
    try { parts.push(await zstd(buffer.subarray(from, to))); } catch { /* 跳过坏帧 */ }
  }
  return Buffer.concat(parts).toString("utf8");
}

async function dirSize(dir) {
  let total = 0;
  const walk = async (d) => {
    let ents;
    try { ents = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else { try { total += (await stat(p)).size; } catch { /* ignore */ } }
    }
  };
  await walk(dir);
  return total;
}

/* ───────────────────────── 插件主体 ───────────────────────── */

export function apply(ctx) {
  const service = (n) => getService(ctx, n);
  const homePath = service("dshHomePath");
  if (typeof homePath !== "function") {
    ctx?.logger?.warn?.("session-recycle: dshHomePath 服务不可用，插件停用");
    return;
  }

  const info = (msg) => { try { ctx?.logger?.info?.(msg); } catch { /* ignore */ } };
  info("dsh-session-recycle v0.2.0");

  const sessionsRoot = () => resolve(String(homePath("sessions")));
  const pluginRoot = () => resolve(String(homePath("dsh-session-recycle")));
  const trashRoot = () => join(pluginRoot(), "trash");
  const metaRoot = () => join(pluginRoot(), "meta");
  const projCacheDir = () => resolve(String(homePath("storages")), "session_projcache", "sessions");
  const workspaceFile = () => resolve(String(homePath("storages")), "workspace.json");
  const logsDir = () => resolve(String(homePath("logs")));
  const attachmentsObjects = () => resolve(String(homePath("attachments")), "v1", "objects");
  const filesIndex = () => resolve(String(homePath("llm-deepseek")), "files-v3.json");

  const readBody = async (req) => {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > 256 * 1024) throw Object.assign(new Error("请求体过大"), { code: "body-too-large" });
      chunks.push(bytes);
    }
    return Buffer.concat(chunks).toString("utf8");
  };

  const send = (res, code, obj) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj));
  };

  const readJson = async (file) => {
    try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
  };
  const writeJson = async (file, data) => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data, null, 2), "utf8");
  };

  /* ── 会话扫描（含子代理） ───────────────────────────────── */

  const scanSessions = async () => {
    const root = sessionsRoot();
    const out = [];
    let projects;
    try { projects = await readdir(root, { withFileTypes: true }); } catch { return out; }
    for (const proj of projects) {
      if (!proj.isDirectory()) continue;
      const pd = join(root, proj.name);
      let subs;
      try { subs = await readdir(pd, { withFileTypes: true }); } catch { continue; }
      for (const sub of subs) {
        if (!sub.isDirectory()) continue;
        out.push({ id: sub.name, project: proj.name, dir: join(pd, sub.name), projectKey: proj.name });
      }
    }
    return out;
  };

  const sessionFile = (dir) => join(dir, "session.v4.jsonl.zstd");

  const readSessionHead = async (dir) => {
    const file = sessionFile(dir);
    let buf;
    try { buf = await readFile(file); } catch { return null; }
    const chunk = buf.subarray(0, Math.min(buf.length, 64 * 1024));
    const text = await decodeZstdFrames(chunk.length >= ZSTD_MAGIC.length ? chunk : buf);
    const nl = text.indexOf("\n");
    const line = nl === -1 ? text : text.slice(0, nl);
    try {
      const obj = JSON.parse(line);
      if (obj && obj.type === "session") {
        return {
          id: obj.id, cwd: obj.cwd, createdAt: obj.createdAt,
          parentSession: obj.parentSession, origin: obj.origin, delegationDepth: obj.delegationDepth
        };
      }
    } catch { /* ignore */ }
    return null;
  };

  const readSessionTitle = async (dir) => {
    const file = sessionFile(dir);
    let buf;
    try { buf = await readFile(file); } catch { return ""; }
    const head = buf.subarray(0, Math.min(buf.length, 1024 * 1024));
    const text = await decodeZstdFrames(head);
    let titled = "";
    let firstUser = "";
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      // 会话标题事件：后出现的覆盖先出现的（provider 标题优先于 fallback 截断）
      if (obj.type === "session/title" && obj.data && typeof obj.data.title === "string") {
        titled = obj.data.title.trim();
        continue;
      }
      if (!firstUser && obj.type === "user/message") {
        const content = obj.data?.content;
        if (Array.isArray(content)) {
          const t = content.map(p => (typeof p?.text === "string" ? p.text : "")).join(" ").replace(/\s+/g, " ").trim();
          if (t) firstUser = t.slice(0, 60);
        }
      }
    }
    return titled || firstUser || "";
  };

  /** 所有会话的头部摘要（一次扫描复用） */
  const scanHeads = async () => {
    const all = await scanSessions();
    const heads = [];
    for (const s of all) {
      const head = await readSessionHead(s.dir);
      if (!head) continue;
      heads.push({ ...s, head });
    }
    return heads;
  };

  /** 主会话 + 全部后代（子代理递归整棵树） */
  const buildTree = (rootId, heads) => {
    const byParent = new Map();
    for (const h of heads) {
      const p = h.head.parentSession;
      if (!p) continue;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(h);
    }
    const out = [];
    const seen = new Set();
    const walk = (id) => {
      if (seen.has(id)) return;
      seen.add(id);
      const self = heads.find(h => h.id === id);
      if (self) out.push(self);
      for (const child of byParent.get(id) ?? []) walk(child.id);
    };
    walk(rootId);
    return out;
  };

  const listSessions = async () => {
    const heads = await scanHeads();
    const out = [];
    for (const h of heads) {
      if (h.head.origin === "subagent" || h.head.parentSession) continue; // 子代理不单列
      const bytes = await dirSize(h.dir);
      let mtime = 0;
      try { mtime = (await stat(h.dir)).mtimeMs; } catch { /* ignore */ }
      const title = (await readSessionTitle(h.dir)) || "（无标题会话）";
      const tree = buildTree(h.id, heads);
      out.push({
        id: h.id, cwd: h.head.cwd ?? "", title, bytes, mtime,
        createdAt: h.head.createdAt ?? 0, project: h.project,
        subagents: Math.max(0, tree.length - 1)
      });
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return out;
  };

  /* ── 产物识别 ───────────────────────────────────────────── */

  const SKIP_EXT = new Set([
    ".jsonl", ".zstd", ".log", ".lock", ".tmp", ".cache", ".db", ".db-wal", ".db-shm",
    ".node", ".dll", ".so", ".dylib", ".exe", ".sys", ".bin", ".asar", ".pak", ".pdb"
  ]);
  // 只跳真正的依赖/版本库目录。dist、build、out 这类是构建产物，属于"生成的文件"，
  // 不能跳 —— 否则做软件留下的打包结果全看不见。
  const SKIP_DIRS = new Set([
    "node_modules", ".git", ".svn", ".hg", "__pycache__", ".venv", "venv",
    ".idea", ".vscode", ".pytest_cache", ".mypy_cache", ".cache"
  ]);
  // 时间戳兜底扫描时额外跳过的（这些目录里全是依赖，动一下就几千个文件）
  const HEAVY_DIRS = new Set([
    "node_modules", ".git", "__pycache__", ".venv", "venv", ".next", "site-packages"
  ]);
  const PROTECT_NAMES = new Set(["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", ".gitignore", "tsconfig.json"]);

  // 路径常嵌在正文/命令/日志里，按片段提取而不是要求整串就是路径
  const PATH_RE = /(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|~[\\/])[^\s"'<>|?*\r\n,;)\]}]*/g;

  const collectPathStrings = (node, bag) => {
    if (node === null || node === undefined) return;
    if (typeof node === "string") {
      if (node.length < 4 || node.length > 20000) return;
      PATH_RE.lastIndex = 0;
      let m;
      while ((m = PATH_RE.exec(node)) !== null) {
        const p = m[0].replace(/[.,;:'"`\]\)}]+$/, "");
        if (p.length >= 4 && p.length <= 512) bag.add(p);
      }
      return;
    }
    if (Array.isArray(node)) { for (const v of node) collectPathStrings(v, bag); return; }
    if (typeof node === "object") { for (const v of Object.values(node)) collectPathStrings(v, bag); }
  };

  /** 把「候选路径字符串集合」解析成工作区内的真实文件列表 */
  const bagToFiles = async (bag, workspaceCwd) => {
    const workspace = workspaceCwd && isAbsolute(workspaceCwd) ? resolve(workspaceCwd) : "";
    const seen = new Set();
    const files = [];
    for (const raw of bag) {
      let p = raw.replace(/[),.;:'"`\]]+$/, "");
      if (!isAbsolute(p)) {
        if (!workspace) continue;
        p = resolve(workspace, p);
      }
      p = resolve(p);
      // 排除 "文件:行号" 与 NTFS 备用数据流：除盘符外不该再出现冒号。
      // 否则 lstat("D:\\x\\a.ps1:127") 会在 NTFS 上命中 ADS，凭空多出一个假文件。
      if (p.length > 2 && p.slice(2).includes(":")) continue;
      if (seen.has(p)) continue;
      seen.add(p);
      const rel = workspace ? relative(workspace, p) : p;
      if (rel.startsWith("..") || isAbsolute(rel)) continue;
      if (rel.split(sep).some(seg => SKIP_DIRS.has(seg))) continue;
      const ext = extname(p).toLowerCase();
      if (SKIP_EXT.has(ext)) continue;
      if (PROTECT_NAMES.has(basename(p))) continue;
      let st;
      try { st = await lstat(p); } catch { continue; }
      if (!st.isFile()) continue;
      if (st.size > 200 * 1024 * 1024) continue;
      files.push({ path: p, rel: rel || basename(p), bytes: st.size, mtime: st.mtimeMs });
    }
    files.sort((a, b) => b.mtime - a.mtime);
    return files;
  };

  /** 时间戳兜底：会话开始之后被写过的文件都算产物。
   *
   *  事件解析只能抓到 write/edit 明确写出的路径，网上下载的、文档里插入的图片、
   *  脚本自己吐出来的文件都抓不到。这里按 mtime 再扫一遍工作目录补齐，
   *  两者合并去重。
   */
  const scanByMtime = async (cwd, sinceMs, options = {}) => {
    const { maxFiles = 20000, maxMs = 8000, maxDepth = 12 } = options;
    const out = [];
    if (!cwd || !isAbsolute(cwd) || !sinceMs) return out;
    let root;
    try { root = resolve(cwd); } catch { return out; }
    if (!root) return out;
    const deadline = Date.now() + maxMs;

    const walk = async (dir, depth) => {
      if (out.length >= maxFiles || Date.now() > deadline || depth > maxDepth) return;
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (out.length >= maxFiles || Date.now() > deadline) return;
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          if (HEAVY_DIRS.has(e.name.toLowerCase())) continue;
          await walk(full, depth + 1);
          continue;
        }
        if (!e.isFile()) continue;
        if (SKIP_EXT.has(extname(e.name).toLowerCase())) continue;
        if (PROTECT_NAMES.has(e.name)) continue;
        try {
          const st = await stat(full);
          if (st.mtimeMs < sinceMs) continue;
          if (st.size > 200 * 1024 * 1024) continue;
          const rel = relative(root, full);
          if (!rel || rel.startsWith("..")) continue;
          out.push({ path: full, rel, bytes: st.size, mtime: st.mtimeMs });
        } catch { /* 单个文件失败不影响整体 */ }
      }
    };

    await walk(root, 0);
    out.sort((a, b) => b.mtime - a.mtime);
    return out;
  };

  /** 文件信息专用：扫描会话时间窗口内工作区全部普通文件，保留 cache/log/tmp 供分类展示。
   * 不用于 purge/delete，避免将信息清单扩大为可删除清单。 */
  const scanSessionFiles = async (cwd, sinceMs, options = {}) => {
    const { maxFiles = 20000, maxMs = 8000, maxDepth = 12 } = options;
    const out = [];
    if (!cwd || !isAbsolute(cwd) || !sinceMs) return out;
    const root = resolve(cwd);
    const deadline = Date.now() + maxMs;
    const walk = async (dir, depth) => {
      if (out.length >= maxFiles || Date.now() > deadline || depth > maxDepth) return;
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (out.length >= maxFiles || Date.now() > deadline) return;
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          if (HEAVY_DIRS.has(e.name.toLowerCase())) continue;
          await walk(full, depth + 1);
          continue;
        }
        if (!e.isFile() || PROTECT_NAMES.has(e.name)) continue;
        try {
          const st = await stat(full);
          if (st.mtimeMs < sinceMs || st.size > 200 * 1024 * 1024) continue;
          const rel = relative(root, full);
          if (!rel || rel.startsWith("..")) continue;
          out.push({ path: full, rel, bytes: st.size, mtime: st.mtimeMs });
        } catch { /* 单个文件失败不影响整体 */ }
      }
    };
    await walk(root, 0);
    out.sort((a, b) => b.mtime - a.mtime);
    return out;
  };

  /** 合并两路来源：事件解析（精确） + 时间戳扫描（兜底） */
  const mergeArtifacts = (parsed, extra) => {
    const byPath = new Map();
    for (const f of parsed) byPath.set(f.path, f);
    for (const f of extra) if (!byPath.has(f.path)) byPath.set(f.path, f);
    return [...byPath.values()].sort((a, b) => b.mtime - a.mtime);
  };

  /* 只认「写」：write/edit 直接产出的文件，以及命令行里被写成目标的路径。
   * 仅被 read/grep 打开过的文件不算产物——那是对照用的引用。 */
  const WRITE_TOOLS = new Set(["write", "edit", "apply_patch", "create_file", "multi_edit", "write_file"]);
  const SHELL_TOOLS = new Set(["pwsh", "bash", "shell", "terminal", "run_command", "exec", "cmd"]);

  /** 从命令行里挑出「写入目标」：重定向、Set-Content/Out-File、复制/移动的目标、打包输出 */
  const SHELL_WRITE_PATTERNS = [
    // > 或 >> 后面跟的路径
    /(?:^|[^>])>{1,2}\s*["']?((?:[A-Za-z]:[\\/]|\.{1,2}[\\/])[^"'\s|;)]+)/g,
    // Set-Content / Add-Content / Out-File 的目标
    /(?:Set-Content|Add-Content|Out-File)\s+(?:-Path\s+|-FilePath\s+)?["']?((?:[A-Za-z]:[\\/]|\.{1,2}[\\/])[^"'\s;)]+)/gi,
    // New-Item 的 -Path（目录会在一会儿的 isFile 检查里被滤掉）
    /New-Item\s+[^|;]*?-Path\s+["']?((?:[A-Za-z]:[\\/]|\.{1,2}[\\/])[^"'\s;)]+)/gi,
    // Copy-Item / Move-Item / cp / mv 的目标（最后一个参数）
    /(?:Copy-Item|Move-Item|\bcp\b|\bmv\b|\bcopy\b|\bmove\b)[^|;]*?\s["']?((?:[A-Za-z]:[\\/])[^"'\s;)]+)\s*$/gim,
    // tar -czf / -xzf 的输出
    /\btar\b[^|;]*?\s-[a-zA-Z]*[cz][a-zA-Z]*f\s+["']?((?:[A-Za-z]:[\\/]|\.{1,2}[\\/])[^"'\s;)]+)/gi
  ];

  const extractShellWriteTargets = (command, bag) => {
    if (typeof command !== "string" || command.length === 0) return;
    for (const re of SHELL_WRITE_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(command)) !== null) {
        const p = (m[1] ?? "").replace(/[.,;:'"`\]\)}]+$/, "");
        if (p.length >= 4 && p.length <= 512) bag.add(p);
      }
    }
  };

  const collectWritePaths = (evt, bag) => {
    if (!evt || evt.type !== "tool/call") return;
    const name = typeof evt.data?.name === "string" ? evt.data.name : "";
    if (!name) return;
    let args = evt.data?.arguments;
    if (typeof args === "string") {
      try { args = JSON.parse(args); } catch { return; }
    }
    if (!args || typeof args !== "object") return;

    if (WRITE_TOOLS.has(name)) {
      const fp = args.file_path ?? args.path ?? args.filename ?? args.target;
      if (typeof fp === "string") bag.add(fp);
      for (const key of ["paths", "files"]) {
        if (Array.isArray(args[key])) for (const v of args[key]) if (typeof v === "string") bag.add(v);
      }
      return;
    }
    if (SHELL_TOOLS.has(name)) {
      extractShellWriteTargets(args.command ?? args.cmd ?? args.script, bag);
    }
  };

  /** 读一个会话目录的正文，抽出「写操作产生」的路径候选 */
  const bagOfSessionDir = async (dir, bag) => {
    let buf;
    try { buf = await readFile(sessionFile(dir)); } catch { return bag; }
    const text = await decodeZstdFrames(buf);
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      try { collectWritePaths(obj, bag); } catch { /* 单条坏数据不影响整体 */ }
    }
    return bag;
  };

  const collectArtifacts = async (sessionId, cwd) => {
    assertSessionId(sessionId);
    const all = await scanSessions();
    let entry = all.find(s => s.id === sessionId);
    let workspaceCwd = cwd;
    if (!entry) {
      // 已移入回收站：从 meta 里取回该会话的存放位置继续识别
      const meta = await readJson(metaPathOf(sessionId));
      const member = Array.isArray(meta?.members)
        ? (meta.members.find(m => m.id === sessionId) ?? meta.members[0])
        : undefined;
      if (!member) throw Object.assign(new Error("找不到该会话目录"), { code: "session-not-found" });
      entry = { dir: member.trashedDir };
      if (!workspaceCwd) workspaceCwd = meta.cwd || "";
    }
    const bag = await bagOfSessionDir(entry.dir, new Set());
    return { files: await bagToFiles(bag, workspaceCwd) };
  };

  /** 整棵会话树（主对话 + 全部子代理）产生/引用过的文件。
   *  会话已经进了回收站时也能用：从 meta 找回各成员的存放位置再扫。 */
  const collectTreeArtifacts = async (rootId, cwd) => {
    assertSessionId(rootId);
    const heads = await scanHeads();
    const root = heads.find(h => h.id === rootId);

    if (!root) {
      const meta = await readJson(metaPathOf(rootId));
      if (!meta || !Array.isArray(meta.members)) {
        throw Object.assign(new Error("找不到该会话"), { code: "session-not-found" });
      }
      const bag = new Set();
      for (const m of meta.members) await bagOfSessionDir(m.trashedDir, bag);
      const workspaceCwd = cwd || meta.cwd || "";
      const parsed = await bagToFiles(bag, workspaceCwd);
      // 回收站里的会话：目录已经搬走，但工作区里的产物还在，时间戳兜底照做
      const since = (Number(meta.createdAt) || 0) - 120000;
      const extra = since > 0 ? await scanByMtime(workspaceCwd, since) : [];
      const files = mergeArtifacts(parsed, extra);
      return { files, workspace: workspaceCwd, sessions: meta.members.length, inTrash: true };
    }

    const tree = buildTree(rootId, heads);
    const workspaceCwd = cwd || root.head.cwd || "";
    const bag = new Set();
    for (const node of tree) await bagOfSessionDir(node.dir, bag);
    const parsed = await bagToFiles(bag, workspaceCwd);

    // 时间戳兜底：这条对话树里最早一条会话的开始时间往前推 2 分钟作为基准，
    // 会话期间产生的所有文件都算。
    const starts = tree
      .map(n => Number(n.head?.createdAt) || 0)
      .filter(n => n > 0);
    const since = starts.length > 0 ? Math.min(...starts) - 120000 : 0;
    const extra = since > 0 ? await scanByMtime(workspaceCwd, since) : [];
    const files = mergeArtifacts(parsed, extra);

    return { files, workspace: workspaceCwd, sessions: tree.length, inTrash: false };
  };

  /* ── 打开会话文件所在目录 ───────────────────────────────── */

  const openInExplorer = (target, select = false) => {
    try {
      const child = spawn("explorer.exe", [select ? "/select," + target : target], { detached: true, stdio: "ignore" });
      child.unref();
      return true;
    } catch { return false; }
  };

  /** 打开目录并把指定文件多选高亮（借 reveal.ps1 走 Shell Com）。
   *
   *  速度取舍：
   *   - 立即返回，不等 PowerShell 跑完。用户点完马上就有反馈（窗口几百毫秒后出现），
   *     不必干等一两秒。
   *   - 后台仍然串行：revealChain 保证同一时刻只有一个 PowerShell 在动窗口，
   *     连点不会互相抢。
   */
  let revealChain = Promise.resolve();
  const openAndHighlight = (dir, names) => {
    let script;
    try { script = join(dirname(fileURLToPath(import.meta.url)), "reveal.ps1"); }
    catch { script = ""; }

    const run = () => new Promise((resolve) => {
      try {
        if (!script || !existsSync(script) || names.length === 0) {
          openInExplorer(dir, false);
          return resolve(false);
        }
        const spec = join(tmpdir(), `dsh-reveal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
        writeFileSync(spec, "\uFEFF" + JSON.stringify({ dir, names: names.slice(0, 500) }), "utf8");
        const child = spawn("powershell.exe", [
          "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
          "-WindowStyle", "Hidden", "-File", script, "-Spec", spec
        ], { stdio: "ignore", windowsHide: true });
        let settled = false;
        const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };
        child.on("exit", (code) => done(code === 0));
        child.on("error", () => { try { openInExplorer(dir, false); } catch { /* ignore */ } done(false); });
        setTimeout(() => { try { child.kill(); } catch { /* ignore */ } done(false); }, 20000).unref();
      } catch {
        try { openInExplorer(dir, false); } catch { /* ignore */ }
        resolve(false);
      }
    });

    // 排队执行，但不把结果返回给调用方 —— 调用方立刻拿到 true 继续往下走
    revealChain = revealChain.then(run, run).catch(() => {});
    return true;
  };

  // Explorer 标签页导航需模拟前台键盘，焦点错位有误操作风险。
  // 保留兼容入口但不启动任何标签页脚本，统一退回 COM 多窗口打开。
  const openInTabs = (tabs) => {
    if (!Array.isArray(tabs)) return false;
    for (const tab of tabs) openAndHighlight(tab.dir, tab.names ?? []);
    return true;
  };



  /** 给「打开文件目录」用：把整棵会话树的产物摊开，选最集中的目录并高亮这些文件 */
  const revealSession = async (sessionId) => {
    assertSessionId(sessionId);
    const all = await scanSessions();
    let entry = all.find(s => s.id === sessionId);
    let cwd = "";
    let inTrash = false;
    if (!entry) {
      const meta = await readJson(metaPathOf(sessionId));
      const member = Array.isArray(meta?.members)
        ? (meta.members.find(m => m.id === sessionId) ?? meta.members[0])
        : undefined;
      if (!member) throw Object.assign(new Error("找不到该会话目录"), { code: "session-not-found" });
      entry = { dir: member.trashedDir };
      cwd = meta.cwd || "";
      inTrash = true;
    } else {
      const head = await readSessionHead(entry.dir);
      cwd = head?.cwd ?? "";
    }

    let files = [];
    let sessionCount = 1;
    if (!inTrash) {
      try {
        const tree = await collectTreeArtifacts(sessionId, cwd);
        files = tree.files ?? [];
        sessionCount = tree.sessions ?? 1;
        if (!cwd) cwd = tree.workspace ?? "";
      } catch { files = []; }
    }

    const workspace = cwd && isAbsolute(cwd) ? resolve(cwd) : "";

    if (files.length > 0) {
      // 按目录聚类，选文件最多的那个
      const byDir = new Map();
      for (const f of files) {
        const d = dirname(f.path);
        if (!byDir.has(d)) byDir.set(d, []);
        byDir.get(d).push(f);
      }
      const ranked = [...byDir.entries()].sort((a, b) => b[1].length - a[1].length);
      const [target, list] = ranked[0];
      const names = list.map(f => basename(f.path));
      // 不等高亮做完：窗口会在这之后几百毫秒内弹出来，高亮随后补上。
      // 等它做完再返回会让用户白等 1~2 秒。
      openAndHighlight(target, names);
      return {
        opened: target,
        kind: "artifacts",
        ok: true,
        artifacts: files.length,
        highlighted: names.length,
        sessions: sessionCount,
        otherDirs: ranked.slice(1).map(([d, l]) => ({ dir: d, count: l.length })),
        inTrash
      };
    }

    if (workspace) {
      openInExplorer(workspace, false);
      return { opened: workspace, kind: "workspace", artifacts: 0, highlighted: 0, sessions: sessionCount, inTrash, otherDirs: [] };
    }

    openInExplorer(entry.dir, true);
    return { opened: entry.dir, kind: "session", artifacts: 0, highlighted: 0, sessions: sessionCount, inTrash, otherDirs: [] };
  };

  /* ── 多目录展开 & 文件清单 ──────────────────────────────── */

  /** 一次收集：会话的产物、工作目录、是否在回收站 */
  const gatherSessionFiles = async (sessionId) => {
    assertSessionId(sessionId);
    const all = await scanSessions();
    let entry = all.find(s => s.id === sessionId);
    let cwd = "";
    let inTrash = false;
    if (!entry) {
      const meta = await readJson(metaPathOf(sessionId));
      const member = Array.isArray(meta?.members)
        ? (meta.members.find(m => m.id === sessionId) ?? meta.members[0])
        : undefined;
      if (!member) throw Object.assign(new Error("找不到该会话目录"), { code: "session-not-found" });
      entry = { dir: member.trashedDir };
      cwd = meta.cwd || "";
      inTrash = true;
    } else {
      const head = await readSessionHead(entry.dir);
      cwd = head?.cwd ?? "";
    }

    let files = [];
    let sessionCount = 1;
    if (!inTrash) {
      try {
        const tree = await collectTreeArtifacts(sessionId, cwd);
        files = tree.files ?? [];
        sessionCount = tree.sessions ?? 1;
        if (!cwd) cwd = tree.workspace ?? "";
      } catch { files = []; }
    }

    const byDir = new Map();
    for (const f of files) {
      const d = dirname(f.path);
      if (!byDir.has(d)) byDir.set(d, []);
      byDir.get(d).push(f);
    }
    const ranked = [...byDir.entries()].sort((a, b) => b[1].length - a[1].length);

    return { entry, cwd, inTrash, files, sessionCount, ranked };
  };

  /** 打开这条对话产物所在的全部目录，每个目录各自高亮 */
  const revealAllDirs = async (sessionId, limit = Infinity, mode = "windows") => {
    const { entry, cwd, inTrash, files, sessionCount, ranked } = await gatherSessionFiles(sessionId);

    if (files.length === 0 || ranked.length === 0) {
      const workspace = cwd && isAbsolute(cwd) ? resolve(cwd) : "";
      if (workspace) {
        openInExplorer(workspace, false);
        return { kind: "workspace", opened: [{ dir: workspace, count: 0, ok: true }], total: 0, artifacts: 0, sessions: sessionCount, remaining: 0, inTrash, mode };
      }
      openInExplorer(entry.dir, true);
      return { kind: "session", opened: [{ dir: entry.dir, count: 0, ok: true }], total: 0, artifacts: 0, sessions: sessionCount, remaining: 0, inTrash, mode };
    }

    // 标签页自动化已停用：不允许任何 explorer 前台键盘导航；旧请求安全转多窗口。
    if (mode === "tabs") mode = "windows";

    const targets = ranked.slice(0, limit);

    // 窗口模式：每个目录一个窗口，各自用 Shell COM 高亮。串行队列防止焦点竞争。
    const opened = [];
    for (const [dir, list] of targets) {
      openAndHighlight(dir, list.map(f => basename(f.path)));
      opened.push({ dir, count: list.length, ok: true });
    }

    return {
      kind: "artifacts",
      ok: true,
      mode: "windows",
      opened,
      total: opened.length,
      artifacts: files.length,
      sessions: sessionCount,
      remaining: Math.max(0, ranked.length - targets.length),
      inTrash
    };
  };

  /** 文件清单：供「文件查询」和会话行的「文件信息」共用 */
  const fileReport = async (sessionId) => {
    const { entry, cwd, inTrash, files, sessionCount, ranked } = await gatherSessionFiles(sessionId);
    let since = 0;
    const heads = await scanHeads();
    const root = heads.find(s => s.id === sessionId);
    let recordPaths = [];
    if (root) {
      const tree = buildTree(sessionId, heads);
      const starts = tree.map(n => Number(n.head?.createdAt) || 0).filter(n => n > 0);
      since = starts.length ? Math.max(1, Math.min(...starts) - 120000) : 0;
      recordPaths = tree.map(node => sessionFile(node.dir));
    } else {
      const meta = await readJson(metaPathOf(sessionId));
      since = Math.max(0, (Number(meta?.createdAt) || 0) - 120000);
      recordPaths = (Array.isArray(meta?.members) ? meta.members : [])
        .filter(member => member.trashedDir).map(member => sessionFile(member.trashedDir));
    }

    // 文件信息视图用较广扫描补齐下载/缓存等路径；仅用于展示与复制，不传给删除操作。
    const observed = await scanSessionFiles(cwd, since);
    const allFiles = mergeArtifacts(files, observed);
    const categorized = allFiles.map(f => {
      const low = `${f.path || ""}\\n${f.rel || ""}`.toLowerCase().replace(/\\/g, "/");
      let category = "文件产物";
      if (/(^|\/)(cache|caches|\.cache|tmp|temp|__pycache__|\.pytest_cache)(\/|$)/i.test(low)
        || /\.(tmp|temp|cache|log|bak|old)$/i.test(low)) category = "缓存";
      else if (/(^|\/)(downloads?|网盘下载|下载|素材下载)(\/|$)/i.test(low)
        || /\b(download|downloaded|source[_-]?material|素材|网络素材)\b/i.test(low)) category = "网络素材下载";
      return { ...f, category };
    });
    return {
      cwd,
      workspaces: cwd ? [{ path: cwd, category: "工作目录" }] : [],
      conversationRecords: [...new Set(recordPaths)].map(path => ({ path, category: "对话记录" })),
      inTrash,
      sessions: sessionCount,
      total: categorized.length,
      dirs: ranked.map(([dir, list]) => ({ dir, count: list.length, bytes: list.reduce((a, f) => a + (f.bytes || 0), 0) })),
      files: categorized.sort((a, b) => a.rel.localeCompare(b.rel))
    };
  };

  /* ── ① 移入回收站 ───────────────────────────────────────── */

  const metaPathOf = (id) => join(metaRoot(), `${id}.json`);
  const itemDirOf = (id) => join(trashRoot(), id);

  /* ---- 宿主侧账本与投影缓存：删掉时必须同步摘除，否则侧栏照旧显示 ---- */

  /** 让宿主把所有客户端里的这一行丢掉：销毁 agent、flush + detach 会话条目，
   *  最后无论如何都发一次 session/disposed——只改磁盘文件的话，侧栏会把它
   *  挪进「未分组」而不是消失。 */
  const teardownLive = async (sessionId) => {
    const agents = service("agents");
    const sessions = service("sessions");
    let agent;
    let session;
    try { agent = agents && typeof agents.get === "function" ? agents.get(sessionId) : undefined; } catch { agent = undefined; }
    try { session = sessions && typeof sessions.get === "function" ? sessions.get(sessionId) : undefined; } catch { session = undefined; }

    if (agent !== undefined && agent !== null) {
      try { if (typeof agent.cancel === "function") agent.cancel({ kind: "disposed" }); } catch { /* best-effort */ }
      if (typeof agent.scope?.dispose === "function") {
        try { await Promise.race([agent.scope.dispose(), delay(3000)]); } catch { /* best-effort */ }
      }
      try { agents?.store?.delete?.(sessionId); } catch { /* best-effort */ }
    }

    let detached = false;
    if (session !== undefined && session !== null) {
      try { if (typeof sessions.flush === "function") await sessions.flush(session); } catch { /* best-effort */ }
      try {
        const entry = sessions?.store?.get?.(sessionId);
        if (entry !== undefined && typeof entry.detach === "function") {
          entry.detach();
          await delay(200);
          detached = true;
        }
      } catch { /* best-effort */ }
    }

    // 关键：宿主的接收方长这样 ——
    //   ctx.on("session/disposed", (session) => { this.source.release(session.id); ... })
    // 参数必须是 session 对象本身，传 { id } 进去 session.id 是 undefined，等于没发。
    if (session !== undefined && session !== null) {
      try { ctx.emit("session/disposed", session); } catch { /* best-effort */ }
    }
    // 没有 session 对象（冷会话）时补一发：带上 id 字段，兼容按对象取 id 的监听方
    if (!detached && (session === undefined || session === null)) {
      try { ctx.emit("session/disposed", { id: sessionId }); } catch { /* best-effort */ }
    }
    return { wasLiveAgent: agent !== undefined && agent !== null, wasLiveSession: session !== undefined && session !== null, detached };
  };

  /** 记住这条会话在原工作区里的位置（attachSession 是头插，锚点才靠得住） */
  const captureWorkspaceSlot = async (sessionId) => {
    const slot = { workspaceId: undefined, workspacePath: undefined, index: undefined, anchorId: null, wasLast: false };
    try {
      for (const entity of (service("workspaceRegistry")?.list?.() ?? [])) {
        const ids = entity?.sessionIds;
        if (!Array.isArray(ids)) continue;
        const index = ids.indexOf(sessionId);
        if (index === -1) continue;
        slot.workspaceId = entity.id;
        slot.workspacePath = entity.path;
        slot.index = index;
        const anchor = ids[index + 1];
        slot.anchorId = typeof anchor === "string" && anchor !== sessionId ? anchor : null;
        slot.wasLast = slot.anchorId === null;
        break;
      }
    } catch { /* best-effort */ }
    return slot;
  };

  /** 从宿主的工作区账本里摘掉这条会话（内存 + 落盘） */
  const detachFromWorkspaces = async (sessionId) => {
    const registry = service("workspaceRegistry");
    let detached = 0;
    if (!registry || typeof registry.list !== "function") return detached;
    for (const entity of registry.list()) {
      const ids = entity?.sessionIds;
      if (Array.isArray(ids) && ids.includes(sessionId) && typeof entity.detachSession === "function") {
        try { await entity.detachSession(sessionId); detached++; } catch { /* ignore */ }
      }
    }
    return detached;
  };

  /** 宿主已打开的 session_projcache 表；delete 会连带删盘上的 <id>.json */
  const projcacheDomainTable = () => {
    try {
      const domain = service("storageDomain")?.get?.("session_projcache");
      if (domain && typeof domain.table === "function") {
        const table = domain.table("sessions");
        if (table && typeof table.delete === "function") return table;
      }
    } catch { /* domain closed / not mounted */ }
    return undefined;
  };

  const dropProjectionCacheRecord = async (sessionId, liveSession) => {
    const cache = service("sessionProjectionCache");
    if (liveSession !== undefined && liveSession !== null && typeof cache?.markClean === "function") {
      try { cache.markClean(liveSession); } catch { /* best-effort */ }
    }
    const table = projcacheDomainTable();
    if (table !== undefined) {
      try {
        const removed = await table.delete(sessionId);
        if (removed !== false) return true;
      } catch { /* fall through */ }
    }
    if (cache && typeof cache === "object") {
      if (typeof cache.remove === "function") {
        try { await cache.remove(sessionId); return true; } catch { /* fall through */ }
      }
      if (typeof cache.requireTable === "function") {
        try {
          const own = cache.requireTable();
          if (own && typeof own.delete === "function") {
            const removed = await own.delete(sessionId);
            if (removed !== false) return true;
          }
        } catch { /* fall through */ }
      }
    }
    return false;
  };

  /** 备份并摘除侧栏投影缓存行；返回备份内容供恢复时写回 */
  const detachProjCache = async (sessionId) => {
    const dir = projCacheDir();
    const saved = [];
    const candidates = [`${sessionId}.json`, `${sessionId}.json.bak`];
    for (const name of candidates) {
      const file = join(dir, name);
      let content = null;
      try { content = await readFile(file, "utf8"); } catch { continue; }
      saved.push({ name, content });
    }
    try { await dropProjectionCacheRecord(sessionId); } catch { /* ignore */ }
    for (const name of candidates) {
      try { await rm(join(dir, name), { force: true }); } catch { /* ignore */ }
    }
    return saved;
  };

  const restoreProjCache = async (saved) => {
    if (!Array.isArray(saved)) return;
    const dir = projCacheDir();
    await mkdir(dir, { recursive: true });
    for (const item of saved) {
      if (!item || typeof item.name !== "string" || typeof item.content !== "string") continue;
      if (item.name.includes("/") || item.name.includes("\\")) continue;
      try { await writeFile(join(dir, item.name), item.content, "utf8"); } catch { /* ignore */ }
    }
  };

  /** 把恢复回来的会话挂回原工作区，并尽量还原它原来的槽位 */
  const restoreWorkspaceSlot = async (slot, sessionId) => {
    const result = { attached: false, positionRestored: false };
    if (!slot) return result;
    const registry = service("workspaceRegistry");
    if (!registry) return result;
    let entity;
    try {
      if (typeof slot.workspaceId === "string" && typeof registry.get === "function") {
        try { entity = registry.get(slot.workspaceId); } catch { entity = undefined; }
      }
      if (entity === undefined && typeof slot.workspacePath === "string") {
        for (const candidate of (registry.list?.() ?? [])) {
          if (candidate?.path === slot.workspacePath) { entity = candidate; break; }
        }
      }
    } catch { return result; }
    if (entity === undefined || typeof entity.attachSession !== "function") return result;
    try { await entity.attachSession(sessionId); result.attached = true; }
    catch { return result; }
    if (typeof entity.insertSessionBefore !== "function") return result;
    const anchor = typeof slot.anchorId === "string" && slot.anchorId !== sessionId ? slot.anchorId : undefined;
    if (anchor === undefined && slot.wasLast !== true) return result;
    try {
      await entity.insertSessionBefore(sessionId, anchor);
      result.positionRestored = true;
    } catch { /* 锚点可能已删：停在头部即可 */ }
    return result;
  };

  const trashSession = async (rootId) => {
    assertSessionId(rootId);

    // 已经搬进回收站了就别再走一遍：目录已经不在了，再扫只会报"找不到"，
    // 用户会以为点了没用。这里给一句能对上现状的提示。
    const existingMeta = await readJson(metaPathOf(rootId));
    if (existingMeta) {
      throw Object.assign(
        new Error("这条对话已经在回收站里了，去面板的「回收站」页签可以恢复或彻底删除"),
        { code: "already-in-trash" }
      );
    }

    const heads = await scanHeads();
    const root = heads.find(h => h.id === rootId);
    if (!root) throw Object.assign(new Error("会话不存在或已被删除"), { code: "session-not-found" });
    const tree = buildTree(rootId, heads);
    const title = await readSessionTitle(root.dir);
    const bytes = await dirSize(root.dir);

    // 先让宿主把所有客户端的这一行丢掉，否则它会被挪到「未分组」而不是消失
    for (const node of tree) {
      try { await teardownLive(node.id); } catch { /* best-effort */ }
    }

    await mkdir(trashRoot(), { recursive: true });
    await mkdir(metaRoot(), { recursive: true });

    const target = itemDirOf(rootId);
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });

    const members = [];
    for (const node of tree) {
      const isRoot = node.id === rootId;
      const dest = isRoot ? join(target, "__root__") : join(target, "sub", node.id);
      await mkdir(dirname(dest), { recursive: true });
      // 先记下侧栏位置并摘除账本 + 投影缓存，侧栏才会立刻消失
      const slot = await captureWorkspaceSlot(node.id);
      const projCache = await detachProjCache(node.id);
      const detached = await detachFromWorkspaces(node.id);
      await rm(dest, { recursive: true, force: true });
      await rename(node.dir, dest);
      members.push({
        id: node.id,
        originalDir: node.dir,
        trashedDir: dest,
        isRoot,
        slot,
        detached,
        projCache
      });
    }

    const meta = {
      id: rootId,
      title,
      cwd: root.head.cwd ?? "",
      project: root.project,
      bytes,
      trashedAt: Date.now(),
      members
    };
    await writeJson(metaPathOf(rootId), meta);
    return {
      id: rootId, title, bytes, cwd: meta.cwd,
      total: members.length, subagents: members.length - 1
    };
  };

  const listTrash = async () => {
    let names = [];
    try { names = await readdir(metaRoot()); } catch { return []; }
    const out = [];
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      const meta = await readJson(join(metaRoot(), n));
      if (!meta || !meta.id) continue;
      out.push({
        id: meta.id,
        title: meta.title || meta.id,
        cwd: meta.cwd || "",
        bytes: meta.bytes || 0,
        trashedAt: meta.trashedAt || 0,
        total: Array.isArray(meta.members) ? meta.members.length : 1,
        subagents: Array.isArray(meta.members) ? Math.max(0, meta.members.length - 1) : 0
      });
    }
    out.sort((a, b) => b.trashedAt - a.trashedAt);
    return out;
  };

  /* ── ③ 恢复 ─────────────────────────────────────────────── */

  const restoreSession = async (rootId) => {
    assertSessionId(rootId);
    const meta = await readJson(metaPathOf(rootId));
    if (!meta || !Array.isArray(meta.members)) {
      throw Object.assign(new Error("回收站里没有该会话"), { code: "not-in-trash" });
    }
    const restored = [];
    let attached = 0;
    let positionRestored = 0;
    for (const m of meta.members) {
      try {
        await mkdir(dirname(m.originalDir), { recursive: true });
        await rm(m.originalDir, { recursive: true, force: true });
        await rename(m.trashedDir, m.originalDir);
        await restoreProjCache(m.projCache);
        // 挂回原工作区（子代理会话不占侧栏槽位，只有主会话需要）
        if (m.isRoot) {
          const slot = await restoreWorkspaceSlot(m.slot, m.id);
          if (slot.attached) attached++;
          if (slot.positionRestored) positionRestored++;
        }
        restored.push(m.id);
      } catch (error) {
        return { id: rootId, restored, error: safeErrorMessage(error) };
      }
    }
    await rm(metaPathOf(rootId), { force: true });
    await rm(itemDirOf(rootId), { recursive: true, force: true });
    return { id: rootId, restored, total: restored.length, attached, positionRestored };
  };

  /* ── ② 彻底删除 ─────────────────────────────────────────── */

  /** 工作区账本里摘掉这些会话的所有引用（sessionIds / 归档 / 置顶） */
  const detachWorkspaceLedger = async (ids) => {
    const file = workspaceFile();
    const ws = await readJson(file);
    if (!ws) return { changed: false };
    const set = new Set(ids);
    let changed = false;
    const g = ws.global || {};
    for (const key of ["archivedSessionIds", "pinnedSessionIds"]) {
      if (Array.isArray(g[key])) {
        const before = g[key].length;
        g[key] = g[key].filter(id => !set.has(id));
        if (g[key].length !== before) changed = true;
      }
    }
    for (const w of Object.values(ws.tables?.workspaces ?? {})) {
      if (!Array.isArray(w.sessionIds)) continue;
      const before = w.sessionIds.length;
      w.sessionIds = w.sessionIds.filter(id => !set.has(id));
      if (w.sessionIds.length !== before) changed = true;
    }
    if (changed) {
      try { await writeFile(file, JSON.stringify(ws, null, 2), "utf8"); } catch { /* ignore */ }
    }
    return { changed };
  };

  /** 清日志里提到这些会话的行 */
  const scrubLogs = async (ids) => {
    const set = new Set(ids);
    let files = [];
    try { files = await readdir(logsDir(), { withFileTypes: true }); } catch { return { files: 0, lines: 0 }; }
    let touched = 0;
    let lines = 0;
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
      const file = join(logsDir(), f.name);
      let raw;
      try { raw = await readFile(file, "utf8"); } catch { continue; }
      const parts = raw.split("\n");
      const kept = [];
      let removed = 0;
      for (const line of parts) {
        if (!line) { kept.push(line); continue; }
        let hit = false;
        for (const id of set) { if (line.includes(id)) { hit = true; break; } }
        if (hit) { removed++; continue; }
        kept.push(line);
      }
      if (removed > 0) {
        try { await writeFile(file, kept.join("\n"), "utf8"); touched++; lines += removed; } catch { /* ignore */ }
      }
    }
    return { files: touched, lines };
  };

  /** 清 cache 下与会话同名的条目 */
  const scrubCache = async (ids) => {
    const set = new Set(ids);
    const roots = [resolve(String(homePath("cache")), "attachments"), resolve(String(homePath("cache")), "dsh-image-gen")];
    let removed = 0;
    for (const root of roots) {
      let entries = [];
      try { entries = await readdir(root, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!set.has(e.name)) continue;
        try { await rm(join(root, e.name), { recursive: true, force: true }); removed++; } catch { /* ignore */ }
      }
    }
    return { removed };
  };

  /** 只有被删会话引用过的附件对象才清（被别处引用的留着） */
  const scrubAttachments = async (deletedIds) => {
    const heads = await scanSessions();
    const deleted = new Set(deletedIds);
    const reSha = /sha256:([0-9a-f]{64})/g;
    const shaOf = (text) => {
      const set = new Set();
      let m;
      reSha.lastIndex = 0;
      while ((m = reSha.exec(text)) !== null) set.add(m[1]);
      return set;
    };
    const alive = new Set();
    for (const h of heads) {
      if (deleted.has(h.id)) continue;
      let buf;
      try { buf = await readFile(sessionFile(h.dir)); } catch { continue; }
      const text = await decodeZstdFrames(buf);
      for (const s of shaOf(text)) alive.add(s);
    }
    // 被删会话的引用来自回收站里的目录（已经搬走，仍可读）
    const doomed = new Set();
    let names = [];
    try { names = await readdir(metaRoot()); } catch { names = []; }
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      const meta = await readJson(join(metaRoot(), n));
      if (!meta || !deleted.has(meta.id)) continue;
      for (const m of meta.members ?? []) {
        let buf;
        try { buf = await readFile(sessionFile(m.trashedDir)); } catch { continue; }
        const text = await decodeZstdFrames(buf);
        for (const s of shaOf(text)) if (!alive.has(s)) doomed.add(s);
      }
    }
    let removed = 0;
    for (const hash of doomed) {
      const obj = join(attachmentsObjects(), hash.slice(0, 2), hash);
      try { await lstat(obj); } catch { continue; }
      try { await rm(obj, { force: true }); removed++; } catch { /* ignore */ }
    }
    // files-v3 登记里指向已删对象/只属于被删会话的记录
    const idxFile = filesIndex();
    const idx = await readJson(idxFile);
    if (idx && Array.isArray(idx.records)) {
      const before = idx.records.length;
      idx.records = idx.records.filter(r => {
        const ids = [r.attachmentId, r.variantId]
          .filter(v => typeof v === "string")
          .map(v => v.replace(/^sha256:/, "").toLowerCase());
        return ids.some(h2 => !doomed.has(h2));
      });
      if (idx.records.length !== before) {
        try { await writeJson(idxFile, idx); } catch { /* ignore */ }
      }
    }
    return { objects: removed, candidates: doomed.size };
  };

  const purgeSession = async (rootId) => {
    assertSessionId(rootId);
    const meta = await readJson(metaPathOf(rootId));
    if (!meta) throw Object.assign(new Error("回收站里没有该会话"), { code: "not-in-trash" });
    const ids = (meta.members ?? []).map(m => m.id);
    if (ids.length === 0) ids.push(rootId);

    const result = { id: rootId, ids, dirs: 0, logs: null, cache: null, ledger: null, attachments: null };

    await rm(itemDirOf(rootId), { recursive: true, force: true });
    await rm(metaPathOf(rootId), { force: true });
    result.dirs = ids.length;

    // 兜底：目录若还在（比如手工残留）一并清掉
    for (const m of meta.members ?? []) {
      try { await rm(m.originalDir, { recursive: true, force: true }); } catch { /* ignore */ }
      try { await rm(join(projCacheDir(), `${m.id}.json`), { force: true }); } catch { /* ignore */ }
      try { await rm(join(projCacheDir(), `${m.id}.json.bak`), { force: true }); } catch { /* ignore */ }
    }

    result.ledger = await detachWorkspaceLedger(ids);
    result.logs = await scrubLogs(ids);
    result.cache = await scrubCache(ids);
    try { result.attachments = await scrubAttachments(ids); }
    catch (error) { result.attachments = { error: safeErrorMessage(error) }; }
    return result;
  };

  const deleteArtifacts = async (paths) => {
    const removed = [];
    const failed = [];
    for (const p of paths) {
      if (typeof p !== "string" || !isAbsolute(p)) { failed.push({ path: String(p), error: "路径不合法" }); continue; }
      try { await rm(p, { force: true }); removed.push(p); }
      catch (error) { failed.push({ path: p, error: safeErrorMessage(error) }); }
    }
    return { removed, failed };
  };

  /* ── HTTP API ───────────────────────────────────────────── */

  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: API_PREFIX,
    handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const sub = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) || "/" : "/";
        let body = {};
        if (req.method === "POST") {
          const raw = await readBody(req);
          if (raw.trim() !== "") body = JSON.parse(raw);
        }
        const ids = Array.isArray(body.sessionIds)
          ? body.sessionIds.filter(x => typeof x === "string" && x.trim()).map(x => x.trim())
          : [];

        if (req.method === "GET" && sub === "/list") {
          return send(res, 200, { ok: true, result: { sessions: await listSessions() } });
        }

        if (req.method === "POST" && sub === "/reveal") {
          const id = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
          if (!id) return send(res, 400, { ok: false, error: "缺少 sessionId" });
          return send(res, 200, { ok: true, result: await revealSession(id) });
        }

        if (req.method === "POST" && sub === "/reveal-all") {
          const id = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
          if (!id) return send(res, 400, { ok: false, error: "缺少 sessionId" });
          const limit = Number.isFinite(body.limit) ? Math.max(1, body.limit) : Infinity;
          const mode = body.mode === "tabs" ? "tabs" : "windows";
          return send(res, 200, { ok: true, result: await revealAllDirs(id, limit, mode) });
        }

        if (req.method === "POST" && sub === "/file-report") {
          const id = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
          if (!id) return send(res, 400, { ok: false, error: "缺少 sessionId" });
          return send(res, 200, { ok: true, result: await fileReport(id) });
        }

        if (req.method === "POST" && sub === "/artifacts") {
          // 口径与「打开文件目录」一致：整条对话链（主对话 + 全部子代理），
          // 这样勾选「同时删除文件产物」删掉的，正是打开目录时高亮看到的那批。
          const cwd = typeof body.cwd === "string" ? body.cwd : "";
          const perSession = [];
          for (const id of ids) {
            try {
              const tree = await collectTreeArtifacts(id, cwd);
              perSession.push({ id, files: tree.files, sessions: tree.sessions });
            } catch (error) {
              perSession.push({ id, files: [], error: safeErrorMessage(error) });
            }
          }
          const merged = new Map();
          for (const s of perSession) for (const f of s.files) merged.set(f.path, f);
          return send(res, 200, { ok: true, result: { perSession, files: [...merged.values()] } });
        }

        if (req.method === "POST" && sub === "/delete") {
          if (ids.length === 0) return send(res, 400, { ok: false, error: "未选择会话" });
          const trashed = [], errors = [];
          for (const id of ids) {
            try { trashed.push(await trashSession(id)); }
            catch (error) { errors.push({ id, error: safeErrorMessage(error) }); }
          }
          let artifacts = { removed: [], failed: [] };
          if (body.removeArtifacts === true && Array.isArray(body.artifactPaths)) {
            artifacts = await deleteArtifacts(body.artifactPaths);
          }
          return send(res, 200, { ok: true, result: { trashed, errors, artifacts } });
        }

        if (req.method === "POST" && sub === "/trash/list") {
          return send(res, 200, { ok: true, result: { items: await listTrash() } });
        }

        if (req.method === "POST" && sub === "/trash/restore") {
          if (ids.length === 0) return send(res, 400, { ok: false, error: "未选择会话" });
          const done = [], errors = [];
          for (const id of ids) {
            try { done.push(await restoreSession(id)); }
            catch (error) { errors.push({ id, error: safeErrorMessage(error) }); }
          }
          return send(res, 200, { ok: true, result: { done, errors } });
        }

        if (req.method === "POST" && sub === "/trash/purge") {
          if (ids.length === 0) return send(res, 400, { ok: false, error: "未选择会话" });
          const done = [], errors = [];
          for (const id of ids) {
            try { done.push(await purgeSession(id)); }
            catch (error) { errors.push({ id, error: safeErrorMessage(error) }); }
          }
          let artifacts = { removed: [], failed: [] };
          if (body.removeArtifacts === true && Array.isArray(body.artifactPaths)) {
            artifacts = await deleteArtifacts(body.artifactPaths);
          }
          return send(res, 200, { ok: true, result: { done, errors, artifacts } });
        }

        return send(res, 404, { ok: false, error: "not found: " + req.method + " " + sub });
      } catch (error) {
        ctx?.logger?.warn?.("session-recycle: api error: " + safeErrorMessage(error));
        const status = error?.code === "bad-request" || error?.code === "body-too-large" ? 400
          : error?.code === "session-not-found" ? 404
          : error?.code === "not-in-trash" || error?.code === "already-in-trash" ? 409 : 500;
        return send(res, status, { ok: false, error: safeErrorMessage(error) });
      }
    }
  }), "session-recycle: http api");
}
