/**
 * Standalone DOM probe for the repository-list UI. Does not start a server or
 * install a DSH plugin. Only generated files below this project's .local are
 * written. The browser uses the REAL src/client.js and mocked host services.
 *
 * Prepare only (safe before the repository UI exists):
 *   node scripts/repositories-probe.mjs --prepare
 * Run the printed esbuild executable command directly from PowerShell, then:
 *   node scripts/repositories-probe.mjs --smoke
 *   node scripts/repositories-probe.mjs --full
 *
 * Dependencies, outside package.json:
 *   .local/browser-fixture/node_modules: playwright-core 1.58.2, esbuild 0.25.12
 *   .local/ssr/profiles/web/node_modules: react/react-dom 19.2.0
 * No browser download: uses DGP_PROBE_BROWSER or installed Chrome / Edge.
 *
 * esbuild's JS API is deliberately NOT used. If a sandbox rejects the browser
 * launch with EPERM, the parent must handle the exact denied invocation; this
 * file does not retry, change transports, or work around the pipe restriction.
 *
 * Exports let integration callers replace selectors, fixtures and assertions.
 * Neither --prepare nor importing this module launches a browser. Runtime
 * assertions are deliberately strict: missing repository UI is a failure.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const DEFAULT_OUTPUT = join(PROJECT_ROOT, '.local', 'repositories-probe')
export const DEFAULT_DRIVER_ROOT = join(PROJECT_ROOT, '.local', 'browser-fixture')
export const DEFAULT_REACT_MODULES = join(PROJECT_ROOT, '.local', 'ssr', 'profiles', 'web', 'node_modules')
export const SELECTORS = Object.freeze({
  list: '.dgp-repositories',
  row: '.dgp-repository[data-repo-root]',
  toggle: '.dgp-repository-toggle',
  branch: '.dgp-repository-branch',
  count: '.dgp-repository-count',
  refresh: '[data-action="refresh"]',
  stageAll: '[data-action="stage-all"]',
  workbench: '[data-action="workbench"]',
  changes: '.dgp-changes',
  message: '.dgp-commit-box textarea, .dgp-commit-box input:not([type="checkbox"])',
  commit: '.dgp-commit-box button.dgp-btn-primary',
  commitAndPush: '.dgp-commit-actions > button:not(.dgp-btn-primary)',
  backToRepositories: '[data-action="repositories"]',
  file: '.dgp-row-file',
  miniStage: 'button.dgp-mini[title="Stage"]',
  miniDiscard: 'button.dgp-mini[title="Discard changes"]',
  menuItem: '.dgp-menu-item',
  confirm: '.dgp-dialog-actions button.dgp-btn-danger',
  alert: '.dgp-banner[role="alert"]',
})

const clone = (value) => JSON.parse(JSON.stringify(value))
const changeCount = (repo) => new Set(['staged', 'unstaged', 'untracked', 'conflicted'].flatMap((key) => repo.changes[key].map((item) => item.path))).size
const hash = (index) => String(index).padStart(40, '0')

/** Pure data: roots are virtual API identities and are never filesystem paths. */
export function createRepositoryFixture({ repoCount = 3 } = {}) {
  assert.ok(repoCount === 2 || repoCount === 3, 'Use two or three repositories')
  const item = (path, status = ' M') => ({ path, index: status[0], worktree: status[1], additions: 2, deletions: 1, binary: false })
  const repo = (cwd, name, branch, index, staged, unstaged, untracked) => ({
    cwd, name, root: cwd + '/' + name, kind: 'nested', branch,
    detached: false, upstream: 'origin/' + branch, ahead: index, behind: index % 2,
    hash: hash(index + 1), stashCount: 0, operation: null, worktrees: [],
    changes: { staged, unstaged, untracked, conflicted: [], ignored: [], ignoredTruncated: false },
  })
  const a = '/probe/workspaces/alpha'
  const b = '/probe/workspaces/beta'
  const initial = [
    repo(a, 'app', 'main', 1, [item('app-staged.txt', 'M ')], [item('app-edited.txt')], [item('app-new.txt', '??'), item('app-previous-discard.txt', '??')]),
    repo(a, 'lib', 'feature/library', 2, [], [item('library-edited.txt')], [item('library-new.txt', '??')]),
    repo(a, 'repository-with-a-deliberately-long-name', 'feature/long-branch-for-width-regression', 3, [], [item('nested/a-very-long-directory-name/a-file-name-that-must-be-truncated.txt')], []),
  ].slice(0, repoCount)
  // Same display names in another workspace expose incorrect name-only keys.
  const next = [
    repo(b, 'app', 'beta/main', 4, [item('beta-app-staged.txt', 'M ')], [], []),
    repo(b, 'lib', 'beta/release', 5, [], [item('beta-library-edited.txt')], []),
  ]
  return { initialWorkspace: a, nextWorkspace: b, workspaces: { [a]: initial, [b]: next } }
}

function outputPath(value = DEFAULT_OUTPUT) {
  const target = resolve(PROJECT_ROOT, value)
  const rel = relative(join(PROJECT_ROOT, '.local'), target)
  assert.ok(rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../') && !isAbsolute(rel), 'Probe output must stay under this project\'s .local directory')
  return target
}

/**
 * This entire function is serialized into the browser entry. Keep it free of
 * Node imports and outer-scope references. It is also exported for adjustment.
 */
export function installBrowserFixture(React, createRoot, config) {
  const copy = (value) => JSON.parse(JSON.stringify(value))
  const fixture = copy(config.fixture)
  const repositories = new Map(Object.values(fixture.workspaces).flat().map((repo) => [repo.root, repo]))
  const requests = []
  const unknownRequests = []
  const failures = []
  const responsePatches = []
  const gates = []
  const cleanup = []
  const serviceCalls = []
  const autoRefreshCallbacks = new Map()
  const nativeSetInterval = window.setInterval.bind(window)
  const nativeClearInterval = window.clearInterval.bind(window)
  window.setInterval = (callback, delay, ...args) => {
    const id = nativeSetInterval(callback, delay, ...args)
    if (delay === 12000) autoRefreshCallbacks.set(id, () => callback(...args))
    return id
  }
  window.clearInterval = (id) => { autoRefreshCallbacks.delete(id); nativeClearInterval(id) }
  let serial = 0
  let inFlight = 0
  let descriptor = null
  let reactRoot = null
  let scope = { cwd: fixture.initialWorkspace, sessionId: 'repositories-probe' }
  const match = (rule, record) => Object.entries(rule).every(([key, value]) => (key === 'method' ? record.method : record.payload[key]) === value)
  const entryHash = (index) => String(index).padStart(40, '0')
  const pickRepo = (record) => {
    const repo = repositories.get(record.payload.repoRoot)
    if (!repo) throw new Error('Explicit repoRoot is required for ' + record.method + ': ' + JSON.stringify(record.payload))
    if (record.payload.cwd !== undefined && record.payload.cwd !== repo.cwd && record.payload.cwd !== repo.root) {
      throw new Error('repoRoot does not belong to requested cwd: ' + JSON.stringify(record.payload))
    }
    return repo
  }
  const statRows = (items) => items.map((item) => [item.path, item.additions, item.deletions, item.binary])
  const respond = (record) => {
    const payload = record.payload
    if (record.method === 'repos') {
      const entries = fixture.workspaces[payload.cwd]
      if (!entries) throw new Error('Unknown probe workspace: ' + payload.cwd)
      return { cwd: payload.cwd, isRepo: false, repos: entries.map((repo) => ({ path: repo.root, name: repo.name, kind: repo.kind })) }
    }
    if (record.method === 'gitLogs') return { entries: [] }
    if (record.method === 'commit-models') return { models: [] }
    if (record.method === 'commit-efforts') return { efforts: [] }
    const repo = pickRepo(record)
    if (record.method === 'summary') return {
      repoRoot: repo.root, cwd: repo.cwd, branch: repo.branch, detached: repo.detached,
      upstream: repo.upstream, ahead: repo.ahead, behind: repo.behind,
      changes: Object.fromEntries(Object.entries(repo.changes).map(([key, items]) => [key, Array.isArray(items) ? items.map((item) => payload.stats === false ? { ...item, additions: 0, deletions: 0, binary: false } : copy(item)) : items])), statsDeferred: payload.stats === false,
      stashCount: repo.stashCount, operation: repo.operation, worktrees: repo.worktrees,
    }
    if (record.method === 'stats') return { staged: statRows(repo.changes.staged), unstaged: statRows(repo.changes.unstaged) }
    if (record.method === 'branches') return {
      repoRoot: repo.root, branch: repo.branch,
      local: [{ name: repo.branch, hash: repo.hash, shortHash: repo.hash.slice(0, 8), head: true, upstream: repo.upstream, date: '2026-10-13T12:00:00Z', subject: 'Probe baseline', worktree: null }],
      remote: [], tags: [], remotes: copy(repo.remotes || []), worktrees: [],
    }
    if (record.method === 'commitDetail') return { hash: payload.hash, shortHash: payload.hash.slice(0, 8), author: 'Probe', date: '2026-10-13T12:00:00Z', subject: 'Probe detail', body: '', files: [] }
    if (record.method === 'log') return { commits: [{ hash: repo.hash, shortHash: repo.hash.slice(0, 8), parents: [], author: 'Probe', email: 'probe@example.invalid', date: '2026-10-13T12:00:00Z', subject: 'Baseline in ' + repo.name, refs: [repo.branch] }], hasMore: false }
    if (record.method === 'stage' || record.method === 'unstage') {
      if (!Array.isArray(payload.paths) || payload.paths.length === 0) throw new Error('Expected nonempty paths for ' + record.method)
      const all = payload.paths.includes('.') || payload.paths.includes('*')
      const selected = (item) => all || payload.paths.includes(item.path)
      const sources = record.method === 'stage' ? ['unstaged', 'untracked'] : ['staged']
      const destination = record.method === 'stage' ? 'staged' : 'unstaged'
      for (const source of sources) {
        const picked = repo.changes[source].filter(selected)
        repo.changes[source] = repo.changes[source].filter((item) => !selected(item))
        for (const item of picked) {
          if (!repo.changes[destination].some((other) => other.path === item.path)) {
            const moved = copy(item)
            moved.index = destination === 'staged' ? (item.index === '?' ? 'A' : 'M') : ' '
            moved.worktree = destination === 'staged' ? ' ' : 'M'
            repo.changes[destination].push(moved)
          }
        }
      }
      return { paths: payload.paths, staged: record.method === 'stage' }
    }
    if (record.method === 'commit') {
      if (typeof payload.message !== 'string' || payload.message.trim() === '') throw new Error('Commit message is required')
      if (repo.changes.staged.length === 0 && payload.amend !== true) throw new Error('Nothing staged in targeted repository')
      repo.changes.staged = []
      repo.hash = entryHash(100 + record.id)
      return { hash: repo.hash, output: 'Probe commit' }
    }
    if (record.method === 'discard') {
      if (payload.confirm !== true || !Array.isArray(payload.paths) || payload.paths.length === 0 || payload.paths.some((path) => path === '.' || path === '*')) throw new Error('Discard requires confirmation and explicit file paths')
      const source = payload.untracked === true ? 'untracked' : 'unstaged'
      repo.changes[source] = repo.changes[source].filter((item) => !payload.paths.includes(item.path))
      // The probe intentionally supplies no snapshot or undo handle.
      return { discarded: payload.paths.length, untracked: payload.untracked === true, undoBlocked: true }
    }
    if (record.method === 'fetch') return { output: '', fetched: true }
    if (record.method === 'diff') return { patch: 'diff --git a/' + payload.path + ' b/' + payload.path + '\n--- a/' + payload.path + '\n+++ b/' + payload.path + '\n@@ -1 +1 @@\n-before\n+after\n' }
    throw new Error('Unmocked Git API method: ' + record.method)
  }
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, document.baseURI)
    const method = /\/dsh-git-panel\/api\/([^/]+)$/.exec(url.pathname)?.[1]
    const record = { id: ++serial, method: method || 'unrecognized-url', url: url.href, payload: {}, state: 'received' }
    requests.push(record)
    inFlight += 1
    try {
      record.payload = typeof init.body === 'string' ? JSON.parse(init.body) : {}
      if (!method || init.method !== 'POST') throw new Error('Unexpected fetch: ' + url.href)
      const failure = failures.findIndex((item) => match(item.rule, record))
      let body
      if (failure >= 0) body = { ok: false, error: { code: 'probe-injected-error', message: failures.splice(failure, 1)[0].message } }
      else {
        try {
          const data = copy(respond(record))
          const patch = responsePatches.findIndex((item) => match(item.rule, record))
          if (patch >= 0) Object.assign(data, responsePatches.splice(patch, 1)[0].data)
          body = { ok: true, data }
        }
        catch (error) {
          unknownRequests.push({ ...copy(record), error: error.message })
          body = { ok: false, error: { code: 'probe-contract-error', message: error.message } }
        }
      }
      // Capture the response NOW, then delay delivery. Do not regenerate it
      // after a workspace switch. AbortSignal is intentionally ignored so even
      // a transport which delivers late must not overwrite the new workspace.
      const gate = gates.find((item) => !item.released && item.pending.length < item.limit && match(item.rule, record))
      if (gate) {
        record.gate = gate.id
        gate.pending.push(record.id)
        await new Promise((resolve) => gate.resolvers.push(resolve))
      }
      record.state = 'done'
      record.ok = body.ok
      record.response = copy(body)
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    } finally { inFlight -= 1 }
  }
  const registerTab = (spec) => { descriptor = spec; return () => {} }
  const services = {
    betterSidebar: {
      registerTab,
      openTab: (...args) => { serviceCalls.push({ method: 'openTab', args: copy(args) }); return 'probe-preview' },
    },
    locale: { getSnapshot: () => ({ active: 'en' }), register: () => () => {}, subscribe: () => () => {} },
  }
  const ctx = {
    registerTab,
    get: (name) => services[name],
    effect: (callback) => { const dispose = callback(); if (typeof dispose === 'function') cleanup.push(dispose); return dispose },
    inject: (names, callback) => {
      if (names.every((name) => services[name] !== undefined)) callback(ctx)
      return { dispose: async () => {} }
    },
  }
  const render = () => reactRoot.render(React.createElement(descriptor.component, {
    ctx, store: {}, scope: { ...scope }, visible: true,
    tab: { id: descriptor.id, type: descriptor.id, title: 'Git' },
  }))
  window.__repositoriesProbe = {
    requests, unknownRequests, serviceCalls,
    get inFlight() { return inFlight },
    fixture,
    mountPlugin(spec) {
      if (!spec || typeof spec.factory !== 'function') throw new Error('Real client did not register its module')
      const plugin = spec.factory((name) => {
        if (name === 'react') return React
        throw new Error('Unexpected browser dependency: ' + name)
      })
      plugin.apply(ctx)
      if (!descriptor || typeof descriptor.component !== 'function') throw new Error('No Better Sidebar tab registered')
      reactRoot = createRoot(document.getElementById('probe-root'))
      render()
      return { moduleId: spec.id, tabId: descriptor.id }
    },
    // Re-render the SAME component/root. A forced remount would mask stale
    // state and missing effect dependencies during the workspace switch test.
    setScope(next) { scope = { ...scope, ...next }; render() },
    hold(rule, { limit = Number.MAX_SAFE_INTEGER } = {}) {
      const gate = { id: gates.length + 1, rule: copy(rule), limit, pending: [], resolvers: [], released: false }
      gates.push(gate)
      return gate.id
    },
    gate(id) { const gate = gates.find((item) => item.id === id); return gate ? { id, pending: [...gate.pending], released: gate.released } : null },
    release(id) {
      const gate = gates.find((item) => item.id === id)
      if (!gate) throw new Error('Unknown request gate: ' + id)
      gate.released = true
      for (const resolve of gate.resolvers.splice(0)) resolve()
    },
    failNext(rule, message) { failures.push({ rule: copy(rule), message }) },
    respondNext(rule, data) { responsePatches.push({ rule: copy(rule), data: copy(data) }) },
    setBranch(root, branch) { const repo = repositories.get(root); if (!repo) throw new Error('Unknown root: ' + root); repo.branch = branch },
    setRemotes(root, remotes) { const repo = repositories.get(root); if (!repo) throw new Error('Unknown root: ' + root); repo.remotes = copy(remotes) },
    tickAutoRefresh() { for (const callback of [...autoRefreshCallbacks.values()]) callback() },
    snapshot() { return { scope: copy(scope), repos: copy([...repositories.values()]), requests: copy(requests), unknownRequests: copy(unknownRequests), inFlight } },
    dispose() {
      for (const gate of gates) if (!gate.released) this.release(gate.id)
      if (reactRoot) reactRoot.unmount()
      for (const dispose of cleanup.reverse()) dispose()
    },
  }
}

const FIXTURE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Git repositories probe</title><link rel="icon" href="data:,"><style>
:root{font-family:system-ui,sans-serif;color:#e5e7eb;background:#16191f;color-scheme:dark;
--dsw-alias-label-primary:#e5e7eb;--dsw-alias-label-secondary:#aeb6c5;--dsw-alias-label-tertiary:#7f899a;
--dsw-alias-bg-base:#16191f;--dsw-alias-bg-l1:#1c2029;--dsw-alias-bg-l2:#232936;
--dsw-alias-border-l1:#2c3340;--dsw-alias-border-l2:#353f50;--dsw-alias-border-l3:#46536a;
--dsw-alias-brand-primary:#8faeff;--dsw-alias-interactive-bg-hover:#2b3343;--dsw-alias-interactive-bg-active:#364665;
--dsw-alias-state-success-primary:#8bd5ac;--dsw-alias-state-error-primary:#f28b9e;--dsw-alias-state-warn-primary:#efc778}
html,body{margin:0;width:100%;height:100%;}#probe-root{width:100%;height:100%;display:flex;flex-direction:column;min-width:0;min-height:0}
</style></head><body><div id="probe-root"></div><script src="/fixture.bundle.js"></script></body></html>`

/** Writes an entry only; the caller invokes the real esbuild binary directly. */
export function prepareFixture({ out = DEFAULT_OUTPUT, reactModules = DEFAULT_REACT_MODULES, driverRoot = DEFAULT_DRIVER_ROOT } = {}) {
  const directory = outputPath(out)
  const react = join(resolve(reactModules), 'react', 'index.js')
  const dom = join(resolve(reactModules), 'react-dom', 'client.js')
  assert.ok(existsSync(react) && existsSync(dom), 'React and react-dom are missing from ' + reactModules)
  mkdirSync(directory, { recursive: true })
  const entry = join(directory, 'fixture-entry.mjs')
  const bundle = join(directory, 'fixture.bundle.js')
  const importPath = (path) => JSON.stringify(path.replaceAll('\\', '/'))
  writeFileSync(entry, 'import * as React from ' + importPath(react) + '\nimport { createRoot } from ' + importPath(dom) + '\n(' + installBrowserFixture.toString() + ')(React, createRoot, window.__repositoriesProbeConfig)\n', 'utf8')
  const binary = join(resolve(driverRoot), 'node_modules', '@esbuild', process.platform + '-' + process.arch, ...(process.platform === 'win32' ? ['esbuild.exe'] : ['bin', 'esbuild']))
  assert.ok(existsSync(binary), 'Install esbuild with ignore-scripts in ' + driverRoot + ' first')
  const quote = (value) => "'" + value.replaceAll("'", "''") + "'"
  const command = '& ' + quote(binary) + ' ' + quote(entry) + ' --bundle --platform=browser --format=iife --target=chrome120 ' + quote('--outfile=' + bundle)
  return { entry, bundle, binary, command }
}

export function findBrowser(explicit = process.env.DGP_PROBE_BROWSER) {
  const candidates = explicit ? [explicit] : [
    join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium',
  ]
  const executable = candidates.find((path) => existsSync(path))
  assert.ok(executable, 'No installed Chrome / Edge found; set DGP_PROBE_BROWSER. No browser is downloaded automatically.')
  return executable
}

const rowSelector = (selectors, root) => selectors.row + '[data-repo-root=' + JSON.stringify(root) + ']'
const rowLocator = (page, selectors, root) => page.locator(rowSelector(selectors, root))
const uiTurn = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

export async function waitForRepositoryRows(page, fixture, cwd, selectors = SELECTORS) {
  const expected = fixture.workspaces[cwd]
  await page.waitForFunction(({ list, row, roots }) => {
    const host = document.querySelector(list)
    return host && host.querySelectorAll(row).length === roots.length && roots.every((root) => Array.from(host.querySelectorAll(row)).some((element) => element.getAttribute('data-repo-root') === root))
  }, { list: selectors.list, row: selectors.row, roots: expected.map((repo) => repo.root) })
  for (const repo of expected) {
    const row = rowLocator(page, selectors, repo.root)
    await page.waitForFunction(({ row, branch, expected }) => document.querySelector(row)?.querySelector(branch)?.textContent.includes(expected), { row: rowSelector(selectors, repo.root), branch: selectors.branch, expected: repo.branch })
    const count = await row.locator(selectors.count).textContent()
    assert.equal(Number((count || '').match(/\d+/)?.[0]), changeCount(repo), 'Change count for ' + repo.root)
    for (const action of ['refresh', 'stageAll', 'workbench']) assert.equal(await row.locator(selectors[action]).count(), 1, 'Row toolbar action ' + action + ': ' + repo.root)
  }
}

async function setExpanded(page, selectors, root, value) {
  const row = rowLocator(page, selectors, root)
  const toggle = row.locator(selectors.toggle)
  assert.equal(await toggle.count(), 1, 'Exactly one accessible toggle per row')
  const current = await toggle.getAttribute('aria-expanded')
  assert.ok(current === 'true' || current === 'false', 'Repository toggle needs aria-expanded')
  if (current !== String(value)) await toggle.click()
  await page.waitForFunction(({ row, toggle, value }) => document.querySelector(row)?.querySelector(toggle)?.getAttribute('aria-expanded') === value, { row: rowSelector(selectors, root), toggle: selectors.toggle, value: String(value) })
  if (value) await row.locator(selectors.message).first().waitFor({ state: 'visible' })
}

/** Real DOM smoke: identity, metadata, controls, expansion and separate drafts. */
export async function verifyRepositorySmoke(page, fixture, selectors = SELECTORS, { draftRetention = true } = {}) {
  await waitForRepositoryRows(page, fixture, fixture.initialWorkspace, selectors)
  const [a, b] = fixture.workspaces[fixture.initialWorkspace]
  await setExpanded(page, selectors, a.root, true)
  await setExpanded(page, selectors, b.root, true)
  assert.equal(await rowLocator(page, selectors, a.root).locator(selectors.toggle).getAttribute('aria-expanded'), 'true', 'Opening B must preserve A expansion')
  const drafts = { [a.root]: 'Draft for alpha app', [b.root]: 'Draft for alpha library' }
  for (const repo of [a, b]) {
    assert.ok(await rowLocator(page, selectors, repo.root).locator(selectors.changes).count() >= 1, 'Expanded row mounts ChangesPanel')
    await rowLocator(page, selectors, repo.root).locator(selectors.message).first().fill(drafts[repo.root])
  }
  assert.equal(await rowLocator(page, selectors, a.root).locator(selectors.message).first().inputValue(), drafts[a.root], 'B typing must not overwrite A draft')
  await setExpanded(page, selectors, a.root, false)
  assert.equal(await rowLocator(page, selectors, b.root).locator(selectors.toggle).getAttribute('aria-expanded'), 'true', 'Closing A must preserve B expansion')
  assert.equal(await rowLocator(page, selectors, b.root).locator(selectors.message).first().inputValue(), drafts[b.root], 'Closing A must preserve B draft')
  await setExpanded(page, selectors, a.root, true)
  if (draftRetention) assert.equal(await rowLocator(page, selectors, a.root).locator(selectors.message).first().inputValue(), drafts[a.root], 'A draft survives collapse/reopen')
  else await rowLocator(page, selectors, a.root).locator(selectors.message).first().fill(drafts[a.root])
  return { drafts, checkedRoots: [a.root, b.root], draftRetention }
}

async function waitForRequest(page, cursor, method, root) {
  await page.waitForFunction(({ cursor, method, root }) => window.__repositoriesProbe.requests.some((record) => record.id > cursor && record.method === method && record.payload.repoRoot === root && record.state === 'done'), { cursor, method, root })
  await uiTurn(page)
  return page.evaluate(({ cursor, method, root }) => window.__repositoriesProbe.requests.find((record) => record.id > cursor && record.method === method && record.payload.repoRoot === root), { cursor, method, root })
}

/** Writes are mocked but actual click handlers and serialized payloads are real. */
export async function verifyRepositoryActions(page, fixture, smoke, selectors = SELECTORS) {
  const [a, b] = fixture.workspaces[fixture.initialWorkspace]
  const before = await page.evaluate(() => window.__repositoriesProbe.snapshot())
  let cursor = await page.evaluate(() => window.__repositoriesProbe.requests.at(-1)?.id || 0)
  const stageGate = await page.evaluate((root) => window.__repositoriesProbe.hold({ method: 'stage', repoRoot: root }), b.root)
  await rowLocator(page, selectors, b.root).locator(selectors.stageAll).click()
  await page.waitForFunction((id) => window.__repositoriesProbe.gate(id).pending.length > 0, stageGate)
  await uiTurn(page)
  assert.equal(await rowLocator(page, selectors, a.root).locator(selectors.commit).first().isEnabled(), true, 'B busy state must not disable A commit')
  assert.equal(await rowLocator(page, selectors, b.root).locator(selectors.commit).first().isDisabled(), true, 'B commit is disabled while B action is pending')
  await page.evaluate((id) => window.__repositoriesProbe.release(id), stageGate)
  const stage = await waitForRequest(page, cursor, 'stage', b.root)
  await waitForRequest(page, stage.id, 'summary', b.root)
  assert.equal(stage.ok, true, 'Stage-all fixture response succeeded')
  const afterStage = await page.evaluate(() => window.__repositoriesProbe.snapshot())
  assert.deepEqual(afterStage.repos.find((repo) => repo.root === a.root).changes, before.repos.find((repo) => repo.root === a.root).changes, 'Staging B must not change A')
  assert.equal(afterStage.repos.find((repo) => repo.root === b.root).changes.staged.length, changeCount(b), 'B stage-all moves all B paths')
  assert.equal(afterStage.requests.filter((record) => record.id > cursor && record.method === 'stage').every((record) => record.payload.repoRoot === b.root), true, 'Every stage target belongs to B')
  assert.equal(await rowLocator(page, selectors, a.root).locator(selectors.message).first().inputValue(), smoke.drafts[a.root], 'Staging B must preserve A message')
  cursor = await page.evaluate(() => window.__repositoriesProbe.requests.at(-1)?.id || 0)
  await rowLocator(page, selectors, a.root).locator(selectors.commit).first().click()
  const commit = await waitForRequest(page, cursor, 'commit', a.root)
  await waitForRequest(page, commit.id, 'summary', a.root)
  assert.equal(commit.ok, true, 'Commit fixture response succeeded')
  assert.equal(commit.payload.message, smoke.drafts[a.root], 'A commit uses A draft')
  const afterCommit = await page.evaluate(() => window.__repositoriesProbe.snapshot())
  assert.deepEqual(afterCommit.repos.find((repo) => repo.root === b.root).changes, afterStage.repos.find((repo) => repo.root === b.root).changes, 'Committing A must not change B')
  assert.equal(await rowLocator(page, selectors, b.root).locator(selectors.message).first().inputValue(), smoke.drafts[b.root], 'Committing A must preserve B message')
  assert.equal(afterCommit.requests.filter((record) => record.id > cursor && record.method === 'commit').every((record) => record.payload.repoRoot === a.root), true, 'Every commit target belongs to A')
  const errorMessage = 'probe-alpha-refresh-error'
  await page.evaluate(({ root, message }) => window.__repositoriesProbe.failNext({ method: 'summary', repoRoot: root }, message), { root: a.root, message: errorMessage })
  cursor = await page.evaluate(() => window.__repositoriesProbe.requests.at(-1)?.id || 0)
  await rowLocator(page, selectors, a.root).locator(selectors.refresh).click()
  await waitForRequest(page, cursor, 'summary', a.root)
  await page.waitForFunction(({ row, message }) => document.querySelector(row)?.textContent.includes(message), { row: rowSelector(selectors, a.root), message: errorMessage })
  assert.equal((await rowLocator(page, selectors, b.root).textContent()).includes(errorMessage), false, 'A error must not appear inside B')
  return { stagePayload: stage.payload, commitPayload: commit.payload, rowError: errorMessage }
}

const fileLocator = (page, selectors, root, path) => rowLocator(page, selectors, root).locator(selectors.file + '[title=' + JSON.stringify(path) + ']')
const requestCursor = (page) => page.evaluate(() => window.__repositoriesProbe.requests.at(-1)?.id || 0)

async function waitForRowIdle(page, selectors, root) {
  await page.waitForFunction((row) => document.querySelector(row)?.getAttribute('aria-busy') === 'false', rowSelector(selectors, root))
  await uiTurn(page)
}

async function waitForRowAlert(page, selectors, root, message) {
  await page.waitForFunction(({ row, alert, message }) => document.querySelector(row)?.querySelector(alert)?.textContent.includes(message), { row: rowSelector(selectors, root), alert: selectors.alert, message })
}

async function refreshRow(page, selectors, root) {
  assert.equal(await rowLocator(page, selectors, root).locator(selectors.refresh).isEnabled(), true, 'Row refresh must be available')
  const cursor = await requestCursor(page)
  await rowLocator(page, selectors, root).locator(selectors.refresh).click()
  const scan = await waitForRequest(page, cursor, 'summary', root)
  assert.equal(scan.ok, true, 'Recovery scan succeeds')
  await waitForRowIdle(page, selectors, root)
  return scan
}

/** Navigation must preserve mounted row drafts; diff must use the clicked root. */
export async function verifyRepositoryNavigation(page, fixture, smoke, selectors = SELECTORS) {
  const [a, b] = fixture.workspaces[fixture.initialWorkspace]
  const cursor = await requestCursor(page)
  await rowLocator(page, selectors, a.root).locator(selectors.workbench).click()
  await page.locator(selectors.backToRepositories).waitFor({ state: 'visible' })
  assert.equal(await page.locator(selectors.list).isVisible(), false, 'Workbench hides the repository list')
  const summary = await waitForRequest(page, cursor, 'summary', a.root)
  assert.equal(summary.ok, true, 'Workbench reads the selected repository')
  await page.locator(selectors.backToRepositories).click()
  await page.locator(selectors.list).waitFor({ state: 'visible' })
  for (const repo of [a, b]) {
    assert.equal(await rowLocator(page, selectors, repo.root).locator(selectors.toggle).getAttribute('aria-expanded'), 'true', 'Workbench roundtrip preserves expansion')
    assert.equal(await rowLocator(page, selectors, repo.root).locator(selectors.message).first().inputValue(), smoke.drafts[repo.root], 'Workbench roundtrip preserves each draft')
  }
  // A is the selected workbench root; B's diff must carry B explicitly.
  const path = b.changes.unstaged[0].path
  const serviceCursor = await page.evaluate(() => window.__repositoriesProbe.serviceCalls.length)
  await fileLocator(page, selectors, b.root, path).click({ button: 'right' })
  await page.locator(selectors.menuItem).filter({ hasText: /^Show diff$/ }).click()
  await page.waitForFunction((cursor) => window.__repositoriesProbe.serviceCalls.slice(cursor).some((call) => call.method === 'openTab' && call.args[0]?.type === 'diff'), serviceCursor)
  const call = await page.evaluate((cursor) => window.__repositoriesProbe.serviceCalls.slice(cursor).find((call) => call.method === 'openTab' && call.args[0]?.type === 'diff'), serviceCursor)
  assert.equal(call.args[0].diff.repoRoot, b.root, 'B diff uses B root while workbench selection is A')
  assert.equal(call.args[0].diff.worktree, b.root, 'External diff worktree also uses B root')
  assert.equal(call.args[0].diff.path, path, 'Diff uses the clicked file')
  assert.equal(call.args[0].diff.staged, false, 'Working tree diff is not staged')
  assert.equal(call.args[1].cwd, fixture.initialWorkspace, 'Diff handoff includes the workspace')
  assert.equal(await rowLocator(page, selectors, b.root).locator(selectors.message).first().inputValue(), smoke.drafts[b.root], 'Opening a diff preserves B draft')
  return { workbenchRoot: a.root, diffHandoff: call.args }
}

/** Run after basic actions: B has staged files; A has unstaged/untracked files. */
export async function verifyRepositoryErrorPaths(page, fixture, selectors = SELECTORS) {
  const [a, b] = fixture.workspaces[fixture.initialWorkspace]
  const rowA = rowLocator(page, selectors, a.root)
  const rowB = rowLocator(page, selectors, b.root)
  const commitError = 'probe-commit-failed-draft-must-survive'
  const failedDraft = 'Keep this draft after rejected commit'
  await rowB.locator(selectors.message).first().fill(failedDraft)
  const beforeFailedCommit = await page.evaluate(() => window.__repositoriesProbe.snapshot())
  await page.evaluate(({ root, message }) => window.__repositoriesProbe.failNext({ method: 'commit', repoRoot: root }, message), { root: b.root, message: commitError })
  let cursor = await requestCursor(page)
  await rowB.locator(selectors.commit).first().click()
  const failedCommit = await waitForRequest(page, cursor, 'commit', b.root)
  assert.equal(failedCommit.ok, false, 'Commit actually failed')
  assert.equal(failedCommit.payload.message, failedDraft, 'Failed commit sent the intended draft')
  await waitForRowIdle(page, selectors, b.root)
  await waitForRowAlert(page, selectors, b.root, commitError)
  assert.equal(await rowB.locator(selectors.message).first().inputValue(), failedDraft, 'Failed commit preserves its draft')
  assert.equal(await rowB.locator(selectors.commit).first().isEnabled(), true, 'Failed commit can be retried')
  const afterFailedCommit = await page.evaluate(() => window.__repositoriesProbe.snapshot())
  assert.deepEqual(afterFailedCommit.repos.find((repo) => repo.root === b.root).changes, beforeFailedCommit.repos.find((repo) => repo.root === b.root).changes, 'Failed commit preserves staged files')
  assert.equal((await rowA.textContent()).includes(commitError), false, 'Failed B commit stays local')

  const pushWarning = 'probe-commit-landed-but-push-failed'
  await page.evaluate(({ root, message }) => window.__repositoriesProbe.respondNext({ method: 'commit', repoRoot: root }, { pushed: false, pushError: message }), { root: b.root, message: pushWarning })
  cursor = await requestCursor(page)
  await rowB.locator(selectors.commitAndPush).click()
  const pushedCommit = await waitForRequest(page, cursor, 'commit', b.root)
  assert.equal(pushedCommit.ok, true, 'Commit succeeded despite failed push')
  assert.equal(pushedCommit.payload.push, true, 'Commit-and-push requested a push')
  assert.equal(pushedCommit.payload.confirm, true, 'Push carries confirmation')
  assert.equal(pushedCommit.response.data.pushError, pushWarning, 'Delivered a partial-success warning')
  await waitForRequest(page, pushedCommit.id, 'summary', b.root)
  await waitForRowIdle(page, selectors, b.root)
  await waitForRowAlert(page, selectors, b.root, pushWarning)
  assert.equal(await rowB.locator(selectors.message).first().inputValue(), '', 'Successful commit clears the committed draft even when push fails')
  const afterPush = await page.evaluate(() => window.__repositoriesProbe.snapshot())
  assert.equal(afterPush.repos.find((repo) => repo.root === b.root).changes.staged.length, 0, 'Commit really consumed B staged files')
  await refreshRow(page, selectors, b.root)
  await waitForRowAlert(page, selectors, b.root, pushWarning)
  assert.equal((await rowA.textContent()).includes(pushWarning), false, 'Push warning stays local')

  const failedStageError = 'probe-stage-failed-during-old-summary'
  const recoveryDraft = 'Commit after failed write and stale scan cleanup'
  const stagePath = a.changes.unstaged[0].path
  await rowA.locator(selectors.message).first().fill(recoveryDraft)
  const scanGate = await page.evaluate((root) => window.__repositoriesProbe.hold({ method: 'summary', repoRoot: root }), a.root)
  await rowA.locator(selectors.refresh).click()
  await page.waitForFunction((id) => window.__repositoriesProbe.gate(id).pending.length > 0, scanGate)
  assert.equal(await fileLocator(page, selectors, a.root, stagePath).locator(selectors.miniStage).isDisabled(), true, 'Mini stage respects summary loading')
  await page.evaluate(({ root, message }) => window.__repositoriesProbe.failNext({ method: 'stage', repoRoot: root }, message), { root: a.root, message: failedStageError })
  cursor = await requestCursor(page)
  // The context menu captures write busy, allowing a write during a pending read.
  await fileLocator(page, selectors, a.root, stagePath).click({ button: 'right' })
  const contextStage = page.locator(selectors.menuItem).filter({ hasText: /^Stage$/ })
  assert.equal(await contextStage.isEnabled(), true, 'Context-menu stage can invalidate a pending read')
  await contextStage.click()
  const failedStage = await waitForRequest(page, cursor, 'stage', a.root)
  assert.equal(failedStage.ok, false, 'Row write really failed while old summary is pending')
  assert.deepEqual(failedStage.payload.paths, [stagePath], 'Failed write targets exactly the selected A file')
  await waitForRowAlert(page, selectors, a.root, failedStageError)
  assert.equal(await rowA.locator(selectors.message).first().inputValue(), recoveryDraft, 'Failed stage preserves draft')
  await page.evaluate((id) => window.__repositoriesProbe.release(id), scanGate)
  await page.waitForFunction((id) => window.__repositoriesProbe.gate(id).pending.every((requestId) => window.__repositoriesProbe.requests.find((record) => record.id === requestId).state === 'done'), scanGate)
  await waitForRowIdle(page, selectors, a.root)
  await waitForRowAlert(page, selectors, a.root, failedStageError)
  assert.equal(await rowA.locator(selectors.refresh).isEnabled(), true, 'Old scan completion releases refresh after failed write')
  assert.equal(await rowA.locator(selectors.commit).first().isEnabled(), true, 'Old scan completion releases commit after failed write')
  assert.equal(await rowA.locator(selectors.message).first().inputValue(), recoveryDraft, 'Old summary must not reset the draft')
  await refreshRow(page, selectors, a.root)
  cursor = await requestCursor(page)
  await fileLocator(page, selectors, a.root, stagePath).locator(selectors.miniStage).click()
  const recoveredStage = await waitForRequest(page, cursor, 'stage', a.root)
  assert.equal(recoveredStage.ok, true, 'Single-file staging recovers')
  assert.deepEqual(recoveredStage.payload.paths, [stagePath], 'Mini stage targets exactly one A file')
  await waitForRequest(page, recoveredStage.id, 'summary', a.root)
  await waitForRowIdle(page, selectors, a.root)
  cursor = await requestCursor(page)
  await rowA.locator(selectors.commit).first().click()
  const recoveredCommit = await waitForRequest(page, cursor, 'commit', a.root)
  assert.equal(recoveredCommit.ok, true, 'Commit recovers after failed write and old summary')
  assert.equal(recoveredCommit.payload.message, recoveryDraft, 'Recovered commit uses the preserved draft')
  await waitForRequest(page, recoveredCommit.id, 'summary', a.root)
  await waitForRowIdle(page, selectors, a.root)
  assert.equal(await rowA.locator(selectors.message).first().inputValue(), '', 'Recovered successful commit clears its draft')

  // First install a valid earlier handle, so undoBlocked must remove stale Undo UI.
  const previousDiscardPath = a.changes.untracked[1].path
  await page.evaluate(({ root, path }) => window.__repositoriesProbe.respondNext({ method: 'discard', repoRoot: root }, { undoBlocked: false, undo: { id: 'probe-previous-discard-undo', label: path } }), { root: a.root, path: previousDiscardPath })
  cursor = await requestCursor(page)
  await fileLocator(page, selectors, a.root, previousDiscardPath).locator(selectors.miniDiscard).click()
  await rowA.locator(selectors.confirm).click()
  const priorDiscard = await waitForRequest(page, cursor, 'discard', a.root)
  assert.equal(priorDiscard.ok, true, 'Earlier discard supplies a valid undo handle')
  assert.equal(priorDiscard.response.data.undo.id, 'probe-previous-discard-undo', 'Delivered the earlier undo handle')
  await waitForRequest(page, priorDiscard.id, 'summary', a.root)
  await waitForRowIdle(page, selectors, a.root)
  assert.equal(await rowA.getByRole('button', { name: 'Undo', exact: true }).count(), 1, 'Earlier discard actually offers Undo before blocked discard')

  const discardPath = a.changes.untracked[0].path
  cursor = await requestCursor(page)
  await fileLocator(page, selectors, a.root, discardPath).locator(selectors.miniDiscard).click()
  await rowA.locator(selectors.confirm).click()
  const discarded = await waitForRequest(page, cursor, 'discard', a.root)
  assert.equal(discarded.ok, true, 'Discard actually succeeds')
  assert.deepEqual(discarded.payload.paths, [discardPath], 'Discard targets the chosen A file')
  assert.equal(discarded.payload.untracked, true, 'Untracked discard is explicit')
  assert.equal(discarded.payload.confirm, true, 'Discard carries confirmation')
  assert.equal(discarded.response.data.undoBlocked, true, 'Discard explicitly reports blocked undo')
  assert.equal(Object.hasOwn(discarded.response.data, 'undo'), false, 'Host supplied no undo handle')
  await waitForRequest(page, discarded.id, 'summary', a.root)
  await waitForRowIdle(page, selectors, a.root)
  await waitForRowAlert(page, selectors, a.root, 'too large to keep an undo')
  assert.equal(await fileLocator(page, selectors, a.root, discardPath).count(), 0, 'Discarded file disappears from actual row data')
  assert.equal(await rowA.getByRole('button', { name: 'Undo', exact: true }).count(), 0, 'Blocked discard must not promise Undo')
  await refreshRow(page, selectors, a.root)
  await waitForRowAlert(page, selectors, a.root, 'too large to keep an undo')
  assert.equal((await rowA.locator(selectors.alert).textContent()).includes(discardPath), true, 'Persistent discard warning identifies the file')
  assert.equal(await rowA.getByRole('button', { name: 'Undo', exact: true }).count(), 0, 'Refresh must not invent an undo promise')
  await waitForRowAlert(page, selectors, b.root, pushWarning)
  return {
    failedCommit: { payload: failedCommit.payload, error: commitError, retainedDraft: failedDraft },
    commitWithPushError: { payload: pushedCommit.payload, result: pushedCommit.response.data, warningAfterRefresh: pushWarning },
    failedWriteDuringScan: { delayedSummaryGate: scanGate, errorAfterOldSummary: failedStageError, failedStage: failedStage.payload, recoveredStage: recoveredStage.payload, recoveredCommit: recoveredCommit.payload },
    discardWithoutUndo: { priorUndo: priorDiscard.response.data.undo, payload: discarded.payload, result: discarded.response.data, warningAfterRefresh: await rowA.locator(selectors.alert).textContent() },
  }
}

/** Both late per-repository summaries and late workspace discovery are covered. */
export async function verifyStaleResponses(page, fixture, selectors = SELECTORS) {
  const old = fixture.workspaces[fixture.initialWorkspace][0]
  const marker = 'STALE-ALPHA-BRANCH-MUST-NOT-APPEAR'
  const gate = await page.evaluate(({ root, marker }) => {
    window.__repositoriesProbe.setBranch(root, marker)
    return window.__repositoriesProbe.hold({ method: 'summary', repoRoot: root })
  }, { root: old.root, marker })
  await rowLocator(page, selectors, old.root).locator(selectors.refresh).click()
  await page.waitForFunction((id) => window.__repositoriesProbe.gate(id).pending.length > 0, gate)
  await page.evaluate((cwd) => window.__repositoriesProbe.setScope({ cwd, sessionId: 'repositories-probe-beta' }), fixture.nextWorkspace)
  await waitForRepositoryRows(page, fixture, fixture.nextWorkspace, selectors)
  await page.evaluate((id) => window.__repositoriesProbe.release(id), gate)
  await page.waitForFunction((id) => window.__repositoriesProbe.gate(id).pending.every((requestId) => window.__repositoriesProbe.requests.find((record) => record.id === requestId).state === 'done'), gate)
  await uiTurn(page)
  await waitForRepositoryRows(page, fixture, fixture.nextWorkspace, selectors)
  assert.equal((await page.locator(selectors.list).textContent()).includes(marker), false, 'Late A summary must not overwrite workspace B')
  assert.equal(await rowLocator(page, selectors, old.root).count(), 0, 'No old root after summary completion')
  const discovery = await page.evaluate((cwd) => window.__repositoriesProbe.hold({ method: 'repos', cwd }), fixture.initialWorkspace)
  await page.evaluate((cwd) => window.__repositoriesProbe.setScope({ cwd, sessionId: 'repositories-probe-alpha-again' }), fixture.initialWorkspace)
  await page.waitForFunction((id) => window.__repositoriesProbe.gate(id).pending.length > 0, discovery)
  await page.evaluate((cwd) => window.__repositoriesProbe.setScope({ cwd, sessionId: 'repositories-probe-beta-again' }), fixture.nextWorkspace)
  await waitForRepositoryRows(page, fixture, fixture.nextWorkspace, selectors)
  await page.evaluate((id) => window.__repositoriesProbe.release(id), discovery)
  await page.waitForFunction((id) => window.__repositoriesProbe.gate(id).pending.every((requestId) => window.__repositoriesProbe.requests.find((record) => record.id === requestId).state === 'done'), discovery)
  await uiTurn(page)
  await waitForRepositoryRows(page, fixture, fixture.nextWorkspace, selectors)
  assert.equal(await rowLocator(page, selectors, old.root).count(), 0, 'Late A discovery must not replace workspace B rows')
  return { delayedSummaryGate: gate, delayedDiscoveryGate: discovery, finalWorkspace: fixture.nextWorkspace }
}

/** Deterministic loading regression: real hooks, held deliveries, no speed threshold. */
export async function verifyWorkbenchLoading(page, fixture, selectors = SELECTORS) {
  const [a, b] = fixture.workspaces[fixture.initialWorkspace]
  await page.waitForFunction(() => window.__repositoriesProbe.inFlight === 0)
  const cursor = await requestCursor(page)
  const commit = (index, subject) => ({ hash: hash(index), shortHash: hash(index).slice(0, 8), parents: [], author: 'Probe', date: '2026-10-13T12:00:00Z', subject, refs: [] })
  const first = commit(801, 'First loading page')
  const more = commit(802, 'Appended loading page')
  const latest = commit(803, 'Newest filtered page')
  const statsGate = await page.evaluate(({ root, first }) => {
    const probe = window.__repositoriesProbe
    probe.setRemotes(root, [{ name: 'origin', fetch: 'probe://origin', push: 'probe://origin' }])
    probe.respondNext({ method: 'log', repoRoot: root }, { commits: [first], hasMore: true })
    probe.respondNext({ method: 'stats', repoRoot: root }, { staged: [['app-staged.txt', 91, 0, false]], unstaged: [] })
    return probe.hold({ method: 'stats', repoRoot: root }, { limit: 1 })
  }, { root: a.root, first })
  await rowLocator(page, selectors, a.root).locator(selectors.workbench).click()
  await page.waitForFunction((id) => window.__repositoriesProbe.gate(id).pending.length === 1 && window.__repositoriesProbe.inFlight === 1, statsGate)
  await page.waitForFunction(() => document.querySelector('.dgp-load-more')?.disabled === false)
  await uiTurn(page)
  const countRequests = () => page.evaluate(({ cursor, root }) => {
    const requests = window.__repositoriesProbe.requests.filter((record) => record.id > cursor && record.payload.repoRoot === root)
    return Object.fromEntries(['summary', 'stats', 'branches', 'log', 'fetch', 'commitDetail'].map((method) => [method, requests.filter((record) => record.method === method).length]))
  }, { cursor, root: a.root })
  const initialCounts = await countRequests()
  assert.deepEqual(initialCounts, { summary: 1, stats: 1, branches: 1, log: 1, fetch: 0, commitDetail: 0 }, 'Remote-ready transition must not duplicate the initial round')
  const pageSeed = () => page.evaluate((root) => JSON.parse(sessionStorage.getItem('dsh-git-panel.paint.v1')).page[root], a.root)
  const phaseOne = await pageSeed()
  assert.equal(phaseOne.summary.statsDeferred, true, 'First-page cache exists while stats are held')
  assert.equal(phaseOne.summary.changes.staged[0].additions, 0, 'Phase-one fixture matches deferred host stats')
  assert.equal(await page.locator('.dgp-rail-btn[data-action="newBranch"]').isEnabled(), true, 'Deferred stats do not block repository actions')
  await page.evaluate(() => window.__repositoriesProbe.tickAutoRefresh())
  await uiTurn(page)
  assert.deepEqual(await countRequests(), initialCounts, 'Automatic poll shares the initial summary/stats gate')

  await page.evaluate(({ root, more }) => window.__repositoriesProbe.respondNext({ method: 'log', repoRoot: root }, { commits: [more], hasMore: false }), { root: a.root, more })
  await page.locator('.dgp-load-more').click()
  await page.waitForFunction(() => document.querySelectorAll('.dgp-history-scroll .dgp-commit').length === 2)
  await page.locator('.dgp-history-scroll .dgp-commit').first().click()
  await page.locator('.dgp-detail').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '← Back to history', exact: true }).click()
  await uiTurn(page)
  assert.equal(await page.locator('.dgp-history-scroll .dgp-commit').count(), 2, 'Detail/history navigation preserves loaded pages')
  assert.deepEqual(await countRequests(), { ...initialCounts, log: 2, commitDetail: 1 }, 'Detail/history navigation requests only detail, not another page')
  await page.setViewportSize({ width: 360, height: 860 })
  await uiTurn(page)
  await page.locator('.dgp-seg-item', { hasText: 'Changes' }).click()
  await page.locator('.dgp-seg-item', { hasText: 'History' }).click()
  await uiTurn(page)
  assert.deepEqual(await countRequests(), { ...initialCounts, log: 2, commitDetail: 1 }, 'Changes/history tabs do not refresh the workbench')
  await page.setViewportSize({ width: 1440, height: 860 })
  await uiTurn(page)

  // Hold an older refresh's log, then let a changed filter complete a newer
  // round. Stats from the newest round finish BEFORE its page cache write.
  const logGate = await page.evaluate(({ root }) => window.__repositoriesProbe.hold({ method: 'log', repoRoot: root }, { limit: 1 }), { root: a.root })
  await page.locator('.dgp-rail-btn[data-action="refresh"]').click()
  await page.waitForFunction((id) => window.__repositoriesProbe.gate(id).pending.length === 1, logGate)
  await page.evaluate(({ root, latest }) => window.__repositoriesProbe.respondNext({ method: 'log', repoRoot: root, path: 'src/newest.txt' }, { commits: [latest], hasMore: false }), { root: a.root, latest })
  await page.locator('.dgp-filter-path input').fill('src/newest.txt')
  await page.locator('.dgp-filter-path input').press('Enter')
  await page.waitForFunction(({ root, subject }) => JSON.parse(sessionStorage.getItem('dsh-git-panel.paint.v1')).page[root].commits[0].subject === subject, { root: a.root, subject: latest.subject })
  const newestBeforeRelease = await pageSeed()
  assert.equal(newestBeforeRelease.summary.statsDeferred, false, 'Stats finishing before the page write stay enriched in the cache')
  assert.equal(newestBeforeRelease.summary.changes.staged[0].additions, 2)
  await page.evaluate((id) => window.__repositoriesProbe.release(id), logGate)
  await page.waitForFunction((id) => window.__repositoriesProbe.gate(id).pending.every((requestId) => window.__repositoriesProbe.requests.find((record) => record.id === requestId).state === 'done'), logGate)
  await page.evaluate((id) => window.__repositoriesProbe.release(id), statsGate)
  await page.waitForFunction(() => window.__repositoriesProbe.inFlight === 0)
  await uiTurn(page)
  const newestAfterRelease = await pageSeed()
  assert.equal(newestAfterRelease.commits[0].subject, latest.subject, 'Older full refresh cannot replace the newest cached page')
  assert.equal(newestAfterRelease.summary.changes.staged[0].additions, 2, 'Late same-repo stats cannot overwrite newer counts')
  assert.equal(await page.locator('.dgp-history-scroll .dgp-commit-subject').first().textContent(), latest.subject, 'Late same-repo history cannot replace the newest visible page')

  // Also exercise the opposite cache order: this round's stats finish AFTER
  // the first-page write, then enrich that exact page without losing its log.
  const lateStats = await page.evaluate(({ root }) => {
    window.__repositoriesProbe.respondNext({ method: 'stats', repoRoot: root }, { staged: [['app-staged.txt', 7, 3, false]], unstaged: [] })
    return window.__repositoriesProbe.hold({ method: 'stats', repoRoot: root }, { limit: 1 })
  }, { root: a.root })
  await page.locator('.dgp-rail-btn[data-action="refresh"]').click()
  await page.waitForFunction((id) => window.__repositoriesProbe.gate(id).pending.length === 1 && window.__repositoriesProbe.inFlight === 1, lateStats)
  await uiTurn(page)
  const beforeEnrichment = await pageSeed()
  assert.equal(beforeEnrichment.summary.statsDeferred, true)
  await page.evaluate((id) => window.__repositoriesProbe.release(id), lateStats)
  await page.waitForFunction((root) => JSON.parse(sessionStorage.getItem('dsh-git-panel.paint.v1')).page[root].summary.changes.staged[0].additions === 7, a.root)
  const afterEnrichment = await pageSeed()
  assert.equal(afterEnrichment.summary.statsDeferred, false)
  assert.deepEqual(afterEnrichment.commits, beforeEnrichment.commits, 'Late stats preserve the rest of the first-page cache')

  const identityGate = await page.evaluate(({ root }) => {
    window.__repositoriesProbe.respondNext({ method: 'stats', repoRoot: root }, { staged: [['app-staged.txt', 92, 0, false]], unstaged: [] })
    return window.__repositoriesProbe.hold({ method: 'stats', repoRoot: root }, { limit: 1 })
  }, { root: a.root })
  await page.locator('.dgp-rail-btn[data-action="refresh"]').click()
  await page.waitForFunction((id) => window.__repositoriesProbe.gate(id).pending.length === 1 && window.__repositoriesProbe.inFlight === 1, identityGate)
  const beforeSwitch = await pageSeed()
  await page.locator('[data-action="repositories"]').click()
  await rowLocator(page, selectors, b.root).locator(selectors.workbench).click()
  await page.waitForFunction(({ root }) => JSON.parse(sessionStorage.getItem('dsh-git-panel.paint.v1')).page[root]?.summary.statsDeferred === false, { root: b.root })
  await page.evaluate((id) => window.__repositoriesProbe.release(id), identityGate)
  await page.waitForFunction(() => window.__repositoriesProbe.inFlight === 0)
  await uiTurn(page)
  assert.deepEqual((await pageSeed()).summary, beforeSwitch.summary, 'Old-repository stats cannot enrich its cache after identity changes')
  assert.equal((await page.locator('.dgp-root').textContent()).includes('+92'), false, 'Old-repository enrichment cannot appear in the new workbench')
  return { initialCounts, deferredStatsDidNotBlock: true, automaticPollDidNotOverlap: true, navigationPreservedPages: true, staleSameRepoStatsRejected: true, staleRefreshCacheRejected: true, cacheEnrichmentBeforeAndAfterPageWrite: true, staleRepositoryStatsRejected: true, gates: { statsGate, logGate, lateStats, identityGate } }
}

/** Horizontal overflow is forbidden; normal vertical list scrolling is allowed. */
export async function verifyOverflowAndScreenshots(page, out, selectors = SELECTORS, sizes = [{ width: 1440, height: 860 }, { width: 360, height: 820 }, { width: 320, height: 640 }, { width: 1100, height: 300 }]) {
  const results = []
  for (const size of sizes) {
    await page.setViewportSize(size)
    await uiTurn(page)
    const geometry = await page.evaluate((s) => {
      const list = document.querySelector(s.list)
      if (!list) throw new Error('Repository list is missing before screenshot')
      const problems = []
      const hosts = [document.documentElement, document.getElementById('probe-root'), list]
      for (const host of hosts) if (host.scrollWidth > host.clientWidth + 2) problems.push({ kind: 'scrollWidth', node: host.className || host.id || host.tagName, client: host.clientWidth, scroll: host.scrollWidth })
      const rows = Array.from(list.querySelectorAll(s.row))
      for (const row of rows) {
        const rect = row.getBoundingClientRect()
        if (rect.width <= 0 || rect.right > innerWidth + 2 || rect.left < -2) problems.push({ kind: 'row-bounds', root: row.getAttribute('data-repo-root'), left: rect.left, right: rect.right, width: rect.width })
        for (const selector of [s.toggle, s.branch, s.count, s.refresh, s.stageAll, s.workbench]) {
          for (const node of row.querySelectorAll(selector)) {
            if (!node.getClientRects().length) continue
            const box = node.getBoundingClientRect()
            if (box.left < rect.left - 2 || box.right > rect.right + 2) problems.push({ kind: 'row-control-bounds', root: row.getAttribute('data-repo-root'), selector, left: box.left, right: box.right })
          }
        }
      }
      return { problems, rows: rows.length, width: list.getBoundingClientRect().width }
    }, selectors)
    assert.deepEqual(geometry.problems, [], 'Horizontal overflow at ' + size.width + 'x' + size.height + ': ' + JSON.stringify(geometry.problems))
    const screenshot = join(outputPath(out), 'repositories-' + size.width + 'x' + size.height + '.png')
    await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' })
    results.push({ ...size, ...geometry, screenshot })
  }
  return results
}

/** No HTTP server: all page resources are fulfilled by Playwright routing. */
export async function runBrowserProbe({ mode = 'smoke', fixture = createRepositoryFixture(), selectors = SELECTORS, out = DEFAULT_OUTPUT, driverRoot = DEFAULT_DRIVER_ROOT, browserPath, headless = true, draftRetention = true, timeout = 15000 } = {}) {
  assert.ok(['smoke', 'full', 'performance'].includes(mode), 'Mode must be smoke, full or performance')
  const directory = outputPath(out)
  const bundle = join(directory, 'fixture.bundle.js')
  assert.ok(existsSync(bundle), 'Missing browser bundle. Run --prepare and its printed esbuild command first.')
  const require = createRequire(join(resolve(driverRoot), 'probe.cjs'))
  const { chromium } = require('playwright-core')
  const executablePath = findBrowser(browserPath)
  mkdirSync(directory, { recursive: true })
  const temporary = join(directory, 'tmp')
  mkdirSync(temporary, { recursive: true })
  const previousTemp = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR }
  for (const key of Object.keys(previousTemp)) process.env[key] = temporary
  let context
  let page
  const pageErrors = []
  const consoleErrors = []
  const report = { mode, browser: executablePath, started: new Date().toISOString(), status: 'running', limitations: ['Git HTTP API and optional DSH services are mocked; no backend Git, auth, discovery or live DSH integration is covered.', 'Standalone theme tokens are representative; full DSH shell integration and other browser engines need separate checks.', 'AbortSignal is intentionally ignored by delayed fetches to exercise worst-case late completion.'] }
  try {
    // A persistent profile is NEW and confined to .local, never the user's
    // browser profile. Playwright/browser temporary output is confined too.
    context = await chromium.launchPersistentContext(join(directory, 'browser-profile'), { executablePath, headless, locale: 'en-US', viewport: { width: 1440, height: 860 }, acceptDownloads: false, args: ['--disable-background-networking', '--no-first-run', '--no-default-browser-check'] })
    context.setDefaultTimeout(timeout)
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin === 'http://dsh-git-panel.invalid' && url.pathname === '/') await route.fulfill({ status: 200, contentType: 'text/html', body: FIXTURE_HTML })
      else if (url.origin === 'http://dsh-git-panel.invalid' && url.pathname === '/fixture.bundle.js') await route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(bundle, 'utf8') })
      else await route.abort('blockedbyclient')
    })
    await context.addInitScript((config) => {
      localStorage.clear()
      sessionStorage.clear()
      window.__repositoriesProbeConfig = config
      window.__ModuleLoader__ = { load: (spec) => { window.__repositoriesProbeClient = spec } }
    }, { fixture: clone(fixture) })
    page = context.pages()[0] || await context.newPage()
    page.on('pageerror', (error) => pageErrors.push(error.stack || error.message))
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    await page.goto('http://dsh-git-panel.invalid/', { waitUntil: 'load' })
    await page.waitForFunction(() => typeof window.__repositoriesProbe?.mountPlugin === 'function')
    await page.addScriptTag({ content: readFileSync(join(PROJECT_ROOT, 'src', 'client.js'), 'utf8') })
    report.registration = await page.evaluate(() => window.__repositoriesProbe.mountPlugin(window.__repositoriesProbeClient))
    assert.equal(report.registration.moduleId, 'dsh-git-panel')
    assert.equal(report.registration.tabId, 'dsh-git-panel:panel')
    report.smoke = await verifyRepositorySmoke(page, fixture, selectors, { draftRetention })
    // Screenshots are taken only after discovery, branch/count metadata and
    // two expanded ChangesPanels have actually rendered with fixture data.
    report.screenshots = await verifyOverflowAndScreenshots(page, directory, selectors)
    await page.setViewportSize({ width: 1440, height: 860 })
    await uiTurn(page)
    if (mode === 'performance' || mode === 'full') report.loading = await verifyWorkbenchLoading(page, fixture, selectors)
    if (mode === 'full') {
      await page.locator('[data-action="repositories"]').click()
      report.navigation = await verifyRepositoryNavigation(page, fixture, report.smoke, selectors)
      report.actions = await verifyRepositoryActions(page, fixture, report.smoke, selectors)
      report.errorPaths = await verifyRepositoryErrorPaths(page, fixture, selectors)
      report.staleResponses = await verifyStaleResponses(page, fixture, selectors)
      await page.screenshot({ path: join(directory, 'repositories-workspace-beta.png'), fullPage: true, animations: 'disabled' })
    }
    report.snapshot = await page.evaluate(() => window.__repositoriesProbe.snapshot())
    assert.deepEqual(report.snapshot.unknownRequests, [], 'Mock API contract mismatches')
    assert.deepEqual(pageErrors, [], 'Uncaught browser errors')
    assert.deepEqual(consoleErrors, [], 'React/browser console errors')
    report.status = 'passed'
    return report
  } catch (error) {
    report.status = 'failed'
    report.error = error.stack || String(error)
    if (page && !page.isClosed()) {
      report.snapshot = await page.evaluate(() => window.__repositoriesProbe?.snapshot?.() || null).catch(() => null)
      await page.screenshot({ path: join(directory, 'repositories-failure.png'), fullPage: true }).catch(() => {})
    }
    throw error
  } finally {
    report.pageErrors = pageErrors
    report.consoleErrors = consoleErrors
    report.finished = new Date().toISOString()
    writeFileSync(join(directory, 'report-' + mode + '.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
    if (page && !page.isClosed()) await page.evaluate(() => window.__repositoriesProbe?.dispose?.()).catch(() => {})
    if (context) await context.close()
    for (const [key, value] of Object.entries(previousTemp)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

async function main(args) {
  const option = (name) => { const index = args.indexOf(name); if (index < 0) return undefined; assert.ok(args[index + 1] && !args[index + 1].startsWith('--'), name + ' requires a value'); return args[index + 1] }
  const allowed = new Set(['--prepare', '--smoke', '--full', '--performance', '--headed', '--no-draft-retention', '--out', '--browser', '--driver-root', '--react-modules', '--help'])
  for (let index = 0; index < args.length; index += 1) {
    assert.ok(allowed.has(args[index]), 'Unknown argument: ' + args[index])
    if (['--out', '--browser', '--driver-root', '--react-modules'].includes(args[index])) index += 1
  }
  if (args.includes('--help')) {
    console.log('Prepare: node scripts/repositories-probe.mjs --prepare\nThen invoke the printed esbuild binary command directly.\nRun after UI exists: node scripts/repositories-probe.mjs --smoke | --full | --performance\nOptions: --headed --no-draft-retention --out <project .local path> --browser <Chrome/Edge exe> --driver-root <dependency folder> --react-modules <node_modules folder>')
    return
  }
  const out = option('--out') || DEFAULT_OUTPUT
  const driverRoot = option('--driver-root') || DEFAULT_DRIVER_ROOT
  if (args.includes('--prepare')) {
    const prepared = prepareFixture({ out, driverRoot, reactModules: option('--react-modules') || DEFAULT_REACT_MODULES })
    console.log('Browser entry prepared; no browser was launched.\nRun directly in PowerShell:\n' + prepared.command + '\nThen, once the repository-list UI exists:\nnode scripts/repositories-probe.mjs --smoke\nnode scripts/repositories-probe.mjs --full')
    return
  }
  const modes = ['smoke', 'full', 'performance'].filter((mode) => args.includes('--' + mode))
  assert.equal(modes.length, 1, 'Choose exactly one of --smoke / --full / --performance after --prepare')
  const report = await runBrowserProbe({ mode: modes[0], out, driverRoot, browserPath: option('--browser'), headless: !args.includes('--headed'), draftRetention: !args.includes('--no-draft-retention') })
  console.log(JSON.stringify({ status: report.status, mode: report.mode, screenshots: report.screenshots.map((item) => item.screenshot), report: join(outputPath(out), 'report-' + report.mode + '.json') }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.stack || String(error)); process.exitCode = 1 })
}
