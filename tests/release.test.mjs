import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareRelease } from '../scripts/prepare-release.mjs'

function input(version = '0.1.0') {
  return {
    tag: `v${version}`,
    pkg: { name: '@misaka10091/dsh-git-panel', version, repository: { url: 'git+https://github.com/Misaka10091/dsh-git-panel.git' } },
    manifest: { version },
    changelog: `# Changelog\n\n## v${version} — 2026-10-14\n\n- Current changes.\n\n## 首发前本地开发记录（未发布到 npm）\n\n### 本地迭代 0.1.4 — 2026-10-14\n\n- Older changes.\n`,
  }
}

test('stable release uses latest and excludes unpublished development history', () => {
  const release = prepareRelease(input())
  assert.equal(release.dist_tag, 'latest')
  assert.equal(release.prerelease, false)
  assert.match(release.notes, /Current changes/)
  assert.doesNotMatch(release.notes, /Older changes/)
  assert.match(release.notes, /@misaka10091\/dsh-git-panel@0\.1\.0/)
})

test('prerelease uses next without promoting to latest', () => {
  const release = prepareRelease(input('0.2.0-beta.1'))
  assert.equal(release.dist_tag, 'next')
  assert.equal(release.prerelease, true)
})

test('invalid tags and tag/version mismatches stop publication', () => {
  for (const tag of ['main', 'v01.1.0', 'v0.1', 'v0.1.0-beta.01', 'v0.1.0+build', 'v0.1.1']) {
    assert.throws(() => prepareRelease({ ...input(), tag }))
  }
  assert.throws(() => prepareRelease({ ...input(), manifest: { version: '0.1.1' } }), /dsh.plugin.json/)
})

test('wrong package identity or repository stops publication', () => {
  const data = input()
  assert.throws(() => prepareRelease({ ...data, pkg: { ...data.pkg, name: 'dsh-git-panel' } }), /package name/)
  assert.throws(() => prepareRelease({ ...data, pkg: { ...data.pkg, repository: undefined } }), /repository.url/)
})

test('missing or empty changelog stops publication', () => {
  assert.throws(() => prepareRelease({ ...input(), changelog: '## v0.1.1 — 2026-10-14\n- Other.' }), /needs a section/)
  assert.throws(() => prepareRelease({ ...input(), changelog: '## v0.1.0 — 2026-10-14\n\n## 首发前本地开发记录\n- Older.' }), /must not be empty/)
})
