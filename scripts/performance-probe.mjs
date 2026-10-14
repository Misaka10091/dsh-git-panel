import { EventEmitter } from 'node:events'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

// Optional fourth argument selects an installed host module for comparison.
// Optional fifth argument overrides the repository-list concurrency (default 4).
const hostModule = process.argv[4] ? pathToFileURL(resolve(process.argv[4])).href : new URL('../src/index.js', import.meta.url).href
const { apply } = await import(hostModule)

// Read-only measurements against an explicitly selected real repository.
const cwd = process.argv[2]
if (!cwd) throw new Error('Usage: node scripts/performance-probe.mjs <absolute repository path> [rounds] [host module path] [listSlots]')
let route
apply({ effect: (fn) => fn(), webServer: { register: (spec) => { route = spec; return () => {} } } })
function call(method, payload = {}) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter()
    Object.assign(req, { method: 'POST', url: '/dsh-git-panel/api/' + method, headers: { host: '127.0.0.1:3080' }, destroy() {} })
    const start = performance.now()
    const res = { writeHead(status) { this.status = status }, end(text) {
      try { const body = JSON.parse(text); if (!body.ok) throw new Error(JSON.stringify(body.error)); resolve({ ms: Math.round(performance.now() - start), data: body.data }) } catch (error) { reject(error) }
    } }
    void route.handler(req, res)
    req.emit('data', Buffer.from(JSON.stringify(payload)))
    req.emit('end')
  })
}
const rounds = Math.max(1, Math.min(10, Number(process.argv[3]) || 3))
const listSlots = Math.max(1, Math.min(16, Number(process.argv[5]) || 4))
const results = []
for (let round = 1; round <= rounds; round++) {
  const roundStartedAt = Date.now()
  const start = performance.now()
  const discovery = await call('repos', { cwd })
  const base = { cwd, repoRoot: cwd }
  const [summary, branches, log] = await Promise.all([
    call('summary', { ...base, stats: false }), call('branches', base), call('log', { ...base, limit: 120 }),
  ])
  const firstPhaseMs = Math.round(performance.now() - start)
  const stats = await call('stats', base)
  const listStart = performance.now()
  const queue = discovery.data.repos.slice()
  const summaries = []
  await Promise.all(Array.from({ length: Math.min(listSlots, queue.length) }, async () => {
    while (queue.length) {
      const repository = queue.shift()
      const result = await call('summary', { cwd, repoRoot: repository.path, stats: false })
      summaries.push({ name: repository.name, ms: result.ms })
    }
  }))
  const repositoryListMs = Math.round(performance.now() - listStart)
  const commands = (await call('gitLogs')).data.entries.filter((entry) => Date.parse(entry.at) >= roundStartedAt)
  results.push({ round, listSlots, reposMs: discovery.ms, repos: discovery.data.repos.length, summaryMs: summary.ms, branchesMs: branches.ms, logMs: log.ms, statsMs: stats.ms, firstPhaseMs, repositoryListMs, summaries,
    changes: Object.fromEntries(['staged', 'unstaged', 'untracked', 'conflicted'].map(key => [key, summary.data.changes[key].length])),
    commits: log.data.commits.length, localBranches: branches.data.local.length,
    commands: commands.map(({ argv, ms, code }) => ({ argv, ms, code })) })
}
console.log(JSON.stringify({ cwd, hostModule, results }, null, 2))
