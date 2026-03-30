const axios = require('axios');

const imageCache = new Map();
const IMAGE_CACHE_TTL = parseInt(process.env.IMAGE_CACHE_TTL_MS || String(10 * 60 * 1000), 10);
const IMAGE_MAX_SIZE = parseInt(process.env.IMAGE_MAX_SIZE_BYTES || String(1 * 1024 * 1024), 10);
const IMAGE_CACHE_MAX_ENTRIES = parseInt(process.env.IMAGE_CACHE_MAX_ENTRIES || '20', 10);
const IMAGE_CACHE_MAX_MEMORY = parseInt(process.env.IMAGE_CACHE_MAX_MEMORY_BYTES || String(12 * 1024 * 1024), 10);
const IMAGE_CACHE_CLEANUP_INTERVAL = parseInt(process.env.IMAGE_CACHE_CLEANUP_INTERVAL_MS || String(5 * 60 * 1000), 10);

function pruneImageCache() {
    const now = Date.now();
    for (const [url, cacheEntry] of imageCache.entries()) {
        if (!cacheEntry || !cacheEntry.timestamp || (now - cacheEntry.timestamp) > IMAGE_CACHE_TTL) {
            imageCache.delete(url);
        }
    }

    let totalCacheSize = 0;
    const entries = Array.from(imageCache.entries());
    for (const [, cacheEntry] of entries) {
        totalCacheSize += cacheEntry.data.length;
    }

    if (imageCache.size > IMAGE_CACHE_MAX_ENTRIES || totalCacheSize > IMAGE_CACHE_MAX_MEMORY) {
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
        for (const [url, cacheEntry] of entries) {
            if (imageCache.size <= IMAGE_CACHE_MAX_ENTRIES * 0.8 && totalCacheSize <= IMAGE_CACHE_MAX_MEMORY * 0.8) {
                break;
            }
            imageCache.delete(url);
            totalCacheSize -= cacheEntry.data.length;
        }
    }
}

const cleanupTimer = setInterval(pruneImageCache, IMAGE_CACHE_CLEANUP_INTERVAL);
if (typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
}

/**
 * Fetch and cache an image from a URL.
 */
async function fetchImage(imageUrl) {
    const cached = imageCache.get(imageUrl);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < IMAGE_CACHE_TTL) {
        return {
            success: true,
            data: cached.data,
            contentType: cached.contentType,
            cached: true
        };
    } else if (cached) {
        imageCache.delete(imageUrl);
    }

    try {
        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            maxContentLength: IMAGE_MAX_SIZE,
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        const imageData = Buffer.from(response.data);
        if (imageData.length > IMAGE_MAX_SIZE) {
            throw new Error(`Image exceeds max size (${imageData.length} > ${IMAGE_MAX_SIZE})`);
        }
        const contentType = response.headers['content-type'] || 'image/jpeg';
        
        imageCache.set(imageUrl, {
            data: imageData,
            contentType,
            timestamp: Date.now()
        });
        
        pruneImageCache();
        
        return {
            success: true,
            data: imageData,
            contentType,
            cached: false
        };
    } catch (error) {
        if (cached) {
            return {
                success: true,
                data: cached.data,
                contentType: cached.contentType,
                cached: true,
                stale: true
            };
        }
        throw error;
    }
}

module.exports = {
    fetchImage
};
