/**
 * Video Storage Module
 * 
 * Storage abstraction for generated videos
 * 
 * Features:
 * - Local filesystem storage
 * - S3 storage (AWS, MinIO, etc.)
 * - Configurable paths and buckets
 * - Automatic directory creation
 */

const path = require('path');
const fs = require('fs').promises;

class VideoStorage {
  /**
   * @param {Object} config - Storage configuration
   */
  constructor(config = {}) {
    this.config = {
      type: config.type || 'local', // 'local' or 's3'
      basePath: config.basePath || './output/videos',
      s3: config.s3 || {
        bucket: 'content-factory-videos',
        region: 'us-east-1',
        prefix: 'videos/'
      },
      ...config
    };
    
    // Initialize S3 client if configured
    if (this.config.type === 's3') {
      try {
        // Lazy load AWS SDK
        this.s3Client = null;
        console.log('[VideoStorage] S3 storage configured (client not initialized yet)');
      } catch (error) {
        console.error('[VideoStorage] Failed to initialize S3 client:', error);
        throw error;
      }
    }
  }

  /**
   * Store video file
   * @param {Buffer|string} fileData - Video file data (buffer or path)
   * @param {string} jobId - Job identifier
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<string>} - Storage path/URL
   */
  async store(fileData, jobId, metadata = {}) {
    console.log('[VideoStorage] Storing video...', { jobId, type: this.config.type });
    
    try {
      if (this.config.type === 'local') {
        return await this._storeLocal(fileData, jobId, metadata);
      } else if (this.config.type === 's3') {
        return await this._storeS3(fileData, jobId, metadata);
      } else {
        throw new Error(`Unknown storage type: ${this.config.type}`);
      }
    } catch (error) {
      console.error('[VideoStorage] Store failed:', error);
      throw error;
    }
  }

  /**
   * Store video locally
   * @private
   */
  async _storeLocal(fileData, jobId, metadata) {
    // Ensure base directory exists
    await fs.mkdir(this.config.basePath, { recursive: true });
    
    // Generate filename
    const filename = `${jobId}.mp4`;
    const filePath = path.join(this.config.basePath, filename);
    
    // Write file
    if (Buffer.isBuffer(fileData)) {
      await fs.writeFile(filePath, fileData);
    } else if (typeof fileData === 'string') {
      // Assume it's a path, copy file
      await fs.copyFile(fileData, filePath);
    } else {
      throw new Error('Invalid file data type');
    }
    
    // Write metadata
    const metadataPath = filePath + '.json';
    await fs.writeFile(
      metadataPath, 
      JSON.stringify({
        jobId,
        storedAt: new Date().toISOString(),
        ...metadata
      }, null, 2)
    );
    
    console.log(`[VideoStorage] Stored locally: ${filePath}`);
    
    return filePath;
  }

  /**
   * Store video in S3
   * @private
   */
  async _storeS3(fileData, jobId, metadata) {
    // Lazy initialize S3 client
    if (!this.s3Client) {
      const { S3Client } = require('@aws-sdk/client-s3');
      this.s3Client = new S3Client({
        region: this.config.s3.region
      });
    }
    
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    
    // Generate key
    const filename = `${jobId}.mp4`;
    const key = `${this.config.s3.prefix}${filename}`;
    
    // Prepare upload
    const uploadParams = {
      Bucket: this.config.s3.bucket,
      Key: key,
      Body: Buffer.isBuffer(fileData) ? fileData : await fs.readFile(fileData),
      ContentType: 'video/mp4',
      Metadata: {
        'job-id': jobId,
        'stored-at': new Date().toISOString(),
        ...Object.entries(metadata).reduce((acc, [k, v]) => {
          acc[k] = String(v);
          return acc;
        }, {})
      }
    };
    
    // Upload
    const command = new PutObjectCommand(uploadParams);
    await this.s3Client.send(command);
    
    // Generate URL
    const s3Url = `https://${this.config.s3.bucket}.s3.${this.config.s3.region}.amazonaws.com/${key}`;
    
    console.log(`[VideoStorage] Stored in S3: ${s3Url}`);
    
    return s3Url;
  }

  /**
   * Get video file
   * @param {string} storagePath - Storage path or URL
   * @returns {Promise<Buffer>} - Video file data
   */
  async get(storagePath) {
    console.log('[VideoStorage] Retrieving video...', { storagePath });
    
    if (this.config.type === 'local') {
      return await fs.readFile(storagePath);
    } else if (this.config.type === 's3') {
      return await this._getS3(storagePath);
    } else {
      throw new Error(`Unknown storage type: ${this.config.type}`);
    }
  }

  /**
   * Get video from S3
   * @private
   */
  async _getS3(s3Url) {
    if (!this.s3Client) {
      const { S3Client } = require('@aws-sdk/client-s3');
      this.s3Client = new S3Client({
        region: this.config.s3.region
      });
    }
    
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    
    // Parse URL to get bucket and key
    const url = new URL(s3Url);
    const bucket = url.hostname.split('.')[0];
    const key = url.pathname.slice(1);
    
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });
    
    const response = await this.s3Client.send(command);
    const chunks = [];
    
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    
    return Buffer.concat(chunks);
  }

  /**
   * Delete video
   * @param {string} storagePath - Storage path or URL
   */
  async delete(storagePath) {
    console.log('[VideoStorage] Deleting video...', { storagePath });
    
    if (this.config.type === 'local') {
      await fs.unlink(storagePath);
      
      // Also delete metadata file if exists
      const metadataPath = storagePath + '.json';
      try {
        await fs.unlink(metadataPath);
      } catch {
        // Ignore if metadata doesn't exist
      }
    } else if (this.config.type === 's3') {
      await this._deleteS3(storagePath);
    }
  }

  /**
   * Delete video from S3
   * @private
   */
  async _deleteS3(s3Url) {
    if (!this.s3Client) {
      const { S3Client } = require('@aws-sdk/client-s3');
      this.s3Client = new S3Client({
        region: this.config.s3.region
      });
    }
    
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    
    // Parse URL to get bucket and key
    const url = new URL(s3Url);
    const bucket = url.hostname.split('.')[0];
    const key = url.pathname.slice(1);
    
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key
    });
    
    await this.s3Client.send(command);
  }

  /**
   * List stored videos
   * @returns {Promise<Array>} - List of video metadata
   */
  async list() {
    if (this.config.type === 'local') {
      return await this._listLocal();
    } else if (this.config.type === 's3') {
      return await this._listS3();
    } else {
      throw new Error(`Unknown storage type: ${this.config.type}`);
    }
  }

  /**
   * List videos locally
   * @private
   */
  async _listLocal() {
    const files = await fs.readdir(this.config.basePath);
    const videos = [];
    
    for (const file of files) {
      if (file.endsWith('.mp4')) {
        const metadataPath = path.join(this.config.basePath, file + '.json');
        let metadata = {};
        
        try {
          const metadataContent = await fs.readFile(metadataPath, 'utf-8');
          metadata = JSON.parse(metadataContent);
        } catch {
          // No metadata available
        }
        
        videos.push({
          filename: file,
          path: path.join(this.config.basePath, file),
          ...metadata
        });
      }
    }
    
    return videos;
  }

  /**
   * List videos in S3
   * @private
   */
  async _listS3() {
    if (!this.s3Client) {
      const { S3Client } = require('@aws-sdk/client-s3');
      this.s3Client = new S3Client({
        region: this.config.s3.region
      });
    }
    
    const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
    
    const command = new ListObjectsV2Command({
      Bucket: this.config.s3.bucket,
      Prefix: this.config.s3.prefix
    });
    
    const response = await this.s3Client.send(command);
    
    return response.Contents || [];
  }
}

module.exports = { VideoStorage };
