import { createContext, FC, useCallback, useState, useContext, ReactNode } from 'react';
import { moxusService } from '../services/MoxusService';

export interface Message {
  role: "assistant" | "user" | "system" | "reasoning" | "nodeEdition" | "selectedNodes" | "actions" | "userMandatoryInstructions" | "moxus";
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
      // Find the streaming message by iterating backwards
      let streamingMessageIndex = -1;
      for (let i = prevChatHistory.length - 1; i >= 0; i--) {
        if (prevChatHistory[i].isStreaming) {
          streamingMessageIndex = i;
          break;
        }
      }

      if (streamingMessageIndex !== -1) {
        const streamingMessage = prevChatHistory[streamingMessageIndex];
        const updatedMessage = { ...streamingMessage, content: streamingMessage.content + content };
        const updatedChatHistory = [...prevChatHistory];
        updatedChatHistory[streamingMessageIndex] = updatedMessage;
        
        localStorage.setItem('chatHistory', JSON.stringify(updatedChatHistory));
        return updatedChatHistory;
      }
      return prevChatHistory;
    });
  }, []);

  const endStreaming = useCallback(() => {
    setChatHistoryState((prevChatHistory) => {
      // Find the streaming message by iterating backwards
      let streamingMessageIndex = -1;
      for (let i = prevChatHistory.length - 1; i >= 0; i--) {
        if (prevChatHistory[i].isStreaming) {
          streamingMessageIndex = i;
          break;
        }
      }

      if (streamingMessageIndex !== -1) {
        const streamingMessage = prevChatHistory[streamingMessageIndex];
        const updatedMessage = { ...streamingMessage, isStreaming: false };
        const updatedChatHistory = [...prevChatHistory];
        updatedChatHistory[streamingMessageIndex] = updatedMessage;

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
    // Use the new function to record this system event for Moxus processing & UI logging
    moxusService.recordInternalSystemEvent(
      `chatReset-${Date.now()}`,
      "System Event: User initiated chat reset.",
      "Chat history has been cleared.",
      "chat_reset_event" // Specific eventType
    );

    localStorage.removeItem('chatHistory');
    setChatHistoryState([]);
  }, []);

  const editMessage = useCallback((index: number, newContent: string) => {
    setChatHistoryState((prevChatHistory) => {
      if (index >= 0 && index < prevChatHistory.length) {
        const originalMessage = prevChatHistory[index];

        if (originalMessage.role === "assistant") {
          // Use the new function to record this system event for Moxus processing & UI logging
          moxusService.recordInternalSystemEvent(
            `assistantMessageEdit-${Date.now()}-${index}`,
            "System Event: User edited an assistant's message.",
            `Message at index ${index} (role: assistant) was edited. Original content: '${originalMessage.content}'. New content: '${newContent}'.`,
            "assistant_message_edit_event" // Specific eventType
          );
        }

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
