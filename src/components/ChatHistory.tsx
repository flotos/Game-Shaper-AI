import React from 'react';
import ChatBubble from './ChatBubble';
import { useChat } from '../context/ChatContext';

interface ChatHistoryProps {
  waitingForAnswer: boolean;
  loadingMessage: string;
  errorMessage: string;
  onActionClick: (action: string) => void;
  onRetry: () => void;
}

const ChatHistory: React.FC<ChatHistoryProps> = ({ waitingForAnswer, loadingMessage, errorMessage, onActionClick, onRetry }) => {
  const { chatHistory, addMessage, setChatHistory } = useChat();

  return (
    <div className="flex-grow overflow-y-auto mb-4 space-y-2">
      {chatHistory.map((msg, index) => (
        <ChatBubble key={index} message={msg} onActionClick={onActionClick} />
      ))}
      {waitingForAnswer && (
        <div className="flex flex-col items-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 my-2"></div>
          <div className="text-white text-sm">{loadingMessage}</div>
        </div>
      )}
      {errorMessage && (
        <div className="flex flex-col items-center">
          <div className="text-red-500 text-xl font-bold">×</div>
          <div className="text-white text-sm">{errorMessage}</div>
          <button
            onClick={onRetry}
            className="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
};

export default ChatHistory;
