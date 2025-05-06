import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import prompts from '../data/prompts.yaml';

interface Prompt {
  name: string;
  description: string;
  data_extraction: string;
  node_generation: string;
}

interface PromptSelectorProps {
  onPromptSelect: (dataExtraction: string, nodeGeneration: string) => void;
}

export function PromptSelector({ onPromptSelect }: PromptSelectorProps) {
  const handlePromptChange = (value: string) => {
    const selectedPrompt = prompts.prompts.find((p: Prompt) => p.name === value);
    if (selectedPrompt) {
      onPromptSelect(selectedPrompt.data_extraction, selectedPrompt.node_generation);
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
          {prompts.prompts.map((prompt: Prompt) => (
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