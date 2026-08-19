'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

class FilesystemStorageAdapter {
  constructor({ root }) {
    if (!root) throw new Error('Storage root is required');
    this.root = path.resolve(root);
  }

  async put({ key, content }) {
    if (!key || typeof content !== 'string') throw new Error('Storage put requires key and string content');
    const target = path.resolve(this.root, key);
    if (!target.startsWith(`${this.root}${path.sep}`)) throw new Error('Storage key escapes root');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
    return { key, uri: target };
  }

  async get({ key }) {
    const target = path.resolve(this.root, key);
    if (!target.startsWith(`${this.root}${path.sep}`)) throw new Error('Storage key escapes root');
    return fs.readFile(target, 'utf8');
  }
}

module.exports = { FilesystemStorageAdapter };
