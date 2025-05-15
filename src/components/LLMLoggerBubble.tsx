import React, { useState, useEffect } from 'react';
import { moxusService, LLMCall } from '../services/MoxusService'; // Adjust path as needed
import { PanelRightOpen, PanelRightClose, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

interface LLMLoggerBubbleProps {
  togglePanel: () => void;
  isOpen: boolean;
}

export const LLMLoggerBubble: React.FC<LLMLoggerBubbleProps> = ({ togglePanel, isOpen }) => {
  const [activeCalls, setActiveCalls] = useState(0);
  const [hasFailedCalls, setHasFailedCalls] = useState(false);

  useEffect(() => {
    const updateStatus = (logEntries: LLMCall[]) => {
      setActiveCalls(logEntries.filter(call => call.status === 'running' || call.status === 'queued').length);
      setHasFailedCalls(logEntries.some(call => call.status === 'failed'));
    };

    // Initial load
    updateStatus(moxusService.getLLMLogEntries());

    // Subscribe to updates
    const unsubscribe = moxusService.subscribeToLLMLogUpdates(updateStatus);
    return () => unsubscribe();
  }, []);

  let bgColor = 'bg-blue-600 hover:bg-blue-700';
  let icon = isOpen ? <PanelRightClose size={24} /> : <PanelRightOpen size={24} />;

  if (activeCalls > 0) {
    bgColor = 'bg-yellow-500 hover:bg-yellow-600';
    icon = <Loader2 size={24} className="animate-spin" />;
  } else if (hasFailedCalls && !isOpen) { // Only show error state if panel is closed and there are errors
    bgColor = 'bg-red-600 hover:bg-red-700';
    icon = <AlertTriangle size={24} />;
  }


  return (
    <button
      onClick={togglePanel}
      className={`fixed bottom-5 right-5 p-3 rounded-full text-white shadow-lg transition-colors duration-150 ease-in-out z-[1000] ${bgColor}`}
      aria-label={isOpen ? 'Close LLM Log Panel' : 'Open LLM Log Panel'}
    >
      {icon}
    </button>
  );
}; 