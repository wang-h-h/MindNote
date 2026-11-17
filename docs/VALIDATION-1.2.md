# MindNote 1.2.0 验证记录

> 本页链接的 JSON 取自对应版本的原始源码归档，公开副本仅替换本机绝对路径与用户名；测试结果、指标和校验值未修改。详见 [报告来源与脱敏说明](verification/README.md)。

记录日期：2026-11-15。历史结果分别保留在 [V1.1](VALIDATION-1.1.md) 与 [V1.0](VALIDATION-1.0.md)，不作为本轮通过的替代证据。

## 自动化与实际界面

- **6 个测试文件、83 项单测全部通过**，整项目 TypeScript 与生产构建通过。覆盖统一节点、单节点计划、独立进度、日期、排序、SQLite、撤销重做、迁移、背景 BLOB、完整卡片备注与安装目录的数据位置。
- **23 组真实 Electron 界面流程通过，渲染器异常为 0**。覆盖既有计划、跨窗口同步、设置、搜索、导图操作，以及标题栏设置按钮、收起后打开设置自动展开、中文品牌、完整备注、同行取消计划、背景导入／加载／模糊／清除、设置两列布局、最大化与八方向鼠标缩放。报告：[v12-ui-results.json](verification/v1.2.0/v12-ui-results.json)。
- **8 组实际容器排序回归通过**。360px 容器完整显示时，完成保留原位置；120px 容器溢出时，完成事项下沉一次；仅调整尺寸不会追补重排。隐藏／折叠／切换筛选以及带 20 行完整备注的宫格均通过。报告：[plan-v12-regression.json](verification/v1.2.0/plan-v12-regression.json)。

外观范围控件另通过 **11 组真实 Electron 竞态回归**：在 100ms 广播／240ms 响应延迟下，快速 Home→End 保留最后的 36；覆盖拖动与键盘编辑、旧广播不覆盖草稿及预览、较新版本同步、失败重试、取消、关闭后保存、重开后新选择优先及不透明度百分比转换。报告：[settings-range-v12-regression.json](verification/v1.2.0/settings-range-v12-regression.json)。

## 导图连线与编辑

新专项覆盖连续 **12 轮主干一级→全部展开**、**14／18px 字号 × 70%／100%／140% 缩放**下编辑长中文名称。展开后的连线端点误差不超过 0.67px；编辑中的节点与覆盖编辑框保持尺寸，无相邻节点重叠，连线误差不超过 1.32px。Enter 提交、Escape 取消和视角保持均通过。

确认的 A「雾蓝同色系」已核对实际节点与连线颜色；完成划线使用浅色 `#C69D35`／深色 `#E7C66B`、2px 厚度。工具栏下边距实测约 8px。报告：[mindmap-v12-layout-regression.json](verification/v1.2.0/mindmap-v12-layout-regression.json)。

既有 **16 组导图回归**继续通过，包括删除旧选择、切图后子项保留、缩放编辑、右键、画布平移与 1,000 节点双向修改。[报告](verification/v1.2.0/mindmap-v1-regression.json) 保留历史脚本文件名，内容为当前运行结果。1,000 节点本机样本：创建渲染 123ms、折叠 20ms、定位展开 95ms、外部编辑同步 106ms；画布编辑完整流程 1,827ms 包含双击、输入、提交及测试等待，不是单帧渲染耗时。

## 窗口、图片与安装目录

- **10 组原生桌面回归通过**：启动仅便签、按需主窗口、最大化／还原、第二进程唤回、尺寸／收起／置顶、SQLite 备份恢复、重启保存、离屏回收和 100%／150%／200% DPI。[报告](verification/v1.2.0/verification-dev.json)。
- **新增 5 组原生检查通过**：四边 16 DIP 吸附；GIF／动态 WebP 原始字节保持不变，减少动效返回正确首帧；跨窗口图片加载；路径与伪图片拒绝；userData、sessionData、logs、crashDumps 均位于 data 下。[报告](verification/v1.2.0/native-v12-dev.json)。
- 圆角 PNG 中，便签与完整窗口分别检出 66／35 种中间透明度，证明边缘为抗锯齿过渡。实际 Windows 桌面合成截图验证两窗外角均显示后方背景，不残留方形材质。[实际桌面报告](verification/v1.2.0/window-shape-dev.json)。
- 安装目录的 3 项测试覆盖：正式包默认使用 EXE 旁 data；迁入活动 WAL 的一致 SQLite 副本、原数据库及 WAL 字节不变；存在目标不覆盖、非 MindNote 数据库拒绝。正式个人数据未参与测试。
- schema 4 背景图片与任务分表存储，背景随整库备份恢复；旧 schema 1／2／3 升级前保留安全备份。恢复源文件不被改写。

## 最终交付验收

实际 Windows x64 打包应用版本为 **1.2.0**，打包后的构建产物、图标和 SQLite 原生二进制校验一致；打包目录没有 data 或测试内容。资源清单见 [package-integrity.json](verification/v1.2.0/package-integrity.json)。该清单记录打包时文件；本记录与交付说明在验收后补入最终结果，应用代码未再改动。

- **打包版 23 组界面流程通过**，渲染器异常为 0：[v12-packaged-ui-results.json](verification/v1.2.0/v12-packaged-ui-results.json)。
- **打包版 10 组原生桌面 + 5 组 V1.2 专项通过**：[verification-packaged.json](verification/v1.2.0/verification-packaged.json)、[native-v12-packaged.json](verification/v1.2.0/native-v12-packaged.json)。
- **打包版 3 项实际桌面合成检查通过**：[window-shape-packaged.json](verification/v1.2.0/window-shape-packaged.json)。

NSIS 安装程序设置为作者／公司／安装信息发布者 `whh`、快捷方式 `MindNote`；包含安装目录选择页，默认 `%LOCALAPPDATA%/Programs/MindNote`，卸载保留 data。NSIS 以 `/WX` 严格模式无警告编译成功。安装器和应用的版本均为 `1.2.0`、CompanyName 为 `whh`、ProductName 为 `MindNote`。

交付安装包：`releases/MindNote-1.2.0-Setup.exe`，118,447,974 字节（112.96 MiB）。SHA256：

```text
961d4814b72ba21cd393a7f356f8af4984de220fc2f16c9d9ed2c5b49ae3d5a8
```

安装包和源码完整校验值见 `releases/SHA256SUMS.txt`；安装器元数据见 [artifacts-1.2.0.json](verification/v1.2.0/artifacts-1.2.0.json)。V1.0／V1.1 安装包和源码保留，原哈希不变。

## 覆盖边界

使用独立测试数据目录，不读写用户正式待办。没有执行安装器或修改用户的桌面快捷方式和卸载注册信息；未配置代码签名，Windows 不会因此成为已认证发布者。真实多显示器插拔以及不同 Windows／显卡组合仍需额外实机覆盖。
