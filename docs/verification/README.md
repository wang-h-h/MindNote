# Verification reports / 验证报告

这里收录版本验证文档引用的 JSON 公开副本。每份报告从同版本原始源码 ZIP 提取，按版本隔离，避免同名报告被后续运行覆盖而混用。V2.0 中的置顶基线报告测试 V1.2 旧包，作为 V2.0 修复的对照。

These public JSON copies were extracted from the original source archive for each release. Versioned folders keep reports with reused filenames separate. The pinning baseline under V2.0 tests the older V1.2 package for comparison.

本机工作区根目录替换为 `<workspace>`，用户目录替换为 `<user-home>`，其他本机绝对路径替换为 `<local-path>`，本地用户名替换为 `<local-user>`。保留 JSON 结构、检查结果、指标、时间戳及校验值；没有重新执行测试，也没有把路径替换后的 JSON 称为原始字节副本。

Local workspace, user-home and other absolute path prefixes, and local usernames are replaced with placeholders. JSON structure, outcomes, metrics, timestamps and checksums are preserved. These are sanitized copies, not byte-identical originals or newly executed test results.

报告中的图片路径仅保留证据文件标识，不是可下载链接。本目录不含测试截图、日志、数据库或用户内容。面向项目展示的六张合成数据截图单独收录于 `../screenshots/`，来自 `scripts/verify-v20-ui.mjs` 创建的独立示例数据。

Image paths inside reports identify local evidence files and are not download links. This folder contains no screenshots, logs, databases or user content. The six showcase images in `../screenshots/` use synthetic fixtures created by `scripts/verify-v20-ui.mjs`.

V1.0 原始源码归档未包含 JSON 报告，因此不以当前可能已覆盖的同名文件补充历史证据。V1.0 的文字记录保留在 `../VALIDATION-1.0.md`。

The V1.0 source archive did not include JSON reports. Current files with reused names are not presented as historical V1.0 evidence; the written record remains in `../VALIDATION-1.0.md`.

| Version / 版本 | Original archive / 原归档 | SHA256 | JSON files / 数量 |
| --- | --- | --- | --- |
| 1.1.0 | `MindNote-1.1.0-source.zip` | `b21ca4d0da402a340d33d6f9d681fe9a9face63bd230b0b8dbf1eb3faa3f80c8` | 9 |
| 1.2.0 | `MindNote-1.2.0-source.zip` | `fd2262a71af29b797d7980ddf24985401acb36c7d69137c51fb91c1df9cd31a6` | 14 |
| 2.0.0 | `MindNote-2.0.0-source.zip` | `5aaa12a97ddcb3910c4255996ea716c1f5ea5959d00cd83555574e45c94e0720` | 13 |

原归档及其哈希仅记录来源；本次 GitHub 整理后的源码归档可能包含新的文档，因此使用另行计算的校验值。 / These hashes document provenance. A newly prepared GitHub source archive can contain updated documentation and therefore has its own checksum.
