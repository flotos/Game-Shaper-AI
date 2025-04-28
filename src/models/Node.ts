export interface Node {
  id: string;
  name: string;
  shortDescription: string;
  longDescription: string;
  rules: string;
  image: string;
  updateImage?: boolean;
  type: string;
  parent: string;
  child: string[];
  imageSeed?: number;
}