'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
function validateResult(value, currentVersion) {
  if (!value || !['success', 'failed', 'rollback-failed'].includes(value.status)) return null;
  if (typeof value.version !== 'string' || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value.version))
    return null;
  return {
    status:
      value.status === 'success' && value.version !== currentVersion ? 'failed' : value.status,
    version: value.version,
  };
}
function resultFromArguments(args, currentVersion) {
  const argument = (prefix) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  return validateResult(
    {
      status: argument('--arcwell-update-result='),
      version: argument('--arcwell-update-version='),
    },
    currentVersion,
  );
}
async function takeUpdateResult(directory, args, currentVersion) {
  const result = resultFromArguments(args, currentVersion);
  const file = path.join(directory, 'update-result.json');
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) return result;
    const text = await fs.readFile(file, 'utf8');
    let saved;
    try {
      saved = validateResult(JSON.parse(text), currentVersion);
    } catch {
      saved = null;
    }
    await fs.unlink(file);
    return result || saved;
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Update result could not be read.');
    return result;
  }
}
module.exports = { validateResult, resultFromArguments, takeUpdateResult };
