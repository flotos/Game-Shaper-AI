import React, { useState, useEffect, useRef } from 'react';
import { moxusService, LLMCall } from '../services/MoxusService'; // Adjust path as needed
import { X, AlertTriangle, CheckCircle2, Loader2, Info, Trash2, Zap } from 'lucide-react';

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

export const LLMLoggerPanel: React.FC<LLMLoggerPanelProps> = ({ isOpen, togglePanel }) => {
  const [logEntries, setLogEntries] = useState<LLMCall[]>([]);
  const [initialLogCount, setInitialLogCount] = useState<number | null>(null);
  const panelContentRef = useRef<HTMLDivElement>(null); // For scrolling

  useEffect(() => {
    if (isOpen) {
      const currentLogs = moxusService.getLLMLogEntries();
      setLogEntries(currentLogs);
      
      if (initialLogCount === null) { // Only set on first open after panel was closed or logs cleared
        setInitialLogCount(currentLogs.length);
      }

      const unsubscribe = moxusService.subscribeToLLMLogUpdates((updatedLogs) => {
        setLogEntries(updatedLogs);
        // If logs were cleared, initialLogCount would be 0. New logs make it > 0.
        // If panel was closed and reopened, initialLogCount would be reset to null then set to currentLogs.length.
      });
      return () => {
        unsubscribe();
        // Don't reset initialLogCount here, only when explicitly closed or cleared
      };
    } else {
      setInitialLogCount(null); // Reset when panel is closed, so it re-evaluates on next open
    }
  }, [isOpen]); // Removed initialLogCount from deps to avoid loop, managed explicitly

  const handleClearLogs = () => {
    moxusService.clearLLMLogEntries();
    setInitialLogCount(0); // After clearing, all new logs are "current session"
    if (panelContentRef.current) {
      panelContentRef.current.scrollTop = 0; // Scroll to top
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 z-[990] flex justify-end"
      onClick={togglePanel} 
    >
      <div 
        className="w-full max-w-2xl h-full bg-gray-800 text-white shadow-xl flex flex-col p-4 z-[995]"
        onClick={(e) => e.stopPropagation()} 
      >
        <div className="flex justify-between items-center mb-4">
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
              onClick={togglePanel} 
              className="p-2 text-gray-400 hover:text-white transition-colors"
              aria-label="Close LLM Log Panel"
            >
              <X size={24} />
            </button>
          </div>
        </div>
        <div ref={panelContentRef} className="flex-grow overflow-y-auto pr-2 space-y-3 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
          {logEntries.length === 0 ? (
            <p className="text-gray-400 text-center py-10">No LLM calls recorded.</p>
          ) : (
            logEntries.map((call, index) => (
              <React.Fragment key={call.id}>
                {initialLogCount !== null && index === initialLogCount && initialLogCount > 0 && (
                  <div className="my-3 pt-2 border-t border-dashed border-gray-600 relative">
                    <span className="absolute left-1/2 -translate-x-1/2 -top-3 bg-gray-800 px-2 text-xs text-gray-500">
                      Current Session
                    </span>
                  </div>
                )}
                <div 
                  className={`bg-gray-700 p-3 rounded-md shadow border-l-4 ${getStatusColor(call.status)}`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-semibold text-sm text-blue-300 truncate max-w-[180px] sm:max-w-[200px]" title={call.id}>ID: {call.id.split('-')[1] || call.id}</span>
                    <span className="text-xs text-gray-400 whitespace-nowrap">
                      {new Date(call.startTime).toLocaleTimeString()} -
                      {call.endTime ? new Date(call.endTime).toLocaleTimeString() : 'Ongoing'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm mb-1">
                      <div className="flex items-center">
                          <StatusIcon status={call.status} />
                          <span className="ml-2 capitalize font-medium">{call.status}</span>
                      </div>
                      {call.duration !== undefined && (
                          <span className="text-xs text-gray-400">{call.duration}ms</span>
                      )}
                  </div>
                  <p className="text-xs text-gray-300 break-all">Type: <span className="font-medium text-purple-300">{call.callType}</span></p>
                  <p className="text-xs text-gray-300 break-all">Model: <span className="font-medium text-indigo-300">{call.modelUsed}</span></p>
                  {call.error && (
                    <p className="text-xs text-red-400 mt-1 bg-red-900 bg-opacity-30 p-2 rounded break-words">Error: {call.error}</p>
                  )}
                </div>
              </React.Fragment>
            ))
          )}
        </div>
      </div>
    </div>
  );
}; 