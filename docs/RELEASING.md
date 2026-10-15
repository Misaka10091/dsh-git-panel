# 发布流程

项目仓库：<https://github.com/Misaka10091/dsh-git-panel>。npm 包：`@misaka10091/dsh-git-panel`。

首次公开发布为 `0.1.0`。首发前用于本地开发和安装联调的编号记录单独保留，不作为公开版本递增依据。`0.1.1` 已通过 GitHub OIDC 发布，npm `latest` 指向该版本，并已创建 GitHub Release。

## 一次性配置 npm Trusted Publisher

`misaka10091` 必须是你拥有发布权限的 npm 用户或组织 scope；GitHub 用户名不会自动授予同名 npm scope。

手动发布需要 npm 账号启用双因素认证，或使用带 bypass 2FA 权限的 granular access token。本项目的手动首发使用交互式登录和 2FA：在 npm 官网 Account → Two-Factor Authentication → Enable 2FA 添加安全密钥或 passkey（可使用 Windows Hello），并保存 recovery codes。若发布报 `E403 ... Two-factor authentication ... is required`，先完成账号配置并重新 `npm login --auth-type=web`。官方步骤：<https://docs.npmjs.com/configuring-two-factor-authentication/>。

### 首发与暂存状态

npm Trusted Publisher 需要在已有包的 Settings 页面配置。本项目已完成 `0.1.0` 首发，后续由工作流发布，不重复手动发布同一版本。

如果使用 staged publishing，上传成功仅表示提交到暂存区。新包页面出现 **Temporary Holding Version / `0.0.0-stage`** 时，需由维护者在 npm 的 **Staged Packages** 中核对实际版本并点击 **Approve**，完成 2FA 后才会公开。该状态不是等待 registry 同步，也不是等待 npm 人工审批。官方说明：<https://docs.npmjs.com/staged-publishing/>。

可用以下命令确认首发已公开：

```sh
npm view @misaka10091/dsh-git-panel@0.1.0 version --prefer-online --registry=https://registry.npmjs.org
```

### GitHub Actions 连接

在 npm 包的 Settings → Trusted Publisher 中选择 GitHub Actions：

| 字段 | 值 |
|---|---|
| Organization or user | `Misaka10091` |
| Repository | `dsh-git-panel` |
| Workflow filename | `npm-publish.yml`（只填文件名） |
| Environment name | 留空（当前工作流不使用 environment） |
| Allow npm publish | 勾选，允许工作流直接发布 |
| Allow npm dist-tag | 不勾选，当前工作流不单独管理 dist-tag |

`Allow npm publish` 下方的安全建议表示 npm 更推荐暂存后由维护者手动批准。本项目采用标签触发的直接发布，因此授予指定仓库和工作流直接发布权限；`npm stage publish` 权限不等于直接发布权限。

保存后可能显示 **Pending validation**，并给出完成验证的截止时间。需在该期限前由这里指定的工作流真实发布一个尚未公开的版本。已公开的 `0.1.0` 重跑时会跳过相同安装包的 npm 上传，不能完成验证；在本机手动发布或运行 `npm whoami` 也不能验证 GitHub OIDC 权限。`0.1.1` 已通过[首次工作流运行](https://github.com/Misaka10091/dsh-git-panel/actions/runs/38668341322)完成发布，npm provenance 已关联指定仓库、工作流、标签和提交，GitHub Release 附件与 npm 安装包 integrity 一致。设置页的状态可刷新查看，无需再次发布一个版本来验证。

后续工作流使用 GitHub OIDC，无需设置 `NPM_TOKEN`。`id-token: write` 用于 OIDC；`contents: write` 用于创建 Release 和上传附件。工作流使用 GitHub 托管的 Ubuntu runner、Node 24 和 npm 11（npm Trusted Publisher 要求 npm >=11.5.1、Node >=22.14.0）。公开 GitHub 仓库的 Trusted Publisher 发布会自动生成 npm provenance。

官方说明：<https://docs.npmjs.com/trusted-publishers/>。

## 日常发版

当前 `0.1.1` 已发布。下一次例如发布 `0.1.2`，先执行 `npm version 0.1.2 --no-git-tag-version` 同步包和插件清单，再添加对应 changelog；发布前完成检查并提交对应代码。

```sh
npm test
npm run check:syntax
npm pack --dry-run
```

SSR 检查运行 `npm run check:ssr`；可通过 `DSH_HOME` / `DSH_PROFILE` 指定测试 profile，显式 skip 不算通过。本地其他专项检查按项目开发约定执行。

推送标签会立即触发 npm 发布和 GitHub Release。获得本次发版授权后，针对已提交的下一版本 `0.1.2` 执行：

```sh
git tag -a v0.1.2 -m "Release v0.1.2"
git push --atomic origin main v0.1.2
```

标签指向的提交必须包含发布工作流和对应 changelog。首次配置时，工作流需要随代码一起推送到 GitHub；原子推送可同时更新分支和标签。

流程顺序：**标签校验 → 语法检查及测试 → 打包一次 → npm 发布 → GitHub Release + 同一 .tgz 附件**。

标签必须是 `vX.Y.Z` 或 `vX.Y.Z-prerelease`，并与 `package.json` 和 `dsh.plugin.json` 完全一致。没有对应 changelog、包名或仓库地址不正确时，发布会终止。稳定版发布到 npm `latest`；预发布如 `v0.2.0-beta.1` 发布到 `next`，GitHub Release 标为 prerelease，不更新 GitHub Latest。正式版本应递增，避免把较旧版本重新发布为 npm latest。

Release 正文取对应 changelog 段落并附安装命令，不混入首发前开发记录、上游或其他公开版本的记录。

## 失败与重跑

- 测试或 npm 发布失败：后续 GitHub Release 步骤不会执行。
- npm 成功但 Release 失败：修复后重跑失败的 workflow。若 npm 上已有该版本，工作流比较 `dist.integrity` 与当前 tarball；一致时跳过发布，继续补建 Release。
- npm 已有版本但内容不同：终止发布，需要修复并增加版本号。npm 不允许覆盖已发布版本。
- GitHub Release 已存在：补传同一安装包附件。
- 手动恢复：Actions → npm-publish → Run workflow，选择包含当前工作流的分支，并填写已存在的版本标签；checkout 始终读取该标签，而不是所选分支。

本地验证不会调用 npm publish、创建远程标签或创建 GitHub Release。真实 Actions/OIDC 发布需要 npm 侧配置完成并实际运行工作流后才能验证。

## 从旧的本地包迁移

旧的 unscoped `dsh-git-panel` 与 scoped 包是两个 npm 安装身份。迁移时应移除旧 bundle，再安装新包，避免同一 `git-panel` row 重复挂载。若 profile 的用户 patch 里有 `id: git-panel` 并带 `name: dsh-git-panel`，这个 name 是插件名断言；应改为 scoped 包名或移除该断言、保留 config，否则旧断言会导致配置 patch 被跳过。插件动作条与面板配置仍按 `git-panel` 行存储；包名变更本身不要求重置配置，但移除旧 bundle 时要保留需要的用户配置。
