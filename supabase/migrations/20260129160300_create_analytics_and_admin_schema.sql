/*
  # Analytics, Admin, and Site Health Schema

  1. New Tables
    - `admin_users` - Admin authentication (id, email, password_hash, role, created_at, last_login)
    - `visitors` - Unique visitor tracking (visitor_id fingerprint, first_seen, last_seen, visit_count)
    - `sessions` - User sessions (session_id, visitor_id, timestamps, metrics, geo, device info)
    - `page_visits` - Individual page view events with full analytics data
    - `pages` - Site page registry (path, title, meta, word_count, status)
    - `internal_links` - Links between site pages
    - `external_links` - Outbound links with validation status
    - `link_validations` - History of link check results
    - `build_logs` - Build process logs and metrics
    - `test_runs` - Test execution results

  2. Security
    - RLS enabled on all tables
    - Admin-only access policies (no public access)
    - Service role bypass for server-side operations

  3. Indexes
    - Optimized for common query patterns (country, timestamp, landing_page, session)
*/

-- Admin users table for dashboard authentication
CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'admin',
  created_at timestamptz DEFAULT now(),
  last_login timestamptz,
  failed_login_attempts integer DEFAULT 0,
  locked_until timestamptz
);

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin users readable by authenticated admins"
  ON admin_users FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Visitors table for unique visitor tracking (fingerprint-based)
CREATE TABLE IF NOT EXISTS visitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id text UNIQUE NOT NULL,
  first_seen timestamptz DEFAULT now(),
  last_seen timestamptz DEFAULT now(),
  visit_count integer DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE visitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Visitors insert for service role"
  ON visitors FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Visitors select for service role"
  ON visitors FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Visitors update for service role"
  ON visitors FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Sessions table for tracking user sessions
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text UNIQUE NOT NULL,
  visitor_id text NOT NULL,
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  page_count integer DEFAULT 0,
  total_duration_seconds integer DEFAULT 0,
  landing_page text,
  exit_page text,
  referrer text,
  referrer_domain text,
  country text,
  region text,
  city text,
  device_type text,
  browser text,
  os text,
  screen_width integer,
  screen_height integer,
  is_bounce boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sessions insert for service role"
  ON sessions FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Sessions select for service role"
  ON sessions FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Sessions update for service role"
  ON sessions FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_sessions_visitor_id ON sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_country ON sessions(country);
CREATE INDEX IF NOT EXISTS idx_sessions_landing_page ON sessions(landing_page);
CREATE INDEX IF NOT EXISTS idx_sessions_device_type ON sessions(device_type);

-- Page visits table for detailed analytics
CREATE TABLE IF NOT EXISTS page_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  visitor_id text NOT NULL,
  page_path text NOT NULL,
  page_title text,
  referrer text,
  referrer_domain text,
  is_landing_page boolean DEFAULT false,
  is_exit_page boolean DEFAULT false,
  country text,
  region text,
  city text,
  device_type text,
  browser text,
  os text,
  screen_width integer,
  screen_height integer,
  time_on_page_seconds integer DEFAULT 0,
  scroll_depth_percent integer DEFAULT 0,
  visited_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE page_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Page visits insert for service role"
  ON page_visits FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Page visits select for service role"
  ON page_visits FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Page visits update for service role"
  ON page_visits FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_page_visits_session_id ON page_visits(session_id);
CREATE INDEX IF NOT EXISTS idx_page_visits_visitor_id ON page_visits(visitor_id);
CREATE INDEX IF NOT EXISTS idx_page_visits_page_path ON page_visits(page_path);
CREATE INDEX IF NOT EXISTS idx_page_visits_visited_at ON page_visits(visited_at);
CREATE INDEX IF NOT EXISTS idx_page_visits_country ON page_visits(country);
CREATE INDEX IF NOT EXISTS idx_page_visits_is_landing ON page_visits(is_landing_page);

-- Pages registry table
CREATE TABLE IF NOT EXISTS pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path text UNIQUE NOT NULL,
  title text,
  description text,
  meta_keywords text[],
  word_count integer DEFAULT 0,
  has_hero boolean DEFAULT false,
  has_featured_image boolean DEFAULT false,
  internal_link_count integer DEFAULT 0,
  external_link_count integer DEFAULT 0,
  status text DEFAULT 'active',
  last_modified timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Pages insert for service role"
  ON pages FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Pages select for service role"
  ON pages FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Pages update for service role"
  ON pages FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Pages delete for service role"
  ON pages FOR DELETE
  TO service_role
  USING (true);

-- Internal links table
CREATE TABLE IF NOT EXISTS internal_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_page text NOT NULL,
  target_page text NOT NULL,
  link_text text,
  anchor text,
  context text,
  is_valid boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(source_page, target_page, anchor)
);

ALTER TABLE internal_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal links insert for service role"
  ON internal_links FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Internal links select for service role"
  ON internal_links FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Internal links update for service role"
  ON internal_links FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Internal links delete for service role"
  ON internal_links FOR DELETE
  TO service_role
  USING (true);

CREATE INDEX IF NOT EXISTS idx_internal_links_source ON internal_links(source_page);
CREATE INDEX IF NOT EXISTS idx_internal_links_target ON internal_links(target_page);

-- External links table
CREATE TABLE IF NOT EXISTS external_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_page text NOT NULL,
  url text NOT NULL,
  domain text,
  link_text text,
  last_checked timestamptz,
  status_code integer,
  response_time_ms integer,
  is_valid boolean DEFAULT true,
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(source_page, url)
);

ALTER TABLE external_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "External links insert for service role"
  ON external_links FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "External links select for service role"
  ON external_links FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "External links update for service role"
  ON external_links FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "External links delete for service role"
  ON external_links FOR DELETE
  TO service_role
  USING (true);

CREATE INDEX IF NOT EXISTS idx_external_links_source ON external_links(source_page);
CREATE INDEX IF NOT EXISTS idx_external_links_domain ON external_links(domain);
CREATE INDEX IF NOT EXISTS idx_external_links_is_valid ON external_links(is_valid);

-- Link validations history
CREATE TABLE IF NOT EXISTS link_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_type text NOT NULL,
  link_url text NOT NULL,
  source_page text,
  checked_at timestamptz DEFAULT now(),
  status_code integer,
  response_time_ms integer,
  is_valid boolean DEFAULT false,
  error_message text,
  build_id uuid
);

ALTER TABLE link_validations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Link validations insert for service role"
  ON link_validations FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Link validations select for service role"
  ON link_validations FOR SELECT
  TO service_role
  USING (true);

CREATE INDEX IF NOT EXISTS idx_link_validations_checked_at ON link_validations(checked_at);
CREATE INDEX IF NOT EXISTS idx_link_validations_is_valid ON link_validations(is_valid);
CREATE INDEX IF NOT EXISTS idx_link_validations_build_id ON link_validations(build_id);

-- Build logs table
CREATE TABLE IF NOT EXISTS build_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id uuid UNIQUE DEFAULT gen_random_uuid(),
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  status text DEFAULT 'running',
  duration_ms integer,
  page_count integer DEFAULT 0,
  internal_link_count integer DEFAULT 0,
  external_link_count integer DEFAULT 0,
  broken_link_count integer DEFAULT 0,
  warning_count integer DEFAULT 0,
  error_count integer DEFAULT 0,
  errors jsonb DEFAULT '[]'::jsonb,
  warnings jsonb DEFAULT '[]'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE build_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Build logs insert for service role"
  ON build_logs FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Build logs select for service role"
  ON build_logs FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Build logs update for service role"
  ON build_logs FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_build_logs_started_at ON build_logs(started_at);
CREATE INDEX IF NOT EXISTS idx_build_logs_status ON build_logs(status);

-- Test runs table
CREATE TABLE IF NOT EXISTS test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid UNIQUE DEFAULT gen_random_uuid(),
  suite_name text NOT NULL,
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  status text DEFAULT 'running',
  duration_ms integer,
  total_tests integer DEFAULT 0,
  passed integer DEFAULT 0,
  failed integer DEFAULT 0,
  skipped integer DEFAULT 0,
  failures jsonb DEFAULT '[]'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE test_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Test runs insert for service role"
  ON test_runs FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Test runs select for service role"
  ON test_runs FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Test runs update for service role"
  ON test_runs FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_test_runs_started_at ON test_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_test_runs_suite_name ON test_runs(suite_name);
CREATE INDEX IF NOT EXISTS idx_test_runs_status ON test_runs(status);

-- Admin sessions table for dashboard authentication
CREATE TABLE IF NOT EXISTS admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE admin_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin sessions insert for service role"
  ON admin_sessions FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Admin sessions select for service role"
  ON admin_sessions FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Admin sessions delete for service role"
  ON admin_sessions FOR DELETE
  TO service_role
  USING (true);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);
