import { useState, useEffect } from 'react';

export interface Message {
  role: "assistant" | "user" | "system" | "reasoning" | "nodeEdition" | "selectedNodes" | "actions";
  content: string;
  timestamp?: string;
}

const useChatHistory = () => {
  const [chatHistory, setChatHistory] = useState<Message[]>(() => {
    const savedHistory = localStorage.getItem('chatHistory');
    return savedHistory ? JSON.parse(savedHistory) : [
      {
        role: "assistant",
        content: "You arrives in front of a tavern",
      }
    ];
  });

  useEffect(() => {
    localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
  }, [chatHistory]);

  return { chatHistory, setChatHistory };
};

export default useChatHistory;
