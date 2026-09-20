/**
 * Slicing Result Cache
 * Keyed by: MD5(file_hash + scale_xyz + material_id + quality_id + infill)
 */

const crypto = require('crypto');

class SlicerCache {
  constructor(maxSize = 1000, ttlMs = 24 * 60 * 60 * 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  generateKey({ fileHash, dims, scale, materialId, qualityId, infill }) {
    const scaleStr = scale ? `${scale.x},${scale.y},${scale.z}` : (dims ? `${dims.x},${dims.y},${dims.z}` : '1,1,1');
    const raw = `${fileHash}|${scaleStr}|${materialId || 'pla'}|${qualityId || 'standard'}|${infill || 20}`;
    return crypto.createHash('md5').update(raw).digest('hex');
  }

  get(keyParams) {
    const key = typeof keyParams === 'string' ? keyParams : this.generateKey(keyParams);
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check expiration
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  set(keyParams, data) {
    const key = typeof keyParams === 'string' ? keyParams : this.generateKey(keyParams);
    if (this.cache.size >= this.maxSize) {
      // Evict oldest
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
    return key;
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

const defaultCache = new SlicerCache();

module.exports = {
  SlicerCache,
  defaultCache
};
