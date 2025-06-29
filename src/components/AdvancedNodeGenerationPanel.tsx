import React from 'react';
import { PipelineState } from '../types/advancedNodeGeneration';

interface AdvancedNodeGenerationPanelProps {
  pipelineState?: PipelineState;
  onRunNextLoop?: () => void;
  onCancel?: () => void;
}

const safeStringValue = (value: any): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  
  // Handle objects that might have longDescription or content properties
  if (typeof value === 'object') {
    if (value.longDescription && typeof value.longDescription === 'string') {
      return value.longDescription;
    }
    if (value.content && typeof value.content === 'string') {
      return value.content;
    }
    if (value.text && typeof value.text === 'string') {
      return value.text;
    }
    // For arrays, try to join them
    if (Array.isArray(value)) {
      return value.map(item => safeStringValue(item)).join('\n');
    }
  }
  
  // Last resort: try to JSON stringify for debugging, but fallback to empty string
  try {
    const jsonStr = JSON.stringify(value, null, 2);
    // If it's a simple object representation, return empty instead
    if (jsonStr === '{}' || jsonStr === '[]') return '';
    return jsonStr;
  } catch {
    return '';
  }
};

const AdvancedNodeGenerationPanel: React.FC<AdvancedNodeGenerationPanelProps> = ({
  pipelineState,
  onRunNextLoop,
  onCancel,
}) => {
  if (!pipelineState) {
    return null;
  }

  const getStageDisplayName = (stage: string) => {
    switch (stage) {
      case 'planning': return 'Planning';
      case 'searching': return 'Web Search';
      case 'generating': return 'Content Generation';
      case 'validating': return 'Validation';
      case 'completed': return 'Completed';
      case 'failed': return 'Failed';
      default: return stage;
    }
  };

  const getStageColor = (stage: string) => {
    switch (stage) {
      case 'completed': return 'text-green-400';
      case 'failed': return 'text-red-400';
      case 'planning':
      case 'searching':
      case 'generating':
      case 'validating':
        return 'text-yellow-400';
      default: return 'text-gray-400';
    }
  };

  const canRunNextLoop = pipelineState.stage === 'completed' || 
                         pipelineState.stage === 'failed' ||
                         (pipelineState.validationResult && pipelineState.validationResult.failedRules.length > 0);

  return (
    <div className="bg-gray-800 border border-gray-600 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Advanced Node Generation</h3>
        <div className="flex gap-2">
          {canRunNextLoop && onRunNextLoop && (
            <button
              onClick={onRunNextLoop}
              className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-500 text-sm"
            >
              Run Next Loop
            </button>
          )}
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-500 text-sm"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Pipeline Status */}
      <div className="mb-4">
        <div className="flex items-center gap-4 mb-2">
          <span className="text-sm text-gray-300">
            Loop {pipelineState.currentLoop} / {pipelineState.maxLoops}
          </span>
          <span className={`text-sm font-medium ${getStageColor(pipelineState.stage)}`}>
            Stage: {getStageDisplayName(pipelineState.stage)}
          </span>
        </div>
        
        {/* Progress bar */}
        <div className="w-full bg-gray-700 rounded-full h-2">
          <div 
            className={`h-2 rounded-full transition-all duration-300 ${
              pipelineState.stage === 'completed' ? 'bg-green-500' :
              pipelineState.stage === 'failed' ? 'bg-red-500' : 'bg-yellow-500'
            }`}
            style={{ 
              width: `${
                pipelineState.stage === 'planning' ? '25%' :
                pipelineState.stage === 'searching' ? '50%' :
                pipelineState.stage === 'generating' ? '75%' :
                pipelineState.stage === 'validating' ? '90%' :
                pipelineState.stage === 'completed' ? '100%' :
                pipelineState.stage === 'failed' ? '100%' : '0%'
              }`
            }}
          />
        </div>
      </div>

      {/* Planning Output */}
      {pipelineState.planningOutput && (
        <div className="mb-4">
          <h4 className="text-sm font-medium text-gray-300 mb-2">Planning Results</h4>
          <div className="bg-gray-900 rounded p-3 text-sm">
            <div className="mb-2">
              <span className="text-gray-400">Objectives:</span>
              <p className="text-white mt-1">{pipelineState.planningOutput.objectives}</p>
            </div>
            <div className="mb-2">
              <span className="text-gray-400">Target Nodes:</span>
              <p className="text-white mt-1">{pipelineState.planningOutput.targetNodeIds.join(', ')}</p>
            </div>
                          <div className="mb-2">
                <span className="text-gray-400">Success Rules:</span>
                <ul className="text-white mt-1 list-disc list-inside">
                  {pipelineState.planningOutput.successRules.map((rule, index) => (
                    <li key={index} className="text-xs">{safeStringValue(rule)}</li>
                  ))}
                </ul>
              </div>
          </div>
        </div>
      )}

      {/* Search Results */}
      {pipelineState.searchResults && (
        <div className="mb-4">
          <h4 className="text-sm font-medium text-gray-300 mb-2">Web Search Results</h4>
          <div className="bg-gray-900 rounded p-3 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <span className="text-gray-400">Broad Search ({pipelineState.searchResults.broad.length} results)</span>
                <div className="mt-1 space-y-1">
                  {pipelineState.searchResults.broad.slice(0, 2).map((result, index) => (
                    <div key={index} className="text-xs text-white">
                      <div className="font-medium">{result.title}</div>
                      <div className="text-gray-400 truncate">{result.description}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-gray-400">Precise Search ({pipelineState.searchResults.precise.length} results)</span>
                <div className="mt-1 space-y-1">
                  {pipelineState.searchResults.precise.slice(0, 2).map((result, index) => (
                    <div key={index} className="text-xs text-white">
                      <div className="font-medium">{result.title}</div>
                      <div className="text-gray-400 truncate">{result.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Validation Results */}
      {pipelineState.validationResult && (
        <div className="mb-4">
          <h4 className="text-sm font-medium text-gray-300 mb-2">Validation Results</h4>
          <div className="bg-gray-900 rounded p-3 text-sm">
            <div className="mb-2">
              <span className="text-green-400">
                Passed: {pipelineState.validationResult.validatedRules.length} rules
              </span>
            </div>
            {pipelineState.validationResult.failedRules.length > 0 && (
              <div>
                <span className="text-red-400">
                  Failed: {pipelineState.validationResult.failedRules.length} rules
                </span>
                <ul className="mt-1 space-y-1">
                  {pipelineState.validationResult.failedRules.map((failure, index) => (
                    <li key={index} className="text-xs text-red-300">
                      <span className="font-medium">{safeStringValue(failure.nodeId)}:</span> {safeStringValue(failure.reason)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Errors */}
      {pipelineState.errors.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-medium text-red-400 mb-2">Errors</h4>
          <div className="bg-gray-900 rounded p-3 text-sm">
            {pipelineState.errors.map((error, index) => (
              <div key={index} className="text-red-300 text-xs mb-1">
                Loop {error.loop}, {error.stage}: {error.error}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdvancedNodeGenerationPanel; 