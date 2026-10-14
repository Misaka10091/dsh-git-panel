# dsh-git-panel

简体中文 | [English](README_EN.md)

> 为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供 Git 面板，基于 [KannaKuron/dsh-ide-git](https://github.com/KannaKuron/dsh-ide-git) 二开。默认提供类似 VS Code Source Control 的可折叠仓库列表，并保留完整的 Git 工作台。

当前版本：**0.1.0**。上游基线：**dsh-ide-git 0.18.2**，提交 `b4e4b5a176de7da9060d1225d9ed027a8df8472c`。来源、许可证和同步方法见 [UPSTREAM.md](UPSTREAM.md)。

## 当前能力

继承上游的分支树、提交图谱、变更与暂存、提交框、文件差异、提交详情、stash、标签、分支及远程操作、AI 提交信息与会话插入能力。

插件支持 Better Sidebar 的侧栏和底部工作台；未安装 Better Sidebar 时使用 DSH 原生右侧栏；还提供主对话区 Git 标签页。已经能够发现工作区及嵌套仓库、已初始化子模块，并选择一个仓库操作。

默认面板标题为 **Git**。每行显示仓库名称、分支和变更文件数，提供刷新、全部暂存及进入历史工作台的动作；展开后显示暂存、更改、未跟踪文件和提交框。暂存、取消暂存、提交、提交并推送、丢弃确认、可用的撤回句柄和 diff 预览均绑定该行的仓库。

提交草稿、展开状态、文件选择、忙碌状态和错误按仓库隔离；折叠或往返历史工作台会保留仓库行草稿。失败提交保留草稿；提交成功但推送失败会清空已提交草稿并保留失败提示；无法生成撤回快照的丢弃会明确提示。切换工作区或会话后，旧请求不能覆盖当前界面。

摘要通过最多 4 个并发槽共享调度，列表可见时每 12 秒轮询轻量摘要；隐藏时停止轮询。写队列使用 Git 根路径与实际文件系统路径，合并子目录、路径别名及 Windows 大小写变体；不同仓库和 linked worktree 保持独立。`rebaseAbort` 已纳入写队列。请求与会话工作区的范围绑定仍待完善。

## 环境与开发

- Git 命令行可用。
- 插件运行要求 Node.js >=18；开发和 CI 推荐 Node.js 24（当前上游测试已使用较新的 Node API）。
- DSH >=0.1.6-alpha.2；Better Sidebar >=0.12.0，为可选依赖。
- 当前宿主和客户端均为普通 JavaScript，无构建步骤。日常测试不需要安装 DSH 的 peer 依赖。

在项目目录执行：

```sh
npm test
npm run check:syntax
npm run check:ssr
npm pack --dry-run
```

SSR 检查读取本机 DSH profile 中的 React，默认选择 `web`；可以通过 `DSH_HOME` 和 `DSH_PROFILE` 指定位置。没有可用 profile 或 React 时会明确跳过。Windows 桌面 profile 示例：

```powershell
$env:DSH_PROFILE = 'desktop'
npm run check:ssr
```

## 仓库列表浏览器验证

`scripts/repositories-probe.mjs` 使用真实客户端入口、React 19.2 和模拟宿主/Git API，在隔离 Chrome profile 中验证数据态界面。测试依赖为项目 `.local/browser-fixture/node_modules` 下的 `playwright-core@1.58.2`、`esbuild@0.25.12`，以及 `.local/ssr/profiles/web/node_modules` 下的 `react@19.2.0`、`react-dom@19.2.0`。它们不属于插件运行依赖或生产构建步骤。

先执行 `node scripts/repositories-probe.mjs --prepare`，再执行输出中的 esbuild 可执行文件命令，最后运行 `node scripts/repositories-probe.mjs --full`。源码或探针修改后需要重新 prepare 和构建测试 bundle。报告、隔离浏览器 profile 及 1440×860、360×820、320×640、1100×300 截图保存在忽略的 `.local/repositories-probe/` 中。

完整探针覆盖独立草稿、折叠保留、目标仓库与忙碌状态隔离、工作台往返、跨仓库 diff、提交失败重试、推送部分成功、丢弃撤回提示、失败写入与旧摘要交错、工作区旧响应和窄屏溢出。**此测试不等同于真实 DSH 宿主联调**；AGENTS.md 要求的安装后测试实例仍需显式 URL 和 `DSH_CHECKOUT` 的专项探针。已获授权安装到当前桌面 profile，真实仓库发现和嵌套仓库摘要成功；首次提交前仓库修复已安装并通过 58 项 API/仓库测试，但运行中的宿主仍缓存旧模块，需要重启加载。独立浏览器尚无当前 GUI 的登录会话，真实页面数据态验证仍待完成。

## 本地安装

此项目尚未发布到 npm。需要安装时，在项目目录先打包，再通过 DSH CLI 安装本地包：

```sh
npm pack
dsh plugin --profile desktop add file:./dsh-git-panel-0.1.0.tgz
```

宿主代码更新后需要重启当前 DSH 实例才能生效；客户端更新需要重新加载页面。新项目初始化不会自动安装插件或重启实例。

## 独立插件标识

| 用途 | 标识 |
|---|---|
| npm 包 / host / client module / locale namespace | `dsh-git-panel` |
| 插件清单 ID | `dsh-external/dsh-git-panel` |
| Cordis loader row / config namespace | `git-panel` |
| Git HTTP API | `/dsh-git-panel/api` |
| Better Sidebar tab | `dsh-git-panel:panel` |
| 原生主面板 / 预览面板 | `dsh-git-panel` / `dsh-git-panel-preview` |
| 主对话区 view ID | `git-panel` |
| 浏览器存储 | `dsh-git-panel.*` |
| CSS / DOM class prefix | `dgp-` |

这些注册、存储和样式标识与上游分开，后续修改不会复用上游的设置空间。

## 后续开发顺序

1. 在获准的隔离 DSH 测试实例中验证安装、注册、主题和宿主集成。
2. 完善请求与会话工作区范围绑定，把一致路径身份扩展到撤回存储等场景。
3. 支持 VS Code 仓库扫描配置，完善大型工作区的摘要与统计加载。
4. 保留图谱、diff 与详细工作台，逐步拆分维护成本较高的模块。

## 目录

- `src/index.js`：宿主 Git API。
- `src/client.js`：客户端注册、界面和样式。
- `cordis.patch.yml`、`dsh.plugin.json`：安装挂载与插件清单。
- `tests/`：冒烟、真实仓库 API、图谱和仓库发现测试。
- `scripts/`：SSR 自检、演示仓库、隔离仓库列表探针及要求真实测试实例的宿主集成探针。
- `docs/screenshots/`：保留的上游演示截图，尚不是本项目的实测截图。
- [AGENTS.md](AGENTS.md)：后续开发规则。
- [CHANGELOG.md](CHANGELOG.md)：本项目变更记录及保留的上游历史。

## 许可证

[MIT](LICENSE)。保留上游 `Copyright (c) 2026 KannaKuron` 声明。本项目尚未获得上游插件的市场收录或 npm 发布身份；仓库地址确定后再补充自身的发布信息。
