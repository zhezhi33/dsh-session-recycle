dsh-session-recycler v0.2.4 发布说明
=====================================

本版只做地址迁移，插件功能没有任何变化。

1. GitHub 仓库改名
   - dsh-session-recycle → dsh-session-recycler
   - 旧地址继续可用（GitHub 301 跳转）
   - 面板头部的「项目主页」图标、package.json 的 repository 字段都指向新地址

2. npm 地址更新
   - 包名仍是 dsh-session-recycler
   - 本版把包元数据里的 repository 字段改成了新仓库地址，
     npm 页面上的「Repository」链接不再指向旧名

3. 插件商店条目改名
   - 市场条目从 zhezhi33__dsh-session-recycle.yml 改为 zhezhi33__dsh-session-recycler.yml
   - 安装地址（tarball）指向本版 dsh-session-recycler-0.2.4.tgz

升级
----

重新安装即可覆盖旧版：回收站里已有的会话、面板设置（打开方式）都不受影响。
插件数据目录仍沿用 %DSH_HOME%\dsh-session-recycle\，不会因为改名丢失历史回收站内容。

安装
----

解压后双击：

  一键安装-纯PowerShell.cmd

只检查不安装：

  一键安装-纯PowerShell.cmd --check

安装后完全退出 DeepSeek Harness 再启动。

本版限制
--------

- 仅支持 Windows（依赖 explorer.exe 与 Shell COM）
- 多窗口模式逐目录高亮；标签页模式因焦点自动化风险已禁用
- 产物识别依赖对话正文里的路径文本 + 工作区 mtime 兜底，纯命令行 cd 后的相对写入仍可能漏
