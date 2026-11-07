# 发布到 DSH 插件市场

目标：[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的收录列表。
一次投稿 = 一个 YAML 文件，合并后自动出现在市场里。

---

## 前置条件（缺一不可）

| 条件 | 当前状态 |
|---|---|
| GitHub 仓库，有真实可用的代码 | ⚠ 还没有仓库，需要先建并推送 |
| `package.json` 声明 `dsh.bundle` | ✅ 已有 |
| 仓库根目录有 `cordis.patch.yml` | ✅ 已有 |
| 仓库创建满 **1 天** | ⏳ 建完仓库要等一天 |
| 仓库加 `dsh-plugin` topic | ⏳ 建完仓库后加 |
| 描述属实、无营销词 | ✅ 已按规范写 |

> **最容易被打回的原因**：只声明了 `dsh.client` 而没声明 `dsh.bundle`。本插件两者都有，不会踩这个坑。

---

## 第一步：建仓库并推送

```powershell
cd C:\Users\ZZHI\.dsh\local-plugins\dsh-session-recycler
git init -b main
git add .
git commit -m "feat: dsh-session-recycler <版本>"
git remote add origin https://github.com/<你的用户名>/dsh-session-recycler.git
git push -u origin main
```

推之前把 `package.json` 里的 `repository.url` 改成你的真实仓库地址。

推完到仓库设置里加 topic：`dsh-plugin`。

**然后等满 24 小时**——CI 会检查仓库年龄，不满一天直接拒。

---

## 第二步：可选但推荐

### 发 GitHub Release 挂预构建包

市场会优先展示预构建 tarball，用户装的时候跳过源码构建。

```powershell
# 用现成的 dist 产物
# 把 dsh-session-recycler-<版本>.tgz 传上去：
gh release create v<版本> .\dist\dsh-session-recycler-<版本>.tgz --title "v<版本>" --notes "见 RELEASE.md"
```

⚠️ 资产名带不带版本号要和 `tarball:` 字段匹配（见下）。

### 发 npm（可选）

有 npm 包就能显示下载量。要求 `package.json` 的 `repository` 字段指回你的仓库。

```powershell
npm publish
```

---

## 第三步：提 PR

Fork [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)，
新增**一个文件**：`data/plugins/<用户名>__dsh-session-recycler.yml`

```yaml
url: https://github.com/<你的用户名>/dsh-session-recycler
name: <你的用户名>/dsh-session-recycler
category: session
description:
  en: Move DSH sessions to a recoverable recycle bin, purge them together with their subagent trees, and reveal the files a conversation produced in Explorer.
  zh: 把 DSH 会话移入可恢复的回收站，彻底删除时连带子代理树与缓存，并能在资源管理器里高亮该对话产出的文件。
# 可选：预构建包（发了 GitHub Release 再填）
# tarball: https://github.com/<你的用户名>/dsh-session-recycler/releases/latest/download/dsh-session-recycler.tgz
```

注意：

- `url` 必须和仓库完全一致
- 文件名是 `owner__repo.yml`（双下划线）
- 描述里有 `: `（冒号+空格）必须给整行加引号——本例没有
- **不要手改 README**，那两个文件是脚本从 `data/plugins/*.yml` 生成的
- 一个 PR 最多 3 条

分类取值里 `session` 最贴切（还有 `ui` / `tools` / `dev` 等可选）。选得不准维护者会直接改，不会打回。

---

## CI 会检查什么

按顺序：

1. 条目数 ≤ 3
2. 从你仓库的 `package.json` 读 `dsh.bundle` —— 只声明 `dsh.client` 会在这步失败
3. 仓库年龄 ≥ 1 天
4. `awesome-lint` + 站点构建（双语一致性、分隔符、日期、截图）

失败会明确指出要改什么，推到同一分支即可，不用重开 PR。

---

## 评审会看什么

- 代码是否真做了描述里写的事（包括数字和 API 名称）
- 分类是否合理（不准的维护者直接改）
- 是不是真实可用的代码，不是占位
- 是否与已有条目重复
- 源码有无可疑之处
- PR 有没有动别人的条目

插件功能与描述的对应关系：

| 描述里的说法 | 代码位置 |
|---|---|
| 移入可恢复的回收站 | `lib/index.js` `trashSession()` |
| 彻底删除连带子代理树 | `buildTree()` + `purgeSession()` |
| 清缓存 | `dropProjectionCacheRecord()` / `scrubCache()` |
| 在资源管理器里高亮产物 | `revealSession()` + `lib/reveal.ps1` |

---

## 本地已经准备好的东西

```
package.json        dsh.bundle ✅ / repository 待你填
cordis.patch.yml    ✅
screenshots.json    ✅ 指向 assets/screenshot-1.png
assets/screenshot-1.png   ✅ 真实界面截图
README.md           完整功能与实现说明
RELEASE.md          发布说明
lib/reveal.ps1      打开文件目录的高亮脚本（必须一起提交）
```
