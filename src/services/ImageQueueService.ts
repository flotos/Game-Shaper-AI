import { Node } from '../models/Node';
import { generateImage } from './ImageService';
import { generateImagePrompt } from './llm';

interface QueuedImage {
  nodeId: string;
  prompt: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  imageUrl?: string;
  node?: Node;
}

class ImageQueueService {
  private queue: QueuedImage[] = [];
  private isProcessing = false;
  private updateNodeCallback: ((node: Node) => void) | null = null;

  constructor() {
    this.processQueue = this.processQueue.bind(this);
  }

  setUpdateNodeCallback(callback: (node: Node) => void) {
    this.updateNodeCallback = callback;
  }

  async addToQueue(node: Node, allNodes: Node[], chatHistory: any[]) {
    if (!node.updateImage) {
      console.log(`Skipping image queue for node ${node.id} because updateImage is not true.`);
      return;
    }
    try {
      const prompt = await generateImagePrompt(node, allNodes, chatHistory);
      this.queue.push({
        nodeId: node.id,
        prompt,
        status: 'pending',
        node
      });
      
      if (!this.isProcessing) {
        this.processQueue();
      }
    } catch (error) {
      console.error('Error generating prompt for node:', node.id, error);
    }
  }

  async addToQueueWithExistingPrompt(node: Node, prompt: string) {
    if (!node.updateImage) {
      console.log(`Skipping image queue for node ${node.id} with existing prompt because updateImage is not true.`);
      return;
    }
    this.queue.push({
      nodeId: node.id,
      prompt,
      status: 'pending',
      node
    });
    
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    const item = this.queue.find(item => item.status === 'pending');
    
    if (!item || !item.node) {
      this.isProcessing = false;
      if (!item) console.log('No pending items in queue.');
      else console.error('Queue item is missing node data:', item.nodeId);
      return;
    }

    try {
      console.log('Processing queue item for node:', item.nodeId, 'Type:', item.node.type);
      item.status = 'processing';
      const imageUrl = await generateImage(item.prompt, item.node.imageSeed, item.node.type);
      
      if (imageUrl && this.updateNodeCallback) {
        console.log('Generated new image for node:', item.nodeId);
        const originalNode = this.queue.find(q => q.nodeId === item.nodeId)?.node;
        if (!originalNode) {
          console.error('Original node not found in queue for node:', item.nodeId);
          return;
        }
        const updatedNode: Node = {
          ...originalNode,
          image: imageUrl,
          updateImage: false
        } as Node;
        console.log('Updating node with new image:', updatedNode.id);
        this.updateNodeCallback(updatedNode);
      } else {
        console.error('Failed to generate image or update callback not set for node:', item.nodeId);
      }

      item.status = 'completed';
      item.imageUrl = imageUrl;
    } catch (error) {
      console.error('Error generating image for node:', item.nodeId, error);
      item.status = 'failed';
    }

    this.isProcessing = false;
    this.processQueue();
  }

  getQueueStatus() {
    return this.queue.map(item => ({
      nodeId: item.nodeId,
      status: item.status
    }));
  }
}

export const imageQueueService = new ImageQueueService(); 