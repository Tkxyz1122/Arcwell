'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { generateKeyPairSync, sign, createHash } = require('node:crypto');
const {
  UpdateService,
  newer,
  signedManifest,
  RELEASES,
  REPOSITORY,
} = require('../src/updates.cjs');
const keys = generateKeyPairSync('ed25519');
const binary = Buffer.from('isolated executable fixture - never executed');
function fixture(overrides = {}) {
  const manifest = {
    repository: REPOSITORY,
    version: '0.6.0',
    filename: 'Arcwell-0.6.0-Update.exe',
    size: binary.length,
    sha256: createHash('sha256').update(binary).digest('hex'),
    ...overrides,
  };
  const payload = Buffer.from(JSON.stringify(manifest));
  const envelope = JSON.stringify({
    payload: payload.toString('base64'),
    signature: sign(null, payload, keys.privateKey).toString('base64'),
  });
  const asset = (name, size) => ({
    name,
    size,
    browser_download_url: `${RELEASES}/download/v0.6.0/${name}`,
  });
  const release = {
    tag_name: 'v0.6.0',
    draft: false,
    prerelease: false,
    assets: [asset('update.json', envelope.length), asset(manifest.filename, manifest.size)],
  };
  return { manifest, envelope, release };
}
async function service(t, fetch) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'arcwell-update-unit-'));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return new UpdateService({
    currentVersion: '0.5.0',
    directory,
    fetch,
    publicKey: keys.publicKey,
  });
}
function fakeFetch(f, body = binary) {
  return async (url) =>
    new Response(
      url.endsWith('/latest')
        ? JSON.stringify(f.release)
        : url.endsWith('/update.json')
          ? f.envelope
          : body,
    );
}
test('stable versions compare numerically and reject invalid versions', () => {
  assert.equal(newer('0.10.0', '0.9.9'), true);
  assert.equal(newer('0.5.0', '0.5.0'), false);
  assert.equal(newer('0.4.9', '0.5.0'), false);
  assert.throws(() => newer('0.5.0-beta', '0.4.0'));
});
test('signed manifests reject tampering, wrong keys, versions and repositories', () => {
  const f = fixture();
  assert.equal(signedManifest(Buffer.from(f.envelope), keys.publicKey, '0.6.0').version, '0.6.0');
  assert.throws(
    () =>
      signedManifest(Buffer.from(f.envelope), generateKeyPairSync('ed25519').publicKey, '0.6.0'),
    /签名/,
  );
  assert.throws(() => signedManifest(Buffer.from(f.envelope), keys.publicKey, '0.7.0'), /签名/);
  assert.throws(
    () =>
      signedManifest(
        Buffer.from(fixture({ repository: 'other/app' }).envelope),
        keys.publicKey,
        '0.6.0',
      ),
    /签名/,
  );
  const e = JSON.parse(f.envelope);
  e.payload = Buffer.from('tampered').toString('base64');
  assert.throws(
    () => signedManifest(Buffer.from(JSON.stringify(e)), keys.publicKey, '0.6.0'),
    /签名/,
  );
});
test('valid feed downloads atomically and rechecks the binary before install', async (t) => {
  const s = await service(t, fakeFetch(fixture()));
  assert.equal((await s.check()).phase, 'available');
  assert.equal((await s.download()).phase, 'ready');
  const file = await s.installFile();
  assert.deepEqual(await fs.readFile(file), binary);
  await fs.writeFile(file, 'altered');
  await assert.rejects(s.installFile(), /已改变/);
});
test('bad checksum never exposes an executable for installation', async (t) => {
  const s = await service(t, fakeFetch(fixture({ sha256: 'a'.repeat(64) })));
  await s.check();
  assert.equal((await s.download()).phase, 'error');
  assert.equal((await fs.readdir(s.directory)).length, 0);
  await assert.rejects(s.installFile(), /先下载/);
});
test('untrusted URLs, oversized data, redirects and private network redirects fail closed', async (t) => {
  const f = fixture();
  f.release.assets[0].browser_download_url = 'https://evil.example/update.json';
  const s = await service(t, fakeFetch(f));
  assert.equal((await s.check()).phase, 'error');
  await assert.rejects(s.request('http://github.com/x', new AbortController().signal), /地址/);
  const redirect = await service(
    t,
    async () =>
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/update.exe' } }),
  );
  assert.equal((await redirect.check()).phase, 'error');
  const huge = await service(t, async () => new Response('x'.repeat(1024 * 1024 + 1)));
  assert.equal((await huge.check()).phase, 'error');
});
test('missing releases, offline failure and concurrent/cancelled checks are recoverable', async (t) => {
  const empty = await service(t, async () => new Response(null, { status: 404 }));
  assert.equal((await empty.check()).phase, 'current');
  const offline = await service(t, async () => {
    throw new Error('offline');
  });
  assert.equal((await offline.check()).phase, 'error');
  const blocked = await service(
    t,
    async (_url, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      ),
  );
  const task = blocked.check();
  assert.throws(() => blocked.check(), /正在/);
  blocked.cancel();
  assert.match((await task).message, /已取消/);
  await blocked.dispose();
});
test('same/older release and prerelease never become install candidates', async (t) => {
  const f = fixture();
  f.release.tag_name = 'v0.5.0';
  const s = await service(t, fakeFetch(f));
  assert.equal((await s.check()).phase, 'current');
  f.release.prerelease = true;
  f.release.tag_name = 'v0.6.0';
  assert.equal((await s.check()).phase, 'error');
});
test('cancelled download removes partial file and can retry', async (t) => {
  const f = fixture();
  let s;
  const fetch = fakeFetch(f);
  s = await service(t, async (url, options) => {
    if (!url.endsWith('.exe')) return fetch(url, options);
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(binary.subarray(0, 5));
          options.signal.addEventListener('abort', () => controller.error(options.signal.reason), {
            once: true,
          });
        },
      }),
    );
  });
  await s.check();
  const task = s.download();
  while (s.status().progress === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  s.cancel();
  assert.equal((await task).phase, 'error');
  assert.equal((await fs.readdir(s.directory)).length, 0);
  s.fetch = fakeFetch(f);
  assert.equal((await s.check()).phase, 'available');
  assert.equal((await s.download()).phase, 'ready');
});
