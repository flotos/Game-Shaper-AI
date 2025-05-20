import React, { useRef, useEffect } from 'react';

interface ChatInputProps {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  handleSend: () => void;
  handleSendAsNote: () => void;
  waitingForAnswer: boolean;
  onRegenerate: () => void;
  showRegenerate: boolean;
  handleRefocus: () => void;
}

const ChatInput: React.FC<ChatInputProps> = ({ input, setInput, handleSend, handleSendAsNote, waitingForAnswer, onRegenerate, showRegenerate, handleRefocus }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      // Resize the textarea to fit the content
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex items-center mb-2">
      <textarea
        ref={textareaRef}
        className="flex-grow p-2 border border-gray-600 rounded bg-gray-700 text-white resize-none"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyPress={handleKeyPress}
        rows={1}
      />
      {showRegenerate && !waitingForAnswer && (
        <button
          onClick={onRegenerate}
          className="ml-2 px-2 py-1 bg-gray-700 text-gray-300 text-xs rounded hover:bg-gray-600 transition-colors"
          title="Regenerate last response"
        >
          ↻
        </button>
      )}
      <button
        className="ml-2 px-4 py-2 bg-purple-500 text-white rounded disabled:bg-gray-600 hover:bg-purple-600"
        onClick={handleSendAsNote}
        disabled={waitingForAnswer}
      >
        Send as Note
      </button>
      <button
        className="ml-2 px-4 py-2 bg-yellow-500 text-white rounded disabled:bg-gray-600 hover:bg-yellow-600"
        onClick={handleRefocus}
        disabled={waitingForAnswer}
        title="Refocus story (clears history)"
      >
        Refocus
      </button>
      <button
        className="ml-2 px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-600"
        onClick={handleSend}
        disabled={waitingForAnswer}
      >
        Send
      </button>
    </div>
  );
};

export default ChatInput;
