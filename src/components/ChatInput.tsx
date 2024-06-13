import React, { useRef, useEffect } from 'react';

interface ChatInputProps {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  handleSend: () => void;
  waitingForAnswer: boolean;
}

const ChatInput: React.FC<ChatInputProps> = ({ input, setInput, handleSend, waitingForAnswer }) => {
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
