export interface Target {
  xUserId: string;
  username: string;
  priority: number;
  category: string;
  enabled: boolean;
  notes?: string;
  lastCheckedAt?: string;
}

export interface Topic {
  topicId: string;
  label: string;
  /** Raw X search query, already narrowed with operators like -is:retweet. */
  query: string;
  priority: number;
  enabled: boolean;
}
