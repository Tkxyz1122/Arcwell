'use strict';
// Rasterize the vector source with the bundled Chromium; retain transparent corners.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
app.whenReady().then(async () => {
  let window;
  try {
    const assets = path.resolve(__dirname, '../assets');
    const svg = await fs.readFile(path.join(assets, 'icon.svg'), 'utf8');
    window = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    await window.loadURL('data:text/html,<html><body></body></html>');
    const images = await window.webContents.executeJavaScript(`(async () => {
      const image = new Image();
      image.src = ${JSON.stringify(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)};
      await image.decode();
      return [16, 24, 32, 48, 64, 128, 256].map(size => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
        canvas.getContext('2d').drawImage(image, 0, 0, size, size);
        return { size, png: canvas.toDataURL('image/png').split(',')[1] };
      });
    })()`);
    const header = Buffer.alloc(6 + images.length * 16);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(images.length, 4);
    const buffers = [];
    let offset = header.length;
    images.forEach(({ size, png }, i) => {
      const buffer = Buffer.from(png, 'base64'),
        entry = 6 + i * 16;
      header[entry] = header[entry + 1] = size === 256 ? 0 : size;
      header.writeUInt16LE(1, entry + 4);
      header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(buffer.length, entry + 8);
      header.writeUInt32LE(offset, entry + 12);
      offset += buffer.length;
      buffers.push(buffer);
    });
    await fs.writeFile(path.join(assets, 'icon.ico'), Buffer.concat([header, ...buffers]));
    await fs.writeFile(path.join(assets, 'icon-preview.png'), buffers.at(-1));
    console.log('Rounded icon generated at seven sizes (16–256), with transparent corners.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (window) window.destroy();
    app.quit();
  }
});
