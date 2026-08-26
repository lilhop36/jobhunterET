export interface DeepSweepConfig {
  /** Whether deep sweep is enabled for this source */
  enabled: boolean;
  /** How often deep sweep runs (in hours). Default: 6 */
  frequencyHours?: number;
  /** Maximum pages to fetch during a deep sweep */
  maxPagesDeep?: number;
  /** Which categories to sweep during deep runs. Empty = all categories. */
  categories?: string[];
}

export interface PaginationConfig {
  /** Max pages during a fast (frequent) run */
  maxPagesFast: number;
  /** Max pages during a deep sweep run */
  maxPagesDeep: number;
  /** Stop paginating when jobs are older than this many days */
  stopOnOlderThanDays: number;
  /** Delay between page requests (ms) for politeness */
  delayBetweenRequestsMs: number;
}

export interface FastCollectionConfig {
  /** Freshness boundary in hours — pagination stops once postings are older than this. */
  freshnessHours: number;
  /** Hard page ceiling for a FAST run. */
  maxPages: number;
  /** Hard request ceiling for a FAST run. */
  maxRequests: number;
  /** Categories to sweep during FAST runs. Empty = no category filtering. */
  categories?: string[];
}

export interface DeepCollectionConfig {
  /** How often DEEP runs (in minutes). */
  everyMinutes: number;
  /** Freshness boundary in days for DEEP pagination. */
  freshnessDays: number;
  /** Hard page ceiling for a DEEP run. */
  maxPages: number;
  /** Hard request ceiling for a DEEP run. */
  maxRequests: number;
  /** Max pages per category during DEEP sweep. */
  maxPagesPerCategory: number;
  /** Categories to sweep during DEEP runs. */
  categories: string[];
}

export interface CollectionConfig {
  /** Source supports per-category collection. */
  supportsCategories: boolean;
  /** Source supports page-based pagination. */
  supportsPagination: boolean;
  /** Delay between requests (ms) for politeness. */
  requestDelayMs: number;
  /** FAST run configuration. */
  fast: FastCollectionConfig;
  /** DEEP run configuration. */
  deep: DeepCollectionConfig;
}

export interface SourceDefinition {
  id: string;
  name: string;
  adapter: string;
  type: string;
  baseUrl: string;
  frequency: number;
  priorityTier: string;
  defaultLocationClass: string;
  defaultTags: string[];
  fetchTimeout?: number;
  /**
   * Source-specific category slugs that JobHunter should actively collect.
   * Empty array = collect everything (no category filtering).
   */
  categories?: string[];
  /**
   * How many days back to consider jobs "fresh" for this source.
   * Used as the freshness boundary for incremental pagination.
   */
  freshnessWindowDays?: number;
  /**
   * Pagination configuration for sources that support page-based crawling.
   * Only used by HTML adapters (e.g. EthioJobs).
   */
  pagination?: PaginationConfig;
  /**
   * Collection configuration — mode-aware fetch, category sweeps, and deep cadence.
   * Absence = today's behaviour.
   */
  collection?: CollectionConfig;
  /**
   * @deprecated Use collection.deep instead.
    */
  deepSweep?: DeepSweepConfig;
}

export interface QueueConfig {
  concurrency: number;
  maxRetries: number;
  retryDelayMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
}

export interface ClassificationConfig {
  tags: Record<string, string>;
}

export interface SourceConfigs {
  sources: SourceDefinition[];
  fallbackChains: Record<string, string[]>;
  queue: QueueConfig;
  classification: ClassificationConfig;
}
