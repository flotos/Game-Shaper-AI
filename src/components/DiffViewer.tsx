import React, { CSSProperties } from 'react';
import ReactMarkdown from 'react-markdown';
// @ts-ignore - rehypeRaw has no default TS types in our setup
import rehypeRaw from 'rehype-raw';

interface DiffViewerProps {
  original: string | string[] | undefined | null;
  updated: string | string[] | undefined | null;
  isCurrent: boolean;
  className?: string;
  style?: CSSProperties;
}

export const createDiffMarkdown = (
  original: string | string[] | undefined | null,
  updated: string | string[] | undefined | null,
  isCurrent: boolean
) => {
  try {
    // Handle undefined or null values and ensure strings
    const originalText = typeof original === 'string' ? original : 
                        Array.isArray(original) ? original.join(', ') : '';
    const updatedText = typeof updated === 'string' ? updated : 
                       Array.isArray(updated) ? updated.join(', ') : '';
    
    // Split into words and normalize whitespace
    const originalWords = originalText.trim().split(/(\s+)/); // keep spaces as tokens
    const updatedWords = updatedText.trim().split(/(\s+)/);
    const resultParts: string[] = [];
    
    // Find the longest common subsequence (on word+whitespace tokens)
    const lcs: (string)[] = [];
    const dp: number[][] = Array(originalWords.length + 1).fill(0).map(() => Array(updatedWords.length + 1).fill(0));
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
    // Render diff as markdown with span wrappers
    i = 0;
    j = 0;
    let lcsIndex = 0;
    if (isCurrent) {
      // Show original side with deletions in red
      while (i < originalWords.length) {
        if (lcsIndex < lcs.length && originalWords[i] === lcs[lcsIndex]) {
          resultParts.push(originalWords[i]);
          i++;
          lcsIndex++;
        } else {
          // deletion (present in original only)
          const token = originalWords[i];
          // Spaces should not be colored
          if (/^\s+$/.test(token)) {
            resultParts.push(token);
          } else {
            resultParts.push(`<span class="bg-red-900 text-white">${token}</span>`);
          }
          i++;
        }
      }
    } else {
      // Show updated side with additions in green
      while (j < updatedWords.length) {
        if (lcsIndex < lcs.length && updatedWords[j] === lcs[lcsIndex]) {
          resultParts.push(updatedWords[j]);
          j++;
          lcsIndex++;
        } else {
          const token = updatedWords[j];
          if (/^\s+$/.test(token)) {
            resultParts.push(token);
          } else {
            resultParts.push(`<span class="bg-green-900 text-white">${token}</span>`);
          }
          j++;
        }
      }
    }
    return resultParts.join('');
  } catch (error) {
    console.error('Error in createDiffMarkdown:', error);
    return 'Error displaying diff';
  }
};

const DiffViewer: React.FC<DiffViewerProps> = ({ original, updated, isCurrent, className = '', style }) => {
  const markdownWithDiff = createDiffMarkdown(original, updated, isCurrent);
  return (
    <div className={`p-2 bg-gray-700 rounded text-white whitespace-pre-wrap ${className}`} style={style}>
      <ReactMarkdown rehypePlugins={[rehypeRaw]}>{markdownWithDiff}</ReactMarkdown>
    </div>
  );
};

export default DiffViewer; 