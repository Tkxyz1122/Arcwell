'use strict';
const { Readable } = require('node:stream');
// Electron net.fetch rejects manual redirects without exposing the response.
// Adapt net.request's redirect event so UpdateService can validate each hop.
function updateFetch(net) {
  return (url, { signal, headers }) =>
    new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const request = net.request({
        url,
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        headers,
      });
      let response,
        resolved = false;
      const abort = () => {
        const error = signal.reason || new Error('更新已取消。');
        response?.destroy(error);
        request.abort();
        if (!resolved) reject(error);
      };
      signal.addEventListener('abort', abort, { once: true });
      request.once('close', () => signal.removeEventListener('abort', abort));
      request.on('error', (error) => {
        if (response) response.destroy(error);
        else if (!resolved) reject(new Error('无法连接 GitHub，请检查网络后重试。'));
      });
      request.once('redirect', (status, _method, location) => {
        resolved = true;
        resolve({ ok: false, status, headers: new Headers({ location }), body: null });
        // Do not follow automatically: UpdateService checks this location first.
        request.abort();
      });
      request.once('response', (incoming) => {
        response = incoming;
        resolved = true;
        incoming.once('aborted', () => incoming.destroy(new Error('GitHub 下载中断，请重试。')));
        incoming.once('close', () => request.abort());
        const responseHeaders = new Headers(
          Object.entries(incoming.headers).map(([key, value]) => [
            key,
            Array.isArray(value) ? value.join(', ') : value,
          ]),
        );
        resolve({
          ok: incoming.statusCode >= 200 && incoming.statusCode < 300,
          status: incoming.statusCode,
          headers: responseHeaders,
          body: Readable.toWeb(incoming),
        });
      });
      request.end();
    });
}
module.exports = { updateFetch };
