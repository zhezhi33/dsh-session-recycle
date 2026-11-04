# dsh-session-recycler

[English](README.en.md) | **中文**

DeepSeek Harness 的会话管理插件，只支持 Windows。

它解决两件 DSH 本身不管的事：**删对话删不干净**，以及**说不清一条对话到底改过哪些文件**。

- 删除做成两段：先移进插件自己的回收站，随时能搬回侧栏原位置；确认不要了再彻底清，
  连带整条子代理树、侧栏账本、投影缓存、日志里相关的行、只被它引用过的附件一起清掉。
- 产物可以反查：右键一条对话，扫出它真正写过的文件，在资源管理器里多选高亮；
  也能一键把这条对话的完整路径清单复制到剪贴板，或交给助手判断哪些文件可以删。

---

## 功能

### 1. 两段式删除

| 阶段 | 做什么 | 能恢复吗 |
|---|---|---|
| **移入回收站** | 会话目录整体 `rename` 进插件回收站（同盘原子操作，不复制）；子代理对话跟着主对话一起搬走；侧栏投影缓存行备份后摘除 | 能 |
| **彻底删除** | 删掉回收站里的整条对话链，清侧栏账本（sessionIds / 归档 / 置顶）、投影缓存及其 `.bak`、日志里提到这些会话的行、`cache/` 下同名条目、只被它们引用过的附件对象与 `files-v3` 登记 | 不能 |
| **恢复** | 目录搬回原工作区绝对路径，投影缓存行写回，会话回到侧栏原来的槽位 | — |

移入回收站时日志、缓存、附件一律不动，只有彻底删除才连带清理。
工作区里的会话被清空后，空掉的工作区注册也会一并注销，侧栏不会留下一个空分组；
恢复时若该工作区已被注销，会按原路径重新建回来，会话仍然回到原位置。

### 2. 会话管理面板

入口有两个：侧栏底部的「会话管理」，以及会话右键菜单里的「移入回收站」。

- 会话按工作区分组列出，组头可以折叠/展开，折叠时箭头旋转，键盘 Enter / 空格也能切换
- 搜索框按标题或工作区过滤；「全选」作用于当前过滤结果，「全选本组」只作用于那一组
- 每行显示大小、最后活动时间、子代理会话数、工作区路径
- 删除前二次确认，确认框里写明会话数、产物数量与总大小
- 页签「回收站」：同一套搜索 / 全选 / 逐条勾选，行内可逐条「恢复」或「彻底删除」
- 回收站页底部：勾选「同时删除文件产物」后，彻底删除会一并删掉该会话生成的文件，
  并可预览清单；旁边是红色「全部删除」，作用于勾选的会话，同样走二次确认
- 两个页签的勾选各自独立，切页即清空，不会把一页的选择带到另一页去删

### 3. 打开文件目录

右键会话 →「打开文件目录」：

- 扫描**整条对话链**（主对话 + 它派生的所有子代理），只统计**写操作**产生的文件
- 按目录聚类，打开文件最集中的那个目录，并把命中的文件**多选高亮**
- 提示：`已打开目录并高亮 N 个文件；另有 M 个文件在其它目录`

右键会话 →「打开所有文件目录」：把散落在所有目录里的产物逐个目录打开并高亮，
不限制目录数。Explorer 操作通过串行队列执行，多个目录不会互相抢焦点。
打开方式可在面板右上角 ⚙ 里查看；标签页自动化已暂停，只用「多个窗口」。

产物识别的口径（只算产出，不算引用）：

| 来源 | 算产物 |
|---|---|
| `write` / `edit` 工具调用的 `file_path` | ✅ |
| 命令行里的写入目标：`>` `>>` 重定向、`Set-Content` / `Out-File`、`Copy-Item` / `Move-Item` 的目标、`tar -czf` 输出 | ✅ |
| 会话期间工作区内被改动过的文件（mtime 兜底） | ✅ |
| `read` / `grep` / `read_image` 打开过的文件 | ❌ 视图引用，不算 |
| 只在对话文字里被提到过的路径 | ❌ |

### 4. 文件查询

右键会话 →「文件查询」：扫描这条对话的全部产物，生成一段分析提示词
（文件清单 + 目录分布 + 期望的输出格式），直接填进对话输入框，回车即可让助手
逐个说明文件用途，并归类为缓存 / 对话记录 / 生成文件 / 引用素材，给出哪些可以删。

输入框拿不到时（比如页面结构变了）自动退到剪贴板，粘贴即可。

### 5. 文件信息：复制当前所有路径

右键会话 →「文件信息」，或会话行右侧的「文件信息」按钮：扫描后在剪贴板里放一份
**按类型分好组的完整路径清单**——文件产物 / 缓存 / 工作目录 / 网络素材下载 / 对话记录，
分组内去重、按路径排序。粘到哪里都能直接用：搜索框、脚本、别的对话、文本比对工具。

---

## 安装

### 用安装包（推荐）

1. 完全退出 DeepSeek Harness（托盘图标右键退出，只关窗口不算）
2. 解压 `dsh-session-recycler-<版本>.zip`，双击 `一键安装-纯PowerShell.cmd`
3. 看到「安装完成」后重新打开 DeepSeek Harness，侧栏底部出现「会话管理」即成功

不需要联网，不需要管理员权限，不用自己装 Node 或 npm，只用 Windows 自带的 PowerShell 5.1。

装之前想先确认的话，给 cmd 加参数：

```text
一键安装-纯PowerShell.cmd --check            只检查，不写任何文件
一键安装-纯PowerShell.cmd --dry-run          演练，打印会改什么
一键安装-纯PowerShell.cmd --profile desktop  机器上有多份 profile 时只装指定那份
一键安装-纯PowerShell.cmd --link             用目录链接代替复制（改源码即时生效）
一键安装-纯PowerShell.cmd --home D:\dsh-home 数据目录不在默认位置时指定
```

安装器只碰两样东西：把插件文件复制进 `<profile>\node_modules\dsh-session-recycler\`，
以及在 `<profile>\package.json` 里登记一条依赖和一个 bundle 声明；
改 package.json 之前会备份成 `package.json.bak-<时间戳>`。

### 卸载

双击 `一键卸载-纯PowerShell.cmd`，或：

```powershell
.\install-dsh-session-recycler-native.ps1 --uninstall
```

会删掉 `node_modules` 里那份插件，并撤掉 `package.json` 里加过的两条登记。
回收站里已删的会话不会被删，它们在 `%USERPROFILE%\.dsh\dsh-session-recycler\` 下，要清就手工删。

### 开发模式

把源码放到 `<DSH_HOME>\local-plugins\dsh-session-recycler`，在 profile 的 `package.json` 里登记：

```json
"dependencies": { "dsh-session-recycler": "link:C:/Users/<you>/.dsh/local-plugins/dsh-session-recycler" }
"dsh": { "profile": { "bundles": ["...", "dsh-session-recycler"] } }
```

`link:` 是软链，改完重启 DSH 即生效，不用重跑安装。

---

## 实现要点

- **会话正文是多帧拼接的 zstd**，Node 的 one-shot 解压只吐第一帧。这里按帧魔数 `28 B5 2F FD`
  切开逐帧解压，才能拿到完整正文。
- **会话标题**在 `session/title` 事件里，不在用户消息字段，后出现的 provider 标题优先于 fallback。
- **删除后侧栏不消失**是宿主内存态没清。删之前要跑一遍销户：
  `agent.cancel({kind:"disposed"})` → `agent.scope.dispose()` → `agents.store.delete()` →
  `sessions.flush()` → `entry.detach()` → 兜底 `ctx.emit("session/disposed", session)`。
  少了最后一步，会话会被挪进「未分组」而不是消失。
- **工作区是独立实体**（`ctx.workspaceRegistry`）。`detachSession(id)` 只从 `sessionIds` 里过滤掉 id，
  工作区注册本身不会因为会话清空而消失，侧栏就会留一个空分组。所以摘完会话后要检查
  `sessionIds` 是否为空，为空才 `registry.delete(id)`；恢复时若注册已不在，按原路径
  `registry.create(path)` 重建再挂回去。
- **恢复要挂回原槽位**：`entity.attachSession(id)` 是头插，还要 `insertSessionBefore(id, anchor)`
  才能回到原来的位置，锚点取删除时记下的「它后面那个会话」。
- **产物识别**从正文里用正则抽路径片段（不要求整串是路径），再按会话时间扫工作区补漏；
  只保留落在 `cwd` 内、真实存在、非 `node_modules`/`.git`/`dist`、非工程配置文件、
  扩展名不在日志缓存黑名单里的普通文件。
- **资源管理器多选高亮**走 Shell COM：`$win.Document.SelectItem($item, 1)`，连续调用是累加。
  文件名不能走命令行参数（中文会被编码吃掉），改成 UTF-8 JSON 文件传；子进程也不能 `detached`，
  否则 powershell 被提前结束、窗口根本开不出来。

---

## 已知限制

- 只在 Windows 上验证过（依赖 `explorer.exe` 与 Shell COM）。
- 产物识别靠正文里的路径文本加工作区 mtime 兜底，纯命令行 `cd` 之后的相对写入仍可能漏。
- 标签页模式已停用：Windows 资源管理器无法保证自动化焦点安全，误触可能改到文件名。
- 只能安装在 DSH 里，依赖宿主提供的 `react` 与 `@deepseek-ai/dsh-client-ui-primitives`。

---

## 许可

MIT
