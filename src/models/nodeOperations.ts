import { Node } from './Node';

// Instruction for a specific text change within a string field
export interface TextDiffInstruction {
  prev_txt: string; // The exact text fragment to find and replace.
  next_txt: string; // The text to replace prev_txt with. If empty, prev_txt is deleted.
  occ?: number;      // Optional: 1-indexed. Which occurrence of prev_txt to target. Defaults to 1.
}

// Defines how a single field on a node should be updated
export interface FieldUpdateOperation {
  rpl?: any;                // For replacing the entire field content.
  df?: TextDiffInstruction[]; // For targeted changes within a string field (like longDescription or rules).
}

// Defines all updates for a specific node, including an optional image update flag
export interface NodeSpecificUpdates {
  // Key is the field name (e.g., "name", "longDescription", "rules", "type")
  // Value is how that field should be updated.
  [fieldName: string]: FieldUpdateOperation | boolean | undefined;
  img_upd?: boolean; // Optional: Explicitly signal if the node's image needs regeneration due to these updates.
}

// The overall structure for node edits returned by the LLM (now in YAML, using shortened keys)
export interface LLMNodeEditionResponse {
  callId: string;                     // Internal tracking ID, not from LLM YAML
  n_nodes?: Node[];                   // Array of full new Node objects to be created.
  u_nodes?: {                         // Object where keys are node IDs to be updated.
    [nodeId: string]: NodeSpecificUpdates;
  };
  d_nodes?: string[];                 // Array of node IDs to be deleted.
}

// --- Old types from previous approaches are commented out below --- 
/*
export interface Patch {
  op: 'replace';
  path: string; 
  value?: any; 
}

export interface PatchNodeOperation {
  op: 'patchNode';
  nodeId: string;
  patches: Patch[];
  updateImage?: boolean;
}

export interface TextEditInstructionOld {
  findText: string; 
  replaceWith?: string; 
  occurrence?: number; 
}

export interface ModifyStringFieldOperation {
  op: 'modifyStringField';
  nodeId: string;
  path: string; 
  edits: TextEditInstructionOld[];
  updateImage?: boolean; 
}

export interface AddNodeOperation {
  op: 'addNode';
  value: Node; 
}

export interface RemoveNodeOperation {
  op: 'removeNode';
  nodeId: string;
}

export type NodeOperation = 
  | PatchNodeOperation 
  | AddNodeOperation 
  | RemoveNodeOperation 
  | ModifyStringFieldOperation; 

export function isAddNodeOperation(op: NodeOperation): op is AddNodeOperation {
  return op.op === 'addNode';
}

export function isRemoveNodeOperation(op: NodeOperation): op is RemoveNodeOperation {
  return op.op === 'removeNode';
}

export function isPatchNodeOperation(op: NodeOperation): op is PatchNodeOperation {
  return op.op === 'patchNode';
}

export function isModifyStringFieldOperation(op: NodeOperation): op is ModifyStringFieldOperation {
  return op.op === 'modifyStringField';
}
*/ 