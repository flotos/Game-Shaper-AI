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
      chat_history: this.formatChatHistoryForPrompt(chatHistory),
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
    const targetNode = allNodes.find(n => n.id === nodeId);
    if (!targetNode) {
      throw new Error(`Target node ${nodeId} not found`);
    }

    const replacements = {
      all_nodes: this.formatNodesForPrompt(allNodes),
      to_edit_node_content: this.formatSingleNodeForPrompt(targetNode),
      searchQuery1: planningOutput.searchQueries[0] || '',
      searchResults1: this.formatSearchResultsForPrompt(searchResults.broad),
      searchQuery2: planningOutput.searchQueries[1] || '',
      searchResults2: this.formatSearchResultsForPrompt(searchResults.precise),
      userQuery: userPrompt,
      objectives: planningOutput.objectives,
      successRules: planningOutput.successRules.join('\n'),
      previous_failures: previousFailures ? previousFailures.join('\n') : '',
      chat_history: this.formatChatHistoryForPrompt(chatHistory),
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
    const replacements = {
      existing_nodes: this.formatNodesForPrompt(allNodes),
      edited_nodes: JSON.stringify(editedNodes, null, 2),
      successRules: planningOutput.successRules.join('\n'),
      chat_history: this.formatChatHistoryForPrompt(chatHistory),
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
          
          for (const nodeId of state.planningOutput.targetNodeIds) {
            const previousFailures = state.validationResult?.failedRules
              .filter(fr => fr.nodeId === nodeId)
              .map(fr => fr.reason);
              
            const diff = await this.generateNodeDiff(
              nodeId,
              state.allNodes,
              state.planningOutput,
              state.searchResults,
              state.chatHistory || [],
              state.userPrompt,
              previousFailures
            );
            
            generatedDiffs[nodeId] = diff;
          }
          
          state.generatedDiffs = generatedDiffs;
        }

        // Apply diffs to current state for validation
        const editedNodes = this.applyDiffsToNodes(
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
    return data &&
           Array.isArray(data.targetNodeIds) &&
           typeof data.objectives === 'string' &&
           Array.isArray(data.successRules) &&
           Array.isArray(data.searchQueries) &&
           data.searchQueries.length === 2;
  }

  private validateValidationOutput(data: any): boolean {
    return data &&
           Array.isArray(data.validatedRules) &&
           Array.isArray(data.failedRules) &&
           Array.isArray(data.failedNodeIds);
  }

  private formatNodesForPrompt(nodes: Node[]): string {
    return nodes.map(node => 
      `---\nid: "${node.id}"\nname: ${node.name}\nlongDescription: ${node.longDescription}\ntype: ${node.type}`
    ).join('\n');
  }

  private formatSingleNodeForPrompt(node: Node): string {
    return `---\nid: "${node.id}"\nname: ${node.name}\nlongDescription: ${node.longDescription}\ntype: ${node.type}`;
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
      if (editedNodes[nodeId] && diff.u_nodes && diff.u_nodes[nodeId]) {
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
      }
    }
    
    return editedNodes;
  }
}

export const advancedNodeGenerationService = new AdvancedNodeGenerationService(); 