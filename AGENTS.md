# AGENTS.md

面向 `dsh-git-panel` 的后续开发者。此项目基于 `KannaKuron/dsh-ide-git` 0.18.2，来源与固定提交见 [UPSTREAM.md](UPSTREAM.md)。

## 项目方向

提供通用 Git 面板：可折叠仓库总览、逐仓库状态与操作，以及完整的分支、图谱、变更和 diff 工作台。当前 0.1.0 已建立独立项目并实现默认的可折叠仓库列表、逐仓库状态与操作。隔离浏览器验证覆盖真实客户端和模拟宿主；现已获授权安装到当前桌面 profile，并验证真实仓库发现与嵌套仓库摘要。首次提交前仓库修复已安装，运行中宿主需重启加载；真实 GUI 数据态尚因独立浏览器缺少登录会话而未验证，不应把模拟宿主或真实 API 验证宣称为真实 GUI 验证。

## 项目身份

- 包名、host/client module 与 locale namespace：`dsh-git-panel`。
- manifest：`dsh-external/dsh-git-panel`。
- Cordis loader row 与 config namespace：`git-panel`。
- API：`/dsh-git-panel/api`。
- Better Sidebar tab：`dsh-git-panel:panel`。
- 原生主面板、预览：`dsh-git-panel`、`dsh-git-panel-preview`。
- conversation view：`git-panel`。
- 浏览器存储：`dsh-git-panel.*`；CSS / DOM class prefix：`dgp-`。

不得重新引入上游运行时身份。保留 LICENSE 原文与来源信息，不把上游的市场收录、GitHub 账号、npm 发布权限或本机路径当成本项目配置。

## 开发和验证

- 开发与 CI 推荐 Node.js 24；Git 命令行必须可用。
- 日常使用 `npm test`、`npm run check:syntax`、`npm run check:ssr`；打包前使用 `npm pack --dry-run`。
- SSR 默认读取 web profile；桌面可设置 `DSH_PROFILE=desktop`，自定义用户目录可设置 `DSH_HOME`。SSR 只覆盖初始/空数据渲染，跳过不能算通过。
- `scripts/repositories-probe.mjs` 提供项目隔离的模拟宿主验证，覆盖仓库列表状态、操作与失败路径；不能替代真实 DSH 集成验证。
- 修改分支、变更、历史等数据态界面，必须在装有本插件的测试实例运行 `scripts/layout-probe.mjs` 或对应专项探针；探针使用显式 URL 和 `DSH_CHECKOUT`，不依赖上游开发者机器。
- 不擅自安装插件、改用户 profile、发送消息或重启现有 DSH 实例。用户明确授权相应操作后再执行。
- 不启动替代服务器来声称更新了用户现有 GUI。测试实例的启动与停止遵守当前会话授权和宿主环境要求。
- 文件可能是硬链接或副本，修改安装产物前先确认真实文件关系，避免回写源码。

## 代码约束

1. 当前无构建步骤。客户端保留 `window.__ModuleLoader__.load({ id, factory })` 包装，不新增第二个 client entry。需要模块化或构建链时先设计明确迁移方案和产物验证。
2. 宿主使用 Node 内置 API。当前仅有 host 提供的 `@deepseek-ai/schemastery` 动态可选加载，缺失时允许降级。
3. Git 永远使用 argv 数组；禁止 shell 命令拼接、`exec` 或 `shell: true`。新参数走现有 ref/path 校验。
4. 写操作必须登记到 `WRITE_METHODS` 并通过队列。`rebaseAbort` 已登记；队列按 Git checkout 根路径与实际文件系统路径规范化，linked worktree 保持独立。不要把原始路径字符串视为仓库唯一身份；撤回存储等场景仍需逐项统一身份。
5. 保留破坏性操作的 confirm 守卫、撤回句柄及冲突检查。未经正确快照不能宣称可撤回。
6. 新路由遵循现有 method 和 trust 校验；现有 loopback/Fetch Metadata 检查不能替代宿主鉴权或工作区授权。完善请求与会话仓库范围绑定是后续任务。
7. Better Sidebar 与原生主侧栏注册互斥，后者必须有 guide 入口；主对话区座位独立，遵循实时配置开关。注册要有 effect cleanup，避免热加载/禁用后残留。
8. 宿主不访问客户端侧栏服务。客户端对可选服务和平台 UI primitives 做能力探测。
9. 布局通过容器宽度测量；高度仅区分 columns/stack，不能独立触发 compact。
10. hooks 依赖数组引用的 const 必须先声明。词典的 `t` 必须是函数，新增键要补齐全部语言并跑键集测试。
11. 浮层在面板内 absolute 定位，坐标相对根容器，避免 layout containment 导致错误。
12. `RAIL_SPECS` 是动作条权威；配置通过归一化读写。按仓库隔离状态时兼顾工作区、session 与过期请求。
13. package 和 manifest 的版本必须一致，files 列出的产物必须存在。
14. 安装声明只通过包自带的 bundle patch 与 `dsh.profile.bundles`，不在 profile 手写重复 insert。

## 文档与发布

变更和验证结果写入 [CHANGELOG.md](CHANGELOG.md)，格式为 `## vX.Y.Z — YYYY-MM-DD`。下方上游历史保持来源标注，不重写成自身发布记录。

README 使用标题、语言切换、简介的顺序。尚未收录本项目时不挂市场收录徽章；保留的上游截图明确标为上游示例。

本项目尚无自己的远程地址与 npm 发布配置。发布工作流仅手动触发；设置 Trusted Publisher 与发布包名后，发布行为仍需用户明确授权。

DSH 升级时检查平台是否已经导出可复用的完整 diff 组件；可用后优先复用官方组件，避免继续扩展临时 LineDiff。检查主题 alias token 和宿主注册协议是否发生变化。
