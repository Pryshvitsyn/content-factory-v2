/**
 * Storage Manager
 * 
 * Handles video storage and retrieval
 */

const fs = require('fs');
const path = require('path');

class StorageManager {
  constructor() {
    this.storageDir = path.join(process.cwd(), 'storage');
    
    // Create storage directory if it doesn't exist
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  async save(item) {
    const { id, type, data, metadata } = item;
    
    const filePath = path.join(this.storageDir, `${id}.${type}`);
    const metaPath = path.join(this.storageDir, `${id}.json`);
    
    fs.writeFileSync(filePath, data);
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
    
    console.log(`[Storage] Saved ${id} to ${filePath}`);
    
    return { path: filePath, id };
  }

  async get(id) {
    const filePath = path.join(this.storageDir, `${id}`);
    const metaPath = path.join(this.storageDir, `${id}.json`);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${id}`);
    }
    
    const data = fs.readFileSync(filePath);
    const metadata = fs.existsSync(metaPath) 
      ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) 
      : {};
    
    return { data, metadata };
  }
}

module.exports = { StorageManager };
