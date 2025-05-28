import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import assistantPrompts from '../data/assistant-prompts.yaml';

interface AssistantPrompt {
  name: string;
  description: string;
  prompt: string;
}

interface AssistantPromptSelectorProps {
  onPromptSelect: (prompt: string) => void;
}

export function AssistantPromptSelector({ onPromptSelect }: AssistantPromptSelectorProps) {
  const handlePromptChange = (value: string) => {
    const selectedPrompt = assistantPrompts.prompts.find((p: AssistantPrompt) => p.name === value);
    if (selectedPrompt) {
      onPromptSelect(selectedPrompt.prompt);
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Select Pre-made Prompt</label>
      <Select onValueChange={handlePromptChange}>
        <SelectTrigger className="w-full bg-gray-700 text-white border-gray-600">
          <SelectValue placeholder="Choose a prompt template" />
        </SelectTrigger>
        <SelectContent className="bg-gray-700 text-white border-gray-600">
          {assistantPrompts.prompts.map((prompt: AssistantPrompt) => (
            <SelectItem key={prompt.name} value={prompt.name} className="hover:bg-gray-600">
              <div className="flex flex-col">
                <span className="font-medium">{prompt.name}</span>
                <span className="text-sm text-gray-300">{prompt.description}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
} 