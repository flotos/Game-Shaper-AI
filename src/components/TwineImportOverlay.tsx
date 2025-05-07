import React, { useState, useRef, useEffect } from 'react';
import { Node } from '../models/Node';
import { extractDataFromTwine, generateNodesFromExtractedData, TWINE_DATA_EXTRACTION_PROMPT, TWINE_NODE_GENERATION_PROMPT_NEW_GAME, TWINE_NODE_GENERATION_PROMPT_MERGE } from '../services/LLMService';
import { Message } from '../context/ChatContext';
import { PromptSelector } from './PromptSelector';

// Throttle hook
function useThrottle<T>(value: T, delay: number): T {
  const [throttledValue, setThrottledValue] = useState<T>(value);
  const lastRun = useRef(Date.now());

  useEffect(() => {
    const handler = setTimeout(() => {
      if (Date.now() - lastRun.current >= delay) {
        setThrottledValue(value);
        lastRun.current = Date.now();
      }
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return throttledValue;
}

interface ExtractedElement {
  type: string;
  name: string;
  content: string;
}

interface ExtractedData {
  chunks: ExtractedElement[][];
}

interface TagStats {
  [key: string]: number;
}

interface PreviewState {
  showPreview: boolean;
  step: 'extraction' | 'generation' | 'preview';
  changes?: {
    new?: Partial<Node>[];
    update?: {
      id: string;
      longDescription?: string;
      rules?: string;
      updateImage?: boolean;
    }[];
    delete?: string[];
  };
  originalNodes: Node[];
  content?: string;
  extractedData?: ExtractedData;
}

interface TwineImportOverlayProps {
  nodes: Node[];
  updateGraph: (nodeEdition: { 
    merge: Node[];
    delete: string[];
    newNodes: string[];
  }, imagePrompts?: { nodeId: string; prompt: string }[]) => Promise<void>;
  closeOverlay: () => void;
}

// Helper function to create diff spans
const createDiffSpans = (original: string, updated: string, isCurrent: boolean) => {
  // Split into words and normalize whitespace
  const originalWords = original.trim().split(/\s+/);
  const updatedWords = updated.trim().split(/\s+/);
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
};

// Helper function to calculate height based on content length
const calculateHeight = (text: string, isLongDescription: boolean = false, defaultRows: number = 10) => {
  if (!isLongDescription) return `${defaultRows * 1.5}rem`;
  const lineCount = (text || '').split('\n').length;
  const minHeight = '15rem';
  const calculatedHeight = `${Math.max(15, lineCount * 1.5)}rem`;
  return calculatedHeight;
};

// Add Web Worker for content processing
const createContentProcessor = () => {
  const workerCode = `
    self.onmessage = function(e) {
      const { content, type, trimPercent } = e.data;
      
      function processContent(content, type, trimPercent) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/html');
        const passages = Array.from(doc.querySelectorAll('tw-passagedata'));
        
        // Process passages in chunks to prevent blocking
        const chunkSize = 10;
        const chunks = [];
        for (let i = 0; i < passages.length; i += chunkSize) {
          chunks.push(passages.slice(i, i + chunkSize));
        }
        
        let processedContent = '';
        
        function processChunk(chunk, index) {
          const processedChunk = chunk.map(passage => {
            const name = passage.getAttribute('name') || 'Untitled';
            let text = passage.textContent || '';
            
            if (type === 'aggressive') {
              // Skip script files and JavaScript content
              if (name.toLowerCase().endsWith('.js') || 
                  name.toLowerCase().includes('script') ||
                  text.trim().startsWith('(()') ||
                  text.trim().startsWith('function') ||
                  text.trim().startsWith('const') ||
                  text.trim().startsWith('let') ||
                  text.trim().startsWith('var') ||
                  text.trim().startsWith('/*') ||
                  text.trim().startsWith('//')) {
                return '';
              }
              
              // Combine all regex patterns into a single pass
              const patterns = [
                /\[Macros\][\s\S]*?(?=\n\n|$)/g,
                /\([^)]*\)/g,
                /\)+/g,
                /\(+/g,
                /\s+/g,
                /<[^>]+>/g,
                /<<[^>]+>>/g,
                /\[img\[[^\]]+\]\[[^\]]+\]\]/g,
                /\[\[[^\]]+\]\]/g,
                /<style[^>]*>[\s\S]*?<\/style>/g,
                /<script[^>]*>[\s\S]*?<\/script>/g,
                /&[^;]+;/g,
                /^>\s*/g,
                />/g,
                /</g,
                /[\[\]]/g
              ];
              
              // Apply all patterns in a single pass
              text = patterns.reduce((acc, pattern) => acc.replace(pattern, ''), text).trim();
              
              // Split into lines and filter in a single pass
              const lines = text.split('\\n');
              const cleanedLines = [];
              let groupCharCount = 0;
              let groupStartIndex = 0;
              let shortLineCount = 0;
              let lastLine = '';
              
              // Pre-compile regex patterns for line filtering
              const skipPatterns = [
                /^[^a-zA-Z]*passage\(\)[^a-zA-Z]*$/,
                /^\\d+\\$$/,
                /^[()\\d\\s,]+$/,
                /^case \\d+SET Scene to \\d+$/,
                /^defaultSET Scene to \\d+$/
              ];
              
              // Process lines in a single pass
              for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                
                // Skip empty lines and lines matching skip patterns
                if (!line || skipPatterns.some(pattern => pattern.test(line))) continue;
                
                // Skip lines with specific content
                if (line === '/button' ||
                    line.startsWith('src=') ||
                    line.startsWith('widget') ||
                    line.includes('layer') ||
                    line.includes('class=') ||
                    line.includes('img$image_dir+') ||
                    line.startsWith('/IF') ||
                    line.startsWith('ELSE') ||
                    line.startsWith('SET') ||
                    line.startsWith('/*') ||
                    line.startsWith('//') ||
                    line.startsWith('function') ||
                    line.startsWith('const') ||
                    line.startsWith('let') ||
                    line.startsWith('var') ||
                    line.includes('=>') ||
                    line.includes('{') ||
                    line.includes('}') ||
                    line.includes(';') ||
                    line.includes('()') ||
                    line.includes('return')) {
                  continue;
                }
                
                // Skip repeated lines
                if (line === lastLine) continue;
                
                // Process character density
                groupCharCount += line.length;
                if (i - groupStartIndex >= 14) {
                  if (groupCharCount >= 250) {
                    // Keep the lines in this group
                    for (let j = groupStartIndex; j <= i; j++) {
                      if (lines[j].trim()) {
                        cleanedLines.push(lines[j].trim());
                      }
                    }
                  }
                  groupStartIndex = i + 1;
                  groupCharCount = 0;
                }
                
                // Handle short lines
                if (line.length < 20) {
                  shortLineCount++;
                  if (shortLineCount >= 5) continue;
                } else {
                  shortLineCount = 0;
                }
                
                cleanedLines.push(line);
                lastLine = line;
              }
              
              // Process the last group
              if (lines.length - groupStartIndex > 0 && groupCharCount >= 250) {
                for (let j = groupStartIndex; j < lines.length; j++) {
                  if (lines[j].trim()) {
                    cleanedLines.push(lines[j].trim());
                  }
                }
              }
              
              return cleanedLines.length > 0 ? \`[\${name}]\\n\${cleanedLines.join('\\n')}\\n\` : '';
            } else {
              // Basic cleaning
              text = text
                .split('\\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .join('\\n');
              
              return \`[\${name}]\\n\${text}\\n\`;
            }
          }).join('');
          
          processedContent += processedChunk;
          
          // Report progress
          self.postMessage({
            type: 'progress',
            progress: Math.round((index + 1) / chunks.length * 100)
          });
          
          // Process next chunk if available
          if (index + 1 < chunks.length) {
            setTimeout(() => processChunk(chunks[index + 1], index + 1), 0);
          } else {
            // Apply trimming if needed
            if (trimPercent > 0) {
              const lines = processedContent.split('\\n');
              const totalLines = lines.length;
              const linesToRemove = Math.floor(totalLines * (trimPercent / 100));
              const startIndex = Math.floor((totalLines - linesToRemove) / 2);
              processedContent = lines
                .filter((_, index) => index < startIndex || index >= startIndex + linesToRemove)
                .join('\\n');
            }
            
            // Send final result
            self.postMessage({
              type: 'complete',
              content: processedContent
            });
          }
        }
        
        // Start processing first chunk
        processChunk(chunks[0], 0);
      }
      
      processContent(content, type, trimPercent);
    };
  `;
  
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  return new Worker(URL.createObjectURL(blob));
};

const TwineImportOverlay: React.FC<TwineImportOverlayProps> = ({ nodes, updateGraph, closeOverlay }) => {
  const [rawContent, setRawContent] = useState('');
  const [basicContent, setBasicContent] = useState('');
  const [aggressiveContent, setAggressiveContent] = useState('');
  const [selectedContent, setSelectedContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [tagStats, setTagStats] = useState<TagStats>({});
  const [importMode, setImportMode] = useState<'new_game' | 'merge_story'>('new_game');
  const [useAggressiveTrim, setUseAggressiveTrim] = useState(false);
  const [trimPercentage, setTrimPercentage] = useState(0);
  const throttledTrimPercentage = useThrottle(trimPercentage, 200); // 200ms throttle
  const [extractionCount, setExtractionCount] = useState(1);
  const [nextPromptInstructions, setNextPromptInstructions] = useState('');
  const [secondPromptInstructions, setSecondPromptInstructions] = useState('');
  const [preview, setPreview] = useState<PreviewState>({
    showPreview: false,
    step: 'extraction',
    originalNodes: nodes
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [processingProgress, setProcessingProgress] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const [isContentTruncated, setIsContentTruncated] = useState(false);
  const [isContentTrimmed, setIsContentTrimmed] = useState(false);
  const [trimmedLinesCount, setTrimmedLinesCount] = useState(0);
  const MAX_PREVIEW_LENGTH = 1000000; // 1 million characters
  const MAX_CONTENT_LENGTH = 1000000; // 1 million characters
  const [extractionProgress, setExtractionProgress] = useState(0);

  // Initialize worker
  useEffect(() => {
    workerRef.current = createContentProcessor();
    
    workerRef.current.onmessage = (e) => {
      const { type, content, progress } = e.data;
      
      if (type === 'progress') {
        setProcessingProgress(progress);
      } else if (type === 'complete') {
        if (useAggressiveTrim) {
          setAggressiveContent(content);
          setSelectedContent(content);
        } else {
          setBasicContent(content);
          setSelectedContent(content);
        }
        setProcessingProgress(0);
      }
    };
    
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  // Update content processing when trim percentage changes
  useEffect(() => {
    if (rawContent && workerRef.current) {
      setProcessingProgress(0);
      workerRef.current.postMessage({
        content: rawContent,
        type: useAggressiveTrim ? 'aggressive' : 'basic',
        trimPercent: throttledTrimPercentage
      });
    }
  }, [throttledTrimPercentage, rawContent, useAggressiveTrim]);

  const analyzeTags = (content: string): TagStats => {
    const stats: TagStats = {};
    const tagRegex = /<([a-zA-Z0-9-]+)(?:\s|>)/g;
    let match;

    while ((match = tagRegex.exec(content)) !== null) {
      const tagName = match[1].toLowerCase();
      stats[tagName] = (stats[tagName] || 0) + 1;
    }

    return stats;
  };

  // Function to process content with basic cleaning
  const processBasicContent = (content: string, trimPercent: number = trimPercentage) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');
    const passages = Array.from(doc.querySelectorAll('tw-passagedata'));
    
    let processedContent = passages.map(passage => {
      const name = passage.getAttribute('name') || 'Untitled';
      let text = passage.textContent || '';
      
      // Basic cleaning - just remove empty lines and trim
      text = text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n');

      return `[${name}]\n${text}\n`;
    }).join('\n');

    // Apply middle trimming to the final combined string
    if (trimPercent > 0) {
      const lines = processedContent.split('\n');
      const totalLines = lines.length;
      const linesToRemove = Math.floor(totalLines * (trimPercent / 100));
      const startIndex = Math.floor((totalLines - linesToRemove) / 2);
      const trimmedLines = lines.filter((_, index) => 
        index < startIndex || index >= startIndex + linesToRemove
      );
      return trimmedLines.join('\n');
    }

    return processedContent;
  };

  // Function to process content with aggressive cleaning
  const processAggressiveContent = (content: string, trimPercent: number = trimPercentage) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');
    const passages = Array.from(doc.querySelectorAll('tw-passagedata'));
    
    // Process all passages and combine them
    let processedContent = passages.map(passage => {
      const name = passage.getAttribute('name') || 'Untitled';
      let text = passage.textContent || '';
      
      // Skip script files and JavaScript content
      if (name.toLowerCase().endsWith('.js') || 
          name.toLowerCase().includes('script') ||
          text.trim().startsWith('(()') ||
          text.trim().startsWith('function') ||
          text.trim().startsWith('const') ||
          text.trim().startsWith('let') ||
          text.trim().startsWith('var') ||
          text.trim().startsWith('/*') ||
          text.trim().startsWith('//')) {
        return '';
      }
      
      // Remove macro blocks and macro-related content
      text = text
        // Remove [Macros] blocks and everything after them until a double newline or end
        .replace(/\[Macros\][\s\S]*?(?=\n\n|$)/g, '')
        // Remove any line containing only parentheses and macro-like content
        .split('\n')
        .filter(line => {
          const trimmed = line.trim();
          // Skip lines that are just parentheses, numbers, or macro-like content
          if (/^[()\d\s,]+$/.test(trimmed)) return false;
          if (/^\)+$/.test(trimmed)) return false;
          if (/^\(forget-undos:/.test(trimmed)) return false;
          if (/^\(for:/.test(trimmed)) return false;
          if (/^\(print:/.test(trimmed)) return false;
          if (/^\(link:/.test(trimmed)) return false;
          if (/^\(dm:/.test(trimmed)) return false;
          return true;
        })
        .join('\n')
        // Remove any remaining macro-like patterns
        .replace(/\([^)]*\)/g, '')  // Remove simple parentheses content
        .replace(/\)+/g, '')        // Remove any remaining closing parentheses
        .replace(/\(+/g, '')        // Remove any remaining opening parentheses
        .replace(/\s+/g, ' ')       // Normalize whitespace
        .trim();
      
      // Aggressive cleaning
      text = text
        .split('\n')
        .map(line => {
          // Remove HTML tags
          line = line.replace(/<[^>]+>/g, '');
          // Remove Twine macros
          line = line.replace(/<<[^>]+>>/g, '');
          // Remove image tags
          line = line.replace(/\[img\[[^\]]+\]\[[^\]]+\]\]/g, '');
          // Remove links
          line = line.replace(/\[\[[^\]]+\]\]/g, '');
          // Remove style tags
          line = line.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
          // Remove script tags
          line = line.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
          // Remove HTML entities
          line = line.replace(/&[^;]+;/g, '');
          // Remove standalone '>' characters
          line = line.replace(/^>\s*/g, '');
          // Remove any remaining '>' characters
          line = line.replace(/>/g, '');
          // Remove any remaining '<' characters
          line = line.replace(/</g, '');
          // Remove any remaining '[' or ']' characters that aren't part of passage names
          line = line.replace(/[\[\]]/g, '');
          return line.trim();
        })
        .filter(line => {
          const trimmedLine = line.trim();
          return trimmedLine.length > 0 && 
            !trimmedLine.startsWith('/IF') && 
            !trimmedLine.startsWith('ELSE') && 
            !trimmedLine.startsWith('SET') &&
            !/^case \d+SET Scene to \d+$/.test(trimmedLine) &&
            !/^defaultSET Scene to \d+$/.test(trimmedLine) &&
            trimmedLine !== '/button' &&
            !trimmedLine.startsWith('src=') &&
            !trimmedLine.startsWith('widget') &&
            !trimmedLine.includes('layer') &&
            !trimmedLine.includes('class=') &&
            !trimmedLine.match(/^SAVES from version/) &&
            // Additional script-related filters
            !trimmedLine.startsWith('/*') &&
            !trimmedLine.startsWith('//') &&
            !trimmedLine.startsWith('function') &&
            !trimmedLine.startsWith('const') &&
            !trimmedLine.startsWith('let') &&
            !trimmedLine.startsWith('var') &&
            !trimmedLine.includes('=>') &&
            !trimmedLine.includes('{') &&
            !trimmedLine.includes('}') &&
            !trimmedLine.includes(';') &&
            !trimmedLine.includes('()') &&
            !trimmedLine.includes('return') &&
            // Skip lines that are just prices (e.g., "25$")
            !line.match(/^\d+\$$/) &&
            // Skip lines containing image directory references
            !line.includes('img$image_dir+');
        })
        .join('\n');

      // Remove repetitive and low-content lines
      const lines = text.split('\n');
      const cleanedLines = [];
      let shortLineCount = 0;
      let lastLine = '';
      let groupStartIndex = 0;
      let groupCharCount = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip empty lines
        if (!line) continue;
        
        // Skip lines that are just passage() or similar
        if (line.match(/^[^a-zA-Z]*passage\(\)[^a-zA-Z]*$/)) continue;
        
        // Skip lines that are just prices (e.g., "25$")
        if (line.match(/^\d+\$$/)) continue;
        
        // Skip lines that are just repeated content
        if (line === lastLine) continue;
        
        // Skip lines containing image directory references
        if (line.includes('img$image_dir+')) continue;

        // Check character density in groups of 15 lines
        groupCharCount += line.length;
        if (i - groupStartIndex >= 14) { // We have a group of 15 lines
          if (groupCharCount < 250) {
            // Remove all lines in this group
            cleanedLines.splice(groupStartIndex, i - groupStartIndex + 1);
          }
          groupStartIndex = i + 1;
          groupCharCount = 0;
        }
        
        // Count consecutive short lines
        if (line.length < 20) {
          shortLineCount++;
        } else {
          shortLineCount = 0;
        }
        
        // Only add the line if we haven't seen 5 consecutive short lines
        if (shortLineCount < 5) {
          cleanedLines.push(line);
          lastLine = line;
        }
      }

      // Check the last group if it's not a full 15 lines
      if (lines.length - groupStartIndex > 0) {
        if (groupCharCount < 250) {
          cleanedLines.splice(groupStartIndex);
        }
      }

      return cleanedLines.length > 0 ? `[${name}]\n${cleanedLines.join('\n')}\n` : '';
    }).join('\n');

    // Remove multiple consecutive line breaks
    processedContent = processedContent.replace(/\n{3,}/g, '\n\n');

    // Apply middle trimming to the final combined string
    if (trimPercent > 0) {
      const lines = processedContent.split('\n');
      const totalLines = lines.length;
      const linesToRemove = Math.floor(totalLines * (trimPercent / 100));
      const startIndex = Math.floor((totalLines - linesToRemove) / 2);
      const trimmedLines = lines.filter((_, index) => 
        index < startIndex || index >= startIndex + linesToRemove
      );
      return trimmedLines.join('\n');
    }

    return processedContent;
  };

  // Update selected content when toggle changes
  useEffect(() => {
    setSelectedContent(useAggressiveTrim ? aggressiveContent : basicContent);
  }, [useAggressiveTrim, basicContent, aggressiveContent]);

  // Update content when trim percentage changes
  useEffect(() => {
    if (rawContent) {
      const newBasicContent = processBasicContent(rawContent, throttledTrimPercentage);
      const newAggressiveContent = processAggressiveContent(rawContent, throttledTrimPercentage);
      setBasicContent(newBasicContent);
      setAggressiveContent(newAggressiveContent);
      
      // Update selectedContent based on which type is currently selected
      if (selectedContent === basicContent) {
        setSelectedContent(newBasicContent);
      } else if (selectedContent === aggressiveContent) {
        setSelectedContent(newAggressiveContent);
      } else {
        // If no content is selected yet, default to basic
        setSelectedContent(newBasicContent);
      }
    }
  }, [throttledTrimPercentage, rawContent, basicContent, aggressiveContent, selectedContent]);

  // Add helper function to truncate content
  const truncateContent = (content: string): string => {
    if (content.length > MAX_PREVIEW_LENGTH) {
      setIsContentTruncated(true);
      return content.substring(0, MAX_PREVIEW_LENGTH) + '\n\n[Content truncated due to size...]';
    }
    setIsContentTruncated(false);
    return content;
  };

  // Add helper function to automatically trim content
  const autoTrimContent = (content: string): string => {
    if (content.length <= MAX_CONTENT_LENGTH) {
      setIsContentTrimmed(false);
      setTrimmedLinesCount(0);
      return content;
    }

    // Calculate how much to remove
    const excessLength = content.length - MAX_CONTENT_LENGTH;
    const removeFromEachSide = Math.floor(excessLength / 2);

    // Split content into lines
    const lines = content.split('\n');
    const totalLines = lines.length;
    
    // Calculate how many lines to remove from each side
    const linesToRemove = Math.floor(removeFromEachSide / (content.length / totalLines));
    const removeFromStart = Math.floor(linesToRemove / 2);
    const removeFromEnd = linesToRemove - removeFromStart;

    // Set state for trimmed content
    setIsContentTrimmed(true);
    setTrimmedLinesCount(linesToRemove);

    // Remove lines from middle
    const trimmedLines = [
      ...lines.slice(0, removeFromStart),
      `\n[Content trimmed: ${linesToRemove} lines removed from middle]\n`,
      ...lines.slice(-removeFromEnd)
    ];

    return trimmedLines.join('\n');
  };

  // Update the handleFileUpload function
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
  
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        
        // Trim the content first if it's too large
        let trimmedContent = content;
        if (content.length > MAX_CONTENT_LENGTH) {
          // Calculate how much to remove
          const excessLength = content.length - MAX_CONTENT_LENGTH;
          const removeFromEachSide = Math.floor(excessLength / 2);

          // Split content into lines
          const lines = content.split('\n');
          const totalLines = lines.length;
          
          // Calculate how many lines to remove from each side
          const linesToRemove = Math.floor(removeFromEachSide / (content.length / totalLines));
          const removeFromStart = Math.floor(linesToRemove / 2);
          const removeFromEnd = linesToRemove - removeFromStart;

          // Set state for trimmed content
          setIsContentTrimmed(true);
          setTrimmedLinesCount(linesToRemove);

          // Remove lines from middle
          trimmedContent = [
            ...lines.slice(0, removeFromStart),
            `\n[Content trimmed: ${linesToRemove} lines removed from middle]\n`,
            ...lines.slice(-removeFromEnd)
          ].join('\n');
        } else {
          setIsContentTrimmed(false);
          setTrimmedLinesCount(0);
        }

        // Process only the trimmed content
        setRawContent(trimmedContent);
        const basicProcessed = processBasicContent(trimmedContent);
        const aggressiveProcessed = processAggressiveContent(trimmedContent);
        setBasicContent(basicProcessed);
        setAggressiveContent(aggressiveProcessed);
        setSelectedContent(useAggressiveTrim ? aggressiveProcessed : basicProcessed);
        setError('');
      } catch (err) {
        setError('Failed to parse Twine file. Please ensure it is a valid Twine HTML export.');
        console.error(err);
      }
    };
    reader.readAsText(file);
  };

  const renderNodeComparison = (originalNode: Node | null, updatedNode: Partial<Node>) => {
    return (
      <div className="mb-4 p-4 bg-gray-800 rounded">
        <h3 className="text-lg font-bold mb-2">{updatedNode.name}</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h4 className="text-sm font-semibold mb-1">Current</h4>
            <div className="text-sm space-y-2">
              <div>
                <span className="font-semibold block mb-1">Long Description:</span>
                <div className="relative">
                  <div
                    className="w-full p-2 bg-gray-700 rounded text-white resize-none whitespace-pre-wrap"
                    style={{ 
                      height: calculateHeight(originalNode?.longDescription || '', true),
                      overflowY: 'auto'
                    }}
                  >
                    {createDiffSpans(originalNode?.longDescription || '', updatedNode.longDescription || '', true)}
                  </div>
                </div>
              </div>
              <div>
                <span className="font-semibold block mb-1">Rules:</span>
                <div className="relative">
                  <div
                    className="w-full p-2 bg-gray-700 rounded text-white resize-none whitespace-pre-wrap"
                    style={{ height: '7.5rem', overflowY: 'auto' }}
                  >
                    {createDiffSpans(originalNode?.rules || '', updatedNode.rules || '', true)}
                  </div>
                </div>
              </div>
              <div>
                <span className="font-semibold block mb-1">Type:</span>
                <div className="relative">
                  <div className="w-full p-2 bg-gray-700 rounded text-white whitespace-pre-wrap">
                    {createDiffSpans(originalNode?.type || '', updatedNode.type || '', true)}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-1">New</h4>
            <div className="text-sm space-y-2">
              <div>
                <span className="font-semibold block mb-1">Long Description:</span>
                <div className="relative">
                  <div
                    className="w-full p-2 bg-gray-700 rounded text-white resize-none whitespace-pre-wrap"
                    style={{ 
                      height: calculateHeight(updatedNode.longDescription || '', true),
                      overflowY: 'auto'
                    }}
                  >
                    {createDiffSpans(originalNode?.longDescription || '', updatedNode.longDescription || '', false)}
                  </div>
                </div>
              </div>
              <div>
                <span className="font-semibold block mb-1">Rules:</span>
                <div className="relative">
                  <div
                    className="w-full p-2 bg-gray-700 rounded text-white resize-none whitespace-pre-wrap"
                    style={{ height: '7.5rem', overflowY: 'auto' }}
                  >
                    {createDiffSpans(originalNode?.rules || '', updatedNode.rules || '', false)}
                  </div>
                </div>
              </div>
              <div>
                <span className="font-semibold block mb-1">Type:</span>
                <div className="relative">
                  <div className="w-full p-2 bg-gray-700 rounded text-white whitespace-pre-wrap">
                    {createDiffSpans(originalNode?.type || '', updatedNode.type || '', false)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const handleExtractData = async () => {
    if (!selectedContent) return;
    
    setIsLoading(true);
    setError('');
    setExtractionProgress(0);
    
    try {
      const extractedData = await extractDataFromTwine(
        selectedContent,
        nextPromptInstructions,
        extractionCount,
        (completed) => {
          setExtractionProgress(completed);
        }
      );

      // If there were failed chunks, show a warning
      if (extractedData.failedChunks > 0) {
        setError(`Warning: ${extractedData.failedChunks} out of ${extractionCount} chunks failed to process. The extraction will continue with the successful chunks.`);
      }

      setPreview({
        showPreview: true,
        step: 'generation',
        originalNodes: nodes,
        content: selectedContent,
        extractedData: extractedData
      });
    } catch (err) {
      setError('Failed to extract data. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
      setExtractionProgress(0);
    }
  };

  const handleGenerateNodes = async () => {
    if (!preview.extractedData) {
      setError('Please extract data first before generating nodes.');
      return;
    }
    
    setIsLoading(true);
    setError('');
    
    try {
      const nodeResponse = await generateNodesFromExtractedData(
        preview.extractedData,
        nodes,
        importMode,
        secondPromptInstructions
      );

      setPreview(prev => ({
        ...prev,
        step: 'preview',
        changes: nodeResponse
      }));
    } catch (err) {
      setError('Failed to generate nodes. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = () => {
    if (preview.changes) {
      // Convert the changes to the format expected by updateGraph
      const changes = {
        merge: [
          // Convert new nodes to full Node objects
          ...(preview.changes.new?.map(node => ({
            id: node.id || '',
            name: node.name || '',
            longDescription: node.longDescription || '',
            rules: node.rules || '',
            type: node.type || '',
            image: node.image || '',
            updateImage: node.updateImage || false,
            imageSeed: node.imageSeed || 0
          } as Node)) || []),
          // Convert update nodes to full Node objects by merging with existing nodes
          ...(preview.changes.update?.map(update => {
            const existingNode = nodes.find(n => n.id === update.id);
            if (!existingNode) return null;
            return {
              ...existingNode,
              longDescription: update.longDescription || existingNode.longDescription,
              rules: update.rules || existingNode.rules,
              updateImage: update.updateImage ?? existingNode.updateImage
            };
          }).filter(Boolean) as Node[]) || []
        ],
        delete: preview.changes.delete || [],
        newNodes: (preview.changes.new?.map(node => node.id).filter((id): id is string => id !== undefined) || [])
      };
      updateGraph(changes);
      closeOverlay();
    }
  };

  const handlePromptSelect = (dataExtraction: string, nodeGeneration: string) => {
    setNextPromptInstructions(dataExtraction);
    setSecondPromptInstructions(nodeGeneration);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 p-6 rounded-lg w-3/4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Import Twine Story</h2>
          <button onClick={closeOverlay} className="text-gray-400 hover:text-white">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* File Upload Section */}
        <div className="mb-6">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".html,.twee"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
          >
            Upload Twine File
          </button>
        </div>

        {/* Content Display Section */}
        {rawContent && (
          <div className="mb-6">
            <div className="flex space-x-4 mb-4">
              <button
                onClick={() => setSelectedContent(basicContent)}
                className={`px-4 py-2 rounded ${selectedContent === basicContent ? 'bg-blue-600' : 'bg-gray-700'}`}
              >
                Basic Clean
              </button>
              <button
                onClick={() => setSelectedContent(aggressiveContent)}
                className={`px-4 py-2 rounded ${selectedContent === aggressiveContent ? 'bg-blue-600' : 'bg-gray-700'}`}
              >
                Aggressive Clean
              </button>
            </div>
            {isContentTrimmed && (
              <div className="mb-2 p-2 bg-yellow-900 text-yellow-200 rounded">
                <p className="text-sm">
                  Warning: Content was too large and has been automatically trimmed. {trimmedLinesCount} lines were removed from the middle of the content to fit within the 1 million character limit.
                  This represents approximately {Math.round((trimmedLinesCount / (trimmedLinesCount + selectedContent.split('\n').length)) * 100)}% of the original content.
                  Only the trimmed content will be processed.
                </p>
              </div>
            )}
            <textarea
              value={selectedContent}
              readOnly
              className="w-full h-64 p-2 bg-gray-700 text-white rounded"
              placeholder="Processed content will appear here..."
            />
          </div>
        )}

        {/* Import Mode Selection */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">Import Mode</label>
          <div className="flex space-x-4">
            <button
              onClick={() => setImportMode('new_game')}
              className={`px-4 py-2 rounded ${importMode === 'new_game' ? 'bg-blue-600' : 'bg-gray-700'}`}
            >
              New Game
            </button>
            <button
              onClick={() => setImportMode('merge_story')}
              className={`px-4 py-2 rounded ${importMode === 'merge_story' ? 'bg-blue-600' : 'bg-gray-700'}`}
            >
              Merge with Existing
            </button>
          </div>
        </div>

        {/* Trim Percentage Slider */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">
            Content Trim: {trimPercentage}%
          </label>
          <input
            type="range"
            min="0"
            max="95"
            value={trimPercentage}
            onChange={(e) => setTrimPercentage(Number(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        {/* Character Count and Chunk Splitting */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm font-medium">
              Number of Parallel Extractions: {extractionCount}
            </label>
            <span className="text-sm text-blue-400">
              ({Math.ceil(Math.min(selectedContent.length, MAX_CONTENT_LENGTH) / extractionCount)} characters per extraction)
            </span>
          </div>
          <input
            type="range"
            min="1"
            max="10"
            value={extractionCount}
            onChange={(e) => setExtractionCount(Number(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        {/* Prompt Selector */}
        <div className="mb-6">
          <PromptSelector onPromptSelect={handlePromptSelect} />
        </div>

        {/* Prompt Instructions */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">Instructions for Data Extraction (First Prompt)</label>
          <textarea
            value={nextPromptInstructions}
            onChange={(e) => setNextPromptInstructions(e.target.value)}
            className="w-full h-32 p-2 bg-gray-700 text-white rounded"
            placeholder="Enter instructions for data extraction..."
          />
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">Instructions for Node Generation (Second Prompt)</label>
          <textarea
            value={secondPromptInstructions}
            onChange={(e) => setSecondPromptInstructions(e.target.value)}
            className="w-full h-32 p-2 bg-gray-700 text-white rounded"
            placeholder="Enter instructions for node generation..."
          />
        </div>

        {/* Add progress indicator */}
        {processingProgress > 0 && (
          <div className="mb-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm">Processing content: {processingProgress}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${processingProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end space-x-4">
          <button
            onClick={closeOverlay}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded"
          >
            Cancel
          </button>
          {preview.step === 'extraction' && (
            <button
              onClick={handleExtractData}
              disabled={isLoading || !selectedContent}
              className={`px-4 py-2 rounded ${isLoading || !selectedContent ? 'bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'} text-white`}
            >
              {isLoading ? `Extracting... ${extractionProgress}/${extractionCount}` : 'Extract Data'}
            </button>
          )}
          {preview.step === 'generation' && (
            <button
              onClick={handleGenerateNodes}
              disabled={isLoading}
              className={`px-4 py-2 rounded ${isLoading ? 'bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'} text-white`}
            >
              {isLoading ? 'Generating...' : 'Generate Nodes'}
            </button>
          )}
          {preview.step === 'preview' && (
            <button
              onClick={handleConfirm}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded"
            >
              Confirm
            </button>
          )}
        </div>

        {/* Preview Section */}
        {preview.showPreview && (
          <div className="mt-6">
            <h3 className="text-lg font-bold mb-4">
              {preview.step === 'generation' ? 'Extracted Data Preview' : ''}
            </h3>
            {preview.step === 'generation' && preview.extractedData && (
              <div className="bg-gray-700 p-4 rounded">
                <pre className="text-white whitespace-pre-wrap">
                  {JSON.stringify(preview.extractedData, null, 2)}
                </pre>
              </div>
            )}
            {preview.step === 'preview' && preview.changes && (
              <div className="space-y-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold">Generated Nodes Preview</h3>
                  <button
                    onClick={handleGenerateNodes}
                    disabled={isLoading}
                    className={`px-4 py-2 rounded ${isLoading ? 'bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'} text-white`}
                  >
                    {isLoading ? 'Regenerating...' : 'Regenerate Nodes'}
                  </button>
                </div>
                {preview.changes.new?.map((node, index) => (
                  <div key={index}>
                    {renderNodeComparison(
                      nodes.find(n => n.id === node.id) || null,
                      node
                    )}
                  </div>
                ))}
                {preview.changes.update?.map((update, index) => {
                  const existingNode = nodes.find(n => n.id === update.id);
                  if (!existingNode) return null;
                  return (
                    <div key={index}>
                      {renderNodeComparison(
                        existingNode,
                        {
                          ...existingNode,
                          longDescription: update.longDescription || existingNode.longDescription,
                          rules: update.rules || existingNode.rules,
                          updateImage: update.updateImage ?? existingNode.updateImage
                        }
                      )}
                    </div>
                  );
                })}
                {preview.changes.delete?.map((nodeId, index) => (
                  <div key={index} className="p-4 bg-red-900 rounded">
                    <h4 className="text-lg font-bold">Node to Delete: {nodeId}</h4>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mt-4 p-4 bg-red-900 text-white rounded">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default TwineImportOverlay;