export interface Node {
  id: string;
  name: string;
  longDescription: string;
  rules: string;
  image: string;
  updateImage?: boolean;
  type: string;
  imageSeed?: number;
}