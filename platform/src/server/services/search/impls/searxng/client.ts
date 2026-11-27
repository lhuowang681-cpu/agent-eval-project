import qs from 'query-string';
import urlJoin from 'url-join';

export interface SearXNGSearchResult {
  category: string;
  content?: string;
  engine: string;
  engines: string[];
  iframe_src?: string;
  img_src?: string;
  parsed_url: string[];
  positions: number[];
  publishedDate?: string | null;
  score: number;
  template: string;
  thumbnail?: string | null;
  thumbnail_src?: string | null;
  title: string;
  url: string;
}

export interface SearXNGSearchResponse {
  answers: any[];
  corrections: any[];
  infoboxes: any[];
  number_of_results: number;
  query: string;
  results: SearXNGSearchResult[];
  suggestions: any[];
  unresponsive_engines: any[];
}

/**
 * Options for SearXNG engine-level parameters.
 * Used to pass engine-specific data.
 */
export interface SearXNGEngineOptions {
  /**
   * Engine-specific parameters.
   * Key is engine name, value is a record of param key-value pairs.
   * Will be serialized to 'engine_data-{engine}-{param}' query params.
   */
  engineData?: Record<string, Record<string, string>>;
  /** Specify which engines to use */
  engines?: string[];
  /** SearXNG instance-level token (required if SearXNG is configured with tokens) */
  tokens?: string;
}

export class SearXNGClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async search(
    query: string,
    optionalParams: Record<string, any> = {},
    engineOptions?: SearXNGEngineOptions,
  ): Promise<SearXNGSearchResponse> {
    try {
      const { time_range, ...otherParams } = optionalParams;

      const processedParams = Object.entries(otherParams).reduce<Record<string, any>>(
        (acc, [key, value]) => {
          acc[key] = Array.isArray(value) ? value.join(',') : value;
          return acc;
        },
        {},
      );

      // Handle engineData: convert to 'engine_data-{engine}-{param}' query params
      if (engineOptions?.engineData) {
        for (const [engine, params] of Object.entries(engineOptions.engineData)) {
          for (const [key, value] of Object.entries(params)) {
            processedParams[`engine_data-${engine}-${key}`] = value;
          }
        }
      }

      const searchParams = qs.stringify({
        ...processedParams,
        ...(time_range !== 'anytime' && { time_range }),
        // Inject engines from engineOptions
        ...(engineOptions?.engines?.length && { engines: engineOptions.engines.join(',') }),
        // Inject SearXNG instance-level tokens
        ...(engineOptions?.tokens && { tokens: engineOptions.tokens }),
        format: 'json',
        q: query,
      });

      const response = await fetch(urlJoin(this.baseUrl, `/search?${searchParams}`));

      if (response.ok) {
        return await response.json();
      }

      const body = await response.text().catch(() => '');

      // SearXNG returns 500 for empty results, treat as normal empty response
      if (body.toLowerCase().includes('empty results')) {
        return {
          answers: [],
          corrections: [],
          infoboxes: [],
          number_of_results: 0,
          query,
          results: [],
          suggestions: [],
          unresponsive_engines: [],
        };
      }

      throw new Error(
        `Failed to search: ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`,
      );
    } catch (error) {
      console.error('Error searching:', error);
      throw error;
    }
  }
}
