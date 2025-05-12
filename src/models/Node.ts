export interface Node {
  id: string;
  name: string;
  longDescription: string;
  rules: string;
  image: string;
  updateImage?: boolean;
  // Define specific types like 'Character' | 'Location' | 'Item' | 'Rule' | 'Game Rule' | 'assistant' etc.
  type: string;
  imageSeed?: number;
}