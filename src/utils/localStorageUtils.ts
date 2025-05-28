export const getLocalStorageUsage = () => {
  try {
    let totalSize = 0;
    const sizeByKey: Record<string, number> = {};
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key);
        if (value) {
          const size = new Blob([value]).size;
          sizeByKey[key] = size;
          totalSize += size;
        }
      }
    }
    
    return {
      totalSize,
      sizeByKey,
      formattedTotalSize: formatBytes(totalSize),
      itemCount: localStorage.length
    };
  } catch (error) {
    console.error('Error calculating localStorage usage:', error);
    return {
      totalSize: 0,
      sizeByKey: {},
      formattedTotalSize: '0 B',
      itemCount: 0
    };
  }
};

export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const cleanupLargeLocalStorageItems = (maxSizePerItem: number = 100000) => {
  const usage = getLocalStorageUsage();
  const itemsToClean: string[] = [];
  
  Object.entries(usage.sizeByKey).forEach(([key, size]) => {
    if (size > maxSizePerItem) {
      itemsToClean.push(key);
    }
  });
  
  console.log(`Found ${itemsToClean.length} large localStorage items to potentially clean:`, itemsToClean);
  return itemsToClean;
};

export const cleanupUnusedImageEntries = () => {
  const keysToRemove: string[] = [];
  let cleanedSize = 0;
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (
      key.startsWith('imageCache_') || 
      key.startsWith('tempImage_') || 
      key.startsWith('generatedImage_') ||
      key.startsWith('blob_') ||
      key.startsWith('dataUrl_')
    )) {
      const value = localStorage.getItem(key);
      if (value) {
        cleanedSize += new Blob([value]).size;
      }
      keysToRemove.push(key);
    }
  }
  
  keysToRemove.forEach(key => {
    localStorage.removeItem(key);
  });
  
  return {
    itemsRemoved: keysToRemove.length,
    bytesFreed: cleanedSize,
    formattedBytesFreed: formatBytes(cleanedSize)
  };
};

export const getLocalStorageQuotaInfo = async () => {
  try {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      return {
        quota: estimate.quota,
        usage: estimate.usage,
        available: estimate.quota ? estimate.quota - (estimate.usage || 0) : undefined,
        formattedQuota: estimate.quota ? formatBytes(estimate.quota) : 'Unknown',
        formattedUsage: estimate.usage ? formatBytes(estimate.usage) : 'Unknown',
        formattedAvailable: estimate.quota && estimate.usage ? formatBytes(estimate.quota - estimate.usage) : 'Unknown'
      };
    }
  } catch (error) {
    console.error('Error getting storage estimate:', error);
  }
  
  return {
    quota: undefined,
    usage: undefined,
    available: undefined,
    formattedQuota: 'Unknown',
    formattedUsage: 'Unknown',
    formattedAvailable: 'Unknown'
  };
};

export const handleQuotaExceededError = (key: string, value: string) => {
  console.warn(`localStorage quota exceeded when saving ${key}. Attempting cleanup...`);
  
  // Try image cleanup first (most likely culprit)
  const imageCleanup = cleanupUnusedImageEntries();
  console.log(`Image cleanup freed ${imageCleanup.formattedBytesFreed} of space`);
  
  // Try to save again after image cleanup
  try {
    localStorage.setItem(key, value);
    console.log(`Successfully saved ${key} after image cleanup`);
    return true;
  } catch (error) {
    console.warn(`Still unable to save ${key} after image cleanup`);
    
    // If still failing, check if any individual node has large base64 images
    if (key === 'nodeGraph') {
      try {
        const nodes = JSON.parse(value);
        let cleaned = false;
        
        for (const node of nodes) {
          if (node.image && typeof node.image === 'string' && node.image.startsWith('data:image/')) {
            console.log(`Removing large base64 image from node ${node.id} (${node.name})`);
            node.image = ''; // Clear the image, it can be regenerated
            cleaned = true;
          }
        }
        
        if (cleaned) {
          const cleanedValue = JSON.stringify(nodes);
          localStorage.setItem(key, cleanedValue);
          console.log(`Successfully saved ${key} after removing base64 images from nodes`);
          return true;
        }
      } catch (parseError) {
        console.error('Error parsing nodes for base64 cleanup:', parseError);
      }
    }
    
    return false;
  }
};

export const safeLocalStorageSetItem = (key: string, value: string): boolean => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      return handleQuotaExceededError(key, value);
    } else {
      console.error(`Error saving to localStorage (${key}):`, error);
      return false;
    }
  }
}; 