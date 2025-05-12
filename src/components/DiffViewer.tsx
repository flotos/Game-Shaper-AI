import React, { CSSProperties } from 'react';

interface DiffViewerProps {
  original: string | string[] | undefined | null;
  updated: string | string[] | undefined | null;
  isCurrent: boolean;
  className?: string;
  style?: CSSProperties;
}

export const createDiffSpans = (original: string | string[] | undefined | null, updated: string | string[] | undefined | null, isCurrent: boolean) => {
  try {
    // Handle undefined or null values and ensure strings
    const originalText = typeof original === 'string' ? original : 
                        Array.isArray(original) ? original.join(', ') : '';
    const updatedText = typeof updated === 'string' ? updated : 
                       Array.isArray(updated) ? updated.join(', ') : '';
    
    // Split into words and normalize whitespace
    const originalWords = originalText.trim().split(/\s+/);
    const updatedWords = updatedText.trim().split(/\s+/);
    const result = [];
    
    // Find the longest common subsequence
    const lcs = [];
    const dp = Array(originalWords.length + 1).fill(0).map(() => Array(updatedWords.length + 1).fill(0));
    
    for (let i = 1; i <= originalWords.length; i++) {
      for (let j = 1; j <= updatedWords.length; j++) {
        if (originalWords[i - 1] === updatedWords[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }
    
    let i = originalWords.length;
    let j = updatedWords.length;
    
    while (i > 0 && j > 0) {
      if (originalWords[i - 1] === updatedWords[j - 1]) {
        lcs.unshift(originalWords[i - 1]);
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }
    
    // Now render the differences
    i = 0;
    j = 0;
    let lcsIndex = 0;
    
    if (isCurrent) {
      // Left side - show original with deletions in red
      while (i < originalWords.length) {
        if (lcsIndex < lcs.length && originalWords[i] === lcs[lcsIndex]) {
          result.push(<span key={`common-${i}`} className="text-white">{lcs[lcsIndex]} </span>);
          i++;
          lcsIndex++;
        } else {
          result.push(
            <span key={`old-${i}`} className="bg-red-900 text-white">
              {originalWords[i]}{' '}
            </span>
          );
          i++;
        }
      }
    } else {
      // Right side - show updated with additions in green
      while (j < updatedWords.length) {
        if (lcsIndex < lcs.length && updatedWords[j] === lcs[lcsIndex]) {
          result.push(<span key={`common-${j}`} className="text-white">{lcs[lcsIndex]} </span>);
          j++;
          lcsIndex++;
        } else {
          result.push(
            <span key={`new-${j}`} className="bg-green-900 text-white">
              {updatedWords[j]}{' '}
            </span>
          );
          j++;
        }
      }
    }
    
    return result;
  } catch (error) {
    console.error('Error in createDiffSpans:', error);
    return [<span key="error" className="text-red-500">Error displaying diff</span>];
  }
};

const DiffViewer: React.FC<DiffViewerProps> = ({ original, updated, isCurrent, className = '', style }) => {
  return (
    <div className={`p-2 bg-gray-700 rounded text-white whitespace-pre-wrap ${className}`} style={style}>
      {createDiffSpans(original, updated, isCurrent)}
    </div>
  );
};

export default DiffViewer; 