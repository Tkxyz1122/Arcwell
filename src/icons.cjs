'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { normalizeUrl } = require('./domain.cjs');
class IconService {
  constructor(directory, fetch, decode) {
    this.directory = directory;
    this.fetch = fetch;
    this.decode = decode;
    this.active = new Map();
  }
  async download(url, type, signal) {
    let current = new URL(url);
    const origin = current.origin;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await this.fetch(current.href, {
        signal,
        redirect: 'manual',
        credentials: 'omit',
        headers: { Accept: type === 'html' ? 'text/html' : 'image/*' },
      });
      if (response.status >= 300 && response.status < 400) {
        const next = new URL(response.headers.get('location'), current);
        if (next.origin !== origin) throw new Error('图标重定向到其他网站。');
        current = next;
        continue;
      }
      if (!response.ok) throw new Error('网站图标暂时不可用。');
      const contentType = response.headers.get('content-type') || '';
      if (type === 'html' && !contentType.includes('text/html'))
        throw new Error('网站未返回网页。');
      const limit = type === 'html' ? 512 * 1024 : 1024 * 1024;
      if (Number(response.headers.get('content-length')) > limit) throw new Error('网站资源过大。');
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > limit) throw new Error('网站资源过大。');
          chunks.push(Buffer.from(value));
        }
      } finally {
        await reader.cancel();
      }
      return Buffer.concat(chunks);
    }
    throw new Error('网站重定向次数过多。');
  }
  async load(raw, refresh = false) {
    const origin = new URL(normalizeUrl(raw)).origin;
    const key = createHash('sha256').update(origin).digest('hex');
    await fs.mkdir(this.directory, { recursive: true });
    const file = path.join(this.directory, `${key}.png`);
    if (!refresh) {
      try {
        const stat = await fs.stat(file);
        if (Date.now() - stat.mtimeMs < 30 * 86400000 && stat.size <= 1024 * 1024)
          return `data:image/png;base64,${(await fs.readFile(file)).toString('base64')}`;
      } catch (error) {
        if (error.code !== 'ENOENT') throw new Error('图标缓存无法读取。');
      }
      return null; // Reading an existing bookmark never triggers a startup network request.
    }
    if (this.active.has(key)) return this.active.get(key).promise;
    if (this.active.size >= 4) throw new Error('图标读取任务较多，请稍后刷新。');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const promise = (async () => {
      let candidate = `${origin}/favicon.ico`;
      try {
        const html = (await this.download(`${origin}/`, 'html', controller.signal)).toString(
          'utf8',
        );
        for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
          if (!/\brel\s*=\s*["'][^"']*\b(?:icon|apple-touch-icon)\b/i.test(tag)) continue;
          const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
          if (href) {
            const parsed = new URL(href.replace(/&amp;/g, '&'), origin);
            if (parsed.origin === origin && !parsed.pathname.endsWith('.svg')) {
              candidate = parsed.href;
              break;
            }
          }
        }
      } catch {
        /* Root favicon remains available when HTML discovery fails. */
      }
      let bytes;
      try {
        bytes = await this.download(candidate, 'image', controller.signal);
      } catch (error) {
        if (candidate === `${origin}/favicon.ico`) throw error;
        bytes = await this.download(`${origin}/favicon.ico`, 'image', controller.signal);
      }
      const png = await this.decode(bytes);
      if (!png || png.length > 1024 * 1024) throw new Error('图标格式不受支持。');
      const files = await fs.readdir(this.directory);
      if (files.length < 2000 || files.includes(`${key}.png`)) await fs.writeFile(file, png);
      return `data:image/png;base64,${png.toString('base64')}`;
    })().finally(() => {
      clearTimeout(timer);
      this.active.delete(key);
    });
    this.active.set(key, { promise, controller });
    return promise;
  }
  dispose() {
    for (const item of this.active.values()) item.controller.abort();
  }
}
module.exports = { IconService };
