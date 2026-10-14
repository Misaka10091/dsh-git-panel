# 上游来源 / Upstream provenance

`dsh-git-panel` 基于以下 MIT 开源项目二开：

- 原项目：[KannaKuron/dsh-ide-git](https://github.com/KannaKuron/dsh-ide-git)
- 基线版本：`0.18.2`
- 基线提交：[`b4e4b5a176de7da9060d1225d9ed027a8df8472c`](https://github.com/KannaKuron/dsh-ide-git/tree/b4e4b5a176de7da9060d1225d9ed027a8df8472c)
- 原版权声明：`Copyright (c) 2026 KannaKuron`
- 许可证：[MIT](LICENSE)，保留原文。

初始项目保留上游代码、测试、探针脚本、图标和演示截图。CHANGELOG 中的上游章节仅记录原项目历史，不代表本项目发布过那些版本。两份 README、开发规则和运行时标识已按本项目更新；本项目没有继承上游 GitHub、npm、Trusted Publisher 或插件市场身份。

## 当前差异

- 独立包名 `dsh-git-panel`，项目版本从 `0.1.0` 开始。
- 包、manifest、host/client、路由、loader/config、locale、tab、storage 和样式标识独立。
- 测试与浏览器探针同步使用本项目标识，探针环境变量使用 `DGP_PROBE_*`；真实宿主集成探针必须显式设置 `DSH_CHECKOUT`，不再默认上游作者的机器路径。
- SSR 脚本支持 `DSH_PROFILE`，并使用可跨平台的 file URL。
- CI 保留测试；发布工作流改为仅手动触发，尚未配置本项目的发布目标。
- 默认可折叠仓库列表、逐仓库摘要/选择/草稿/动作状态及错误恢复；保留现有历史工作台和 diff 交接。新增隔离浏览器探针验证真实客户端与模拟 API，尚未进行真实 DSH 安装联调。
- 写队列按 Git checkout 与物理路径统一身份，补齐 `rebaseAbort`，保留 linked worktree 独立性；Git 可执行文件覆盖变量改为 `DSH_GIT_PANEL_BIN`。工作区范围绑定仍待完善。

## 同步上游

本地 Git 远程 `upstream` 指向原项目。初始化保留了基线提交的浅历史；需要完整历史时可执行：

```sh
git fetch --unshallow upstream
```

日常检查上游更新：

```sh
git fetch upstream
git log --oneline HEAD..upstream/main
```

引入更新时逐项审查运行时标识、注册协议、Git 写操作和文档归属。合并后保留本项目命名，更新这里与 package metadata 中的基线记录，运行测试和 SSR；UI 数据态修改需要浏览器探针验证。

本项目自己的远程仓库尚未创建，因此没有设置 `origin`。后续确定仓库地址后，再添加 `origin` 并补齐 package 的 repository/homepage/bugs 字段。
