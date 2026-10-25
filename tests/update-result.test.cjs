'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {
  validateResult,
  resultFromArguments,
  takeUpdateResult,
} = require('../src/update-result.cjs');
test('update results accept fixed statuses and report success only for the actual running version', () => {
  assert.deepEqual(validateResult({ status: 'success', version: '0.5.3' }, '0.5.3'), {
    status: 'success',
    version: '0.5.3',
  });
  assert.equal(validateResult({ status: 'success', version: '0.5.4' }, '0.5.3').status, 'failed');
  assert.equal(validateResult({ status: 'exec', version: '0.5.3' }, '0.5.3'), null);
  assert.equal(validateResult({ status: 'failed', version: '<script>' }, '0.5.3'), null);
  assert.equal(
    resultFromArguments(
      ['app.exe', '--arcwell-update-result=rollback-failed', '--arcwell-update-version=0.5.3'],
      '0.5.3',
    ).status,
    'rollback-failed',
  );
});
test('a saved update result is consumed once; malformed or oversized receipts cannot inject UI content', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'arcwell-result-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'update-result.json');
  await fs.writeFile(
    file,
    JSON.stringify({ status: 'failed', version: '0.5.3', message: '<script>' }),
  );
  assert.deepEqual(await takeUpdateResult(directory, [], '0.5.3'), {
    status: 'failed',
    version: '0.5.3',
  });
  assert.equal(await takeUpdateResult(directory, [], '0.5.3'), null);
  await fs.writeFile(file, 'not json');
  assert.equal(await takeUpdateResult(directory, [], '0.5.3'), null);
  await fs.writeFile(file, 'x'.repeat(4097));
  assert.equal(await takeUpdateResult(directory, [], '0.5.3'), null);
  assert.equal((await fs.stat(file)).size, 4097);
});
