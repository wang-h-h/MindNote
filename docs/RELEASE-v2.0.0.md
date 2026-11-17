# MindNote V2.0.0 · 让想法有脉络，让计划有着落

**Desktop sticky notes, task planning, and mind maps — connected in one local Windows app.**

MindNote 将桌面透明便签、待办计划和项目导图连接起来。计划与导图共用同一份事项，支持独立进度、雾蓝主题、自定义背景，以及无需账号的本地 SQLite 保存。

MindNote connects a transparent desktop note with task planning and project mind maps. Both views share the same tasks, with independent progress, mist-blue styling, custom backgrounds, and local SQLite storage without an account.

## 本次更新 / What's new

- **完成记录保留 / Keep completed work visible:** 修复逾期事项达到 100% 后从今日／本周消失的问题；完成事项同时保留原计划日期和实际完成日期的记录。Overdue tasks stay visible on their completion day and week while retaining their original scheduled dates.
- **清晰的完成样式 / Readable completion styling:** 完成名称保持原字号、字色和字重，只加明显黄色划线；计划、月历、详情与导图一致。A clear yellow strike-through marks completion without changing text size, color, or weight across views.
- **三周计划 / Three-week planning:** 固定展示上周、本周、下周，按项目分组，兼顾回顾和安排。View last week, this week, and next week together, grouped by project.
- **关闭到托盘 / Close to tray:** 便签标题栏增加关闭按钮，隐藏窗口并保留事项；从托盘即可恢复。Hide the sticky note using its new close button and restore it from the tray without losing content.
- **置顶恢复 / Restore the pinning preference:** 重新显示、最小化还原，以及唤醒、解锁和显示变化后重新应用已保存的置顶选择；取消置顶同样保持。Saved always-on-top preferences are reapplied when windows are shown or restored and after relevant system events, including when pinning is disabled.
- **查看归档 / Access completed records:** 全部事项中主动选择「已归档」可查看完成记录，不改写全局隐藏设置。The completed-record filter remains accessible without changing the global hide-completed preference.

## 下载与升级 / Download and upgrade

目标平台：**Windows x64**。应用界面为**简体中文**。The application currently has a **Simplified Chinese** interface and targets **Windows x64**.

1. 下载 `MindNote-2.0.0-Setup.exe`，选择当前用户可写的安装目录。Download the installer and choose a writable folder.
2. 升级前使用应用内备份，再从托盘退出旧版。Back up in the app and exit the old version from the tray before upgrading.
3. 安装到原目录可继续使用现有 `data`；V2.0 沿用 V1.2 的 schema 4。Install to the same folder to retain existing data. V2.0 keeps V1.2's schema 4.

无需 Node.js 或其他开发工具。默认数据位于 `<安装目录>/data/mindnote.sqlite`；图片背景包含在数据库备份内。

No Node.js or other development tools are required. Data is stored in `<installation folder>/data/mindnote.sqlite`, and database backups include custom background images.

## 发布文件 / Release assets

- **`MindNote-2.0.0-Setup.exe`** — Windows x64 安装包 / Windows x64 installer.
- **`MindNote-2.0.0-source-github.zip`** — 整理后的 V2.0 源码与项目文档 / V2.0 source and project documentation.
- **`SHA256SUMS-v2.0.0.txt`** — 发布文件的 SHA256 校验值 / SHA256 checksums for the release assets.

安装包沿用已验证的 V2.0.0 二进制；GitHub 项目说明与发布源码补充了中英文介绍。GitHub 自动生成的 “Source code” 压缩包是仓库快照，不是可运行的安装程序。

The installer retains the validated V2.0.0 binary. The repository and source distribution include the prepared bilingual project documentation. GitHub's automatically generated “Source code” archives are repository snapshots, not installers.

## 验证与范围 / Validation and scope

V2.0 的发布验证记录包含 **90 项单元测试、23 组打包界面流程、6 组完成记录／三周计划专项**，以及排序、原生窗口、置顶恢复、背景和数据目录检查。

The V2.0 validation record includes **90 unit tests, 23 packaged UI workflows, and 6 completion-history/three-week behavior groups**, plus ordering, native-window, pinning, background, and storage checks.

本次 GitHub 整理另复测 **90/90 单元测试、TypeScript 检查与生产构建**，均通过；应用业务源码未改动。

The GitHub preparation also reran **all 90 unit tests, TypeScript checks, and the production build** successfully. Application logic was unchanged.

安装器**未代码签名，且未执行安装验证**。唤醒、解锁及显示变化恢复路径通过事件注入验证；多电脑、不同显卡及 Windows 版本仍需扩展覆盖。此版本不含云同步、重复任务、系统通知、导图导出或专注计时。

The installer is **unsigned and was not run as part of installation testing**. Wake, unlock, and display-change recovery paths were checked through event injection. Testing across additional machines, GPUs, and Windows versions remains necessary. This version has no cloud sync, recurring tasks, system notifications, mind-map export, or focus timer.

[项目首页 / Project](https://github.com/wang-h-h/MindNote) · [中文使用说明 / User guide](https://github.com/wang-h-h/MindNote/blob/v2.0.0/docs/USER_GUIDE.zh-CN.md) · [验证记录 / Validation record](https://github.com/wang-h-h/MindNote/blob/v2.0.0/docs/VALIDATION.md)
