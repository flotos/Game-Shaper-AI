import { BraveSearchResponse, SearchResult, SearchResults } from '../types/advancedNodeGeneration';

class BraveSearchService {
  private apiKey?: string;
  private baseUrl: string;
  
  constructor() {    
    // Use proxy in development, direct API or serverless function in production
    if (import.meta.env.DEV) {
      this.baseUrl = '/api/search';
    } else {
      // In production, we'll use a serverless function or backend endpoint
      this.baseUrl = import.meta.env.VITE_SEARCH_PROXY_URL || '/api/brave-search';
    }
  }
  
  private async makeSearchRequest(query: string): Promise<BraveSearchResponse> {
    
    const url = new URL(this.baseUrl, window.location.origin);
    url.searchParams.append('q', query);
    
    const headers: HeadersInit = {
      'Accept': 'application/json',
    };
    
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
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
      // Execute searches sequentially with 2-second delay for rate limiting
      const broadResponse = await this.makeSearchRequest(broadQuery);
      
      // Wait 2 seconds before the next search to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const preciseResponse = await this.makeSearchRequest(preciseQuery);
      
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
    const endpoint = import.meta.env.DEV ? 'development proxy' : 'production endpoint';
    return {
      configured: true,
      message: `Brave Search API is configured and ready to use via ${endpoint}.`,
    };
  }
}

export const braveSearchService = new BraveSearchService(); 