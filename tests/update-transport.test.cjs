'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { updateFetch } = require('../src/update-transport.cjs');
function mockNet(start) {
  const request = new EventEmitter();
  request.end = () => queueMicrotask(() => start(request));
  request.abort = () => {
    request.emit('close');
  };
  return { request: () => request };
}
test('Electron manual redirect is exposed before its cancelled error', async () => {
  const net = mockNet((request) => {
    request.emit('redirect', 302, 'GET', 'https://release-assets.githubusercontent.com/file');
    request.emit('error', new Error('Redirect was cancelled'));
  });
  const response = await updateFetch(net)('https://github.com/file', {
    signal: new AbortController().signal,
    headers: {},
  });
  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get('location'),
    'https://release-assets.githubusercontent.com/file',
  );
});
test('Electron response is streamed with size bounds delegated to UpdateService', async () => {
  const net = mockNet((request) => {
    const response = Readable.from([Buffer.from('part1'), Buffer.from('part2')]);
    response.statusCode = 200;
    response.headers = { 'content-type': 'application/octet-stream' };
    request.emit('response', response);
  });
  const response = await updateFetch(net)('https://github.com/file', {
    signal: new AbortController().signal,
    headers: {},
  });
  const chunks = [];
  for await (const chunk of response.body) chunks.push(Buffer.from(chunk));
  assert.equal(Buffer.concat(chunks).toString(), 'part1part2');
});
test('transport cancellation and network failure remain recoverable', async () => {
  const controller = new AbortController();
  const task = updateFetch(mockNet(() => {}))('https://github.com/file', {
    signal: controller.signal,
    headers: {},
  });
  controller.abort();
  await assert.rejects(task);
  await assert.rejects(
    updateFetch(mockNet((r) => r.emit('error', new Error('offline'))))('https://github.com/file', {
      signal: new AbortController().signal,
      headers: {},
    }),
    /无法连接/,
  );
});
