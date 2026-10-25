'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { IconService } = require('../src/icons.cjs');
test('icons are same-origin, cached and startup never makes requests', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'arcwell-icons-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const calls = [];
  const service = new IconService(
    directory,
    async (url) => {
      calls.push(url);
      return url.endsWith('/')
        ? new Response(
            '<link rel="icon" href="https://third-party.example/track.ico"><link rel="icon" href="/brand.png">',
            { headers: { 'content-type': 'text/html' } },
          )
        : new Response('image');
    },
    (bytes) => Buffer.from(`decoded:${bytes}`),
  );
  assert.equal(await service.load('https://example.com/path'), null);
  assert.equal(calls.length, 0);
  const value = await service.load('https://example.com/path', true);
  assert.equal(calls[1], 'https://example.com/brand.png');
  assert.match(value, /^data:image\/png;base64,/);
  assert.equal(await service.load('https://example.com/other'), value);
  assert.equal(calls.length, 2);
});
test('cross-origin redirects and large responses are refused', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'arcwell-icons-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const service = new IconService(
    directory,
    async () =>
      new Response('', { status: 302, headers: { location: 'https://other.example/image.ico' } }),
    (bytes) => bytes,
  );
  await assert.rejects(service.load('https://example.com', true), /其他网站/);
  service.fetch = async () => new Response('x', { headers: { 'content-length': '99999999' } });
  await assert.rejects(service.load('https://example.com', true), /过大/);
});
