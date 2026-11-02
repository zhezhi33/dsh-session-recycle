/**
 * dsh-session-recycle — Client half.
 *
 * 三个入口，共用一套面板：
 *   1. 侧栏底部「会话清理」按钮（与「会话回收站」同区）；
 *   2. 会话右键菜单里的「移入回收站」；
 *   3. 面板内「回收站」页签：恢复 / 彻底删除。
 *
 * 面板布局按需求：左栏会话多选，顶部右侧勾选「同时删除文件产物」，
 * 删除前二次确认。
 *
 * 无构建步骤：DSH 通过 package.json 的 dsh.client 声明直接加载本文件。
 */

window.__ModuleLoader__.load({
  id: "dsh-session-recycle",
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

    let hostCtx = undefined;

    /* ───────────────────────── 文案（已按界面语规范润色） ───────────────────────── */

    const zh = {
      "entry.title": "会话清理",
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
      "panel.title": "会话清理",
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
      "panel.cancel": "取消",
      "panel.trashAction": "移入回收站",
      "panel.restore": "恢复",
      "panel.purge": "彻底删除",
      "panel.purgeAll": "彻底删除所选",
      "panel.removeArtifacts": "同时删除文件产物",
      "panel.removeArtifactsHint": "彻底删除时，一并删除该会话在工作区内生成或修改的文件",
      "panel.artifactsFound": "已识别 {n} 个文件产物 · {size}",
      "panel.artifactsPreview": "预览文件清单",
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
      "toast.trashedWithArtifacts": "已移入回收站，并删除 {n} 个文件产物",
      "toast.restored": "已恢复到原工作区位置",
      "toast.purged": "已彻底删除",
      "toast.failed": "操作失败：{message}",
      "unit.bytes": "B",
      "detail.lastActive": "最后活动"
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

    const paletteFor = (theme) => theme === "dark" ? {
      layer: "rgba(0,0,0,.55)",
      panel: "#232326",
      panelBorder: "rgba(255,255,255,.14)",
      shadow: "0 12px 36px rgba(0,0,0,.55)",
      text: "#f1f1f3",
      secondary: "#a9a9b2",
      danger: "#f0616d",
      success: "#5ad197",
      accent: "#6f8cff",
      btnBorder: "rgba(255,255,255,.2)",
      rowBorder: "rgba(255,255,255,.08)",
      rowHover: "rgba(255,255,255,.05)",
      rowActive: "rgba(111,140,255,.14)",
      inputBg: "#1b1b1e",
      chipBg: "rgba(255,255,255,.07)"
    } : {
      layer: "rgba(15,18,26,.35)",
      panel: "#ffffff",
      panelBorder: "rgba(0,0,0,.12)",
      shadow: "0 12px 36px rgba(15,18,26,.18)",
      text: "#1b1b1f",
      secondary: "#6b6b76",
      danger: "#d93a45",
      success: "#1a9d63",
      accent: "#3f5bd9",
      btnBorder: "rgba(0,0,0,.16)",
      rowBorder: "rgba(0,0,0,.07)",
      rowHover: "rgba(0,0,0,.035)",
      rowActive: "rgba(63,91,217,.09)",
      inputBg: "#f6f6f8",
      chipBg: "rgba(0,0,0,.05)"
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
.ssr-panel{width:680px;max-width:94vw;height:540px;max-height:84vh;border-radius:10px;display:flex;flex-direction:column;overflow:hidden;font-size:13px;line-height:18px}
.ssr-layer{position:absolute;inset:0}
`;

    function injectStyle() {
      try {
        if (document.getElementById("dsh-session-recycle-style")) return () => {};
        const tag = document.createElement("style");
        tag.id = "dsh-session-recycle-style";
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
              await call("/delete", { sessionIds: [sessionId], removeArtifacts: false });
              showToast(T("toast.trashed"), "ok");
              await refreshSidebar();
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
              const r = await call("/reveal-all", { sessionId, limit: 8 });
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

    const fmtKB = (n) => {
      if (!n) return "0 B";
      return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : (n / 1024).toFixed(1) + " KB";
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
        const dir = f.path.slice(0, f.path.length - f.rel.length - 1) || r.cwd || "";
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

    function Checkbox({ checked, onChange, label, palette, disabled }) {
      const flip = (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        if (!disabled) onChange(!checked);
      };
      return h("label", {
        onClick: flip,
        style: { display: "inline-flex", alignItems: "center", gap: 8, cursor: disabled ? "not-allowed" : "pointer", userSelect: "none" }
      },
        h("span", {
          style: {
            width: 16, height: 16, borderRadius: 4, flex: "0 0 auto",
            border: "1.5px solid " + (checked ? palette.accent : palette.btnBorder),
            background: checked ? palette.accent : "transparent",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 11, lineHeight: 1
          }
        }, checked ? "✓" : ""),
        label ? h("span", { style: { fontSize: 13, color: palette.text } }, label) : null
      );
    }

    function SessionRow({ item, checked, onToggle, palette }) {
      const [hover, setHover] = useState(false);
      return h("div", {
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        onClick: () => onToggle(),
        style: {
          display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 10px",
          borderRadius: 8, cursor: "pointer",
          background: checked ? palette.rowActive : (hover ? palette.rowHover : "transparent"),
          border: "1px solid " + (checked ? "transparent" : "transparent")
        }
      },
        h("span", { style: { paddingTop: 2 } },
          h(Checkbox, { checked, onChange: onToggle, palette })
        ),
        h("div", { style: { minWidth: 0, flex: 1 } },
          h("div", {
            style: {
              fontSize: 13, color: palette.text, overflow: "hidden", textOverflow: "ellipsis",
              whiteSpace: "nowrap", fontWeight: 500
            },
            title: item.title
          }, item.title),
          h("div", { style: { marginTop: 3, fontSize: 11.5, color: palette.secondary, display: "flex", gap: 10, flexWrap: "wrap" } },
            h("span", null, fmtSize(item.bytes)),
            h("span", null, fmtTime(item.mtime || item.createdAt)),
            item.subagents > 0 ? h("span", { style: { color: palette.accent } }, "含 " + item.subagents + " 个子代理会话") : null,
            item.cwd ? h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }, title: item.cwd }, item.cwd) : null
          )
        )
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
      const [keyword, setKeyword] = useState("");
      const [removeArtifacts, setRemoveArtifacts] = useState(false);
      const [artifactInfo, setArtifactInfo] = useState(null); // {files:[], perSession:[]}
      const [scanning, setScanning] = useState(false);
      const [showArtifacts, setShowArtifacts] = useState(false);
      const [confirm, setConfirm] = useState(null); // {kind:'trash'|'purge', ids:[]}
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");

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
        if (!open) { setChecked(new Set()); setConfirm(null); setShowArtifacts(false); setArtifactInfo(null); setKeyword(""); return; }
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

      /* 产物识别：待清理页跟随勾选，回收站页跟随「彻底删除」的目标 */
      useEffect(() => {
        if (!open || !removeArtifacts) { setArtifactInfo(null); return; }
        const ids = tab === "trash"
          ? (confirm?.kind === "purge" ? confirm.ids : [])
          : [...checked];
        if (ids.length === 0) { setArtifactInfo(null); return; }
        const byId = new Map(sessions.map(s => [s.id, s]));
        const trashById = new Map(trashItems.map(s => [s.id, s]));
        let cancelled = false;
        setScanning(true);
        (async () => {
          const merged = [];
          const perSession = [];
          for (const id of ids) {
            const cwd = byId.get(id)?.cwd ?? trashById.get(id)?.cwd ?? "";
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
          setArtifactInfo({ files: [...uniq.values()], perSession });
          setScanning(false);
        })();
        return () => { cancelled = true; };
      }, [open, tab, removeArtifacts, checked, confirm, sessions, trashItems]);

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

      const doTrash = async () => {
        const ids = confirm?.ids ?? [...checked];
        if (ids.length === 0) return;
        setBusy(true); setError("");
        try {
          // 第一次删除只搬会话，产物、日志、缓存都保留
          await call("/delete", { sessionIds: ids, removeArtifacts: false });
          showToast(T("toast.trashed"), "ok");
          setChecked(new Set());
          setConfirm(null);
          await refreshSidebar();
          await load();
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
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
      };

      const doPurge = async () => {
        const ids = confirm?.ids ?? [];
        if (!ids.length) return;
        setBusy(true); setError("");
        try {
          const paths = removeArtifacts && artifactInfo ? artifactInfo.files.map(f => f.path) : [];
          const r = await call("/trash/purge", { sessionIds: ids, removeArtifacts, artifactPaths: paths });
          const removed = r.artifacts?.removed?.length ?? 0;
          showToast(removeArtifacts && removed > 0
            ? T("toast.trashedWithArtifacts", { n: removed })
            : T("toast.purged"), "ok");
          setConfirm(null);
          await load();
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
      };

      if (!open) return null;

      const btn = (label, onClick, kind) => h("button", {
        type: "button",
        disabled: busy,
        onClick,
        style: {
          height: 32, padding: "0 14px", borderRadius: 8, fontSize: 13, cursor: busy ? "default" : "pointer",
          border: "1px solid " + (kind === "primary" ? "transparent" : palette.btnBorder),
          background: kind === "primary" ? (kind === "danger" ? palette.danger : palette.accent) : "transparent",
          color: kind === "primary" ? "#fff" : palette.text,
          opacity: busy ? .6 : 1
        }
      }, label);

      /* ── 二次确认层 ── */
      const confirmLayer = confirm ? h("div", {
        style: {
          position: "absolute", inset: 0, background: palette.layer, borderRadius: 14,
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2
        }
      },
        h("div", {
          style: {
            width: 420, maxWidth: "88%", background: palette.panel, border: "1px solid " + palette.panelBorder,
            borderRadius: 12, boxShadow: palette.shadow, padding: "18px 20px", color: palette.text
          }
        },
          h("div", { style: { fontSize: 15, fontWeight: 600, marginBottom: 10 } },
            confirm.kind === "purge" ? T("confirm.purgeTitle") : T("confirm.title")),
          h("div", { style: { fontSize: 13, lineHeight: 1.7, color: palette.secondary } },
            confirm.kind === "purge"
              ? T("confirm.purgeBody", { n: confirm.ids.length })
              : T("confirm.body", { n: confirm.ids.length })
          ),
          removeArtifacts && scanning
            ? h("div", { style: { marginTop: 8, fontSize: 13, color: palette.secondary } }, T("panel.artifactsScanning"))
            : removeArtifacts && artifactInfo && artifactInfo.files.length > 0
              ? h("div", { style: { marginTop: 8, fontSize: 13, color: palette.danger, lineHeight: 1.7 } },
                  T("confirm.artifacts", { n: artifactInfo.files.length, size: fmtSize(artifactBytes) }))
              : null,
          h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 } },
            btn(T("confirm.back"), () => setConfirm(null)),
            h("button", {
              type: "button", disabled: busy,
              onClick: confirm.kind === "purge" ? doPurge : doTrash,
              style: {
                height: 32, padding: "0 14px", borderRadius: 8, fontSize: 13, border: "1px solid transparent",
                background: palette.danger, color: "#fff", cursor: busy ? "default" : "pointer", opacity: busy ? .6 : 1
              }
            }, confirm.kind === "purge" ? T("panel.purge") : T("confirm.ok"))
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
          style: {
            width: 560, maxWidth: "92%", maxHeight: "80%", display: "flex", flexDirection: "column",
            background: palette.panel, border: "1px solid " + palette.panelBorder, borderRadius: 12,
            boxShadow: palette.shadow, color: palette.text, overflow: "hidden"
          }
        },
          h("div", { style: { padding: "14px 18px", borderBottom: "1px solid " + palette.rowBorder, fontSize: 14, fontWeight: 600 } },
            T("panel.artifactsFound", { n: artifactInfo.files.length, size: fmtSize(artifactBytes) })),
          h("div", { style: { overflow: "auto", padding: "8px 10px", flex: 1 } },
            artifactInfo.files.length === 0
              ? h("div", { style: { padding: 16, color: palette.secondary, fontSize: 13 } }, T("panel.artifactsNone"))
              : artifactInfo.files.map(f => h("div", {
                  key: f.path,
                  style: { display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 8px", borderBottom: "1px solid " + palette.rowBorder }
                },
                  h("span", { style: { fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: f.path }, f.rel || f.path),
                  h("span", { style: { fontSize: 11.5, color: palette.secondary, flex: "0 0 auto" } }, fmtSize(f.bytes))
                ))
          ),
          h("div", { style: { padding: "10px 14px", borderTop: "1px solid " + palette.rowBorder, display: "flex", justifyContent: "flex-end" } },
            btn(T("panel.cancel"), () => setShowArtifacts(false)))
        )
      ) : null;

      const bodyPending = h("div", { style: { display: "flex", flex: 1, minHeight: 0 } },
        /* 左栏：会话多选 */
        h("div", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" } },
          h("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "0 14px 10px" } },
            h("input", {
              value: keyword,
              onChange: (e) => setKeyword(e.target.value),
              placeholder: T("panel.search"),
              style: {
                flex: 1, height: 30, borderRadius: 8, padding: "0 10px", fontSize: 13,
                background: palette.inputBg, border: "1px solid " + palette.btnBorder,
                color: palette.text, outline: "none"
              }
            }),
            h("button", {
              type: "button", onClick: toggleAll,
              style: { height: 30, padding: "0 10px", borderRadius: 8, fontSize: 12.5, background: "transparent", border: "1px solid " + palette.btnBorder, color: palette.text, cursor: "pointer", flex: "0 0 auto" }
            }, checked.size === filtered.length && filtered.length > 0 ? T("panel.clearAll") : T("panel.selectAll"))
          ),
          h("div", { style: { overflow: "auto", padding: "0 8px 8px", flex: 1 } },
            loading ? h("div", { style: { padding: 24, color: palette.secondary, fontSize: 13 } }, T("panel.loading"))
            : filtered.length === 0 ? h("div", { style: { padding: 24, color: palette.secondary, fontSize: 13 } }, T("panel.empty"))
            : grouped.map(([cwd, list]) => {
                const ids = list.map(s => s.id);
                const allChecked = ids.length > 0 && ids.every(id => checked.has(id));
                return h("div", { key: cwd, style: { marginBottom: 6 } },
                  h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px" } },
                    h("div", { style: { fontSize: 11.5, color: palette.secondary, fontWeight: 600, letterSpacing: .3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: cwd },
                      cwd, h("span", { style: { marginLeft: 6, fontWeight: 400 } }, "· " + list.length)),
                    h("button", {
                      type: "button",
                      onClick: () => setChecked(prev => {
                        const next = new Set(prev);
                        if (allChecked) { for (const id of ids) next.delete(id); }
                        else { for (const id of ids) next.add(id); }
                        return next;
                      }),
                      style: {
                        flex: "0 0 auto", height: 22, padding: "0 8px", borderRadius: 6, fontSize: 11.5,
                        border: "1px solid " + palette.btnBorder, background: "transparent",
                        color: allChecked ? palette.accent : palette.secondary, cursor: "pointer"
                      }
                    }, allChecked ? "取消本组" : "全选本组")
                  ),
                  list.map(item => h(SessionRow, {
                    key: item.id, item, palette,
                    checked: checked.has(item.id),
                    onToggle: () => toggle(item.id)
                  }))
                );
              })
          )
        )
      );

      const bodyTrash = h("div", { style: { flex: 1, overflow: "auto", padding: "0 14px 10px" } },
        loading ? h("div", { style: { padding: 24, color: palette.secondary, fontSize: 13 } }, T("panel.loading"))
        : trashItems.length === 0 ? h("div", { style: { padding: 24, color: palette.secondary, fontSize: 13 } }, T("panel.emptyTrash"))
        : trashItems.map(item => h("div", {
            key: item.id,
            style: { display: "flex", alignItems: "center", gap: 10, padding: "10px 10px", borderBottom: "1px solid " + palette.rowBorder }
          },
            h("div", { style: { flex: 1, minWidth: 0 } },
              h("div", { style: { fontSize: 13, color: palette.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, item.title || item.id),
              h("div", { style: { marginTop: 3, fontSize: 11.5, color: palette.secondary } },
                fmtSize(item.bytes), " · ", fmtTime(item.trashedAt),
                item.subagents > 0 ? " · 含 " + item.subagents + " 个子代理" : "",
                item.cwd ? " · " + item.cwd : "")
            ),
            btn(T("panel.restore"), () => doRestore([item.id])),
            h("button", {
              type: "button", disabled: busy,
              onClick: () => setConfirm({ kind: "purge", ids: [item.id] }),
              style: {
                height: 32, padding: "0 12px", borderRadius: 8, fontSize: 12.5, cursor: busy ? "default" : "pointer",
                background: "transparent", border: "1px solid " + palette.btnBorder, color: palette.danger
              }
            }, T("panel.purge"))
          ))
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
          /* 头部 */
          h("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "16px 18px 10px" } },
            h("div", null,
              h("div", { style: { fontSize: 15.5, fontWeight: 600 } }, T("panel.title")),
              h("div", { style: { marginTop: 4, fontSize: 12.5, color: palette.secondary } }, T("panel.subtitle"))
            ),
            /* 顶部右侧：产物开关（仅回收站页，彻底删除时才生效） */
            h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
              tab === "trash"
                ? h("div", { style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 } },
                    h(Checkbox, {
                      checked: removeArtifacts,
                      onChange: (v) => setRemoveArtifacts(v),
                      label: T("panel.removeArtifacts"),
                      palette
                    }),
                    h("div", { style: { fontSize: 11, color: palette.secondary, textAlign: "right", maxWidth: 220 } },
                      T("panel.removeArtifactsHint"))
                  )
                : null,
              h("button", {
                type: "button", onClick: () => store.close(),
                style: { width: 26, height: 26, borderRadius: 6, border: "none", background: "transparent", color: palette.secondary, fontSize: 16, cursor: "pointer" }
              }, "×")
            )
          ),
          /* 页签 */
          h("div", { style: { display: "flex", gap: 4, padding: "0 18px" } },
            ["pending", "trash"].map(k => h("button", {
              key: k,
              type: "button",
              onClick: () => store.open(k),
              style: {
                height: 30, padding: "0 12px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                border: "none",
                background: tab === k ? palette.chipBg : "transparent",
                color: tab === k ? palette.text : palette.secondary,
                fontWeight: tab === k ? 600 : 400
              }
            }, k === "pending" ? T("panel.tabPending") : T("panel.tabTrash")))
          ),
          /* 产物统计条（回收站页） */
          tab === "trash" && removeArtifacts
            ? h("div", { style: { padding: "8px 18px 0", fontSize: 12, color: palette.secondary, display: "flex", alignItems: "center", gap: 10 } },
                scanning ? T("panel.artifactsScanning")
                : artifactInfo
                  ? h("span", null,
                      T("panel.artifactsFound", { n: artifactInfo.files.length, size: fmtSize(artifactBytes) }),
                      artifactInfo.files.length > 0
                        ? h("button", {
                            type: "button",
                            onClick: () => setShowArtifacts(true),
                            style: { marginLeft: 8, border: "none", background: "transparent", color: palette.accent, fontSize: 12, cursor: "pointer", textDecoration: "underline" }
                          }, T("panel.artifactsPreview"))
                        : null
                    )
                  : null
              )
            : null,
          /* 主体 */
          h("div", { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", marginTop: 8 } },
            tab === "pending" ? bodyPending : bodyTrash
          ),
          /* 错误 */
          error ? h("div", { style: { padding: "0 18px 6px", fontSize: 12.5, color: palette.danger } }, error) : null,
          /* 底部 */
          h("div", {
            style: {
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 18px", borderTop: "1px solid " + palette.rowBorder, background: palette.panel
            }
          },
            h("div", { style: { fontSize: 12.5, color: palette.secondary } },
              tab === "pending"
                ? (checked.size > 0
                    ? T("panel.selected", { n: checked.size }) + " · " + T("panel.selectedSize", { size: fmtSize(selectedBytes) })
                    : T("panel.selected", { n: 0 }))
                : h("span", null, T("panel.tabTrash"))
            ),
            h("div", { style: { display: "flex", gap: 8 } },
              btn(T("panel.cancel"), () => store.close()),
              tab === "pending"
                ? h("button", {
                    type: "button",
                    disabled: busy || checked.size === 0,
                    onClick: () => setConfirm({ kind: "trash", ids: [...checked] }),
                    style: {
                      height: 32, padding: "0 16px", borderRadius: 8, fontSize: 13,
                      border: "1px solid transparent", background: checked.size === 0 ? palette.chipBg : palette.danger,
                      color: checked.size === 0 ? palette.secondary : "#fff",
                      cursor: busy || checked.size === 0 ? "default" : "pointer"
                    }
                  }, T("panel.trashAction"))
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
        style: {
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 11100,
          background: palette.panel, border: "1px solid " + palette.panelBorder, boxShadow: palette.shadow,
          color: palette.text, borderRadius: 8, padding: "8px 16px", fontSize: 13,
          display: "flex", alignItems: "center", gap: 8
        }, role: "status"
      },
        h("span", { style: { color: toast.kind === "error" ? palette.danger : palette.success, fontWeight: 600 } }, toast.kind === "error" ? "✕" : "✓"),
        h("span", null, toast.text)
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
