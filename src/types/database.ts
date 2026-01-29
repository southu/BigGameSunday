export interface AdminUser {
  id: string;
  email: string;
  password_hash: string;
  role: string;
  created_at: string;
  last_login: string | null;
  failed_login_attempts: number;
  locked_until: string | null;
}

export interface AdminSession {
  id: string;
  admin_id: string;
  token_hash: string;
  expires_at: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface Visitor {
  id: string;
  visitor_id: string;
  first_seen: string;
  last_seen: string;
  visit_count: number;
  created_at: string;
}

export interface Session {
  id: string;
  session_id: string;
  visitor_id: string;
  started_at: string;
  ended_at: string | null;
  page_count: number;
  total_duration_seconds: number;
  landing_page: string | null;
  exit_page: string | null;
  referrer: string | null;
  referrer_domain: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  device_type: string | null;
  browser: string | null;
  os: string | null;
  screen_width: number | null;
  screen_height: number | null;
  is_bounce: boolean;
  created_at: string;
}

export interface PageVisit {
  id: string;
  session_id: string;
  visitor_id: string;
  page_path: string;
  page_title: string | null;
  referrer: string | null;
  referrer_domain: string | null;
  is_landing_page: boolean;
  is_exit_page: boolean;
  country: string | null;
  region: string | null;
  city: string | null;
  device_type: string | null;
  browser: string | null;
  os: string | null;
  screen_width: number | null;
  screen_height: number | null;
  time_on_page_seconds: number;
  scroll_depth_percent: number;
  visited_at: string;
  created_at: string;
}

export interface Page {
  id: string;
  path: string;
  title: string | null;
  description: string | null;
  meta_keywords: string[] | null;
  word_count: number;
  has_hero: boolean;
  has_featured_image: boolean;
  internal_link_count: number;
  external_link_count: number;
  status: string;
  last_modified: string | null;
  created_at: string;
  updated_at: string;
}

export interface InternalLink {
  id: string;
  source_page: string;
  target_page: string;
  link_text: string | null;
  anchor: string | null;
  context: string | null;
  is_valid: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExternalLink {
  id: string;
  source_page: string;
  url: string;
  domain: string | null;
  link_text: string | null;
  last_checked: string | null;
  status_code: number | null;
  response_time_ms: number | null;
  is_valid: boolean;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface LinkValidation {
  id: string;
  link_type: string;
  link_url: string;
  source_page: string | null;
  checked_at: string;
  status_code: number | null;
  response_time_ms: number | null;
  is_valid: boolean;
  error_message: string | null;
  build_id: string | null;
}

export interface BuildLog {
  id: string;
  build_id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  duration_ms: number | null;
  page_count: number;
  internal_link_count: number;
  external_link_count: number;
  broken_link_count: number;
  warning_count: number;
  error_count: number;
  errors: unknown[];
  warnings: unknown[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface TestRun {
  id: string;
  run_id: string;
  suite_name: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  duration_ms: number | null;
  total_tests: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: unknown[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      admin_users: {
        Row: AdminUser;
        Insert: Omit<AdminUser, 'id' | 'created_at'> & { id?: string; created_at?: string };
        Update: Partial<Omit<AdminUser, 'id'>>;
      };
      admin_sessions: {
        Row: AdminSession;
        Insert: Omit<AdminSession, 'id' | 'created_at'> & { id?: string; created_at?: string };
        Update: Partial<Omit<AdminSession, 'id'>>;
      };
      visitors: {
        Row: Visitor;
        Insert: Omit<Visitor, 'id' | 'created_at' | 'first_seen' | 'last_seen' | 'visit_count'> & {
          id?: string;
          created_at?: string;
          first_seen?: string;
          last_seen?: string;
          visit_count?: number;
        };
        Update: Partial<Omit<Visitor, 'id'>>;
      };
      sessions: {
        Row: Session;
        Insert: Omit<Session, 'id' | 'created_at' | 'started_at' | 'page_count' | 'total_duration_seconds' | 'is_bounce'> & {
          id?: string;
          created_at?: string;
          started_at?: string;
          page_count?: number;
          total_duration_seconds?: number;
          is_bounce?: boolean;
        };
        Update: Partial<Omit<Session, 'id'>>;
      };
      page_visits: {
        Row: PageVisit;
        Insert: Omit<PageVisit, 'id' | 'created_at' | 'visited_at' | 'is_landing_page' | 'is_exit_page' | 'time_on_page_seconds' | 'scroll_depth_percent'> & {
          id?: string;
          created_at?: string;
          visited_at?: string;
          is_landing_page?: boolean;
          is_exit_page?: boolean;
          time_on_page_seconds?: number;
          scroll_depth_percent?: number;
        };
        Update: Partial<Omit<PageVisit, 'id'>>;
      };
      pages: {
        Row: Page;
        Insert: Omit<Page, 'id' | 'created_at' | 'updated_at' | 'word_count' | 'has_hero' | 'has_featured_image' | 'internal_link_count' | 'external_link_count' | 'status'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          word_count?: number;
          has_hero?: boolean;
          has_featured_image?: boolean;
          internal_link_count?: number;
          external_link_count?: number;
          status?: string;
        };
        Update: Partial<Omit<Page, 'id'>>;
      };
      internal_links: {
        Row: InternalLink;
        Insert: Omit<InternalLink, 'id' | 'created_at' | 'updated_at' | 'is_valid'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          is_valid?: boolean;
        };
        Update: Partial<Omit<InternalLink, 'id'>>;
      };
      external_links: {
        Row: ExternalLink;
        Insert: Omit<ExternalLink, 'id' | 'created_at' | 'updated_at' | 'is_valid'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          is_valid?: boolean;
        };
        Update: Partial<Omit<ExternalLink, 'id'>>;
      };
      link_validations: {
        Row: LinkValidation;
        Insert: Omit<LinkValidation, 'id' | 'checked_at' | 'is_valid'> & {
          id?: string;
          checked_at?: string;
          is_valid?: boolean;
        };
        Update: Partial<Omit<LinkValidation, 'id'>>;
      };
      build_logs: {
        Row: BuildLog;
        Insert: Omit<BuildLog, 'id' | 'build_id' | 'created_at' | 'started_at' | 'status' | 'page_count' | 'internal_link_count' | 'external_link_count' | 'broken_link_count' | 'warning_count' | 'error_count' | 'errors' | 'warnings' | 'metadata'> & {
          id?: string;
          build_id?: string;
          created_at?: string;
          started_at?: string;
          status?: string;
          page_count?: number;
          internal_link_count?: number;
          external_link_count?: number;
          broken_link_count?: number;
          warning_count?: number;
          error_count?: number;
          errors?: unknown[];
          warnings?: unknown[];
          metadata?: Record<string, unknown>;
        };
        Update: Partial<Omit<BuildLog, 'id'>>;
      };
      test_runs: {
        Row: TestRun;
        Insert: Omit<TestRun, 'id' | 'run_id' | 'created_at' | 'started_at' | 'status' | 'total_tests' | 'passed' | 'failed' | 'skipped' | 'failures' | 'metadata'> & {
          id?: string;
          run_id?: string;
          created_at?: string;
          started_at?: string;
          status?: string;
          total_tests?: number;
          passed?: number;
          failed?: number;
          skipped?: number;
          failures?: unknown[];
          metadata?: Record<string, unknown>;
        };
        Update: Partial<Omit<TestRun, 'id'>>;
      };
    };
  };
}
