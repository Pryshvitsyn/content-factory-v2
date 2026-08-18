'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'content-factory-storage-'));
  const source = `const { FilesystemStorage } = require('../dist/storage/filesystem-storage');`;

  // The adapter is TypeScript; CI should compile it before this test when a TS build is present.
  // This guard keeps the test explicit instead of silently skipping it.
  let Storage;
  try {
    Storage = require('../dist/storage/filesystem-storage').FilesystemStorage;
  } catch {
    throw new Error(`Storage adapter test requires compiled adapter at dist/storage/filesystem-storage.js (source: ${source})`);
  }

  const storage = new Storage(root);
  const key = 'artifacts/production-1042/video/video-88/v3/final.mp4';
  const payload = Buffer.from('content-factory-storage-fixture');

  try {
    assert.throws(() => new Storage('relative-root'), /absolute path/);

    const stored = await storage.put(key, payload, { contentType: 'video/mp4' });
    assert.equal(stored.key, key);
    assert.equal(stored.size, payload.length);
    assert.equal(stored.contentType, 'video/mp4');
    assert.match(stored.sha256, /^[a-f0-9]{64}$/);
    assert.equal(await storage.exists(key), true);

    const metadata = await storage.head(key);
    assert.equal(metadata.size, payload.length);
    assert.equal(metadata.sha256, stored.sha256);

    const chunks = [];
    for await (const chunk of storage.createReadStream(key)) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), payload);

    await assert.rejects(
      storage.put(key, Buffer.from('different')),
      /already exists/,
    );

    await assert.rejects(
      storage.put('../escape.txt', payload),
      /path traversal/,
    );
    await assert.rejects(
      storage.put('/absolute.txt', payload),
      /relative POSIX path/,
    );
    await assert.rejects(
      storage.put('artifacts\\escape.txt', payload),
      /relative POSIX path/,
    );

    assert.equal(await storage.exists('missing/file.bin'), false);

    console.log('V2.1 storage adapter: PASS');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
