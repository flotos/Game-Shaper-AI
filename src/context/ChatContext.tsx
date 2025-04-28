import { createContext, FC, useCallback, useState, useContext, ReactNode } from 'react';

export interface Message {
  role: "assistant" | "user" | "system" | "reasoning" | "nodeEdition" | "selectedNodes" | "actions";
  content: string;
  timestamp?: string;
}

interface ChatContextType {
  chatHistory: Message[];
  addMessage: (message: Message) => void;
  setChatHistory: (messages: Message[]) => void;
  clearChatHistory: () => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [chatHistory, setChatHistoryState] = useState<Message[]>(() => {
    try {
      const savedChatHistory = localStorage.getItem('chatHistory');
      return savedChatHistory ? JSON.parse(savedChatHistory) : [];
    } catch (error) {
      console.error('Error parsing chat history from localStorage:', error);
      localStorage.removeItem('chatHistory'); // Clear corrupted data
      return [];
    }
  });

  const addMessage = useCallback((message: Message) => {
    setChatHistoryState((prevChatHistory) => {
      const updatedChatHistory = [...prevChatHistory, message];
      localStorage.setItem('chatHistory', JSON.stringify(updatedChatHistory));
      return updatedChatHistory;
    });
  }, []);

  const setChatHistory = useCallback((messages: Message[]) => {
    localStorage.setItem('chatHistory', JSON.stringify(messages));
    setChatHistoryState(messages);
  }, []);

  const clearChatHistory = useCallback(() => {
    localStorage.removeItem('chatHistory');
    setChatHistoryState([]);
  }, []);

  return (
    <ChatContext.Provider value={{ chatHistory, addMessage, setChatHistory, clearChatHistory }}>
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
};
