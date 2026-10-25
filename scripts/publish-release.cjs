'use strict';
// Run only after the final binaries, screenshots and checks have been reviewed.
const fs = require('node:fs/promises');
const path = require('node:path');
const { signedManifest, hashFile, REPOSITORY } = require('../src/updates.cjs');
const pkg = require('../package.json');
(async () => {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('发布需要 GH_TOKEN；不要把令牌写进源码或提交到仓库。');
  const directory = path.resolve(pkg.build.directories.output);
  const names = [
    `Arcwell-${pkg.version}-Setup.exe`,
    `Arcwell-${pkg.version}-Update.exe`,
    'SHA256.txt',
    'update.json',
  ];
  const manifest = signedManifest(
    await fs.readFile(path.join(directory, 'update.json')),
    await fs.readFile('src/update-public.pem'),
    pkg.version,
  );
  if ((await hashFile(path.join(directory, manifest.filename))) !== manifest.sha256)
    throw new Error('更新包与签名不匹配。');
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Arcwell-release',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const api = `https://api.github.com/repos/${REPOSITORY}`;
  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { ...headers, ...options.headers },
      signal: AbortSignal.timeout(10 * 60000),
    });
    if (!response.ok)
      throw new Error(`GitHub 发布操作失败（HTTP ${response.status}），请检查权限或草稿。`);
    return response.json();
  }
  const existing = await request(`${api}/releases?per_page=100`);
  const tag = `v${pkg.version}`;
  let release = existing.find((item) => item.tag_name === tag);
  if (release && !release.draft)
    throw new Error('该版本已发布；请提升版本号，不覆盖已发布的更新包。');
  const notes = await fs.readFile(path.join('docs', 'release-notes.md'), 'utf8');
  if (!release)
    release = await request(`${api}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: process.env.ARCWELL_RELEASE_COMMIT || 'main',
        name: `Arcwell ${pkg.version}`,
        body: notes,
        draft: true,
        prerelease: false,
      }),
    });
  for (const name of names) {
    const file = path.join(directory, name);
    const bytes = await fs.readFile(file);
    const asset = release.assets.find((item) => item.name === name);
    if (asset) {
      const digest = `sha256:${await hashFile(file)}`;
      if (asset.size !== bytes.length || asset.digest !== digest)
        throw new Error(`草稿中已有不同的 ${name}，停止发布。`);
      continue;
    }
    const upload = release.upload_url.replace(/\{.*$/, '') + `?name=${encodeURIComponent(name)}`;
    await request(upload, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
    console.log(`Uploaded ${name}`);
  }
  const published = await request(`${api}/releases/${release.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft: false, make_latest: 'true' }),
  });
  console.log(`Published ${published.html_url}`);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
