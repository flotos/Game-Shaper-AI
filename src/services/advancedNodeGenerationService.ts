import { Node } from '../models/Node';
import { Message } from '../context/ChatContext';
import { 
  PipelineState, 
  PlanningStageOutput, 
  SearchResults, 
  ValidationResult,
  AdvancedNodeGenerationConfig
} from '../types/advancedNodeGeneration';
import { braveSearchService } from './braveSearchService';
import { getResponse, formatPrompt, loadedPrompts } from './llmCore';
import { safeJsonParse } from '../utils/jsonUtils';
import { applyTextDiffInstructions } from '../utils/textUtils';

class AdvancedNodeGenerationService {
  private defaultConfig: AdvancedNodeGenerationConfig = {
    defaultTimeout: 10 * 60 * 1000, // 10 minutes
    maxSearchResults: 5,
  };
  
  private pipelineTimeouts = new Map<string, NodeJS.Timeout>();

  private sanitizeNodeForPrompt(node: Node): Omit<Node, 'image' | 'updateImage' | 'imageSeed'> {
    const { image, updateImage, imageSeed, ...sanitizedNode } = node;
    return sanitizedNode;
  }

  private sanitizeEditedNodesForPrompt(editedNodes: { [nodeId: string]: any }): { [nodeId: string]: any } {
    const sanitized: { [nodeId: string]: any } = {};
    for (const [nodeId, nodeData] of Object.entries(editedNodes)) {
      if (nodeData && typeof nodeData === 'object') {
        const { image, updateImage, imageSeed, ...sanitizedNodeData } = nodeData;
        sanitized[nodeId] = sanitizedNodeData;
      } else {
        sanitized[nodeId] = nodeData;
      }
    }
    return sanitized;
  }

  // Stage 1: Planning
  async runPlanningStage(
    allNodes: Node[], 
    chatHistory: Message[],
    userPrompt: string,
    moxusContext?: string
  ): Promise<PlanningStageOutput> {
    const nodesDescription = this.formatNodesForPrompt(allNodes);
    const replacements = {
      nodes_description: nodesDescription,
      moxus_context_string: moxusContext || '',
      user_prompt: userPrompt,
      string_history: this.formatChatHistoryForPrompt(chatHistory),
    };

    const prompt = formatPrompt(loadedPrompts.advanced_nodes_generation.planning, replacements);
    
    const messages = [{ role: 'user' as const, content: prompt }];
    const response = await getResponse(
      messages,
      undefined, // Use default model
      undefined, // No grammar
      false, // No streaming
      { type: 'json_object' }, // Force JSON response
      { temperature: 0.7 },
      'advanced_node_planning'
    );

    const content = response && 'llmResult' in response ? response.llmResult : '';
    const parsedResponse = safeJsonParse(content);
    if (!parsedResponse || !this.validatePlanningOutput(parsedResponse)) {
      throw new Error('Invalid planning stage output: ' + content);
    }

    return parsedResponse as PlanningStageOutput;
  }

  // Stage 2: Web Search
  async executeSearchStage(planningOutput: PlanningStageOutput): Promise<SearchResults> {
    if (planningOutput.searchQueries.length !== 2) {
      throw new Error('Planning stage must provide exactly 2 search queries');
    }

    const [broadQuery, preciseQuery] = planningOutput.searchQueries;
    
    return await braveSearchService.searchDualQueries(
      broadQuery, 
      preciseQuery, 
      this.defaultConfig.maxSearchResults
    );
  }

  // Stage 3: Content Generation
  async generateNodeDiff(
    nodeId: string,
    allNodes: Node[],
    planningOutput: PlanningStageOutput,
    searchResults: SearchResults,
    chatHistory: Message[],
    userPrompt: string,
    previousFailures?: string[]
  ): Promise<any> {
    const isNewNode = nodeId.match(/^NEW_NODE_[a-zA-Z0-9_]+$/);
    
    let originalNodeContent = '';
    if (isNewNode) {
      // For new nodes, provide empty content template
      originalNodeContent = 'NEW NODE - No existing content. Create a complete new node.';
    } else {
      // For existing nodes, find and validate
      const targetNode = allNodes.find(n => n.id === nodeId);
      if (!targetNode) {
        throw new Error(`Target node ${nodeId} not found`);
      }
      originalNodeContent = this.formatSingleNodeForPrompt(targetNode);
    }

    const replacements = {
      all_nodes_context: this.formatNodesForPrompt(allNodes),
      original_node: originalNodeContent,
      node_operation_type: isNewNode ? 'CREATE_NEW_NODE' : 'EDIT_EXISTING_NODE',
      target_node_id: nodeId,
      searchQuery1: planningOutput.searchQueries[0] || '',
      searchResults1: this.formatSearchResultsForPrompt(searchResults.broad),
      searchQuery2: planningOutput.searchQueries[1] || '',
      searchResults2: this.formatSearchResultsForPrompt(searchResults.precise),
      user_query: userPrompt,
      objectives: planningOutput.objectives,
      successRules: planningOutput.successRules.join('\n'),
      previous_failures: previousFailures ? previousFailures.join('\n') : '',
      string_history: this.formatChatHistoryForPrompt(chatHistory),
    };

    const prompt = formatPrompt(loadedPrompts.advanced_nodes_generation.node_edition, replacements);
    
    const messages = [{ role: 'user' as const, content: prompt }];
    const response = await getResponse(
      messages,
      undefined,
      undefined,
      false,
      { type: 'json_object' },
      { temperature: 0.8 },
      'advanced_node_content_generation'
    );

    const content = response && 'llmResult' in response ? response.llmResult : '';
    const parsedResponse = safeJsonParse(content);
    if (!parsedResponse) {
      throw new Error('Invalid node generation output: ' + content);
    }

    return parsedResponse;
  }

  // Stage 4: Validation
  async validateOutput(
    allNodes: Node[],
    editedNodes: { [nodeId: string]: any },
    planningOutput: PlanningStageOutput,
    chatHistory: Message[]
  ): Promise<ValidationResult> {
    const sanitizedEditedNodes = this.sanitizeEditedNodesForPrompt(editedNodes);
    const replacements = {
      nodes_description: this.formatNodesForPrompt(allNodes),
      edited_nodes: JSON.stringify(sanitizedEditedNodes, null, 2),
      successRules: planningOutput.successRules.join('\n'),
      string_history: this.formatChatHistoryForPrompt(chatHistory),
    };

    const prompt = formatPrompt(loadedPrompts.advanced_nodes_generation.validation, replacements);
    
    const messages = [{ role: 'user' as const, content: prompt }];
    const response = await getResponse(
      messages,
      undefined,
      undefined,
      false,
      { type: 'json_object' },
      { temperature: 0.3 }, // Lower temperature for validation
      'advanced_node_validation'
    );

    const content = response && 'llmResult' in response ? response.llmResult : '';
    const parsedResponse = safeJsonParse(content);
    if (!parsedResponse || !this.validateValidationOutput(parsedResponse)) {
      throw new Error('Invalid validation stage output: ' + content);
    }

    return parsedResponse as ValidationResult;
  }

  // Complete pipeline orchestration
  async runPipeline(
    userPrompt: string,
    allNodes: Node[],
    chatHistory: Message[],
    config: Partial<AdvancedNodeGenerationConfig> = {},
    onStageUpdate?: (state: PipelineState) => void
  ): Promise<PipelineState> {
    const finalConfig = { ...this.defaultConfig, ...config };
    
    const pipelineId = Math.random().toString(36).substring(7);
    const initialState: PipelineState = {
      mode: 'automatic',
      maxLoops: 1,
      timeout: finalConfig.defaultTimeout,
      currentLoop: 1,
      stage: 'planning',
      originalNodes: this.createNodeSnapshot(allNodes),
      currentNodeStates: this.createNodeSnapshot(allNodes),
      errors: [],
      userPrompt,
      allNodes,
      chatHistory,
    };

    let state = { ...initialState };
    
    // Set timeout for entire pipeline
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Pipeline timeout exceeded'));
      }, finalConfig.defaultTimeout);
      this.pipelineTimeouts.set(pipelineId, timeout);
    });

    try {
      const result = await Promise.race([
        this.executePipelineLoop(state, onStageUpdate),
        timeoutPromise
      ]);
      
      return result;
    } catch (error) {
      state.stage = 'failed';
      state.errors.push({
        stage: state.stage,
        loop: state.currentLoop,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      });
      
      onStageUpdate?.(state);
      throw error;
    } finally {
      // Clear timeout
      const timeout = this.pipelineTimeouts.get(pipelineId);
      if (timeout) {
        clearTimeout(timeout);
        this.pipelineTimeouts.delete(pipelineId);
      }
    }
  }

  private async executePipelineLoop(
    initialState: PipelineState,
    onStageUpdate?: (state: PipelineState) => void
  ): Promise<PipelineState> {
    let state = { ...initialState };
    
    while (state.currentLoop <= state.maxLoops) {
      try {
        // Stage 1: Planning (only on first loop)
        if (state.currentLoop === 1) {
          state.stage = 'planning';
          onStageUpdate?.(state);
          
          state.planningOutput = await this.runPlanningStage(
            state.allNodes,
            state.chatHistory || [],
            state.userPrompt
          );
        }

        // Stage 2: Search (only on first loop)
        if (state.currentLoop === 1 && state.planningOutput) {
          state.stage = 'searching';
          onStageUpdate?.(state);
          
          state.searchResults = await this.executeSearchStage(state.planningOutput);
        }

        // Stage 3: Content Generation
        if (state.planningOutput && state.searchResults) {
          state.stage = 'generating';
          onStageUpdate?.(state);
          
          const generatedDiffs: { [nodeId: string]: any } = {};
          
          // Create a working copy of nodes that will be updated with each generation
          let workingNodes = [...state.allNodes];
          let workingNodesMap = this.createNodeSnapshot(workingNodes);
          
          for (const nodeId of state.planningOutput.targetNodeIds) {
            const previousFailures = state.validationResult?.failedRules
              .filter(fr => fr.nodeId === nodeId)
              .map(fr => fr.reason);
              
            const diff = await this.generateNodeDiff(
              nodeId,
              workingNodes, // Use the working copy that includes previous generations
              state.planningOutput,
              state.searchResults,
              state.chatHistory || [],
              state.userPrompt,
              previousFailures
            );
            
            generatedDiffs[nodeId] = diff;
            
            // Apply this diff to the working nodes immediately so next generations can see it
            const tempDiffState = { [nodeId]: diff };
            const updatedNodesMap = this.applyDiffsToNodes(workingNodesMap, tempDiffState);
            
            // Update working nodes array with new nodes if any were created
            // Handle direct node format for CREATE_NEW_NODE
            if (diff && diff.id && diff.name && diff.longDescription && diff.type && nodeId.match(/^NEW_NODE_[a-zA-Z0-9_]+$/)) {
              if (!workingNodes.find(n => n.id === diff.id)) {
                workingNodes.push(diff);
              }
            }
            // Handle legacy n_nodes format
            else if (diff.n_nodes && Array.isArray(diff.n_nodes)) {
              for (const newNode of diff.n_nodes) {
                if (newNode.id && !workingNodes.find(n => n.id === newNode.id)) {
                  workingNodes.push(newNode);
                }
              }
            }
            
            // Update working nodes array with updated existing nodes
            for (const [updatedNodeId, updatedNodeData] of Object.entries(updatedNodesMap)) {
              const nodeIndex = workingNodes.findIndex(n => n.id === updatedNodeId);
              if (nodeIndex !== -1) {
                workingNodes[nodeIndex] = { ...updatedNodeData };
              }
            }
            
            // Update the working map for the next iteration
            workingNodesMap = updatedNodesMap;
          }
          
          state.generatedDiffs = generatedDiffs;
        }

        // Apply diffs to current state for validation
        let editedNodes = this.applyDiffsToNodes(
          state.currentNodeStates,
          state.generatedDiffs || {}
        );

        // Stage 4: Validation
        if (state.planningOutput) {
          state.stage = 'validating';
          onStageUpdate?.(state);
          
          state.validationResult = await this.validateOutput(
            state.allNodes,
            editedNodes,
            state.planningOutput,
            state.chatHistory || []
          );
        }

        // Check if all rules passed
        if (state.validationResult && state.validationResult.failedRules.length === 0) {
          // Apply node deletions if any are specified
          if (state.planningOutput && state.planningOutput.deleteNodeIds.length > 0) {
            editedNodes = this.applyNodeDeletions(editedNodes, state.planningOutput.deleteNodeIds);
          }
          
          state.stage = 'completed';
          onStageUpdate?.(state);
          break;
        }

        // Prepare for next loop
        state.currentLoop++;
        if (state.currentLoop <= state.maxLoops) {
          // Update current node states with any successful changes
          state.currentNodeStates = editedNodes;
        }
        
      } catch (error) {
        state.errors.push({
          stage: state.stage,
          loop: state.currentLoop,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date(),
        });
        
        // Continue to next loop unless this is the last attempt
        if (state.currentLoop >= state.maxLoops) {
          throw error;
        }
        state.currentLoop++;
      }
    }

    // If we've exhausted all loops without success
    if (state.stage !== 'completed') {
      state.stage = 'failed';
    }
    
    onStageUpdate?.(state);
    return state;
  }

  // Utility methods
  private validatePlanningOutput(data: any): boolean {
    if (!data ||
        !Array.isArray(data.targetNodeIds) ||
        !Array.isArray(data.deleteNodeIds) ||
        typeof data.objectives !== 'string' ||
        !Array.isArray(data.successRules) ||
        !Array.isArray(data.searchQueries) ||
        data.searchQueries.length !== 2) {
      return false;
    }

    // Validate targetNodeIds format (existing node IDs or NEW_NODE_descriptiveName pattern)
    for (const nodeId of data.targetNodeIds) {
      if (typeof nodeId !== 'string') return false;
      
      // Allow existing node IDs or NEW_NODE_descriptiveName pattern
      if (!nodeId.match(/^NEW_NODE_[a-zA-Z0-9_]+$/) && !this.isValidExistingNodeId(nodeId)) {
        // For validation purposes, we'll accept any string that doesn't match NEW_NODE pattern
        // The actual existence check will be done in the generation stage
      }
    }

    // Validate deleteNodeIds format (should only be existing node IDs)
    for (const nodeId of data.deleteNodeIds) {
      if (typeof nodeId !== 'string') return false;
      // Delete nodes should only reference existing nodes, not NEW_NODE patterns
      if (nodeId.match(/^NEW_NODE_[a-zA-Z0-9_]+$/)) {
        return false; // Can't delete a node that doesn't exist yet
      }
    }

    return true;
  }

  private isValidExistingNodeId(nodeId: string): boolean {
    // This will be used in context where we have access to actual nodes
    // For now, we'll be permissive and let the generation stage handle validation
    return !nodeId.match(/^NEW_NODE_[a-zA-Z0-9_]+$/);
  }

  private validateValidationOutput(data: any): boolean {
    return data &&
           Array.isArray(data.validatedRules) &&
           Array.isArray(data.failedRules) &&
           Array.isArray(data.failedNodeIds);
  }

  private formatNodesForPrompt(nodes: Node[]): string {
    const filteredNodes = nodes.filter(node => 
      !['image_generation', 'image_generation_prompt', 'image_generation_prompt_negative', 'assistant'].includes(node.type)
    );
    
    return filteredNodes.map(node => {
      const sanitizedNode = this.sanitizeNodeForPrompt(node);
      return `---\nid: "${sanitizedNode.id}"\nname: ${sanitizedNode.name}\nlongDescription: ${sanitizedNode.longDescription}\ntype: ${sanitizedNode.type}`;
    }).join('\n');
  }

  private formatSingleNodeForPrompt(node: Node): string {
    const sanitizedNode = this.sanitizeNodeForPrompt(node);
    return `---\nid: "${sanitizedNode.id}"\nname: ${sanitizedNode.name}\nlongDescription: ${sanitizedNode.longDescription}\ntype: ${sanitizedNode.type}`;
  }

  private formatChatHistoryForPrompt(chatHistory: Message[]): string {
    return chatHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n');
  }

  private formatSearchResultsForPrompt(results: any[]): string {
    return results.map(result => 
      `Title: ${result.title}\nURL: ${result.url}\nDescription: ${result.description}`
    ).join('\n\n');
  }

  private createNodeSnapshot(nodes: Node[]): { [nodeId: string]: any } {
    const snapshot: { [nodeId: string]: any } = {};
    nodes.forEach(node => {
      snapshot[node.id] = { ...node };
    });
    return snapshot;
  }

  private applyDiffsToNodes(currentStates: { [nodeId: string]: any }, diffs: { [nodeId: string]: any }): { [nodeId: string]: any } {
    const editedNodes = { ...currentStates };
    
    for (const [nodeId, diff] of Object.entries(diffs)) {
      // Handle new node creation (direct node format for CREATE_NEW_NODE)
      if (diff && diff.id && diff.name && diff.longDescription && diff.type && nodeId.match(/^NEW_NODE_[a-zA-Z0-9_]+$/)) {
        // This is a direct node object from CREATE_NEW_NODE operation
        editedNodes[diff.id] = { ...diff };
      }
      
      // Handle new node creation (legacy n_nodes format)
      else if (diff.n_nodes && Array.isArray(diff.n_nodes)) {
        for (const newNode of diff.n_nodes) {
          if (newNode.id) {
            editedNodes[newNode.id] = { ...newNode };
          }
        }
      }
      
      // Handle direct diff format (advanced node generation individual diffs)
      else if (diff.df && Array.isArray(diff.df)) {
        if (editedNodes[nodeId]) {
          const editedNode = { ...editedNodes[nodeId] };
          // Apply diff to longDescription by default for advanced node generation
          const originalText = editedNode.longDescription || '';
          editedNode.longDescription = applyTextDiffInstructions(originalText, diff.df);
          editedNodes[nodeId] = editedNode;
        } else {
          console.warn(`Node ${nodeId} targeted for direct diff update but not found in current states. Skipping update.`);
        }
      }
      
      // Handle direct field operations (advanced node generation field-specific updates)
      else if (editedNodes[nodeId] && (diff.name || diff.longDescription || diff.type || diff.rpl)) {
        const editedNode = { ...editedNodes[nodeId] };
        let hasChanges = false;
        
        // Handle direct field replacements
        if (diff.rpl !== undefined) {
          editedNode.longDescription = diff.rpl;
          hasChanges = true;
        }
        
        // Handle individual field operations
        ['name', 'longDescription', 'type'].forEach(fieldName => {
          const fieldOp = (diff as any)[fieldName];
          if (fieldOp) {
            if (typeof fieldOp === 'string') {
              // Direct string replacement
              (editedNode as any)[fieldName] = fieldOp;
              hasChanges = true;
            } else if (fieldOp && typeof fieldOp === 'object') {
              if (fieldOp.rpl !== undefined) {
                (editedNode as any)[fieldName] = fieldOp.rpl;
                hasChanges = true;
              } else if (fieldOp.df && Array.isArray(fieldOp.df)) {
                const originalText = (editedNode as any)[fieldName] || '';
                (editedNode as any)[fieldName] = applyTextDiffInstructions(originalText, fieldOp.df);
                hasChanges = true;
              }
            }
          }
        });
        
        if (hasChanges) {
          editedNodes[nodeId] = editedNode;
        }
      }
      
      // Handle existing node updates (u_nodes format - legacy/standard system)
      else if (diff.u_nodes && diff.u_nodes[nodeId]) {
        if (editedNodes[nodeId]) {
          const nodeUpdates = diff.u_nodes[nodeId];
          const editedNode = { ...editedNodes[nodeId] };
          
          for (const [fieldName, operation] of Object.entries(nodeUpdates)) {
            if (fieldName === 'img_upd') continue;
            
            const fieldOp = operation as any;
            if (fieldOp && typeof fieldOp === 'object') {
              if (fieldOp.rpl !== undefined) {
                (editedNode as any)[fieldName] = fieldOp.rpl;
              } else if (fieldOp.df && Array.isArray(fieldOp.df)) {
                const originalText = (editedNode as any)[fieldName] || '';
                (editedNode as any)[fieldName] = applyTextDiffInstructions(originalText, fieldOp.df);
              }
            }
          }
          
          editedNodes[nodeId] = editedNode;
        } else {
          console.warn(`Node ${nodeId} targeted for update but not found in current states. Skipping update.`);
        }
      }
    }
    
    return editedNodes;
  }

  private applyNodeDeletions(currentStates: { [nodeId: string]: any }, deleteNodeIds: string[]): { [nodeId: string]: any } {
    const editedNodes = { ...currentStates };
    
    for (const nodeId of deleteNodeIds) {
      if (editedNodes[nodeId]) {
        delete editedNodes[nodeId];
        console.log(`Deleted node: ${nodeId}`);
      } else {
        console.warn(`Node ${nodeId} targeted for deletion but not found in current states. Skipping deletion.`);
      }
    }
    
    return editedNodes;
  }
}

export const advancedNodeGenerationService = new AdvancedNodeGenerationService(); 