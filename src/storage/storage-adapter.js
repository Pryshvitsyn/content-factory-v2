'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

class FilesystemStorageAdapter {
  constructor({ root }) {
    if (!root) throw new Error('Storage root is required');
    this.root = path.resolve(root);
  }

  resolveKey(key) {
    if (!key || typeof key !== 'string') throw new Error('Storage key is required');
    const target = path.resolve(this.root, key);
    if (target !== this.root && !target.startsWith(`${this.root}${path.sep}`)) {
      throw new Error('Storage key escapes root');
    }
    return target;
  }

  async put({ key, bytes, metadata = {} }) {
    if (!Buffer.isBuffer(bytes)) throw new Error('Storage put requires Buffer bytes');
    const target = this.resolveKey(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes, { flag: 'wx' });
    return Object.freeze({ key, size: bytes.length, metadata: { ...metadata } });
  }

  async get({ key }) {
    return fs.readFile(this.resolveKey(key));
  }

  async head({ key }) {
    const target = this.resolveKey(key);
    const stat = await fs.stat(target);
    return { key, size: stat.size, modifiedAt: stat.mtime.toISOString() };
  }

  async exists({ key }) {
    try {
      await fs.access(this.resolveKey(key));
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async delete({ key }) {
    await fs.rm(this.resolveKey(key), { force: true });
  }
}

module.exports = { FilesystemStorageAdapter };
