'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { sign, createPrivateKey, createPublicKey } = require('node:crypto');
const { hashFile, REPOSITORY } = require('../src/updates.cjs');
const pkg = require('../package.json');
(async () => {
  const directory = path.resolve(pkg.build.directories.output);
  const filename = `Arcwell-${pkg.version}-Update.exe`;
  const file = path.join(directory, filename);
  const keyText =
    process.env.ARCWELL_UPDATE_PRIVATE_KEY ||
    (await fs.readFile('.tools/release-signing/private.pem', 'utf8'));
  const key = createPrivateKey(keyText);
  const publicKey = createPublicKey(key).export({ type: 'spki', format: 'pem' }).trim();
  if (publicKey !== (await fs.readFile('src/update-public.pem', 'utf8')).trim())
    throw new Error('发布私钥与应用公钥不匹配，停止发布。');
  const payload = Buffer.from(
    JSON.stringify({
      repository: REPOSITORY,
      version: pkg.version,
      filename,
      size: (await fs.stat(file)).size,
      sha256: await hashFile(file),
    }),
  );
  await fs.writeFile(
    path.join(directory, 'update.json'),
    JSON.stringify(
      {
        payload: payload.toString('base64'),
        signature: sign(null, payload, key).toString('base64'),
      },
      null,
      2,
    ) + '\n',
  );
  const checksums = [];
  for (const suffix of ['Setup.exe', 'Update.exe', 'Portable.zip']) {
    const name = `Arcwell-${pkg.version}-${suffix}`;
    checksums.push(`${await hashFile(path.join(directory, name))}  ${name}`);
  }
  await fs.writeFile(path.join(directory, 'SHA256.txt'), checksums.join('\r\n') + '\r\n');
  console.log('Signed update manifest and SHA256.txt generated.');
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
