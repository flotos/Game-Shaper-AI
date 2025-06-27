import { BraveSearchResponse, SearchResult, SearchResults } from '../types/advancedNodeGeneration';

class BraveSearchService {
  private apiKey?: string;
  private baseUrl = 'https://api.search.brave.com/res/v1/web/search';
  
  constructor() {
    this.apiKey = import.meta.env.VITE_BRAVE_API_KEY;
  }
  
  private async makeSearchRequest(query: string): Promise<BraveSearchResponse> {
    if (!this.apiKey) {
      throw new Error('Brave API key not configured. Please set VITE_BRAVE_API_KEY environment variable.');
    }
    
    const url = new URL(this.baseUrl);
    url.searchParams.append('q', query);
    
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': this.apiKey,
      },
    });
    
    if (!response.ok) {
      throw new Error(`Brave Search API error: ${response.status} ${response.statusText}`);
    }
    
    return await response.json();
  }
  
  private convertBraveResultsToSearchResults(braveResponse: BraveSearchResponse): SearchResult[] {
    if (!braveResponse.web?.results) {
      return [];
    }
    
    return braveResponse.web.results.map(result => ({
      title: result.title || '',
      url: result.url || '',
      description: result.description || '',
    }));
  }
  
  async searchDualQueries(broadQuery: string, preciseQuery: string, maxResults: number = 5): Promise<SearchResults> {
    try {
      // Execute both searches in parallel
      const [broadResponse, preciseResponse] = await Promise.all([
        this.makeSearchRequest(broadQuery),
        this.makeSearchRequest(preciseQuery),
      ]);
      
      const broadResults = this.convertBraveResultsToSearchResults(broadResponse).slice(0, maxResults);
      const preciseResults = this.convertBraveResultsToSearchResults(preciseResponse).slice(0, maxResults);
      
      return {
        broad: broadResults,
        precise: preciseResults,
      };
    } catch (error) {
      console.error('Brave Search API error:', error);
      
      // Return empty results on failure rather than throwing
      // This allows the pipeline to continue with empty search context
      return {
        broad: [],
        precise: [],
      };
    }
  }
  
  async searchSingleQuery(query: string, maxResults: number = 10): Promise<SearchResult[]> {
    try {
      const response = await this.makeSearchRequest(query);
      return this.convertBraveResultsToSearchResults(response).slice(0, maxResults);
    } catch (error) {
      console.error('Brave Search API error:', error);
      return [];
    }
  }
  
  isConfigured(): boolean {
    return !!this.apiKey;
  }
  
  getConfigurationStatus(): { configured: boolean; message: string } {
    if (this.apiKey) {
      return {
        configured: true,
        message: 'Brave Search API is configured and ready to use.',
      };
    }
    
    return {
      configured: false,
      message: 'Brave Search API key not found. Set VITE_BRAVE_API_KEY environment variable to enable web search.',
    };
  }
}

export const braveSearchService = new BraveSearchService(); 