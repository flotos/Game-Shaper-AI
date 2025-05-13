import { createContext, FC, useCallback, useState, useContext, ReactNode } from 'react';
import { moxusService } from '../services/MoxusService';

export interface Message {
  role: "assistant" | "user" | "system" | "reasoning" | "nodeEdition" | "selectedNodes" | "actions" | "userNote" | "moxus";
  content: string;
  timestamp?: string;
  isStreaming?: boolean;
}

interface ChatContextType {
  chatHistory: Message[];
  addMessage: (message: Message) => void;
  setChatHistory: (messages: Message[]) => void;
  clearChatHistory: () => void;
  updateStreamingMessage: (content: string) => void;
  endStreaming: () => void;
  editMessage: (index: number, newContent: string) => void;
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

  const updateStreamingMessage = useCallback((content: string) => {
    setChatHistoryState((prevChatHistory) => {
      const lastMessage = prevChatHistory[prevChatHistory.length - 1];
      if (lastMessage && lastMessage.isStreaming) {
        const updatedMessage = { ...lastMessage, content: lastMessage.content + content };
        const updatedChatHistory = [...prevChatHistory.slice(0, -1), updatedMessage];
        localStorage.setItem('chatHistory', JSON.stringify(updatedChatHistory));
        return updatedChatHistory;
      }
      return prevChatHistory;
    });
  }, []);

  const endStreaming = useCallback(() => {
    setChatHistoryState((prevChatHistory) => {
      const lastMessage = prevChatHistory[prevChatHistory.length - 1];
      if (lastMessage && lastMessage.isStreaming) {
        const updatedMessage = { ...lastMessage, isStreaming: false };
        const updatedChatHistory = [...prevChatHistory.slice(0, -1), updatedMessage];
        localStorage.setItem('chatHistory', JSON.stringify(updatedChatHistory));
        return updatedChatHistory;
      }
      return prevChatHistory;
    });
  }, []);

  const setChatHistory = useCallback((messages: Message[]) => {
    localStorage.setItem('chatHistory', JSON.stringify(messages));
    setChatHistoryState(messages);
  }, []);

  const clearChatHistory = useCallback(() => {
    moxusService.recordLLMCall(
      `chatReset-${Date.now()}`,
      "System Event: User initiated chat reset.",
      "Chat history has been cleared." 
    );

    localStorage.removeItem('chatHistory');
    setChatHistoryState([]);
  }, []);

  const editMessage = useCallback((index: number, newContent: string) => {
    setChatHistoryState((prevChatHistory) => {
      if (index >= 0 && index < prevChatHistory.length) {
        const updatedChatHistory = [...prevChatHistory];
        updatedChatHistory[index] = { ...updatedChatHistory[index], content: newContent };
        localStorage.setItem('chatHistory', JSON.stringify(updatedChatHistory));
        return updatedChatHistory;
      }
      return prevChatHistory;
    });
  }, []);

  return (
    <ChatContext.Provider value={{ 
      chatHistory, 
      addMessage, 
      setChatHistory, 
      clearChatHistory,
      updateStreamingMessage,
      endStreaming,
      editMessage
    }}>
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
};
