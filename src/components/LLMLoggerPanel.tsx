import React, { useState, useEffect, useRef } from 'react';
import { moxusService, LLMCall } from '../services/MoxusService'; // Adjust path as needed
import { X, AlertTriangle, CheckCircle2, Loader2, Info, Trash2, Zap, Brain, Puzzle } from 'lucide-react';

interface LLMLoggerPanelProps {
  isOpen: boolean;
  togglePanel: () => void;
}

const StatusIcon = ({ status }: { status: LLMCall['status'] }) => {
  switch (status) {
    case 'running':
    case 'queued':
      return <Loader2 size={18} className="animate-spin text-yellow-400" />;
    case 'completed':
      return <CheckCircle2 size={18} className="text-green-400" />;
    case 'failed':
      return <AlertTriangle size={18} className="text-red-400" />;
    default:
      return <Info size={18} className="text-gray-400" />;
  }
};

const getStatusColor = (status: LLMCall['status']) => {
  switch (status) {
    case 'running':
    case 'queued':
      return 'border-yellow-500';
    case 'completed':
      return 'border-green-500';
    case 'failed':
      return 'border-red-500';
    default:
      return 'border-gray-500';
  }
};

interface LogCardProps {
  call: LLMCall;
  onSelect: (call: LLMCall) => void;
  isSelected: boolean;
}

const LogCard: React.FC<LogCardProps> = ({ call, onSelect, isSelected }) => {
  return (
    <div
      className={`bg-gray-700 p-4 rounded-md shadow border-l-4 ${getStatusColor(call.status)} mb-2 cursor-pointer ${isSelected ? 'ring-2 ring-blue-500' : 'hover:bg-gray-600'}`}
      onClick={() => onSelect(call)}
    >
      <div className="flex justify-between items-start mb-1">
        <span className="font-semibold text-base text-blue-300 truncate max-w-[180px] sm:max-w-[200px] md:max-w-[220px]" title={call.id}>ID: {call.id.split('-')[1] || call.id}</span>
        <span className="text-xs text-gray-400 whitespace-nowrap">
          {new Date(call.startTime).toLocaleTimeString()} -
          {call.endTime ? new Date(call.endTime).toLocaleTimeString() : 'Ongoing'}
        </span>
      </div>
      <div className="flex items-center justify-between text-sm mb-2">
          <div className="flex items-center">
              <StatusIcon status={call.status} />
              <span className="ml-2 capitalize font-medium">{call.status}</span>
          </div>
          {call.duration !== undefined && (
              <span className="text-xs text-gray-400">{call.duration}ms</span>
          )}
      </div>
      <p className="text-sm text-gray-300 break-all">Type: <span className="font-medium text-purple-300 text-sm">{call.callType}</span></p>
      {call.error && (
        <p className="text-xs text-red-400 mt-1 bg-red-900 bg-opacity-30 p-2 rounded break-words">Error: {call.error}</p>
      )}
    </div>
  );
};

// Updated definition for Moxus internal call types
// const moxusInternalCallSystemEvents = ['streamed_chat_text_completed']; // No longer needed with the simpler check
const isMoxusCall = (callType: string): boolean => {
  if (!callType) return false;
  // return callType.startsWith('moxus_feedback_') || moxusInternalCallSystemEvents.includes(callType);
  return callType.startsWith('moxus_'); // Simpler check for any call type prefixed with 'moxus_'
};

export const LLMLoggerPanel: React.FC<LLMLoggerPanelProps> = ({ isOpen, togglePanel }) => {
  const [logEntries, setLogEntries] = useState<LLMCall[]>([]);
  const [initialLogCount, setInitialLogCount] = useState<number | null>(null);
  const [selectedCall, setSelectedCall] = useState<LLMCall | null>(null);

  useEffect(() => {
    if (isOpen) {
      const currentLogs = moxusService.getLLMLogEntries();
      setLogEntries(currentLogs);
      if (initialLogCount === null) {
        setInitialLogCount(currentLogs.length);
      }
      const unsubscribe = moxusService.subscribeToLLMLogUpdates(newEntries => {
        setLogEntries(newEntries);
        if (selectedCall && !newEntries.find(entry => entry.id === selectedCall.id)) {
          setSelectedCall(null);
        }
      });
      return () => {
        unsubscribe();
      };
    } else {
      setInitialLogCount(null);
      setSelectedCall(null);
    }
  }, [isOpen, selectedCall]);

  const handleSelectCall = (call: LLMCall) => {
    setSelectedCall(call);
  };

  const handleCloseDetailView = () => {
    setSelectedCall(null);
  };

  const handleClearLogs = () => {
    moxusService.clearLLMLogEntries();
    setInitialLogCount(0);
    setSelectedCall(null);
  };

  if (!isOpen) {
    return null;
  }

  const moxusCalls = logEntries.filter(call => isMoxusCall(call.callType));
  const appCalls = logEntries.filter(call => !isMoxusCall(call.callType));

  const renderLogColumn = (calls: LLMCall[], title: string, icon: React.ReactNode, columnInitialLogCount?: number) => (
    <div className="flex-1 flex flex-col min-w-[calc(50%-0.5rem)]">
      <h3 className="text-lg font-semibold mb-2 sticky top-0 bg-gray-800 z-10 py-2 flex items-center">
        {icon}{title} <span className="ml-2 text-xs text-gray-400">({calls.length})</span>
      </h3>
      <div className="flex-grow overflow-y-auto pr-2 space-y-2 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
        {calls.length === 0 ? (
          <p className="text-gray-400 text-center py-10 text-sm">No calls in this category.</p>
        ) : (
          calls.map((call, index) => (
            <React.Fragment key={call.id}>
              <LogCard call={call} onSelect={handleSelectCall} isSelected={selectedCall?.id === call.id} />
            </React.Fragment>
          ))
        )}
      </div>
    </div>
  );

  const initialMoxusLogCount = initialLogCount !== null
    ? moxusService.getLLMLogEntries().slice(0, initialLogCount).filter(call => isMoxusCall(call.callType)).length
    : 0;
  const initialAppLogCount = initialLogCount !== null
    ? moxusService.getLLMLogEntries().slice(0, initialLogCount).filter(call => !isMoxusCall(call.callType)).length
    : 0;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 z-[990] flex justify-end"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
            togglePanel();
            setSelectedCall(null);
        }
      }}
    >
      <div
        className="w-full max-w-6xl h-full bg-gray-800 text-white shadow-xl flex flex-col p-4 z-[995]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <h2 className="text-xl font-semibold flex items-center">
            <Zap size={20} className="mr-2 text-yellow-400" /> LLM Call Log
          </h2>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleClearLogs}
              className="p-2 text-gray-400 hover:text-red-500 transition-colors"
              title="Clear all log entries"
              aria-label="Clear LLM Logs"
            >
              <Trash2 size={20} />
            </button>
            <button
              onClick={() => {
                  togglePanel();
                  setSelectedCall(null);
              }}
              className="p-2 text-gray-400 hover:text-white transition-colors"
              aria-label="Close LLM Log Panel"
            >
              <X size={24} />
            </button>
          </div>
        </div>
        <div className="flex flex-grow space-x-4 overflow-x-auto">
          {selectedCall && (
            <div className="w-2/3 flex-shrink-0 flex flex-col border-r border-gray-700 pr-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-semibold text-sky-300">Call Details</h3>
                <button
                  onClick={handleCloseDetailView}
                  className="p-1 text-gray-400 hover:text-white transition-colors"
                  aria-label="Close Details"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="flex-grow overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800 pr-1">
                <div className="space-y-3">
                  <div>
                    <span className="text-xs text-gray-400">ID:</span>
                    <p className="text-xs text-gray-300 break-all" title={selectedCall.id}>{selectedCall.id}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-400">Type:</span>
                    <p className="text-xs font-medium text-purple-300">{selectedCall.callType}</p>
                  </div>
                   <div>
                    <span className="text-xs text-gray-400">Status:</span>
                    <div className="flex items-center">
                        <StatusIcon status={selectedCall.status} />
                        <span className="ml-2 capitalize font-medium text-sm">{selectedCall.status}</span>
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-gray-400">Timestamps:</span>
                    <p className="text-xs text-gray-300">
                        {new Date(selectedCall.startTime).toLocaleString()} - 
                        {selectedCall.endTime ? new Date(selectedCall.endTime).toLocaleString() : 'Ongoing'}
                    </p>
                  </div>
                  {selectedCall.duration !== undefined && (
                     <div>
                        <span className="text-xs text-gray-400">Duration:</span>
                        <p className="text-xs text-gray-300">{selectedCall.duration}ms</p>
                    </div>
                  )}
                   {selectedCall.modelUsed && (
                     <div>
                        <span className="text-xs text-gray-400">Model:</span>
                        <p className="text-xs text-gray-300">{selectedCall.modelUsed}</p>
                    </div>
                  )}

                  {/* Container for two-column Prompt and Response */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 pt-2 border-t border-gray-700 mt-2">
                    <div> {/* Left Column: Input Prompt */}
                      <h4 className="text-sm font-semibold text-gray-300 mb-1">Input Prompt:</h4>
                      {(() => {
                        let contentToShow: string | null = null;
                        if (selectedCall.prompt) {
                          try {
                            const parsedPrompt = JSON.parse(selectedCall.prompt);
                            if (Array.isArray(parsedPrompt) && parsedPrompt.length > 0 && parsedPrompt[0] && typeof parsedPrompt[0].content === 'string') {
                              contentToShow = parsedPrompt[0].content;
                            } else if (typeof parsedPrompt === 'object' && parsedPrompt !== null && !Array.isArray(parsedPrompt) && typeof parsedPrompt.content === 'string') {
                              contentToShow = parsedPrompt.content;
                            }
                          } catch (e) {
                            // Parsing failed or structure is not as expected, contentToShow remains null, fallback will be used.
                          }
                        }
                        
                        if (contentToShow !== null) {
                          return <pre className="text-xs text-gray-200 whitespace-pre-wrap bg-gray-900 p-2 rounded max-h-[calc(100vh-25rem)] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-500 scrollbar-track-gray-700">{contentToShow}</pre>;
                        }
                        // Fallback: Display original prompt if no content was extracted or prompt is null/empty
                        return <pre className="text-xs text-gray-200 whitespace-pre-wrap bg-gray-900 p-2 rounded max-h-[calc(100vh-25rem)] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-500 scrollbar-track-gray-700">{selectedCall.prompt || 'No prompt data'}</pre>;
                      })()}
                    </div>

                    <div> {/* Right Column: Response */}
                      <h4 className="text-sm font-semibold text-gray-300 mb-1">Response:</h4>
                      {selectedCall.status === 'completed' && selectedCall.response ? (
                        <pre className="text-xs text-gray-200 whitespace-pre-wrap bg-gray-900 p-2 rounded max-h-[calc(100vh-25rem)] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-500 scrollbar-track-gray-700">{selectedCall.response}</pre>
                      ) : selectedCall.status === 'running' || selectedCall.status === 'queued' ? (
                        <p className="text-xs text-gray-500 italic">Response pending...</p>
                      ) : selectedCall.status === 'failed' ? (
                        <p className="text-xs text-red-500 italic">No response due to error.</p>
                      ) : (
                        <p className="text-xs text-gray-500 italic">No response available.</p>
                      )}
                    </div>
                  </div>

                  {selectedCall.error && (
                    <div className="mt-2 pt-2 border-t border-gray-700">
                      <h4 className="text-sm font-semibold text-red-400 mb-1">Error:</h4>
                      <pre className="text-xs text-red-300 whitespace-pre-wrap bg-red-900 bg-opacity-30 p-2 rounded max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-red-500 scrollbar-track-red-700">{selectedCall.error}</pre>
                    </div>
                  )}
                   {selectedCall.feedback && (
                    <div className="mt-2 pt-2 border-t border-gray-700">
                      <h4 className="text-sm font-semibold text-yellow-400 mb-1">Feedback:</h4>
                      <pre className="text-xs text-yellow-200 whitespace-pre-wrap bg-yellow-900 bg-opacity-30 p-2 rounded max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-yellow-500 scrollbar-track-yellow-700">{selectedCall.feedback}</pre>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          <div className="flex space-x-4 w-full flex-shrink-0">
            {renderLogColumn(appCalls, "Application Calls", <Puzzle size={18} className="mr-2 text-sky-400" />, initialAppLogCount)}
            {renderLogColumn(moxusCalls, "Moxus Internal", <Brain size={18} className="mr-2 text-emerald-400" />, initialMoxusLogCount)}
          </div>
        </div>
      </div>
    </div>
  );
}; 