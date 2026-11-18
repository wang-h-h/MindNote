# MindNote · 开发与数据 / Development and data

[返回首页 / Back to README](../README.md)

This guide covers development for macOS (Apple Silicon and Intel) and Windows x64, build outputs, local data, and release verification. The development environment uses Node.js 24 and pnpm 11. Dependency installation requires internet access; the packaged app runs offline without development tools.

The main process is the only database writer. Plans and mind maps share node IDs and content. Plan membership and progress are explicit for each task, so changing a parent does not automatically complete its children. SQLite schema 4 stores tasks, settings, and custom backgrounds in `~/Library/Application Support/MindNote` on macOS and the installation folder’s `data` directory on Windows. Use in-app backups to include WAL data safely.

## 运行与构建 / Run and build

目标平台为 macOS（Apple Silicon、Intel）及 Windows x64，开发环境使用 Node.js 24、pnpm 11。首次安装依赖需要联网，运行已经打包的应用不需要开发工具。

```powershell
pnpm install --frozen-lockfile
pnpm exec install-electron
pnpm dev
```

| 命令                  | 用途                                                       |
| --------------------- | ---------------------------------------------------------- |
| `pnpm dev`            | 启动 Vite 与 Electron；渲染器支持热更新                    |
| `pnpm build`          | TypeScript 检查并构建界面、主进程与 preload                |
| `pnpm start`          | 启动已构建的应用，需先运行 `pnpm build`                    |
| `pnpm test`           | 在 Electron 的 Node 模式中运行测试，保持 SQLite 运行时一致 |
| `pnpm icons`          | 从用户提供的 PNG 生成应用与托盘图标                        |
| `pnpm package`        | 在当前平台构建应用目录（Windows x64 或当前 Mac 架构）      |
| `pnpm make:mac`       | 在当前 Mac 构建同架构的 DMG，输出到 `out/make/macos/`      |
| `pnpm make`           | 构建可选安装路径的 Windows NSIS 安装程序                   |
| `pnpm test:desktop`   | 在 Windows 构建并运行界面流程与原生窗口验证                |
| `pnpm test:packaged`  | 在 Windows 对已打包应用运行独立数据验证                    |
| `pnpm native:rebuild` | 更换原生依赖后的重建诊断；需相应编译工具链                 |

主进程或 preload 修改后需要重启开发进程。SQLite 依赖提供 Windows x64、macOS arm64／x64 的 Node-API 二进制，打包时只保留目标平台文件。Windows 安装程序未签名；Mac 应用使用本地 ad hoc 签名，未经 Developer ID 签名和 Apple 公证。应用不自动检查在线更新。

Restart after main-process or preload changes. Packaging includes the SQLite binary for the target architecture. Windows Setup is unsigned; Mac builds are ad-hoc signed, without Developer ID signing or notarization. There is no automatic update check.

主要输出：

- `releases/`：按版本保存最终安装包和源码；各版本是否已生成见验证记录。
- `out/MindNote-win32-x64/MindNote.exe`：应用程序，分发时保留整个目录。
- `out/make/nsis/x64/MindNote-2.0.0-Setup.exe`：Windows 安装程序。
- `out/MindNote-darwin-<arch>/MindNote.app`：Mac 应用，`<arch>` 为 `arm64` 或 `x64`。
- `out/make/macos/<arch>/MindNote-2.0.0-macOS-<arch>.dmg`：对应架构的 Mac 磁盘映像。
- `assets/icon.png`、`assets/icon.ico`、`assets/tray.png`：应用与托盘图标。
- `dist/renderer/`、`dist/main/`：界面及 Electron 构建产物。

图标源为 `UI Reference/MindNote-1.1-用户图标.png`。应用 PNG 原样使用用户图像；生成脚本保留原图构图和透明通道，仅为 ICO／托盘生成适当尺寸。兼容用 SVG 文件是 PNG 包装，并非重新描绘的矢量原稿。

Mac 打包会从应用 PNG 自动生成 ICNS；DMG 必须在对应架构的 Mac 上构建。Mac packaging generates ICNS from the app PNG; build each DMG on a Mac of the matching architecture.

## 实现与数据 / Architecture and storage

| 部分       | 实现                                                 |
| ---------- | ---------------------------------------------------- |
| 桌面外壳   | Electron 45.3.2；透明便签、托盘、主窗口和受限 IPC    |
| 界面       | React 19.3.1、TypeScript 7.0.2、Vite 8.3.8           |
| 导图       | Mind Elixir 6.0.1，通过适配层处理编辑与展示          |
| 数据       | SQLite / better-sqlite3 13.1.1；事务、备份、版本迁移 |
| 打包与测试 | Electron Forge 8.0.1、NSIS 3.13、Vitest 5.1.0        |

`src/shared/` 定义统一节点、计划成员资格、独立进度与日历日期；`src/main/` 是唯一数据库写入端；`src/renderer/` 负责计划、导图与便签。两种视图共用节点 ID 和内容，不通过复制任务维持关联。

macOS 使用 `~/Library/Application Support/MindNote/mindnote.sqlite`。Windows 正式版本将待办、导图、设置和背景保存到 `<安装文件夹>/data/mindnote.sqlite`，备份、缓存和日志也位于 data 内。可从外观设置点击「打开数据文件夹」核对位置。开发测试可用 `MINDNOTE_DATA_DIR` 指向独立目录；正式包默认忽略该覆盖，测试模式除外。

Windows 安装程序支持选择目录，默认 `%LOCALAPPDATA%/Programs/MindNote`，不要求管理员权限。作者及安装信息的发布者为 `whh`，桌面快捷方式仅显示 `MindNote`。请选择当前用户可写的目录。更新前先从托盘退出旧版；卸载保留 data。首次启动如目标库不存在，会检测旧数据目录、校验 SQLite 并先复制一致备份，再迁入新目录，旧库保持不变。

Mac 打开 DMG 后，将 `MindNote.app` 拖入「应用程序」。数据保存在用户的 Application Support 目录，更新应用包不会替换数据库；升级前仍应使用应用内备份并退出旧版。On Mac, drag the app from the DMG to Applications. Data remains in the user's Application Support folder; back up and quit before replacing the app.

数据格式为 schema 4。旧库升级前保存完整安全备份；节点、日期、关联、进度、备注和窗口位置保留。背景图片作为独立 BLOB 存储，任务编辑不反复改写图片；整库备份／恢复同时携带背景，无需保留导入图片的原路径。不要在运行时只复制 `.sqlite` 文件而遗漏 WAL 数据，应使用应用内备份。

`pnpm make` 在缺少编译器时自动下载 [NSIS 3.13 官方 ZIP](https://sourceforge.net/projects/nsis/files/NSIS%203/3.13/)，校验固定 SHA256 后解压到 `.local-data/build-tools`。也可设置 `MINDNOTE_NSIS_COMPILER` 指向已有的 `makensis.exe`。首次构建需要联网；运行已打包应用无需 NSIS、Node.js 或网络。

## 验证状态 / Validation

| 范围 / Scope                                    | 通过的检查 / Passed checks                                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 原 Windows V2.0 发布 / Original Windows release | 90 项单测、23 组打包界面、6 组完成／三周计划、10 组原生桌面，以及置顶、圆角、背景与排序专项；见 [原始记录](VALIDATION.md)。      |
| 本次 Windows 回归 / Current Windows regression  | **97/97 单元测试**、TypeScript 检查、生产构建、**23 组界面、6 组完成／三周计划、10 组原生桌面**。                                |
| macOS arm64 与 x64 原生 CI / Native macOS CI    | 两架构的单测、构建、DMG 挂载与打包应用验证均成功；见 [运行记录](https://github.com/wang-h-h/MindNote/actions/runs/44299343603)。 |

Mac CI 在各自原生架构上检查应用与 SQLite 的 Mach-O 架构、ad hoc 签名完整性、DMG 中的 Applications 链接；从只读挂载的 DMG 启动应用，确认便签窗口可见、新建事项在主窗口共享、退出并重启后仍保留，以及 SQLite `quick_check` 正常。测试使用正式默认的 Application Support 路径。

验证系统 / Tested on macOS　[Apple Silicon · 15.8.2](verification/v2.0.0/macos-arm64.json) · [Intel · 15.7.9](verification/v2.0.0/macos-x64.json)

Both native Mac jobs passed tests, builds, and packaged-app checks: matching app/SQLite architectures, signature integrity, DMG layout, a visible sticky window, a task shared with the main window, persistence after relaunch, and SQLite integrity at the default Application Support path. The current Windows regression passed all 97 unit tests, TypeScript/build checks, and the UI/native groups listed above.

## 官方参考与方案选择 / References and design choices

- [Mind Elixir Core](https://github.com/SSShooter/mind-elixir-core)：直接复用其 MIT 导图引擎，业务模型、计划和 SQLite 保存由 MindNote 管理。框架无关的 API 适合接入现有 React 桌面界面。[官方文档](https://docs.mind-elixir.com/)
- [Freeplane](https://github.com/freeplane/freeplane)：参考节点折叠和分层浏览的交互方向。V1.0 仅增加已确认的一层／两层／全部展开，不引入整套插件或额外工作流。[官方节点操作说明](https://docs.freeplane.org/user-documentation/first-steps.html)
- 初始调研还参考 [BlinkMindDesktop](https://github.com/awehook/blink-mind-desktop)、[Simple mind map](https://github.com/wanglin2/mind-map) 与 [Stikly](https://github.com/wilkcraft/stikly)。没有整仓套用，也没有复制 Stikly 的受限许可代码。

选择 Electron 是为了复用 JavaScript 导图库并完成 Windows 窗口能力；SQLite 提供单机离线保存与可校验备份。第三方组件声明见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

## 验证边界 / Verification limits

Windows 测试使用独立数据目录，**NSIS 安装器未执行**；旧置顶专项中的唤醒、解锁与显示变化采用事件注入。Mac 已实际挂载 DMG 并运行其中的应用，但尚未验证拖入 Applications 后的完整安装流程、下载隔离下的 Gatekeeper 首次打开、登录项、真实休眠唤醒或跨显示器行为。Mac CI 的通过不代表执行了 Windows 的全部专项。

Windows checks used isolated data and did not execute the NSIS installer; wake/unlock/display recovery used event injection. Mac CI mounted each DMG and ran its app, but did not cover a full drag-to-Applications install, quarantined-download Gatekeeper behavior, login items, physical sleep/wake, or multiple displays. The two platforms have different coverage; overlapping test groups should not be added into one independent total.
