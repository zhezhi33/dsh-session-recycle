# dsh-session-recycle

**English** | [中文](README.md)

A session manager plugin for DeepSeek Harness. Windows only.

It handles two things DSH itself leaves alone: **deleting a conversation never cleans up fully**,
and **there is no way to tell which files a conversation actually touched**.

- Deletion happens in two stages. A conversation first moves into the plugin's own recycle bin and
  can be restored to its original sidebar slot; only when you are sure does it get purged, together
  with its whole subagent tree, sidebar ledger rows, projection cache, the log lines that mention it,
  and the attachment objects only it referenced.
- Produced files can be traced back. Right-click a conversation to scan the files it actually wrote
  and select them in Explorer, copy the full path list to the clipboard, or hand the list to the
  assistant to judge which files are safe to delete.

---

## Features

### 1. Two-stage deletion

| Stage | What it does | Recoverable |
|---|---|---|
| **Move to recycle bin** | The session directory is `rename`d into the plugin's trash (atomic on the same volume, no copy); subagent conversations travel with their root; the sidebar projection cache row is backed up and detached | Yes |
| **Purge** | Removes the whole conversation chain from the trash: sidebar ledger (sessionIds / archived / pinned), projection cache and its `.bak`, log lines mentioning those sessions, same-named `cache/` entries, attachment objects and `files-v3` records referenced only by them | No |
| **Restore** | Directory moves back to the original absolute workspace path, cache row is written back, and the conversation returns to its previous slot | — |

Moving to the trash never touches logs, cache or attachments; only a purge removes them.
When a workspace ends up with no sessions left, its registration is deleted too, so the sidebar does
not keep an empty group. If the registration is gone at restore time, it is recreated from the
recorded path and the conversation still lands in its original slot.

### 2. Session management panel

Two entry points: the **Session management** button at the bottom of the sidebar, and
**Move to recycle bin** in a conversation's context menu.

- Conversations are grouped by workspace; group headers collapse and expand, and Enter / Space work too
- Search filters by title or workspace path; **Select all** applies to the filtered list,
  **Select group** only to that group
- Each row shows size, last activity, subagent count and workspace path
- Deletion always asks for confirmation, listing session count, artifact count and total size
- **Recycle bin** tab: the same search / select-all / per-row checkbox behaviour, with per-row
  **Restore** and **Purge**
- Bottom of the recycle bin tab: **Also delete produced files** deletes the files a session created
  during a purge, with a preview list; the red **Delete all** acts on the selected rows behind the
  same confirmation
- Selections in the two tabs are independent and reset when you switch, so one page's selection
  never leaks into a deletion on the other

### 3. Open file folder

Right-click a conversation → **Open file folder**:

- Scans the **whole conversation chain** (the root plus every subagent it spawned) and counts only
  files produced by write operations
- Groups by directory, opens the directory holding most of the files, and **multi-selects** the hits
- Reports `Opened the folder and highlighted N files; M more are in other directories`

Right-click → **Open all file folders** opens every directory that contains produced files and
highlights each one, with no cap on the number of directories. Explorer work is queued serially so
windows never fight over focus. The open mode is visible under the ⚙ in the panel header; tab
automation is disabled, only the multi-window mode is used.

What counts as a produced file:

| Source | Counted |
|---|---|
| `file_path` from `write` / `edit` tool calls | ✅ |
| Write targets on the command line: `>` `>>` redirection, `Set-Content` / `Out-File`, `Copy-Item` / `Move-Item` destinations, `tar -czf` output | ✅ |
| Files changed inside the workspace during the session (mtime fallback) | ✅ |
| Files opened by `read` / `grep` / `read_image` | ❌ reference only |
| Paths merely mentioned in the conversation text | ❌ |

### 4. File query

Right-click → **File query** scans everything the conversation produced and builds an analysis
prompt (file list, directory distribution, expected output format), then fills it straight into the
chat input box. Press Enter and the assistant explains each file, sorts them into cache /
conversation record / generated file / referenced asset, and suggests what can be deleted.

If the input box cannot be reached (for example the page structure changed), the text falls back to
the clipboard.

### 5. File information: copy every path

Right-click → **File information**, or the **File information** button on a session row: after
scanning, the clipboard receives a complete path list **grouped by type** — produced files, cache,
workspace directories, downloaded assets, conversation records — de-duplicated and sorted inside
each group. It can be pasted anywhere: search boxes, scripts, another conversation, a diff tool.

---

## Install

### From the package (recommended)

1. Quit DeepSeek Harness completely (right-click the tray icon; closing the window is not enough)
2. Unpack `dsh-session-recycle-<version>.zip` and double-click `一键安装-纯PowerShell.cmd`
3. After **Install complete**, reopen DeepSeek Harness; a **Session management** entry appears at the
   bottom of the sidebar

No network access, no administrator rights, no Node or npm install — only the PowerShell 5.1 that
ships with Windows.

To inspect before touching anything, pass a flag to the `.cmd`:

```text
一键安装-纯PowerShell.cmd --check            inspect only, writes nothing
一键安装-纯PowerShell.cmd --dry-run          show planned changes, writes nothing
一键安装-纯PowerShell.cmd --profile desktop  install one profile when several exist
一键安装-纯PowerShell.cmd --link             link the source directory instead of copying
一键安装-纯PowerShell.cmd --home D:\dsh-home point at a non-default data directory
```

The installer touches exactly two things: it copies the plugin into
`<profile>\node_modules\dsh-session-recycle\`, and it registers one dependency plus one bundle entry
in `<profile>\package.json`, which it backs up as `package.json.bak-<timestamp>` first.

### Uninstall

Double-click `一键卸载-纯PowerShell.cmd`, or run:

```powershell
.\install-dsh-session-recycle-native.ps1 --uninstall
```

It removes the copy under `node_modules` and drops the two entries from `package.json`.
Conversations already moved to the recycle bin are untouched; they live under
`%USERPROFILE%\.dsh\dsh-session-recycle\` if you want them gone too.

### Development mode

Put the source under `<DSH_HOME>\local-plugins\dsh-session-recycle` and register it in the profile's
`package.json`:

```json
"dependencies": { "dsh-session-recycle": "link:C:/Users/<you>/.dsh/local-plugins/dsh-session-recycle" }
"dsh": { "profile": { "bundles": ["...", "dsh-session-recycle"] } }
```

The `link:` entry is a symlink, so restarting DSH is enough — no reinstall needed.

---

## Implementation notes

- **Session bodies are multi-frame zstd.** Node's one-shot decompression returns only the first
  frame; the code splits on the `28 B5 2F FD` magic and inflates frame by frame to get the full text.
- **The title lives in the `session/title` event**, not in the user message field, and a later
  provider title wins over the fallback.
- **A deleted row lingering in the sidebar means host memory state was not cleared.** Before removing
  files, run the teardown chain: `agent.cancel({kind:"disposed"})` → `agent.scope.dispose()` →
  `agents.store.delete()` → `sessions.flush()` → `entry.detach()` → and finally
  `ctx.emit("session/disposed", session)`. Without the last step the conversation is moved to
  "Ungrouped" instead of disappearing.
- **A workspace is an independent entity** (`ctx.workspaceRegistry`). `detachSession(id)` only filters
  the id out of `sessionIds`; the registration itself survives an emptied workspace, which is why the
  sidebar keeps an empty group. So after detaching, check whether `sessionIds` is empty and only then
  call `registry.delete(id)`. On restore, if the registration is gone, recreate it with
  `registry.create(path)` before attaching.
- **Restoring to the original slot** needs more than `entity.attachSession(id)`, which prepends:
  `insertSessionBefore(id, anchor)` puts it back, using the conversation that used to follow it.
- **Artifact detection** extracts path fragments from the body with regexes (the whole string does not
  have to be a path), then falls back to scanning the workspace by session time. Only regular files
  inside `cwd` that really exist, outside `node_modules`/`.git`/`dist`, not project config files, and
  with extensions outside the log/cache blacklist are kept.
- **Explorer multi-select** goes through Shell COM: `$win.Document.SelectItem($item, 1)`, and repeated
  calls accumulate. File names cannot travel as command-line arguments (Chinese gets mangled by the
  encoding), so they are passed in a UTF-8 JSON file; the child process must not be `detached`, or
  PowerShell exit early and no window ever appears.

---

## Known limitations

- Only verified on Windows (depends on `explorer.exe` and Shell COM).
- Artifact detection relies on path text in the body plus a workspace mtime fallback; relative writes
  after a plain `cd` on the command line can still be missed.
- Tab mode is disabled: Windows Explorer cannot guarantee automated focus safety, and a mistyped
  keystroke can rename a file.
- It only runs inside DSH and depends on the host-provided `react` and
  `@deepseek-ai/dsh-client-ui-primitives`.

---

## License

MIT
