# dsh-session-recycle

DeepSeek Harness 的会话管理插件：把不要的对话搬进可恢复的回收站，需要时再彻底清掉；
一句话看清某条对话到底产出了哪些文件，并在资源管理器里直接高亮出来。

当前版本 **0.2.1**。

---

## 功能

### 1. 两段式删除

| 阶段 | 做什么 | 能恢复吗 |
|---|---|---|
| **移入回收站** | 会话目录整体 `rename` 进插件回收站（同盘原子操作，不复制）；子代理对话跟着主对话一起搬走（挂在上面的都算这个对话的）；侧栏投影缓存行备份进快照后摘除 | 能 |
| **彻底删除** | 删掉回收站里的整条对话链，清侧栏账本（sessionIds / 归档 / 置顶）、投影缓存及其 `.bak`、日志里提到这些会话的行、`cache/` 下同名条目、只被它们引用过的附件对象与 `files-v3` 登记 | 不能 |
| **恢复** | 目录搬回原工作区绝对路径，投影缓存行写回，会话回到侧栏原来的槽位 | — |

**移入回收站时日志、缓存、附件一律不动**，只有彻底删除才连带清理。

### 2. 会话管理面板

- 入口一：侧栏底部「会话管理」按钮（与会话回收站同区，复用产品按钮样式）
- 入口二：会话右键菜单「移入回收站」
- 左栏按工作区分组列出会话，逐条勾选或「全选本组」；会显示大小、最后活动时间、子代理数量
- 删除前二次确认
- 页签「回收站」：逐条恢复 / 彻底删除（同样二次确认）
- 回收站页右上角的「同时删除文件产物」：勾选后彻底删除时会一并删掉该会话生成的文件的，并支持预览清单

### 3. 打开文件目录

右键任意会话 →「打开文件目录」：

- 扫描**整条对话链**（主对话 + 它派生的所有子代理）：先解析写操作路径，再按会话时间扫描工作区补漏
- 右键任意会话 →「打开文件目录」：打开产物最多的目录并高亮命中文件
- 右键会话 →「打开所有文件目录」：所有产物目录逐个打开并高亮；不限制目录数，Explorer 操作通过串行队列执行

产物识别口径（写入事件 + 会话期间工作区 mtime 兜底）：

| 来源 | 算产物 |
|---|---|
| `write` / `edit` 工具调用的 `file_path` | ✅ |
| 命令行里的写入目标：`>` `>>` 重定向、`Set-Content` / `Out-File`、`Copy-Item` / `Move-Item` 的目标、`tar -czf` 输出 | ✅ |
| `read` / `grep` / `read_image` 打开过的文件 | ❌ 视图引用，不算 |
| 只在对话文字里被提到过的路径 | ❌ |

单目录打开优先高亮该目录中的命中文件；整条对话散落在多目录时，可使用「打开所有文件目录」逐个窗口高亮。

### 4. 打开所有文件目录

右键会话 →「打开所有文件目录」：把这条对话散落在**所有**目录里的产物全部打开，
每个目录各自高亮其中的文件，不再限制数量。

打开方式可在面板右上角 ⚙ 查看。当前仅启用「多个窗口」：每个目录单独打开并高亮。标签页自动化已暂停，避免前台焦点变化导致误操作文件或磁盘名称。设置页左侧的 GitHub 图标可直达项目主页。

### 5. 文件查询

右键会话 →「文件查询」：扫描这条对话的全部产物，生成一段分析提示词
（文件清单 + 目录分布 + 期望的输出格式），直接填进对话输入框，回车即可让
助手逐个说明文件用途，并归类为缓存 / 对话记录 / 生成文件 / 引用素材。

输入框拿不到时（比如页面结构变了）会自动退到剪贴板，粘贴即可。

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

3. 看到「安装成功，版本 0.2.6」后，**完全退出 DeepSeek Harness 再打开**

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

## 许可

MIT
