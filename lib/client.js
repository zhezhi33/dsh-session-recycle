/**
 * dsh-session-recycler — Client half.
 *
 * 三个入口，共用一套面板：
 *   1. 侧栏底部「会话管理」按钮（与「会话回收站」同区）；
 *   2. 会话右键菜单里的「移入回收站」；
 *   3. 面板内「回收站」页签：恢复 / 彻底删除。
 *
 * 面板布局按需求：左栏会话多选，待清理页按工作区分组且可折叠；
 * 回收站页同样支持搜索、全选与逐条勾选，底部放「同时删除文件产物」与红色「全部删除」，
 * 删除前二次确认。
 *
 * 无构建步骤：DSH 通过 package.json 的 dsh.client 声明直接加载本文件。
 */

window.__ModuleLoader__.load({
  id: "dsh-session-recycler",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const { useState, useEffect, useMemo, useRef, useSyncExternalStore, useCallback } = React;
    let P = {};
    try { P = require("@deepseek-ai/dsh-client-ui-primitives") || {}; } catch { P = {}; }

    const h = (type, props, ...children) => React.createElement(type, props, ...children);

    const API = "/session-recycle/api";

    /* 项目主页：面板头部的 GitHub 图标直接打开这里 */
    const REPO_URL = "https://github.com/zhezhi33/dsh-session-recycler";

    let hostCtx = undefined;

    /* ───────────────────────── 文案（已按界面语规范润色） ───────────────────────── */

    const zh = {
      "entry.title": "会话管理",
      "entry.hint": "批量清理会话，可连同文件产物一起删除",
      "menu.trash": "移入回收站",
      "menu.reveal": "打开文件目录",
      "menu.revealAll": "打开所有文件目录",
      "menu.query": "文件查询",
      "toast.revealAll": "已打开 {n} 个目录并高亮其中的文件",
      "toast.revealAllMore": "还有 {n} 个目录未展开",
      "toast.queryEmpty": "这条对话还没有可识别的文件",
      "toast.queryInjected": "已把 {n} 个文件的分析指令填入输入框，回车即可发送",
      "toast.queryCopied": "已复制 {n} 个文件的清单到剪贴板，粘贴到输入框发送即可",
      "toast.revealArtifacts": "已打开目录并高亮 {n} 个文件",
      "toast.revealOther": "另有 {n} 个文件在其它目录",
      "toast.revealWorkspace": "已打开工作区目录",
      "toast.revealSession": "已打开会话文件目录",
      "panel.title": "会话管理",
      "panel.subtitle": "移入回收站后仍可恢复；彻底删除才会连子代理会话、日志与缓存一并清除",
      "panel.tabPending": "待清理",
      "panel.tabTrash": "回收站",
      "panel.search": "搜索会话标题或工作区",
      "panel.selectAll": "全选",
      "panel.clearAll": "清空选择",
      "panel.selected": "已选 {n} 个会话",
      "panel.selectedSize": "共 {size}",
      "panel.empty": "没有可清理的会话",
      "panel.emptyTrash": "回收站是空的",
      "panel.loading": "正在读取会话列表…",
      "settings.title": "设置",
      "settings.openMode": "「打开所有文件目录」的方式",
      "settings.modeWindows": "多个窗口",
      "settings.modeWindowsHint": "每个目录单独开一个资源管理器窗口，最稳",
      "settings.modeTabsHint": "没有「同一窗口标签页」这一选项：Windows 资源管理器保证不了自动化焦点安全，一旦开错窗口，误操作会落到别的文件或磁盘上。",
      "settings.back": "返回",
      "panel.openFolder": "打开文件目录",
      "panel.openFolderHint": "右键会话可用",
      "panel.fileInfo": "文件信息",
      "panel.fileInfoCopied": "已复制 {n} 条分类路径",
      "panel.fileInfoEmpty": "没有可复制的文件路径",
      "panel.cancel": "取消",
      "panel.close": "关闭",
      "panel.trashAction": "移入回收站",
      "panel.restore": "恢复",
      "panel.purge": "彻底删除",
      "panel.deleteAll": "全部删除",
      "panel.collapseGroup": "收起",
      "panel.expandGroup": "展开",
      "panel.removeArtifacts": "同时删除文件产物",
      "panel.removeArtifactsHint": "彻底删除时，一并删除该会话在工作区内生成或修改的文件",
      "panel.artifactsFound": "已识别 {n} 个文件产物 · {size}",
      "panel.artifactsShort": "{n} 个文件 · {size}",
      "panel.artifactsNoneShort": "没有可删除的文件",
      "panel.artifactsNone": "该会话没有可识别的文件产物",
      "panel.artifactsScanning": "正在识别文件产物…",
      "confirm.title": "确认清理？",
      "confirm.body": "将把 {n} 个会话移入回收站，可从回收站恢复。",
      "confirm.artifacts": "同时删除 {n} 个文件产物（{size}），此部分不可恢复。",
      "confirm.back": "返回",
      "confirm.ok": "确认清理",
      "confirm.purgeTitle": "确认彻底删除？",
      "confirm.purgeBody": "将删除 {n} 个会话，并连同它们的子代理会话整棵树一起清除，同时清理侧栏账本、日志、缓存与专属附件。此操作不可恢复。",
      "toast.trashed": "已移入回收站",
      "toast.purgedWithArtifacts": "已彻底删除，并删除 {n} 个文件产物",
      "toast.purgedWithArtifactsPartial": "已彻底删除，删除 {n} 个文件产物，另有 {failed} 个失败",
      "toast.artifactsFailed": "会话已彻底删除，但 {n} 个文件产物都没删掉（可能正被占用），可稍后回到回收站页重试",
      "toast.purgedNoArtifacts": "已彻底删除，但没有识别到可删除的文件产物",
      "toast.restored": "已恢复到原工作区位置",
      "toast.purged": "已彻底删除",
      "toast.prunedDirs": "，并清理了 {n} 个空目录",
      "toast.failed": "操作失败：{message}"
    };

    const T = (key, vars) => {
      let s = zh[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
      return s;
    };

    const fmtSize = (n) => {
      if (!n || n < 1) return "0 B";
      const units = ["B", "KB", "MB", "GB"];
      let i = 0; let v = n;
      while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
      return (i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)) + " " + units[i];
    };

    const fmtTime = (ms) => {
      if (!ms) return "";
      const d = new Date(ms);
      const now = Date.now();
      const diff = now - ms;
      if (diff < 60_000) return "刚刚";
      if (diff < 3_600_000) return Math.floor(diff / 60_000) + " 分钟前";
      if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + " 小时前";
      if (diff < 7 * 86_400_000) return Math.floor(diff / 86_400_000) + " 天前";
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };

    /* ───────────────────────── 主题与配色 ───────────────────────── */

    function detectTheme() {
      try {
        const body = document.body;
        if (body) {
          if (body.hasAttribute("data-ds-dark-theme")) return "dark";
          if (body.style.getPropertyValue("--dsw-alias-label-primary") !== "") return "light";
        }
      } catch { /* fall through */ }
      try {
        const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
        if (mq) return mq.matches ? "dark" : "light";
      } catch { /* fall through */ }
      return "light";
    }

    function useTheme() {
      const [theme, setTheme] = useState(() => detectTheme());
      useEffect(() => {
        const listener = () => setTheme(detectTheme());
        const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
        if (mq) {
          if (typeof mq.addEventListener === "function") mq.addEventListener("change", listener);
          else if (typeof mq.addListener === "function") mq.addListener(listener);
        }
        const observer = typeof MutationObserver === "function" && document.body
          ? new MutationObserver(listener) : null;
        if (observer) observer.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme", "style"] });
        return () => {
          if (mq) {
            if (typeof mq.removeEventListener === "function") mq.removeEventListener("change", listener);
            else if (typeof mq.removeListener === "function") mq.removeListener(listener);
          }
          if (observer) observer.disconnect();
        };
      }, []);
      return theme;
    }

    /* 配色只分三层：底（panel）、卡片（card）、选中（accentSoft）。
       边框一律用 line（很淡），需要强调时才用 panelBorder。
       这样列表看起来是「浮在底上的行」，而不是「一格一格的表格」。 */
    const paletteFor = (theme) => theme === "dark" ? {
      layer: "rgba(0,0,0,.52)",
      panel: "#1f1f22",
      panelBorder: "rgba(255,255,255,.09)",
      shadow: "0 24px 64px rgba(0,0,0,.62), 0 2px 8px rgba(0,0,0,.45)",
      text: "#ececed",
      secondary: "#9a9aa3",
      muted: "#75757e",
      danger: "#f0616d",
      dangerSoft: "rgba(240,97,109,.14)",
      success: "#54cf92",
      accent: "#7b91ff",
      accentSoft: "rgba(123,145,255,.15)",
      btnBorder: "rgba(255,255,255,.16)",
      line: "rgba(255,255,255,.07)",
      card: "rgba(255,255,255,.045)",
      rowBorder: "rgba(255,255,255,.07)",
      rowHover: "rgba(255,255,255,.045)",
      rowActive: "rgba(123,145,255,.13)",
      inputBg: "rgba(255,255,255,.05)",
      chipBg: "rgba(255,255,255,.07)"
    } : {
      layer: "rgba(15,18,26,.32)",
      panel: "#ffffff",
      panelBorder: "rgba(15,18,26,.10)",
      shadow: "0 24px 64px rgba(15,18,26,.16), 0 2px 6px rgba(15,18,26,.06)",
      text: "#17181c",
      secondary: "#63636e",
      muted: "#8a8a95",
      danger: "#d93a45",
      dangerSoft: "rgba(217,58,69,.07)",
      success: "#12905c",
      accent: "#3f5bd9",
      accentSoft: "rgba(63,91,217,.08)",
      btnBorder: "rgba(15,18,26,.14)",
      line: "rgba(15,18,26,.07)",
      card: "rgba(15,18,26,.03)",
      rowBorder: "rgba(15,18,26,.07)",
      rowHover: "rgba(15,18,26,.03)",
      rowActive: "rgba(63,91,217,.07)",
      inputBg: "rgba(15,18,26,.04)",
      chipBg: "rgba(15,18,26,.05)"
    };

    /* ───────────────────────── 样式（对齐产品侧栏「新会话」按钮的令牌） ───────────────────────── */

    const CSS = `
.ssr-footerSlot{position:relative;width:100%;display:flex}
.ssr-footerBtn{flex:1 1 auto;min-width:0;min-height:38px;padding:8px 10px;cursor:pointer;font-size:14px;font-weight:500;gap:8px;justify-content:center;align-items:center;text-align:center;display:flex;font-family:inherit;
  background:var(--dsw-alias-button-elevated-fill,#ffffff);border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));color:var(--dsw-alias-label-primary,#1f2328);border-radius:var(--dsw-radius-md,8px)}
.ssr-footerBtn:hover{background:var(--dsw-alias-button-floating-hover,#f1f3f5)}
[data-platform=darwin] .ssr-footerBtn{background:#ffffff8c}
[data-platform=darwin] .ssr-footerBtn:hover{background:#ffffff4d}
[data-platform=darwin] [data-ds-dark-theme] .ssr-footerBtn{background:#ffffff26}
[data-platform=darwin] [data-ds-dark-theme] .ssr-footerBtn:hover{background:#ffffff33}
.ssr-footerBtnRail{flex:0 0 36px;width:36px;min-width:36px;min-height:36px;padding:0}
.ssr-railOnly .ssr-footerBtn{background:transparent;border-color:transparent}
.ssr-railOnly .ssr-footerBtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
.ssr-panel{width:720px;max-width:94vw;height:560px;max-height:86vh;border-radius:14px;display:flex;flex-direction:column;overflow:hidden;font-size:13px;line-height:20px;letter-spacing:.01em}
.ssr-layer{position:absolute;inset:0}
/* 滚动条：细、无轨道、只在需要时可见，避免把留白吃掉 */
.ssr-scroll{overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color:rgba(128,128,140,.35) transparent}
.ssr-scroll::-webkit-scrollbar{width:10px;height:10px}
.ssr-scroll::-webkit-scrollbar-track{background:transparent}
.ssr-scroll::-webkit-scrollbar-thumb{background:rgba(128,128,140,.32);border-radius:8px;border:3px solid transparent;background-clip:content-box}
.ssr-scroll::-webkit-scrollbar-thumb:hover{background:rgba(128,128,140,.55);border:3px solid transparent;background-clip:content-box}
/* 键盘可达：只在键盘聚焦时描环，鼠标点击不描 */
.ssr-focusable:focus-visible{outline:2px solid var(--ssr-accent,#3f5bd9);outline-offset:1px;border-radius:8px}
.ssr-input:focus{border-color:var(--ssr-accent,#3f5bd9)!important;background:transparent!important}
.ssr-tabline{position:relative;display:flex;gap:2px;padding:0 18px;box-shadow:inset 0 -1px 0 var(--ssr-line,rgba(0,0,0,.07))}
.ssr-row{transition:background .12s ease}
.ssr-fade{animation:ssr-fade .16s ease}
@keyframes ssr-fade{from{opacity:0;transform:translateY(-2px)}to{opacity:1;transform:none}}
`;

    function injectStyle() {
      try {
        if (document.getElementById("dsh-session-recycler-style")) return () => {};
        const tag = document.createElement("style");
        tag.id = "dsh-session-recycler-style";
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => { try { tag.remove(); } catch { /* ignore */ } };
      } catch { return () => {}; }
    }

    /* ───────────────────────── 面板开关 store ───────────────────────── */

    let panelOpen = false;
    let panelTab = "pending"; // pending | trash
    let preselectCwd = null;
    const listeners = new Set();
    const store = {
      subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
      getSnapshot: () => panelOpen,
      getTab: () => panelTab,
      getPreselect: () => preselectCwd,
      open(tab, opts) {
        panelTab = tab === "trash" ? "trash" : "pending";
        preselectCwd = typeof opts?.preselectCwd === "string" ? opts.preselectCwd : null;
        panelOpen = true;
        listeners.forEach(l => l());
      },
      consumePreselect() { const v = preselectCwd; preselectCwd = null; return v; },
      close() { if (panelOpen) { panelOpen = false; listeners.forEach(l => l()); } }
    };
    const usePanelOpen = () => useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    const usePanelTab = () => useSyncExternalStore(store.subscribe, store.getTab, store.getTab);

    /* ───────────────────────── 偏好设置 ───────────────────────── */

    const PREF_KEY = "dsh-session-recycler:open-mode";
    const OPEN_MODE = "windows";

    /* 「打开所有文件目录」只有这一种方式。标签页自动化已暂停
       （Windows 资源管理器保证不了焦点安全），旧偏好在这里顺手清掉。 */
    const getOpenMode = () => {
      try {
        if (localStorage.getItem(PREF_KEY) !== OPEN_MODE) localStorage.setItem(PREF_KEY, OPEN_MODE);
      } catch { /* ignore */ }
      return OPEN_MODE;
    };

    /* ───────────────────────── 提示条 ───────────────────────── */

    let toastState = null;
    const toastListeners = new Set();
    const toastStore = {
      subscribe(l) { toastListeners.add(l); return () => toastListeners.delete(l); },
      getSnapshot: () => toastState
    };
    const useToastState = () => useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, toastStore.getSnapshot);
    const showToast = (text, kind = "ok") => {
      toastState = { text, kind, at: Date.now() };
      toastListeners.forEach(l => l());
      setTimeout(() => {
        if (toastState && Date.now() - toastState.at >= 2600) {
          toastState = null;
          toastListeners.forEach(l => l());
        }
      }, 2800);
    };

    /* ───────────────────────── API 调用 ───────────────────────── */

    const call = async (path, body) => {
      const res = await fetch(API + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const json = await res.json().catch(() => ({ ok: false, error: "响应解析失败" }));
      if (!json.ok) throw new Error(json.error || "请求失败");
      return json.result;
    };

    const refreshSidebar = async () => {
      try { if (hostCtx?.sessions?.refresh) await hostCtx.sessions.refresh(); } catch { /* best-effort */ }
    };

    /* ───────────────────────── 侧栏底部入口 ───────────────────────── */

    function CleanupFooterAction(props) {
      const wide = props?.wide === true;
      const Icon = P.IconArchiveOutlineRegular || P.IconTrashOutlineRegular || P.IconDeleteOutlineRegular;
      const glyph = Icon ? h(Icon, { size: wide ? 16 : 18 }) : h("span", { style: { fontSize: wide ? 15 : 17, lineHeight: 1 } }, "🗑");
      try {
        return h("div", { className: "ssr-footerSlot" + (wide ? "" : " ssr-railOnly") },
          h("button", {
            type: "button",
            className: "ssr-footerBtn" + (wide ? "" : " ssr-footerBtnRail"),
            title: T("entry.hint"),
            "aria-label": T("entry.title"),
            onClick: () => store.open("pending")
          },
            glyph,
            wide ? h("span", null, T("entry.title")) : null
          )
        );
      } catch { return null; }
    }

    const footerInjected = () => ({});

    /* ───────────────────────── 会话右键菜单项 ───────────────────────── */

    function TrashMenuItem(props) {
      const { sessionId, useMenuOpenState } = props || {};
      if (!sessionId) return null;
      if (typeof P.MenuItemButton !== "function") return null;
      try {
        const [, setMenuOpen] = useMenuOpenState();
        return h(P.MenuItemButton, {
          danger: true,
          icon: P.IconTrashOutlineRegular ? h(P.IconTrashOutlineRegular, {}) : undefined,
          onSelect: async () => {
            try { setMenuOpen(false); } catch { /* 菜单已关闭 */ }
            try {
              const r = await call("/delete", { sessionIds: [sessionId], removeArtifacts: false });
              const errs = (r.errors || []).filter(e => e && e.error);
              if (errs.length > 0) {
                showToast(errs[0].error, "error");
              } else {
                showToast(T("toast.trashed"), "ok");
                await refreshSidebar();
              }
            } catch (error) {
              showToast(T("toast.failed", { message: error.message }), "error");
            }
          },
          children: T("menu.trash")
        });
      } catch { return null; }
    }

    /* 右键会话 → 打开这个会话的文件目录（生成文件 / 对话文件） */
    function RevealFilesMenuItem(props) {
      const { sessionId, useMenuOpenState } = props || {};
      if (!sessionId) return null;
      if (typeof P.MenuItemButton !== "function") return null;
      try {
        const [, setMenuOpen] = useMenuOpenState();
        return h(P.MenuItemButton, {
          icon: P.IconFolderOutlineRegular ? h(P.IconFolderOutlineRegular, {}) : undefined,
          onSelect: async () => {
            try { setMenuOpen(false); } catch { /* 菜单已关闭 */ }
            try {
              const r = await call("/reveal", { sessionId });
              let text;
              if (r.kind === "artifacts") {
                text = T("toast.revealArtifacts", { n: r.highlighted ?? r.artifacts });
                const others = r.otherDirs?.reduce((a, d) => a + d.count, 0) ?? 0;
                if (others > 0) text += "；" + T("toast.revealOther", { n: others });
              } else if (r.kind === "workspace") {
                text = T("toast.revealWorkspace");
              } else {
                text = T("toast.revealSession");
              }
              showToast(text, "ok");
            } catch (error) {
              showToast(T("toast.failed", { message: error.message }), "error");
            }
          },
          children: T("menu.reveal")
        });
      } catch { return null; }
    }

    /* 右键会话 → 打开这条对话产物所在的全部目录 */
    function RevealAllMenuItem(props) {
      const { sessionId, useMenuOpenState } = props || {};
      if (!sessionId) return null;
      if (typeof P.MenuItemButton !== "function") return null;
      try {
        const [, setMenuOpen] = useMenuOpenState();
        return h(P.MenuItemButton, {
          icon: P.IconFolderOutlineRegular ? h(P.IconFolderOutlineRegular, {}) : undefined,
          onSelect: async () => {
            try { setMenuOpen(false); } catch { /* 菜单已关闭 */ }
            try {
              // 不限数量，全部打开；模式按设置来
              const r = await call("/reveal-all", { sessionId, mode: getOpenMode() });
              let text = T("toast.revealAll", { n: r.total ?? 0 });
              if (r.remaining > 0) text += "；" + T("toast.revealAllMore", { n: r.remaining });
              showToast(text, "ok");
            } catch (error) {
              showToast(T("toast.failed", { message: error.message }), "error");
            }
          },
          children: T("menu.revealAll")
        });
      } catch { return null; }
    }

    /* 把文本塞进对话输入框；失败返回 false，调用方再退到剪贴板 */
    const injectIntoComposer = (text) => {
      try {
        const el = document.querySelector('textarea:not([readonly])')
          || document.querySelector('[contenteditable="true"]')
          || document.querySelector('div[role="textbox"]');
        if (!el) return false;

        el.focus();
        if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
          const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          if (!setter) return false;
          setter.call(el, text);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        }
        // contenteditable：选中全部后整段替换
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return document.execCommand("insertText", false, text);
      } catch { return false; }
    };

    const copyToClipboard = async (text) => {
      try {
        if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
      } catch { /* fall through */ }
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch { return false; }
    };

    const formatFileInfo = (report) => {
      const groups = [
        ["文件产物", (report.files || []).filter(f => f.category === "文件产物").map(f => f.path)],
        ["缓存", (report.files || []).filter(f => f.category === "缓存").map(f => f.path)],
        ["工作目录", (report.workspaces || []).map(x => x.path)],
        ["网络素材下载", (report.files || []).filter(f => f.category === "网络素材下载").map(f => f.path)],
        ["对话记录", (report.conversationRecords || []).map(x => x.path)]
      ];
      return groups
        .filter(([, paths]) => paths.length > 0)
        .map(([label, paths]) => `${label}\n${[...new Set(paths)].sort((a, b) => a.localeCompare(b)).map(p => `  ${p}`).join("\n")}`)
        .join("\n\n");
    };

    const fmtKB = (n) => {
      if (!n) return "0 B";
      return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : (n / 1024).toFixed(1) + " KB";
    };

    /* 从绝对路径取目录：不能拿 rel 去反推，
       工作区外的产物 rel 本身就是绝对路径，长度一减就错位。 */
    const dirOfPath = (p) => {
      const s = String(p || "");
      const cut = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
      return cut > 0 ? s.slice(0, cut) : "";
    };

    const buildFilePrompt = (r) => {
      const lines = [];
      lines.push("请分析这条对话产生的所有文件，逐个说明用途，并分类。");
      lines.push("");
      lines.push("工作目录：" + (r.cwd || "(未知)"));
      lines.push("共 " + r.total + " 个文件，分布在 " + r.dirs.length + " 个目录。");
      lines.push("");
      const byDir = new Map();
      for (const f of r.files) {
        const dir = dirOfPath(f.path) || r.cwd || "(未知)";
        if (!byDir.has(dir)) byDir.set(dir, []);
        byDir.get(dir).push(f);
      }
      for (const [dir, list] of byDir) {
        lines.push("【" + dir + "】 " + list.length + " 个");
        for (const f of list) lines.push("- " + f.rel + "  (" + fmtKB(f.bytes) + ")");
        lines.push("");
      }
      lines.push("请按以下格式回答：");
      lines.push("1. 逐个文件的用途（一行一个，看不清的标「不确定」）");
      lines.push("2. 分类汇总：哪些是缓存、哪些是对话记录、哪些是生成的文件、哪些是引用素材");
      lines.push("3. 建议可以删除的候选，以及理由");
      return lines.join("\n");
    };

    /* 右键会话 → 扫描全部文件并把分析提示词送到输入框 */
    function FileQueryMenuItem(props) {
      const { sessionId, useMenuOpenState } = props || {};
      if (!sessionId) return null;
      if (typeof P.MenuItemButton !== "function") return null;
      try {
        const [, setMenuOpen] = useMenuOpenState();
        return h(P.MenuItemButton, {
          icon: P.IconSearchOutlineRegular ? h(P.IconSearchOutlineRegular, {}) : undefined,
          onSelect: async () => {
            try { setMenuOpen(false); } catch { /* 菜单已关闭 */ }
            try {
              const r = await call("/file-report", { sessionId });
              if (!r.total) {
                showToast(T("toast.queryEmpty"), "error");
                return;
              }
              const prompt = buildFilePrompt(r);
              if (injectIntoComposer(prompt)) {
                showToast(T("toast.queryInjected", { n: r.total }), "ok");
                return;
              }
              const copied = await copyToClipboard(prompt);
              showToast(copied
                ? T("toast.queryCopied", { n: r.total })
                : T("toast.failed", { message: "无法写入输入框或剪贴板" }),
                copied ? "ok" : "error");
            } catch (error) {
              showToast(T("toast.failed", { message: error.message }), "error");
            }
          },
          children: T("menu.query")
        });
      } catch { return null; }
    }

    /* ───────────────────────── 面板 ───────────────────────── */

    /* 纯图标按钮：28×28 固定尺寸 + 悬停高亮（鼠标移入/键盘聚焦都会亮），
       图标一律 16×16 内联 SVG，避免字符字形大小不一导致的错位。 */
    function IconBtn({ label, onClick, active, palette, children }) {
      const [hover, setHover] = useState(false);
      return h("button", {
        type: "button",
        title: label,
        "aria-label": label,
        onClick,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        onFocus: () => setHover(true),
        onBlur: () => setHover(false),
        style: {
          width: 30, height: 30, padding: 0, borderRadius: 8, border: "none",
          background: active ? palette.accentSoft : (hover ? palette.chipBg : "transparent"),
          color: active ? palette.accent : (hover ? palette.text : palette.secondary),
          cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
          lineHeight: 0, transition: "background .12s ease, color .12s ease"
        }
      }, children);
    }

    function Checkbox({ checked, onChange, label, palette, disabled }) {
      const [hover, setHover] = useState(false);
      const flip = (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        if (!disabled) onChange(!checked);
      };
      /* 勾用 SVG 画，比字符 ✓ 更居中、粗细一致 */
      const tick = h("svg", {
        width: 11, height: 11, viewBox: "0 0 12 12", fill: "none", stroke: "#fff",
        strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true"
      }, h("path", { d: "M2.5 6.2 4.9 8.6 9.5 3.6" }));
      return h("label", {
        onClick: flip,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        style: { display: "inline-flex", alignItems: "center", gap: 8, cursor: disabled ? "not-allowed" : "pointer", userSelect: "none" }
      },
        h("span", {
          style: {
            width: 16, height: 16, borderRadius: 5, flex: "0 0 auto", boxSizing: "border-box",
            border: "1.5px solid " + (checked || (hover && !disabled) ? palette.accent : palette.btnBorder),
            background: checked ? palette.accent : "transparent",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            transition: "background .12s ease, border-color .12s ease",
            opacity: disabled ? .5 : 1
          }
        }, checked ? tick : null),
        label ? h("span", { style: { fontSize: 12.5, color: disabled ? palette.muted : palette.text, whiteSpace: "nowrap" } }, label) : null
      );
    }

    function SessionRow({ item, checked, onToggle, palette, onFileInfo }) {
      const [hover, setHover] = useState(false);
      const [fileInfoBusy, setFileInfoBusy] = useState(false);
      const handleFileInfo = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (fileInfoBusy) return;
        setFileInfoBusy(true);
        try {
          const report = await call("/file-report", { sessionId: item.id });
          const text = formatFileInfo(report);
          if (!text) { showToast(T("panel.fileInfoEmpty"), "error"); return; }
          const copied = await copyToClipboard(text);
          if (copied) showToast(T("panel.fileInfoCopied", { n: (report.files || []).length + (report.workspaces || []).length + (report.conversationRecords || []).length }), "ok");
          else showToast(T("toast.failed", { message: "剪贴板写入失败" }), "error");
        } catch (error) {
          showToast(T("toast.failed", { message: error.message }), "error");
        } finally { setFileInfoBusy(false); }
        if (onFileInfo) onFileInfo();
      };
      const dot = h("span", { style: { color: palette.muted, opacity: .55 } }, "·");
      return h("div", {
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        onClick: () => onToggle(),
        role: "checkbox",
        "aria-checked": checked,
        tabIndex: 0,
        className: "ssr-row ssr-focusable",
        onKeyDown: (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); onToggle(); } },
        style: {
          position: "relative", display: "flex", alignItems: "center", gap: 10,
          padding: "8px 10px 8px 12px", borderRadius: 8, cursor: "pointer",
          background: checked ? palette.rowActive : (hover ? palette.rowHover : "transparent"),
          border: "1px solid transparent"
        }
      },
        /* 选中时左侧一条细竖线：比整行换色更轻，也更容易扫读 */
        checked ? h("span", {
          style: { position: "absolute", left: 2, top: 9, bottom: 9, width: 2.5, borderRadius: 2, background: palette.accent }
        }) : null,
        h(Checkbox, { checked, onChange: onToggle, palette }),
        h("div", { style: { minWidth: 0, flex: 1 } },
          h("div", {
            title: item.title,
            style: {
              fontSize: 13, fontWeight: 500, lineHeight: "18px", color: palette.text,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
            }
          }, item.title),
          /* 副信息只留三个最能帮判断的：多大、多久没动、有没有子代理。
             工作区路径已经在分组标题里，行内再写一遍是重复。 */
          h("div", {
            style: {
              marginTop: 2, fontSize: 11.5, lineHeight: "16px", color: palette.muted,
              display: "flex", alignItems: "center", gap: 6, minWidth: 0,
              overflow: "hidden", whiteSpace: "nowrap"
            }
          },
            h("span", null, fmtSize(item.bytes)),
            dot,
            h("span", null, fmtTime(item.mtime || item.createdAt)),
            item.subagents > 0
              ? h("span", { style: { display: "inline-flex", alignItems: "center", gap: 6 } },
                  dot,
                  h("span", { style: { color: palette.accent } }, item.subagents + " 个子代理"))
              : null
          )
        ),
        h("button", {
          type: "button",
          title: T("panel.fileInfo"),
          "aria-label": T("panel.fileInfo"),
          disabled: fileInfoBusy,
          onClick: handleFileInfo,
          onMouseDown: e => e.stopPropagation(),
          /* 平时不显示，行被指向或已勾选时才淡入：列表第一眼只有标题和三个数字 */
          style: {
            flex: "0 0 auto", height: 26, padding: "0 9px", borderRadius: 7, border: "none",
            background: hover ? palette.chipBg : "transparent",
            color: hover ? palette.text : palette.secondary,
            fontSize: 11.5, cursor: fileInfoBusy ? "wait" : "pointer",
            opacity: hover || checked ? 1 : 0, transition: "opacity .12s ease"
          }
        }, fileInfoBusy ? "…" : T("panel.fileInfo"))
      );
    }

    function PanelOverlay(props) {
      const open = usePanelOpen();
      const tab = usePanelTab();
      const theme = useTheme();
      const palette = paletteFor(theme);

      const [loading, setLoading] = useState(false);
      const [sessions, setSessions] = useState([]);
      const [trashItems, setTrashItems] = useState([]);
      const [checked, setChecked] = useState(() => new Set());
      const [checkedTrash, setCheckedTrash] = useState(() => new Set());
      const [collapsed, setCollapsed] = useState(() => new Set());
      const [keyword, setKeyword] = useState("");
      const [keywordTrash, setKeywordTrash] = useState("");
      const [removeArtifacts, setRemoveArtifacts] = useState(false);
      const [artifactInfo, setArtifactInfo] = useState(null); // {files:[], perSession:[]}
      const [scanning, setScanning] = useState(false);
      const [showArtifacts, setShowArtifacts] = useState(false);
      const [confirm, setConfirm] = useState(null); // {kind:'trash'|'purge', ids:[]}
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");
      const [view, setView] = useState("list");   // list | settings

      const busyRef = useRef(false);
      busyRef.current = busy;

      /* Esc 关闭 */
      useEffect(() => {
        if (!open) return;
        const onKey = (e) => {
          if (e.key !== "Escape" || busyRef.current) return;
          e.preventDefault();
          if (confirm) setConfirm(null);
          else if (showArtifacts) setShowArtifacts(false);
          else store.close();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, [open, confirm, showArtifacts]);

      /* 打开时拉数据 */
      const load = useCallback(async () => {
        setLoading(true); setError("");
        try {
          if (tab === "trash") {
            const r = await call("/trash/list", {});
            setTrashItems(r.items || []);
          } else {
            const r = await call("/list");
            setSessions(r.sessions || []);
          }
        } catch (e) { setError(e.message); }
        finally { setLoading(false); }
      }, [tab]);

      useEffect(() => {
        if (!open) { setChecked(new Set()); setCheckedTrash(new Set()); setCollapsed(new Set()); setConfirm(null); setShowArtifacts(false); setArtifactInfo(null); setKeyword(""); setKeywordTrash(""); return; }
        void load();
      }, [open, load]);

      /* 「清理本工作区会话…」带过来的预选 */
      useEffect(() => {
        if (!open || tab !== "pending" || sessions.length === 0) return;
        const cwd = store.consumePreselect();
        if (!cwd) return;
        setChecked(new Set(sessions.filter(s => s.cwd === cwd).map(s => s.id)));
        setKeyword("");
      }, [open, tab, sessions]);

      /* 切换页签：两页勾选各自独立，切走就清空，免得带到另一页去删。
         「同时删除文件产物」只在回收站页存在，跟着一起复位，
         否则切回待清理页时它仍是勾着的，会无谓地再扫一遍全工作区。 */
      useEffect(() => {
        setChecked(new Set());
        setCheckedTrash(new Set());
        setConfirm(null);
        setRemoveArtifacts(false);
        setArtifactInfo(null);
      }, [tab]);

      /* 产物识别：只服务回收站页的「同时删除文件产物」，
         所以只跟回收站页的勾选走；待清理页那个勾选框根本不存在。 */
      useEffect(() => {
        if (!open || !removeArtifacts) { setArtifactInfo(null); setScanning(false); return; }
        const ids = [...checkedTrash];
        if (ids.length === 0) { setArtifactInfo(null); setScanning(false); return; }
        const byId = new Map(sessions.map(s => [s.id, s]));
        const trashById = new Map(trashItems.map(s => [s.id, s]));
        let cancelled = false;
        setScanning(true);
        (async () => {
          const merged = [];
          const perSession = [];
          const cwds = [];
          for (const id of ids) {
            const cwd = byId.get(id)?.cwd ?? trashById.get(id)?.cwd ?? "";
            if (cwd) cwds.push(cwd);
            try {
              const r = await call("/artifacts", { sessionIds: [id], cwd });
              if (cancelled) return;
              perSession.push(...(r.perSession || []));
              merged.push(...(r.files || []));
            } catch { /* 单条失败不打断 */ }
          }
          if (cancelled) return;
          const uniq = new Map();
          for (const f of merged) uniq.set(f.path, f);
          // cwds 一并带出去：彻底删除时交给后端当「清空目录的停止线」，工作区根不会被删
          setArtifactInfo({ files: [...uniq.values()], perSession, cwds });
          setScanning(false);
        })();
        return () => { cancelled = true; };
      }, [open, removeArtifacts, checkedTrash, sessions, trashItems]);

      const filtered = useMemo(() => {
        const kw = keyword.trim().toLowerCase();
        if (!kw) return sessions;
        return sessions.filter(s =>
          (s.title || "").toLowerCase().includes(kw) || (s.cwd || "").toLowerCase().includes(kw));
      }, [sessions, keyword]);

      const grouped = useMemo(() => {
        const map = new Map();
        for (const s of filtered) {
          const key = s.cwd || "（未知工作区）";
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(s);
        }
        return [...map.entries()];
      }, [filtered]);

      const selectedBytes = useMemo(() => {
        let n = 0;
        for (const s of sessions) if (checked.has(s.id)) n += s.bytes || 0;
        return n;
      }, [sessions, checked]);

      const artifactBytes = useMemo(() => {
        if (!artifactInfo) return 0;
        return artifactInfo.files.reduce((a, f) => a + (f.bytes || 0), 0);
      }, [artifactInfo]);

      const toggle = (id) => {
        setChecked(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
        });
      };

      const toggleAll = () => {
        if (checked.size === filtered.length && filtered.length > 0) setChecked(new Set());
        else setChecked(new Set(filtered.map(s => s.id)));
      };

      /* ── 回收站页：搜索、全选、逐条勾选（与待清理页同一套交互） ── */
      const filteredTrash = useMemo(() => {
        const kw = keywordTrash.trim().toLowerCase();
        if (!kw) return trashItems;
        return trashItems.filter(s =>
          (s.title || "").toLowerCase().includes(kw) || (s.cwd || "").toLowerCase().includes(kw));
      }, [trashItems, keywordTrash]);

      const trashBytes = useMemo(() => {
        let n = 0;
        for (const s of trashItems) if (checkedTrash.has(s.id)) n += s.bytes || 0;
        return n;
      }, [trashItems, checkedTrash]);

      const toggleTrash = (id) => {
        setCheckedTrash(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
        });
      };

      const toggleAllTrash = () => {
        if (checkedTrash.size === filteredTrash.length && filteredTrash.length > 0) setCheckedTrash(new Set());
        else setCheckedTrash(new Set(filteredTrash.map(s => s.id)));
      };

      const doTrash = async () => {
        const ids = confirm?.ids ?? [...checked];
        if (ids.length === 0) return;
        setBusy(true); setError("");
        try {
          // 第一次删除只搬会话，产物、日志、缓存都保留
          const r = await call("/delete", { sessionIds: ids, removeArtifacts: false });
          const errs = (r.errors || []).filter(e => e && e.error);
          const done = (r.trashed || []).length;
          setChecked(new Set());
          setConfirm(null);
          await refreshSidebar();
          await load();
          if (errs.length > 0) {
            // 有失败就直说原因（比如已经在回收站里了），别假装成功
            setError(done > 0
              ? `已移入 ${done} 条，另外 ${errs.length} 条失败：${errs[0].error}`
              : errs[0].error);
          } else {
            showToast(T("toast.trashed"), "ok");
          }
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
      };

      const doRestore = async (ids) => {
        setBusy(true); setError("");
        try {
          await call("/trash/restore", { sessionIds: ids });
          showToast(T("toast.restored"), "ok");
          await refreshSidebar();
          await load();
          setCheckedTrash(prev => {
            const next = new Set(prev);
            for (const id of ids) next.delete(id);
            return next;
          });
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
      };

      const doPurge = async () => {
        const ids = confirm?.ids ?? [];
        if (!ids.length) return;
        setBusy(true); setError("");
        try {
          const planned = removeArtifacts && artifactInfo ? artifactInfo.files.length : 0;
          const paths = removeArtifacts && artifactInfo ? artifactInfo.files.map(f => f.path) : [];
          const cwds = removeArtifacts && artifactInfo ? (artifactInfo.cwds ?? []) : [];
          const r = await call("/trash/purge", { sessionIds: ids, removeArtifacts, artifactPaths: paths, cwds });
          const removed = r.artifacts?.removed?.length ?? 0;
          const failed = r.artifacts?.failed?.length ?? 0;
          const pruned = r.artifacts?.pruned?.length ?? 0;
          const tail = pruned > 0 ? T("toast.prunedDirs", { n: pruned }) : "";
          /* 如实回报：以前只要 removed>0 就只说成功，removed=0 时静默当成普通彻底删除，
             用户勾了「同时删除文件产物」却看不出到底动没动。 */
          if (removeArtifacts && removed > 0) {
            showToast((failed > 0
              ? T("toast.purgedWithArtifactsPartial", { n: removed, failed })
              : T("toast.purgedWithArtifacts", { n: removed })) + tail, "ok");
          } else if (removeArtifacts && planned > 0) {
            showToast(T("toast.artifactsFailed", { n: planned }), "error");
          } else if (removeArtifacts) {
            showToast(T("toast.purgedNoArtifacts"), "ok");
          } else {
            showToast(T("toast.purged") + tail, "ok");
          }
          setConfirm(null);
          setCheckedTrash(new Set());
          setChecked(new Set());
          await refreshSidebar();
          await load();
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
      };

      if (!open) return null;

      /* 底部统计跟着当前页签走：两个页签各有一套勾选集 */
      const selCount = tab === "trash" ? checkedTrash.size : checked.size;
      const selBytes = tab === "trash" ? trashBytes : selectedBytes;

      /* 按钮只有三级：实心（做完就改数据）、描边（可逆动作）、纯文字（取消/次要）。
         之前的实心分支里 `kind === "primary" ? (kind === "danger" ? … )` 恒取 accent，
         传 "danger" 根本不会变红，这里改成按 kind 直接取色。 */
      const btn = (label, onClick, kind, disabled) => {
        const solid = kind === "primary" || kind === "danger";
        const off = busy || disabled;
        return h("button", {
          type: "button",
          disabled: off,
          onClick,
          className: "ssr-focusable",
          style: {
            height: 32, padding: "0 14px", borderRadius: 8, fontSize: 12.5,
            fontWeight: solid ? 500 : 400, letterSpacing: ".01em",
            cursor: off ? "default" : "pointer",
            border: "1px solid " + (solid ? "transparent" : palette.btnBorder),
            background: solid ? (off ? palette.chipBg : (kind === "danger" ? palette.danger : palette.accent)) : "transparent",
            color: solid ? (off ? palette.muted : "#fff") : palette.text,
            opacity: busy ? .55 : 1, transition: "background .12s ease, opacity .12s ease"
          }
        }, label);
      };

      const iconSearch = h("svg", {
        width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
        strokeWidth: 2, strokeLinecap: "round", "aria-hidden": "true"
      }, h("circle", { cx: 11, cy: 11, r: 7 }), h("path", { d: "m20 20-3.6-3.6" }));

      /* 两页共用一条搜索栏：搜索框 + 全选/清空 */
      const searchBar = (value, onChange, onToggleAll, allChecked) => h("div", {
        style: { display: "flex", alignItems: "center", gap: 8, padding: "0 16px 10px" }
      },
        h("div", { style: { position: "relative", flex: 1, minWidth: 0, display: "flex", alignItems: "center" } },
          h("span", {
            style: { position: "absolute", left: 10, display: "inline-flex", color: palette.muted, pointerEvents: "none" }
          }, iconSearch),
          h("input", {
            value,
            onChange: (e) => onChange(e.target.value),
            placeholder: T("panel.search"),
            className: "ssr-input",
            style: {
              width: "100%", height: 32, borderRadius: 8, padding: "0 10px 0 30px", fontSize: 12.5,
              background: palette.inputBg, border: "1px solid transparent", color: palette.text,
              outline: "none", boxSizing: "border-box"
            }
          })
        ),
        h("button", {
          type: "button",
          onClick: onToggleAll,
          className: "ssr-focusable",
          style: {
            flex: "0 0 auto", height: 32, padding: "0 11px", borderRadius: 8, fontSize: 12,
            background: "transparent", border: "1px solid " + palette.btnBorder,
            color: palette.secondary, cursor: "pointer", whiteSpace: "nowrap"
          }
        }, allChecked ? T("panel.clearAll") : T("panel.selectAll"))
      );

      /* 空/加载共用：一行灰字，居中，不铺满整块高度 */
      const placeholder = (text) => h("div", {
        style: {
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "56px 16px", fontSize: 12.5, color: palette.muted, textAlign: "center"
        }
      }, text);

      /* 头部图标用的 SVG（尺寸/线宽统一，交给 IconBtn 渲染） */
      const svgStroke = {
        width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
        strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true"
      };
      const iconGithub = h("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "currentColor", "aria-hidden": "true" },
        h("path", {
          d: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
        })
      );
      const iconGear = h("svg", svgStroke,
        h("circle", { cx: 12, cy: 12, r: 3 }),
        h("path", {
          d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        })
      );
      const iconBack = h("svg", svgStroke, h("path", { d: "M19 12H5M12 19l-7-7 7-7" }));
      const iconClose = h("svg", svgStroke, h("path", { d: "M18 6 6 18M6 6l12 12" }));

      /* ── 二次确认层 ── */
      /* ── 设置页：只有一段说明 ──
         「打开方式」曾经是两个可选项，但标签页那项从功能上就不开放，
         摆一个禁用单选框只会让人以为是自己没解锁。这里改成直说。 */
      const settingsBody = h("div", {
        style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 8, padding: "4px 20px 20px", overflow: "auto" }
      },
        h("div", { style: { fontSize: 11.5, letterSpacing: ".06em", textTransform: "uppercase", color: palette.muted } },
          T("settings.openMode")),
        h("div", {
          style: {
            padding: "12px 14px", border: "1px solid " + palette.line, background: palette.card,
            borderRadius: 10, fontSize: 12.5, lineHeight: 1.65
          }
        },
          h("div", { style: { fontWeight: 500 } }, T("settings.modeWindows")),
          h("div", { style: { marginTop: 3, color: palette.muted } }, T("settings.modeWindowsHint")),
          h("div", { style: { marginTop: 8, color: palette.muted } }, T("settings.modeTabsHint"))
        )
      );

      const confirmLayer = confirm ? h("div", {
        style: {
          position: "absolute", inset: 0, background: palette.layer, borderRadius: 14,
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2
        }
      },
        h("div", {
          className: "ssr-fade",
          style: {
            width: 420, maxWidth: "88%", background: palette.panel, border: "1px solid " + palette.line,
            borderRadius: 12, boxShadow: palette.shadow, padding: "20px 22px", color: palette.text
          }
        },
          h("div", { style: { fontSize: 15, fontWeight: 600, letterSpacing: "-.01em", marginBottom: 8 } },
            confirm.kind === "purge" ? T("confirm.purgeTitle") : T("confirm.title")),
          h("div", { style: { fontSize: 12.5, lineHeight: 1.7, color: palette.muted } },
            confirm.kind === "purge"
              ? T("confirm.purgeBody", { n: confirm.ids.length })
              : T("confirm.body", { n: confirm.ids.length })
          ),
          /* 产物提示只对「彻底删除」有意义：移入回收站不动物件（两段式的第一段）。
             以前这里不分页签地渲染，在回收站页勾过勾再切回待清理页，
             弹窗会承诺「同时删除 N 个文件产物」，实际一个都不删 —— 文案说谎。 */
          confirm.kind === "purge" && removeArtifacts && scanning
            ? h("div", { style: { marginTop: 10, fontSize: 12.5, color: palette.muted } }, T("panel.artifactsScanning"))
            : confirm.kind === "purge" && removeArtifacts && artifactInfo && artifactInfo.files.length > 0
              ? h("div", {
                  style: {
                    marginTop: 10, padding: "8px 10px", borderRadius: 8,
                    background: palette.dangerSoft, fontSize: 12.5, lineHeight: 1.6, color: palette.danger
                  }
                }, T("confirm.artifacts", { n: artifactInfo.files.length, size: fmtSize(artifactBytes) }))
              : null,
          h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 } },
            btn(T("confirm.back"), () => setConfirm(null)),
            /* 产物还在识别时不让点确认：那一刻 artifactPaths 还是空的，
               点下去就是「删了会话、产物一个没动」，用户以为成功了。 */
            btn(
              confirm.kind === "purge" ? T("panel.purge") : T("confirm.ok"),
              confirm.kind === "purge" ? doPurge : doTrash,
              "danger",
              confirm.kind === "purge" && removeArtifacts && scanning
            )
          )
        )
      ) : null;

      /* ── 产物预览层 ── */
      const artifactLayer = showArtifacts && artifactInfo ? h("div", {
        style: {
          position: "absolute", inset: 0, background: palette.layer, borderRadius: 14,
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2
        }
      },
        h("div", {
          className: "ssr-fade",
          style: {
            width: 560, maxWidth: "92%", maxHeight: "80%", display: "flex", flexDirection: "column",
            background: palette.panel, border: "1px solid " + palette.line, borderRadius: 12,
            boxShadow: palette.shadow, color: palette.text, overflow: "hidden"
          }
        },
          h("div", {
            style: { padding: "16px 20px 12px", borderBottom: "1px solid " + palette.line, fontSize: 13.5, fontWeight: 600 }
          }, T("panel.artifactsFound", { n: artifactInfo.files.length, size: fmtSize(artifactBytes) })),
          h("div", { className: "ssr-scroll", style: { overflow: "auto", padding: "6px 10px", flex: 1 } },
            artifactInfo.files.length === 0
              ? h("div", { style: { padding: 20, color: palette.muted, fontSize: 12.5 } }, T("panel.artifactsNone"))
              : artifactInfo.files.map(f => h("div", {
                  key: f.path,
                  style: { display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 8px", borderBottom: "1px solid " + palette.line }
                },
                  h("span", {
                    style: {
                      fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                    },
                    title: f.path
                  }, f.rel || f.path),
                  h("span", { style: { fontSize: 11.5, color: palette.muted, flex: "0 0 auto" } }, fmtSize(f.bytes))
                ))
          ),
          h("div", { style: { padding: "12px 20px", borderTop: "1px solid " + palette.line, display: "flex", justifyContent: "flex-end" } },
            btn(T("panel.cancel"), () => setShowArtifacts(false)))
        )
      ) : null;

      const bodyPending = h("div", { style: { display: "flex", flex: 1, minHeight: 0, flexDirection: "column" } },
        searchBar(
          keyword,
          setKeyword,
          toggleAll,
          checked.size === filtered.length && filtered.length > 0
        ),
        h("div", { className: "ssr-scroll", style: { padding: "0 16px 12px", flex: 1, minHeight: 0 } },
            loading ? placeholder(T("panel.loading"))
            : filtered.length === 0 ? placeholder(T("panel.empty"))
            : grouped.map(([cwd, list]) => {
                const ids = list.map(s => s.id);
                const allChecked = ids.length > 0 && ids.every(id => checked.has(id));
                const isCollapsed = collapsed.has(cwd);
                const selectedInGroup = ids.filter(id => checked.has(id)).length;
                const toggleGroup = () => setCollapsed(prev => {
                  const next = new Set(prev);
                  if (next.has(cwd)) next.delete(cwd); else next.add(cwd);
                  return next;
                });
                return h("div", { key: cwd, style: { marginBottom: 12 } },
                  h("div", {
                    role: "button",
                    tabIndex: 0,
                    title: isCollapsed ? T("panel.expandGroup") : T("panel.collapseGroup"),
                    "aria-expanded": !isCollapsed,
                    onClick: toggleGroup,
                    onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleGroup(); } },
                    className: "ssr-focusable",
                    style: {
                      display: "flex", alignItems: "center", gap: 7,
                      padding: "5px 8px", margin: "0 2px 2px", borderRadius: 8,
                      cursor: "pointer", userSelect: "none", background: palette.card
                    }
                  },
                    h("span", {
                      style: {
                        flex: "0 0 12px", width: 12, height: 12, display: "inline-flex",
                        alignItems: "center", justifyContent: "center",
                        color: palette.muted, transition: "transform .14s ease",
                        transform: isCollapsed ? "rotate(-90deg)" : "none"
                      }
                    }, h("svg", {
                      width: 10, height: 10, viewBox: "0 0 10 10", fill: "none", stroke: "currentColor",
                      strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true"
                    }, h("path", { d: "M2 3.5 5 6.5 8 3.5" }))),
                    /* 路径用等宽字体：一眼能看出哪一段是目录、哪一段是名字 */
                    h("span", {
                      title: cwd,
                      style: {
                        minWidth: 0, fontSize: 11.5, color: palette.secondary,
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                      }
                    }, cwd),
                    h("span", { style: { flex: "0 0 auto", fontSize: 11, color: palette.muted } }, list.length + " 项"),
                    selectedInGroup > 0
                      ? h("span", {
                          style: {
                            flex: "0 0 auto", fontSize: 11, lineHeight: "16px", padding: "0 6px", borderRadius: 5,
                            color: palette.accent, background: palette.accentSoft
                          }
                        }, "已选 " + selectedInGroup)
                      : null,
                    h("span", { style: { flex: 1 } }),
                    h("button", {
                      type: "button",
                      onClick: (e) => {
                        e.stopPropagation();
                        setChecked(prev => {
                          const next = new Set(prev);
                          if (allChecked) { for (const id of ids) next.delete(id); }
                          else { for (const id of ids) next.add(id); }
                          return next;
                        });
                      },
                      className: "ssr-focusable",
                      style: {
                        flex: "0 0 auto", height: 22, padding: "0 8px", borderRadius: 6, fontSize: 11.5,
                        border: "none", background: "transparent",
                        color: allChecked ? palette.accent : palette.secondary, cursor: "pointer"
                      }
                    }, allChecked ? "取消本组" : "全选本组")
                  ),
                  h("div", { style: { paddingTop: 2 } },
                    isCollapsed ? null : list.map(item => h(SessionRow, {
                      key: item.id, item, palette,
                      checked: checked.has(item.id),
                      onToggle: () => toggle(item.id)
                    })))
                );
              })
        )
      );

      const bodyTrash = h("div", { style: { display: "flex", flex: 1, minHeight: 0, flexDirection: "column" } },
        searchBar(
          keywordTrash,
          setKeywordTrash,
          toggleAllTrash,
          checkedTrash.size === filteredTrash.length && filteredTrash.length > 0
        ),
        h("div", { className: "ssr-scroll", style: { padding: "0 16px 12px", flex: 1, minHeight: 0 } },
          loading ? placeholder(T("panel.loading"))
          : filteredTrash.length === 0 ? placeholder(T("panel.emptyTrash"))
          : filteredTrash.map(item => {
              const isChecked = checkedTrash.has(item.id);
              const dot = h("span", { style: { color: palette.muted, opacity: .55 } }, "·");
              return h("div", {
                key: item.id,
                onClick: () => toggleTrash(item.id),
                role: "checkbox",
                "aria-checked": isChecked,
                tabIndex: 0,
                className: "ssr-row ssr-focusable",
                onKeyDown: (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggleTrash(item.id); } },
                style: {
                  position: "relative", display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px 8px 12px", borderRadius: 8, cursor: "pointer",
                  background: isChecked ? palette.rowActive : "transparent"
                }
              },
                isChecked ? h("span", {
                  style: { position: "absolute", left: 2, top: 9, bottom: 9, width: 2.5, borderRadius: 2, background: palette.accent }
                }) : null,
                h(Checkbox, { checked: isChecked, onChange: () => toggleTrash(item.id), palette }),
                h("div", { style: { flex: 1, minWidth: 0 } },
                  h("div", {
                    title: item.title || item.id,
                    style: {
                      fontSize: 13, fontWeight: 500, lineHeight: "18px", color: palette.text,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                    }
                  }, item.title || item.id),
                  h("div", {
                    style: {
                      marginTop: 2, fontSize: 11.5, lineHeight: "16px", color: palette.muted,
                      display: "flex", alignItems: "center", gap: 6, minWidth: 0,
                      overflow: "hidden", whiteSpace: "nowrap"
                    }
                  },
                    h("span", null, fmtSize(item.bytes)),
                    dot,
                    h("span", null, fmtTime(item.trashedAt)),
                    item.subagents > 0
                      ? h("span", { style: { display: "inline-flex", alignItems: "center", gap: 6 } },
                          dot,
                          h("span", { style: { color: palette.accent } }, item.subagents + " 个子代理"))
                      : null
                  )
                ),
                /* 行内动作保持轻：无边框、hover 才显色，不跟主按钮抢注意力 */
                h("div", { style: { flex: "0 0 auto", display: "flex", gap: 2, alignItems: "center" } },
                  h("button", {
                    type: "button", disabled: busy,
                    onClick: (e) => { e.stopPropagation(); doRestore([item.id]); },
                    className: "ssr-focusable",
                    style: {
                      height: 26, padding: "0 10px", borderRadius: 7, fontSize: 11.5,
                      background: "transparent", border: "1px solid transparent",
                      color: palette.secondary, cursor: busy ? "default" : "pointer"
                    }
                  }, T("panel.restore")),
                  h("button", {
                    type: "button", disabled: busy,
                    onClick: (e) => { e.stopPropagation(); setConfirm({ kind: "purge", ids: [item.id] }); },
                    className: "ssr-focusable",
                    style: {
                      height: 26, padding: "0 10px", borderRadius: 7, fontSize: 11.5,
                      background: "transparent", border: "1px solid transparent",
                      color: palette.danger, cursor: busy ? "default" : "pointer"
                    }
                  }, T("panel.purge"))
                )
              );
            })
        )
      );

      return h("div", { style: { position: "fixed", inset: 0, zIndex: 10900 } },
        h("div", {
          onClick: () => { if (!busy) store.close(); },
          style: { position: "absolute", inset: 0, background: palette.layer }
        }),
        h("div", {
          role: "dialog",
          "aria-label": T("panel.title"),
          className: "ssr-panel",
          style: {
            position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            background: palette.panel, border: "1px solid " + palette.panelBorder,
            boxShadow: palette.shadow, color: palette.text
          }
        },
          /* 头部：左边标题+一句说明，右边三个图标。留白统一 20 */
          h("div", {
            style: {
              display: "flex", alignItems: "flex-start", justifyContent: "space-between",
              gap: 12, padding: "18px 20px 10px"
            }
          },
            h("div", { style: { minWidth: 0 } },
              h("div", { style: { fontSize: 15.5, fontWeight: 600, lineHeight: 1.35, letterSpacing: ".01em" } },
                view === "settings" ? T("settings.title") : T("panel.title")),
              view === "settings" ? null : h("div", {
                style: {
                  marginTop: 3, fontSize: 12, color: palette.muted,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                }
              }, T("panel.subtitle"))
            ),
            /* 顶部右侧：GitHub 入口 / 设置（或返回）/ 关闭——三个图标同尺寸、同套 SVG，悬停有高亮 */
            h("div", { style: { display: "flex", alignItems: "center", gap: 2, marginTop: -3 } },
              h(IconBtn, {
                label: "项目主页 · github.com/zhezhi33/dsh-session-recycler",
                palette,
                onClick: () => {
                  try { window.open(REPO_URL, "_blank", "noreferrer"); } catch { /* 交给浏览器兜底 */ }
                }
              }, iconGithub),
              h(IconBtn, {
                label: view === "settings" ? T("settings.back") : T("settings.title"),
                palette,
                active: view === "settings",
                onClick: () => setView(view === "settings" ? "list" : "settings")
              }, view === "settings" ? iconBack : iconGear),
              h(IconBtn, { label: T("panel.close"), palette, onClick: () => store.close() }, iconClose)
            )
          ),
          /* 页签：下划线式。小胶囊和旁边的「全选」按钮太像，容易看混 */
          view === "settings" ? null : h("div", {
            role: "tablist",
            "aria-label": T("panel.title"),
            className: "ssr-tabline",
            style: { "--ssr-line": palette.line }
          },
            [
              ["pending", T("panel.tabPending"), sessions.length],
              ["trash", T("panel.tabTrash"), trashItems.length]
            ].map(([k, label, count]) => h("button", {
              key: k,
              type: "button",
              role: "tab",
              "aria-selected": tab === k,
              onClick: () => store.open(k),
              className: "ssr-focusable",
              style: {
                position: "relative", height: 34, padding: "0 2px", marginRight: 18,
                border: "none", background: "transparent", cursor: "pointer",
                fontSize: 12.5, fontWeight: tab === k ? 600 : 400,
                color: tab === k ? palette.text : palette.muted,
                transition: "color .12s ease"
              }
            },
              label,
              count > 0
                ? h("span", {
                    style: {
                      marginLeft: 6, fontSize: 11, fontWeight: 400,
                      color: tab === k ? palette.accent : palette.muted
                    }
                  }, count)
                : null,
              tab === k
                ? h("span", {
                    style: {
                      position: "absolute", left: 0, right: 0, bottom: -1, height: 2,
                      borderRadius: "2px 2px 0 0", background: palette.accent
                    }
                  })
                : null
            ))
          ),
          /* 主体 */
          h("div", { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", paddingTop: 12 } },
            view === "settings" ? settingsBody : (tab === "pending" ? bodyPending : bodyTrash)
          ),
          /* 错误：一行就好，不要让列表跳动 */
          error
            ? h("div", {
                style: { padding: "0 20px 8px", fontSize: 12, color: palette.danger, lineHeight: 1.5 }
              }, error)
            : null,
          /* 底部：左边说「选了多少、一共多大」，右边放动作。
             回收站的「同时删除文件产物」也收进这一行，识别结果做成可点的小字，
             不再单独占一行说明文字——底部越短，眼睛越容易落到按钮上。 */
          h("div", {
            style: {
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
              padding: "12px 20px", borderTop: "1px solid " + palette.line
            }
          },
            h("div", {
              style: {
                minWidth: 0, fontSize: 12, lineHeight: "18px",
                color: selCount > 0 ? palette.text : palette.muted,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
              }
            },
              view === "settings"
                ? ""
                : selCount > 0
                  ? T("panel.selected", { n: selCount }) + " · " + T("panel.selectedSize", { size: fmtSize(selBytes) })
                  : T("panel.selected", { n: 0 })
            ),
            h("div", { style: { display: "flex", gap: 8, alignItems: "center", flex: "0 0 auto" } },
              view === "list" && tab === "pending" && checked.size > 0
                ? h("div", { title: T("panel.openFolderHint") },
                    btn(T("panel.openFolder"), async () => {
                      const id = [...checked][0];
                      setBusy(true);
                      try {
                        await call("/reveal", { sessionId: id });
                      } catch (e) { setError(e.message); }
                      finally { setBusy(false); }
                    }))
                : null,
              view === "settings" || tab === "pending" ? btn(T("panel.cancel"), () => store.close()) : null,
              view === "list" && tab === "pending"
                ? btn(T("panel.trashAction"), () => setConfirm({ kind: "trash", ids: [...checked] }), "danger", checked.size === 0)
                : null,
              view === "list" && tab === "trash"
                ? h("div", { style: { display: "flex", alignItems: "center", gap: 12 } },
                    h("div", { style: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 } },
                      h(Checkbox, {
                        checked: removeArtifacts,
                        onChange: (v) => setRemoveArtifacts(v),
                        label: T("panel.removeArtifacts"),
                        palette
                      }),
                      removeArtifacts
                        ? (scanning
                            ? h("span", { style: { fontSize: 11, color: palette.muted, whiteSpace: "nowrap" } },
                                T("panel.artifactsScanning"))
                            : artifactInfo
                              ? h("button", {
                                  type: "button",
                                  title: T("panel.removeArtifactsHint"),
                                  onClick: () => { if (artifactInfo.files.length > 0) setShowArtifacts(true); },
                                  className: "ssr-focusable",
                                  style: {
                                    border: "none", background: "transparent", padding: 0, fontSize: 11,
                                    whiteSpace: "nowrap",
                                    color: artifactInfo.files.length > 0 ? palette.accent : palette.muted,
                                    cursor: artifactInfo.files.length > 0 ? "pointer" : "default"
                                  }
                                }, artifactInfo.files.length > 0
                                  ? T("panel.artifactsShort", { n: artifactInfo.files.length, size: fmtSize(artifactBytes) })
                                  : T("panel.artifactsNoneShort"))
                              : null)
                        : null
                    ),
                    btn(T("panel.deleteAll"), () => setConfirm({ kind: "purge", ids: [...checkedTrash] }), "danger", checkedTrash.size === 0)
                  )
                : null
            )
          ),
          confirmLayer,
          artifactLayer
        )
      );
    }

    function ToastLayer() {
      const theme = useTheme();
      const palette = paletteFor(theme);
      const toast = useToastState();
      if (!toast) return null;
      return h("div", {
        className: "ssr-fade",
        style: {
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 11100,
          background: palette.panel, border: "1px solid " + palette.line, boxShadow: palette.shadow,
          color: palette.text, borderRadius: 10, padding: "9px 16px", fontSize: 12.5, lineHeight: "18px",
          display: "flex", alignItems: "center", gap: 8, maxWidth: "80vw"
        }, role: "status"
      },
        h("span", {
          style: {
            color: toast.kind === "error" ? palette.danger : palette.success,
            fontSize: 11, fontWeight: 700, lineHeight: 1
          }
        }, toast.kind === "error" ? "✕" : "✓"),
        h("span", { style: { minWidth: 0 } }, toast.text)
      );
    }

    /* ───────────────────────── 注册 ───────────────────────── */

    function apply(ctx) {
      hostCtx = ctx;

      try { ctx.effect(() => injectStyle(), "session-recycle: styles"); }
      catch (error) { try { ctx.logger?.warn?.("session-recycle: style inject failed " + error); } catch { /* ignore */ } }

      try {
        ctx.slots.inject("sidebar.footer.action", function* () {
          yield ctx.slots.register({
            name: "sidebar.footer.action",
            id: "session-recycle-cleanup",
            order: 40,
            inject: footerInjected
          }, CleanupFooterAction);
        });
      } catch (error) { try { ctx.logger?.warn?.("session-recycle: footer slot failed " + error); } catch { /* ignore */ } }

      try {
        ctx.slots.inject("sidebar.workspaces.session.menu.item", function* () {
          yield ctx.slots.register({
            name: "sidebar.workspaces.session.menu.item",
            id: "session-recycle-trash-menu",
            order: 500,
            inject: () => ({})
          }, TrashMenuItem);
          yield ctx.slots.register({
            name: "sidebar.workspaces.session.menu.item",
            id: "session-recycle-reveal-menu",
            order: 510,
            inject: () => ({})
          }, RevealFilesMenuItem);
          yield ctx.slots.register({
            name: "sidebar.workspaces.session.menu.item",
            id: "session-recycle-reveal-all-menu",
            order: 520,
            inject: () => ({})
          }, RevealAllMenuItem);
          yield ctx.slots.register({
            name: "sidebar.workspaces.session.menu.item",
            id: "session-recycle-query-menu",
            order: 530,
            inject: () => ({})
          }, FileQueryMenuItem);
        });
      } catch (error) { try { ctx.logger?.warn?.("session-recycle: menu slot failed " + error); } catch { /* ignore */ } }

      try {
        ctx.slots.inject("shell.overlay", function* () {
          yield ctx.slots.register({
            name: "shell.overlay",
            id: "session-recycle-panel",
            order: 40,
            inject: () => ({})
          }, PanelOverlay);
          yield ctx.slots.register({
            name: "shell.overlay",
            id: "session-recycle-toast",
            order: 41,
            inject: () => ({})
          }, ToastLayer);
        });
      } catch (error) { try { ctx.logger?.warn?.("session-recycle: overlay slot failed " + error); } catch { /* ignore */ } }
    }

    const inject = ["slots", "sessions"];

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
