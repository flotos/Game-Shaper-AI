import React, { useState, useRef } from 'react';
import { Node } from '../models/Node';
import { generateNodesFromPrompt, analyzeTwineContent } from '../services/LLMService';

interface TagStats {
  [key: string]: number;
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

const TwineImportOverlay: React.FC<TwineImportOverlayProps> = ({ nodes, updateGraph, closeOverlay }) => {
  const [twineContent, setTwineContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [tagStats, setTagStats] = useState<TagStats>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
  
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        let content = e.target?.result as string;
        
        // First pass: Remove all empty passage data lines
        content = content
          .split('\n')
          .filter(line => {
            const trimmedLine = line.trim();
            // Keep the storydata line
            if (trimmedLine.startsWith('<tw-storydata')) return true;
            // Remove empty passage data lines
            if (trimmedLine.startsWith('<tw-passagedata') && trimmedLine.endsWith('</tw-passagedata>')) {
              // If it's an empty passage data line, remove it
              if (trimmedLine === '<tw-passagedata pid="undefined" name="undefined"></tw-passagedata>') return false;
              // If it's a passage data line with only whitespace, remove it
              if (trimmedLine.match(/^<tw-passagedata pid="undefined" name="undefined">\s*<\/tw-passagedata>$/)) return false;
            }
            return true;
          })
          .join('\n');
        
        // Remove HTML entities and special characters
        content = content
          .replace(/&(?:lt|gt|amp|quot|apos|cent|pound|yen|euro|copy|reg|nbsp);/g, '')
          .replace(/&[^;]+;/g, '');
        
        // Remove all script and style blocks entirely
        content = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gs, '');
        content = content.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gs, '');
  
        // Remove visual positioning
        content = content
          .replace(/position="[^"]+"/g, '')
          .replace(/size="[^"]+"/g, '')
          .replace(/zoom="[^"]+"/g, '');
  
        // Remove HTML tag attributes except specific ones
        content = content.replace(/<(tw-passagedata|tw-storydata)\b([^>]*?)(?=>)/g, 
          (match, p1, p2) => {
            // Keep only pid, name, tags for passages
            const cleanedAttrs = p2
              .replace(/ pid="[^"]+"/, '')
              .replace(/ name="[^"]+"/, '')
              .replace(/ tags="[^"]+"/, '')
              .replace(/\s{2,}/g, ' ');
            return `<${p1}${cleanedAttrs}`;
          }
        );
  
        // Remove UI elements
        content = content
          .replace(/(addclass|removeclass).*$/gm, '')
          .replace(/<span id="[^"]+"/g, '')
          .replace(/class="[^"]+"/g, '')
          .replace(/style="[^"]+"/g, '')
          .replace(/set \$[^ ]+ to \$[^ ]+= true|false|random$$[^$]+$$.*/g, '')
          .replace(/set \$[^ ]+ to \$[^ ]+ = \d+/g, '')
          .replace(/cacheaudio.*$/gm, '')
          .replace(/Dialog\..*$/gm, '')
          .replace(/audio.*$/gm, '')
          .replace(/fullscreen$/gm, '');
  
        // Keep variable declarations and math operations
        content = content
          .replace(/set \$.*?$/gm, (match) => match.replace(/set \$([A-Za-z0-9_]+)/, 'SET $1'))
          .replace(/Math\.clamp.*$/gm, '')
          .replace(/newinventory.*$/gm, '')
          .replace(/pickup|drop.*$/gm, '')
          .replace(/\$(.*?) +=/g, '$1')
          .replace(/increment\$.*$/gm, '')
          .replace(/decrement\$.*$/gm, '');
  
        // Remove animation and graphics
        content = content
          .replace(/video\s+src=.*?$/gm, '')
          .replace(/img\s+src=.*?$/gm, '')
          .split('\n')
          .filter(line => 
            !line.trim().startsWith('@@') && 
            !line.includes('layer') && 
            !line.includes('class=')
        ).join('\n');
  
        // Simplify macros
        content = content
          .replace(/(if \$[A-Za-z0-9_.]+?)(?: gt| lt| gte| lte| ==| eq| !=| ne| >| <).*?$/gm, '$1')
          .replace(/else(?:if)*.*?$/gm, 'ELSE')
          .replace(/\/if$/gm, '/IF')
          .replace(/(goto|link|button).+?$/gm, '');
  
        // Clean up empty lines and spaces
        content = content
          .replace(/\s+$/gm, '')
          .replace(/^\s+/gm, '')
          .replace(/[ \t]+/g, ' ')
          .split('\n')
          .filter(line => {
            const trimmedLine = line.trim();
            return trimmedLine.length > 0 && 
              !trimmedLine.startsWith('/IF') && 
              !trimmedLine.startsWith('ELSE') && 
              !trimmedLine.startsWith('SET') &&
              !/^case \d+SET Scene to \d+$/.test(trimmedLine) &&
              !/^defaultSET Scene to \d+$/.test(trimmedLine) &&
              trimmedLine !== '/button';
          })
          .join('\n');
  
        // Final simple string replacement
        content = content.replace(/<tw-passagedata pid="undefined" name="undefined"><\/tw-passagedata>/g, '');
  
        // Handle both encoded and unencoded angle brackets
        const emptyPassagePattern = /(?:<tw-passagedata|&lt;tw-passagedata)\s+pid="undefined"\s+name="undefined"(?:>|&gt;)[\s\S]*?(?:<\/tw-passagedata>|&lt;\/tw-passagedata&gt;)/g;
        content = content.replace(emptyPassagePattern, '');

        
        // Additional aggressive cleaning for empty passage data
        content = content
          .split('\n')
          .map(line => line.trim())
          .filter(line => {
            // Skip empty lines
            if (!line) return false;
            
            // Skip lines that are only empty passage data
            if (line === '<tw-passagedata pid="undefined" name="undefined"></tw-passagedata>') return false;
            
            // Skip lines that are only passage data with whitespace
            if (line.match(/^\s*<tw-passagedata pid="undefined" name="undefined">\s*<\/tw-passagedata>\s*$/)) return false;
            
            return true;
          })
          .join('\n');
  
        // Extract core story structure
        const storyDataMatch = content.match(/<tw-storydata\b[^>]*>[\s\S]*?<\/tw-storydata>/);
        const passages = content.match(/<tw-passagedata\b[^>]*>[\s\S]*?<\/tw-passagedata>/g) || [];

        // Reconstruct minimal dataset
        let passageCounter = 1;
        const minimalContent = [
          storyDataMatch?.[0].replace(/<tw-passagedata.*$/s, ''),
          ...passages
            .map(p => {
              // Extract raw content
              const rawContent = p.replace(/<[^>]+>/g, '').trim();
              
              // Skip if no raw content
              if (!rawContent) return '';
              
              // Filter for specific content types
              const filteredContent = rawContent
                .split('\n')
                .filter(line => {
                  const trimmedLine = line.trim();
                  return trimmedLine.length > 0 && 
                    !trimmedLine.startsWith('src=') &&
                    !trimmedLine.startsWith('widget') &&
                    (trimmedLine.startsWith('$') || 
                    trimmedLine.startsWith('set') || 
                    trimmedLine.includes('[[LINK]]') || 
                    trimmedLine.includes('[[RETURN]]') ||
                    trimmedLine.includes('button') ||
                    trimmedLine.includes('SET') ||
                    trimmedLine.includes('IF') ||
                    trimmedLine.includes('ELSE'));
                })
                .join('\n')
                .trim();
              
              // Skip if no filtered content
              if (!filteredContent) return '';
              
              // Extract or generate IDs and names
              const nameMatch = p.match(/name="([^"]+)"/);
              const pidMatch = p.match(/pid="([^"]+)"/);
              
              // If both pid and name are undefined, generate new ones
              if ((!nameMatch || nameMatch[1] === "undefined") && 
                  (!pidMatch || pidMatch[1] === "undefined")) {
                const pid = `passage-${passageCounter}`;
                const name = `Passage ${passageCounter}`;
                passageCounter++;
                return `<tw-passagedata pid="${pid}" name="${name}">${filteredContent}</tw-passagedata>`;
              }
              
              // Use existing or generate new values
              const pid = (pidMatch && pidMatch[1] !== "undefined") ? 
                pidMatch[1] : `passage-${passageCounter}`;
              const name = (nameMatch && nameMatch[1] !== "undefined") ? 
                nameMatch[1] : `Passage ${passageCounter}`;
              
              // Increment counter if we generated anything
              if ((!nameMatch || nameMatch[1] === "undefined") || 
                  (!pidMatch || pidMatch[1] === "undefined")) {
                passageCounter++;
              }
              
              return `<tw-passagedata pid="${pid}" name="${name}">${filteredContent}</tw-passagedata>`;
            }).filter(p => p)].join('\n\n');

  
        setTwineContent(minimalContent);
        setError('');
      } catch (err) {
        setError('Failed to parse Twine file. Please ensure it is a valid Twine HTML export.');
        console.error(err);
      }
    };
    reader.readAsText(file);
  };
  

  const handleNext = async () => {
    if (!twineContent) return;
    
    setIsLoading(true);
    setError('');
    
    try {
      // First prompt to analyze the content
      const analysisResponse = await analyzeTwineContent(twineContent);
      
      // Second prompt to create GameShaper nodes, using the analysis response
      const nodeCreationPrompt = `Step 2.\n\nNow the analysis of this story is complete, you will need to create a GameShaper compatible file.\nGameShaper is a game engine allowing to play stories using an AI assisted narrator. The nodes are elements which help the AI remember and focus on the rules and persistent objects.\n\nHere is the analysis of the story:\n${analysisResponse}\n\nI will provide an example node for a different basic game, and you will output a new node graph, for the Twine game I provided you before.\n\n${JSON.stringify(nodes, null, 2)}`;
      
      const nodeResponse = await generateNodesFromPrompt(nodeCreationPrompt, nodes);
      
      // Convert the response to the expected format
      const nodeEdition = {
        merge: nodeResponse.merge || [],
        delete: nodeResponse.delete || [],
        newNodes: nodeResponse.merge?.map((node: Node) => node.id) || []
      };
      
      // Update the graph and close the overlay immediately
      await updateGraph(nodeEdition);
      closeOverlay();
    } catch (err) {
      setError('Failed to process the Twine content. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-800 bg-opacity-75 flex justify-center items-center z-50">
      <div className="bg-slate-900 p-6 rounded shadow-md w-3/4 max-w-4xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl mb-4 text-white">Import Twine Game</h2>
        
        <div className="mb-4">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Upload Twine HTML File
          </button>
          <input
            type="file"
            accept=".html"
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>

        {Object.keys(tagStats).length > 0 && (
          <div className="mb-4 p-4 bg-gray-800 rounded">
            <h3 className="text-lg mb-2 text-white">Tag Statistics:</h3>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(tagStats)
                .sort(([, a], [, b]) => b - a)
                .map(([tag, count]) => (
                  <div key={tag} className="flex justify-between text-sm">
                    <span className="text-gray-300">{tag}:</span>
                    <span className="text-blue-400">{count}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {twineContent && (
          <div className="mb-4">
            <h3 className="text-lg mb-2 text-white">Extracted Content:</h3>
            <textarea
              value={twineContent}
              readOnly
              className="w-full h-96 p-2 border border-gray-700 rounded bg-gray-900 text-white font-mono text-sm"
            />
          </div>
        )}

        {error && <p className="text-red-500 mb-4">{error}</p>}

        <div className="flex justify-end space-x-4 sticky bottom-0 bg-slate-900 pt-4">
          <button
            onClick={closeOverlay}
            className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={handleNext}
            disabled={!twineContent || isLoading}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Processing...' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TwineImportOverlay; 