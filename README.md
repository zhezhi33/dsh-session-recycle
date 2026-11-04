# dsh-session-recycle

DeepSeek Harness 的会话清理插件：把不要的对话搬进可恢复的回收站，需要时再彻底清掉；
一句话看清某条对话到底产出了哪些文件，并在资源管理器里直接高亮出来。

当前版本 **0.2.9**。

---

## 功能

### 1. 两段式删除

| 阶段 | 做什么 | 能恢复吗 |
|---|---|---|
| **移入回收站** | 会话目录整体 `rename` 进插件回收站（同盘原子操作，不复制）；子代理对话跟着主对话一起搬走（挂在上面的都算这个对话的）；侧栏投影缓存行备份进快照后摘除 | 能 |
| **彻底删除** | 删掉回收站里的整条对话链，清侧栏账本（sessionIds / 归档 / 置顶）、投影缓存及其 `.bak`、日志里提到这些会话的行、`cache/` 下同名条目、只被它们引用过的附件对象与 `files-v3` 登记 | 不能 |
| **恢复** | 目录搬回原工作区绝对路径，投影缓存行写回，会话回到侧栏原来的槽位 | — |

**移入回收站时日志、缓存、附件一律不动**，只有彻底删除才连带清理。

### 2. 会话清理面板

- 入口一：侧栏底部「会话清理」按钮（与会话回收站同区，复用产品按钮样式）
- 入口二：会话右键菜单「移入回收站」
- 左栏按工作区分组列出会话，逐条勾选或「全选本组」；会显示大小、最后活动时间、子代理数量
- 删除前二次确认
- 页签「回收站」：逐条恢复 / 彻底删除（同样二次确认）
- 回收站页右上角的「同时删除文件产物」：勾选后彻底删除时会一并删掉该会话生成的文件的，并支持预览清单

### 3. 打开文件目录

右键任意会话 →「打开文件目录」：

- 扫描**整条对话链**（主对话 + 它派生的所有子代理），只统计**写操作**产生的文件
- 按目录聚类，打开文件最集中的那个目录，并把命中的文件**多选高亮**（资源管理器里蓝色选中状态）
- 返回提示：`已打开目录并高亮 N 个文件；另有 M 个文件在其它目录`

「写操作」的判定口径（只算产出，不算引用）：

| 来源 | 算产物 |
|---|---|
| `write` / `edit` 工具调用的 `file_path` | ✅ |
| 命令行里的写入目标：`>` `>>` 重定向、`Set-Content` / `Out-File`、`Copy-Item` / `Move-Item` 的目标、`tar -czf` 输出 | ✅ |
| `read` / `grep` / `read_image` 打开过的文件 | ❌ 视图引用，不算 |
| 只在对话文字里被提到过的路径 | ❌ |

一次只能开一个资源管理器窗口，所以其余目录用数量告知。

---

## 安装

### 方式 A：安装包（推荐，换电脑用这个）

1. 解压 `dsh-session-recycle-0.2.9-installer.zip`
2. 在解压目录打开 PowerShell，执行：

```powershell
.\install.ps1
```

被脚本策略挡住时：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

3. 看到「安装成功，版本 0.2.9」后，**完全退出 DeepSeek Harness 再打开**

脚本会自动：定位 `DSH_HOME` → 挑 profile（`desktop` 优先，其次 `web`）→ 找 DSH 自带的 node/pnpm →
备份 `package.json` → 登记 `dependencies` 与 `dsh.profile.bundles` → 跑 `pnpm install` → 校验版本。

非默认目录：`.\install.ps1 -DshHome "D:\your-dsh-home"`

### 方式 B：开发模式（改代码即时生效）

```powershell
# 把插件源码放到 <DSH_HOME>\local-plugins\dsh-session-recycle
# 然后在 profile 的 package.json 里登记：
"dependencies": { "dsh-session-recycle": "link:C:/Users/<you>/.dsh/local-plugins/dsh-session-recycle" }
"dsh": { "profile": { "bundles": [ "...", "dsh-session-recycle" ] } }
```

`link:` 是软链，改完重启 DSH 就生效，不用重跑 install。

### 卸载

```powershell
.\install.ps1 -Uninstall
```

---

## 实现要点

- **会话正文是多帧拼接的 zstd**，Node 的 one-shot 解压只吐第一帧。这里按帧魔数 `28 B5 2F FD`
  切开逐帧解压，才能拿到完整正文（实测 59 个会话、11912 帧全部解出，68 MB 文本）。
- **会话标题**在 `session/title` 事件里，不在用户消息字段，且后出现的 provider 标题优先于 fallback。
- **删除后侧栏不消失**是宿主内存态没清。要在删之前跑一遍销户：
  `agent.cancel({kind:"disposed"})` → `agent.scope.dispose()` → `agents.store.delete()` →
  `sessions.flush()` → `entry.detach()` → 兜底 `ctx.emit("session/disposed", {id})`。
  少了最后一步，会话会被挪进「未分组」而不是消失。
- **恢复要挂回原槽位**：`entity.attachSession(id)` 是头插，还要 `insertSessionBefore(id, anchor)`
  才能回到原来的位置，锚点取删除时记下的「它后面那个会话」。
- **产物识别**从正文里用正则抽路径片段（不是要求整串是路径），只保留落在 `cwd` 内、真实存在、
  非 `node_modules`/`.git`/`dist`、非工程配置文件、扩展名不在日志缓存黑名单里的普通文件。
- **资源管理器多选高亮**走 Shell COM：`$win.Document.SelectItem($item, 1)`，连续调用是累加。
  文件名不能走命令行参数（中文会被编码吃掉），改成 UTF-8 JSON 文件传；子进程也不能 `detached`，
  否则 powershell 被提前结束、窗口根本开不出来。

---

## 已知限制

- 只在 Windows 上验证过（依赖 `explorer.exe` 与 Shell COM）。
- 「打开文件目录」一次只开一个窗口，产物分散在多个目录时只高亮最大的那一组。
- 产物识别靠正文里的路径文本，纯命令行 `cd` 之后的相对写入可能识别不到。
- 只能安装在 DSH 里，依赖宿主提供的 `react` 与 `@deepseek-ai/dsh-client-ui-primitives`。

---

## 版本历史

| 版本 | 变化 |
|---|---|
| 0.2.9 | 产物识别收紧为只统计写操作：读过的引用文件不再算产物 |
| 0.2.8 | 修复会话已进回收站时识别不到产物、勾了「同时删除文件产物」却一个都没删的问题 |
| 0.2.7 | 「同时删除文件产物」改为与「打开文件目录」同口径：整条对话链，子代理产物一并识别 |
| 0.2.6 | 「打开文件目录」扫描整条对话链；资源管理器多选高亮（中文文件名、子进程生命周期两个坑已修） |
| 0.2.5 | 新增「打开文件目录」；移除「清理本工作区会话」；补 `session/disposed` 修复删完落进「未分组」 |
| 0.2.4 | 修复勾选框点两次等于没点；补充宿主账本 `detachSession` |
| 0.2.3 | 「同时删除文件产物」挪到回收站页，只在彻底删除时生效；回收站内也能识别产物 |
| 0.2.2 | 槽位注册补 `id`（当前 DSH 的 list 槽位强制要求） |
| 0.2.1 | 标题解析改读 `session/title` 事件 |
| 0.2.0 | 确立两段式语义；子代理对话跟着主对话一起搬；恢复回原槽位 |
| 0.1.0 | 首版：侧栏入口、右键移入回收站、面板多选、二次确认 |

---

## 许可

MIT
