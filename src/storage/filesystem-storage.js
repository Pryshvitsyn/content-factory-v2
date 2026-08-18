'use strict';

const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { mkdir, stat, access, open, link, unlink } = require('node:fs/promises');
const path = require('node:path');

class FilesystemStorage {
  constructor(root) {
    if (!root || !path.isAbsolute(root)) {
      throw new Error('Storage root must be an absolute path');
    }
    this.root = root;
  }

  resolveKey(key) {
    if (!key || path.isAbsolute(key) || key.includes('\\')) {
      throw new Error('Storage key must be a non-empty relative POSIX path');
    }

    const normalized = path.posix.normalize(key);
    if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
      throw new Error('Storage key contains path traversal');
    }

    const resolved = path.resolve(this.root, ...normalized.split('/'));
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : `${this.root}${path.sep}`;
    if (resolved !== this.root && !resolved.startsWith(rootWithSep)) {
      throw new Error('Resolved storage path escapes storage root');
    }
    return resolved;
  }

  async exists(key) {
    try {
      await access(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async head(key) {
    const file = this.resolveKey(key);
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Stored object is not a regular file');
    return {
      key,
      size: info.size,
      sha256: await this.hash(file),
      modifiedAt: info.mtime.toISOString(),
    };
  }

  async put(key, data, metadata = {}) {
    if (!Buffer.isBuffer(data)) throw new TypeError('Storage data must be a Buffer');
    const file = this.resolveKey(key);
    if (await this.exists(key)) {
      throw new Error(`Immutable storage object already exists: ${key}`);
    }

    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const handle = await open(temp, 'wx');
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      // link() gives create-only semantics: a concurrent writer cannot replace the object.
      await link(temp, file);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
    await unlink(temp);

    const info = await stat(file);
    return {
      key,
      size: info.size,
      contentType: metadata.contentType,
      sha256: createHash('sha256').update(data).digest('hex'),
      modifiedAt: info.mtime.toISOString(),
    };
  }

  createReadStream(key) {
    return createReadStream(this.resolveKey(key));
  }

  async hash(file) {
    const hash = createHash('sha256');
    const stream = createReadStream(file);
    for await (const chunk of stream) hash.update(chunk);
    return hash.digest('hex');
  }
}

module.exports = { FilesystemStorage };
