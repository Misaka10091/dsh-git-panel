# dsh-git-panel

[简体中文](README.md) | English

> A Git panel for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), derived from [KannaKuron/dsh-ide-git](https://github.com/KannaKuron/dsh-ide-git). It opens a collapsible repository list similar to VS Code Source Control, with the full Git workbench retained.

Current version: **0.1.1**. Upstream baseline: **dsh-ide-git 0.18.2**, commit `b4e4b5a176de7da9060d1225d9ed027a8df8472c`. See [UPSTREAM.md](UPSTREAM.md) for attribution and update instructions.

## Current state

The fork retains the upstream branch tree, commit graph, changes, staging, commit box, file diffs, commit details, stash, tags, branch and remote operations, AI commit messages and conversation integration.

It supports Better Sidebar, the native DSH right sidebar and the conversation-area Git tab. Repository discovery and selection already cover the workspace repository, nested repositories and initialized submodules.

The default panel is titled **Git**. Each row shows its repository name, branch and changed-file count, with refresh, stage-all and history-workbench actions. Expand it for staged, changed and untracked files and its own commit box. Stage, unstage, commit, commit-and-push, confirmed discard, available undo handles and diff previews target that row's repository.

Drafts, expansion, file selection, busy state and errors belong to individual rows. Folding or visiting the workbench preserves row drafts. Failed commits keep their draft; a successful commit with a failed push clears the committed draft and displays the push error. Discards without a usable undo snapshot explicitly say so. Stale responses cannot overwrite the current workspace or session.

Summary scans share four concurrent slots. Visible lists poll lightweight summaries every 12 seconds; hidden lists stop polling. The host write queue canonicalizes the Git checkout root and physical path, serializing subfolder, filesystem-alias and Windows-case variants of the same checkout. Different repositories and linked worktrees remain independent. `rebaseAbort` now uses the write queue. Binding requests to session workspace scope remains future work.

## Development

Git must be on PATH. Plugin runtime requires Node.js >=18 and DSH >=0.1.6-alpha.2. Node.js 24 is recommended for development and CI because the inherited tests use newer Node APIs. Better Sidebar >=0.12.0 is optional. Both entries are plain JavaScript with no build step; regular tests do not need the DSH peer dependencies installed.

```sh
npm test
npm run check:syntax
npm run check:ssr
npm pack --dry-run
```

The SSR check resolves React from a local DSH profile. It uses `web` by default; set `DSH_HOME` and `DSH_PROFILE` to choose another location. Missing profiles or React produce an explicit skip. For a Windows desktop profile:

```powershell
$env:DSH_PROFILE = 'desktop'
npm run check:ssr
```

## Repository browser verification

`scripts/repositories-probe.mjs` loads the real client with React 19.2 and mocked host/Git services in an isolated Chrome profile. Test dependencies are `playwright-core@1.58.2` and `esbuild@0.25.12` under `.local/browser-fixture/node_modules`, and `react@19.2.0` / `react-dom@19.2.0` under `.local/ssr/profiles/web/node_modules`. These add no plugin runtime dependencies or production build step.

Run `node scripts/repositories-probe.mjs --prepare`, execute its printed esbuild executable command, then run `node scripts/repositories-probe.mjs --full`. Re-prepare and rebuild after source or probe changes. Reports, the isolated browser profile and screenshots at 1440×860, 360×820, 320×640 and 1100×300 are written under ignored `.local/repositories-probe/`.

Full mode covers independent drafts and folding, target roots and busy states, workbench roundtrip, cross-repository diff, failed commit retry, push partial success, discard undo warnings, failed writes interleaved with stale summaries, stale workspace responses and overflow. **This does not validate the real DSH host.** AGENTS.md still requires an installed-plugin test instance with explicit URL and `DSH_CHECKOUT` for integration probes. Installation into the current desktop profile was authorized and completed: live repository discovery and nested-repository summary succeed. The unborn-repository fix is installed and all 58 API/repository tests pass, but the running host still caches the previous module and needs a restart. The isolated browser has no authenticated session for the current GUI, so live page data-state verification remains pending.

## Installation

The npm package is `@misaka10091/dsh-git-panel`. Once its first npm publication is complete:

```sh
dsh plugin --profile desktop add @misaka10091/dsh-git-panel
```

Before publication, pack and install from the project directory:

```sh
npm pack
dsh plugin --profile desktop add file:./misaka10091-dsh-git-panel-0.1.1.tgz
```

Host changes require restarting DSH; client changes require reloading the page. Migration from the unscoped package requires handling the old bundle and any package-name assertions in profile patches while preserving desired configuration. See [release and migration instructions](docs/RELEASING.md).

## Automated releases

Pushing a `vX.Y.Z` tag triggers validation, tests, packing, npm publication, then a GitHub Release with the same `.tgz` attached. Prereleases use npm `next` and GitHub Pre-release. Manual dispatch accepts an existing version tag to recover a failed release. First publication and npm Trusted Publisher setup are documented in [release instructions](docs/RELEASING.md).

## Identity

The npm package, Cordis module specifier, client ModuleLoader ID and bundle settings key are `@misaka10091/dsh-git-panel`. Host/client plugin export names and the locale namespace remain `dsh-git-panel`; the manifest ID is `dsh-external/dsh-git-panel`. The Cordis row and config namespace are `git-panel`, the API prefix is `/dsh-git-panel/api`, and the Better Sidebar tab is `dsh-git-panel:panel`.

Native main and preview IDs are `dsh-git-panel` and `dsh-git-panel-preview`; the conversation view ID is `git-panel`. Browser storage uses `dsh-git-panel.*`, and CSS/DOM classes use `dgp-`. These identities are separate from the upstream plugin.

## Next development steps

1. Verify installation, registration, themes and host integration in an authorized isolated DSH instance.
2. Bind requests to session workspace scope and extend consistent path identity to undo storage.
3. Support VS Code repository scan settings and improve summary/statistics loading for large workspaces.
4. Retain the graph, diff and detailed workbench while improving source organization.

## Project files

Host API lives in `src/index.js`; the client UI and styles live in `src/client.js`. Tests cover smoke checks, real-repository API operations, graph layout and discovery. Scripts provide SSR checks, demo fixtures, the isolated repository-list probe and host integration probes that require a test instance with this fork installed.

Screenshots in `docs/screenshots/` are preserved upstream examples, not newly verified screenshots of this fork. See [AGENTS.md](AGENTS.md) for development rules and [CHANGELOG.md](CHANGELOG.md) for project changes and retained upstream history.

## License

[MIT](LICENSE), retaining `Copyright (c) 2026 KannaKuron`. The repository is [Misaka10091/dsh-git-panel](https://github.com/Misaka10091/dsh-git-panel) and the npm package is `@misaka10091/dsh-git-panel`. Upstream marketplace inclusion and publication credentials do not transfer to this fork.
