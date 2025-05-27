import { getLocalStorageUsage, cleanupUnusedImageEntries, getLocalStorageQuotaInfo } from './localStorageUtils';

// Test function to verify localStorage cleanup functionality
export const testLocalStorageCleanup = async () => {
  console.log('Testing localStorage cleanup functionality...');
  
  // Get initial storage info
  const initialUsage = getLocalStorageUsage();
  console.log('Initial localStorage usage:', initialUsage.formattedTotalSize);
  
  // Add some fake image entries to test cleanup
  localStorage.setItem('tempImage_test1', 'data:image/png;base64,' + 'A'.repeat(1000));
  localStorage.setItem('imageCache_test2', 'data:image/jpeg;base64,' + 'B'.repeat(2000));
  localStorage.setItem('generatedImage_test3', 'data:image/webp;base64,' + 'C'.repeat(1500));
  localStorage.setItem('normalData', 'This should not be cleaned up');
  
  const usageAfterAdding = getLocalStorageUsage();
  console.log('Usage after adding test entries:', usageAfterAdding.formattedTotalSize);
  console.log('Test entries added:', usageAfterAdding.itemCount - initialUsage.itemCount);
  
  // Test cleanup
  const cleanupResult = cleanupUnusedImageEntries();
  console.log('Cleanup result:', cleanupResult);
  
  const usageAfterCleanup = getLocalStorageUsage();
  console.log('Usage after cleanup:', usageAfterCleanup.formattedTotalSize);
  
  // Verify that normal data was preserved
  const normalDataPreserved = localStorage.getItem('normalData') === 'This should not be cleaned up';
  console.log('Normal data preserved:', normalDataPreserved);
  
  // Test quota info
  const quotaInfo = await getLocalStorageQuotaInfo();
  console.log('Browser storage quota info:', quotaInfo);
  
  // Cleanup test data
  localStorage.removeItem('normalData');
  
  console.log('localStorage cleanup test completed successfully!');
  
  return {
    initialUsage: initialUsage.totalSize,
    usageAfterAdding: usageAfterAdding.totalSize,
    usageAfterCleanup: usageAfterCleanup.totalSize,
    cleanupResult,
    normalDataPreserved,
    quotaInfo
  };
}; 