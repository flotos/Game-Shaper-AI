import React from 'react';
import ChatBubble from './ChatBubble';
import { Message } from '../hooks/useChatHistory';

interface ChatHistoryProps {
  chatHistory: Message[];
  waitingForAnswer: boolean;
  loadingMessage: string;
  errorMessage: string;
  onActionClick: (action: string) => void;
}

const ChatHistory: React.FC<ChatHistoryProps> = ({ chatHistory, waitingForAnswer, loadingMessage, errorMessage, onActionClick }) => {
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
        </div>
      )}
    </div>
  );
};

export default ChatHistory;
