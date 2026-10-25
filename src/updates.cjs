'use strict';
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash, verify, randomUUID } = require('node:crypto');
const REPOSITORY = 'Tkxyz1122/Arcwell';
const RELEASES = `https://github.com/${REPOSITORY}/releases`;
const API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const MAX_PACKAGE = 400 * 1024 * 1024;
function versionParts(version) {
  if (typeof version !== 'string' || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(version))
    throw new Error('更新版本号无效。');
  return version.split('.').map(Number);
}
function newer(candidate, current) {
  const a = versionParts(candidate),
    b = versionParts(current);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function releaseAsset(release, filename) {
  const asset = release.assets?.find((item) => item.name === filename);
  const expected = `${RELEASES}/download/${encodeURIComponent(release.tag_name)}/${filename}`;
  if (
    !asset ||
    asset.browser_download_url !== expected ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0
  )
    throw new Error('此版本的更新文件尚未就绪，请稍后重试或查看 GitHub 发布页。');
  return asset;
}
function signedManifest(bytes, publicKey, version) {
  try {
    const envelope = JSON.parse(bytes.toString('utf8'));
    if (typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string')
      throw new Error();
    const payload = Buffer.from(envelope.payload, 'base64');
    const signature = Buffer.from(envelope.signature, 'base64');
    if (signature.length !== 64 || !verify(null, payload, publicKey, signature)) throw new Error();
    const manifest = JSON.parse(payload.toString('utf8'));
    versionParts(manifest.version);
    if (
      manifest.repository !== REPOSITORY ||
      manifest.version !== version ||
      manifest.filename !== `Arcwell-${version}-Update.exe` ||
      !Number.isSafeInteger(manifest.size) ||
      manifest.size <= 0 ||
      manifest.size > MAX_PACKAGE ||
      !/^[a-f0-9]{64}$/.test(manifest.sha256)
    )
      throw new Error();
    return manifest;
  } catch {
    throw new Error('更新签名或清单无效，已阻止下载和安装。');
  }
}
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
class UpdateService {
  constructor({ currentVersion, directory, fetch, publicKey }) {
    versionParts(currentVersion);
    this.currentVersion = currentVersion;
    this.directory = directory;
    this.fetch = fetch;
    this.publicKey = publicKey;
    this.state = {
      phase: 'idle',
      currentVersion,
      releaseUrl: RELEASES,
      message: '按需检查 GitHub 上的正式版本。',
    };
    this.controller = null;
    this.available = null;
    this.readyFile = null;
    this.task = null;
  }
  status() {
    return { ...this.state };
  }
  async request(url, signal) {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const parsed = new URL(url);
      if (
        parsed.protocol !== 'https:' ||
        parsed.username ||
        parsed.password ||
        parsed.port ||
        ![
          'api.github.com',
          'github.com',
          'release-assets.githubusercontent.com',
          'objects.githubusercontent.com',
        ].includes(parsed.hostname)
      )
        throw new Error('更新下载地址不受支持。');
      const response = await this.fetch(url, {
        signal,
        redirect: 'manual',
        cache: 'no-store',
        headers: { 'User-Agent': 'Arcwell', Accept: 'application/vnd.github+json' },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new Error('更新下载跳转无效。');
        url = new URL(location, url).href;
        continue;
      }
      return response;
    }
    throw new Error('更新下载跳转次数过多。');
  }
  async bytes(url, signal, limit) {
    const response = await this.request(url, signal);
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404 && url === API) return null;
      throw new Error(
        response.status === 403 || response.status === 429
          ? 'GitHub 暂时限制请求，请稍后重试。'
          : `无法读取 GitHub 更新（HTTP ${response.status}）。`,
      );
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) throw new Error('更新信息超过大小限制。');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  start(phase, operation, timeout) {
    if (this.task) throw new Error('正在处理更新，请等待或取消。');
    this.controller = new AbortController();
    const controller = this.controller;
    this.state = {
      ...this.state,
      phase,
      progress: 0,
      message: phase === 'checking' ? '正在检查 GitHub 正式版本…' : '正在下载更新包…',
    };
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeout);
    this.task = operation(controller.signal)
      .catch((error) => {
        this.state = {
          ...this.state,
          phase: 'error',
          message: controller.signal.aborted
            ? controller.signal.reason?.message === 'timeout'
              ? '更新请求超时，请重试。'
              : '已取消，当前程序和收藏保持不变。'
            : error.message || '更新失败，请检查网络后重试。',
        };
        return this.status();
      })
      .finally(() => {
        clearTimeout(timer);
        this.task = null;
        this.controller = null;
      });
    return this.task;
  }
  check() {
    return this.start(
      'checking',
      async (signal) => {
        this.available = null;
        this.readyFile = null;
        const bytes = await this.bytes(API, signal, 1024 * 1024);
        if (!bytes) {
          this.state = { ...this.state, phase: 'current', message: 'GitHub 尚未发布正式版本。' };
          return this.status();
        }
        const release = JSON.parse(bytes.toString('utf8'));
        const version = release.tag_name?.replace(/^v/, '');
        versionParts(version);
        if (release.draft || release.prerelease) throw new Error('更新源未提供正式版本。');
        if (!newer(version, this.currentVersion)) {
          this.state = {
            ...this.state,
            phase: 'current',
            version,
            message: `当前已是最新版本 ${this.currentVersion}。`,
          };
          return this.status();
        }
        const asset = releaseAsset(release, 'update.json');
        const manifest = signedManifest(
          await this.bytes(asset.browser_download_url, signal, 64 * 1024),
          this.publicKey,
          version,
        );
        const installer = releaseAsset(release, manifest.filename);
        if (installer.size !== manifest.size) throw new Error('更新包大小与签名清单不一致。');
        this.available = { manifest, url: installer.browser_download_url };
        this.state = {
          ...this.state,
          phase: 'available',
          version,
          message: `发现新版本 ${version}（${Math.ceil(manifest.size / 1048576)} MB）。下载并校验后可更新，无需卸载。`,
        };
        return this.status();
      },
      60000,
    );
  }
  download() {
    if (!this.available || this.readyFile) throw new Error('请先检查更新。');
    return this.start(
      'downloading',
      async (signal) => {
        const { manifest, url } = this.available;
        await fs.mkdir(this.directory, { recursive: true });
        // This directory belongs only to the updater. Never traverse user files.
        for (const name of await fs.readdir(this.directory))
          if (/^Arcwell-\d+\.\d+\.\d+-Update\.exe(?:\.[a-f\d-]+\.part)?$/.test(name))
            await fs.unlink(path.join(this.directory, name));
        const temporary = path.join(this.directory, `${manifest.filename}.${randomUUID()}.part`);
        const target = path.join(this.directory, manifest.filename);
        let file;
        try {
          const response = await this.request(url, signal);
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error(`更新包下载失败（HTTP ${response.status}）。`);
          }
          file = await fs.open(temporary, 'wx');
          let size = 0;
          const hash = createHash('sha256');
          for await (const chunk of response.body) {
            signal.throwIfAborted();
            size += chunk.length;
            if (size > manifest.size) throw new Error('更新包超过声明大小，已停止下载。');
            await file.writeFile(chunk);
            hash.update(chunk);
            this.state.progress = Math.floor((size * 100) / manifest.size);
          }
          if (size !== manifest.size || hash.digest('hex') !== manifest.sha256)
            throw new Error('更新包 SHA-256 校验失败，已阻止安装。');
          signal.throwIfAborted();
          await file.sync();
          await file.close();
          file = null;
          await fs.rename(temporary, target);
          this.readyFile = target;
          this.state = {
            ...this.state,
            phase: 'ready',
            progress: 100,
            message: `版本 ${manifest.version} 已下载，签名与 SHA-256 校验通过。`,
          };
          return this.status();
        } finally {
          if (file) await file.close();
          await fs.unlink(temporary).catch((error) => {
            if (error.code !== 'ENOENT') throw error;
          });
        }
      },
      10 * 60000,
    );
  }
  cancel() {
    this.controller?.abort();
    return this.status();
  }
  async installFile() {
    if (this.task || this.state.phase !== 'ready' || !this.readyFile)
      throw new Error('请先下载并校验更新包。');
    const stat = await fs.lstat(this.readyFile);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size !== this.available.manifest.size ||
      (await hashFile(this.readyFile)) !== this.available.manifest.sha256
    ) {
      this.readyFile = null;
      this.state.phase = 'error';
      throw new Error('更新包已改变，请重新检查并下载。');
    }
    return this.readyFile;
  }
  async dispose() {
    this.cancel();
    await this.task;
  }
}
module.exports = { UpdateService, newer, signedManifest, hashFile, REPOSITORY, RELEASES };
