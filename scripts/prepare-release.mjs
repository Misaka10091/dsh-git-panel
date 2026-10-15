import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repository = 'https://github.com/Misaka10091/dsh-git-panel'

export function prepareRelease({ tag, pkg, manifest, changelog }) {
  const match = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?)$/.exec(tag)
  assert.ok(match, 'Release tag must be vX.Y.Z or vX.Y.Z-prerelease (no build metadata).')
  const [, version, prerelease] = match
  if (prerelease) {
    assert.ok(prerelease.split('.').every((id) => !/^\d+$/.test(id) || !/^0\d/.test(id)), 'Numeric prerelease identifiers must not have leading zeros.')
  }
  assert.equal(pkg.name, '@misaka10091/dsh-git-panel', 'Unexpected npm package name.')
  assert.equal(pkg.version, version, 'Tag and package.json version must agree.')
  assert.equal(manifest.version, version, 'Tag and dsh.plugin.json version must agree.')
  assert.equal(pkg.repository?.url, `git+${repository}.git`, 'repository.url must identify this project for npm provenance.')

  const lines = changelog.split(/\r?\n/)
  const start = lines.findIndex((line) => line.startsWith(`## ${tag} — `))
  assert.ok(start >= 0, `CHANGELOG.md needs a section for ${tag}.`)
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  const body = lines.slice(start + 1, next < 0 ? undefined : next).join('\n').trim()
  assert.ok(body, 'The release changelog section must not be empty.')
  const notes = `${body}\n\n### Installation\n\n\`\`\`sh\ndsh plugin --profile desktop add ${pkg.name}@${version}\n\`\`\`\n\nThe attached .tgz is the same package published to npm.\n`
  return {
    package: pkg.name,
    version,
    tag,
    dist_tag: prerelease ? 'next' : 'latest',
    prerelease: Boolean(prerelease),
    notes,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [tag, outputDirectory] = process.argv.slice(2)
  assert.ok(outputDirectory, 'Usage: node scripts/prepare-release.mjs vX.Y.Z <output-directory>')
  const result = prepareRelease({
    tag,
    pkg: JSON.parse(fs.readFileSync('package.json', 'utf8')),
    manifest: JSON.parse(fs.readFileSync('dsh.plugin.json', 'utf8')),
    changelog: fs.readFileSync('CHANGELOG.md', 'utf8'),
  })
  fs.mkdirSync(outputDirectory, { recursive: true })
  fs.writeFileSync(path.join(outputDirectory, 'notes.md'), result.notes)
  fs.writeFileSync(path.join(outputDirectory, 'metadata.json'), JSON.stringify(result, null, 2) + '\n')
  if (process.env.GITHUB_OUTPUT) {
    for (const key of ['package', 'version', 'dist_tag', 'prerelease']) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${result[key]}\n`)
    }
  }
  console.log(`Validated ${result.package}@${result.version} (${result.dist_tag}); release notes ready.`)
}
