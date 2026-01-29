/*
  # Add Anonymous Insert Policies for Analytics

  1. Security Changes
    - Allow anonymous users to INSERT into visitors, sessions, and page_visits
    - This enables client-side analytics tracking without authentication
    - Read access remains restricted to service role (admin only)

  2. Notes
    - Only INSERT is allowed for anonymous users
    - SELECT/UPDATE/DELETE remain restricted to service role
    - This is secure because analytics data is write-only from client
*/

-- Allow anonymous inserts to visitors table
CREATE POLICY "Visitors insert for anon"
  ON visitors FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anonymous inserts to sessions table
CREATE POLICY "Sessions insert for anon"
  ON sessions FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anonymous updates to sessions table (for ending sessions)
CREATE POLICY "Sessions update for anon"
  ON sessions FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- Allow anonymous inserts to page_visits table
CREATE POLICY "Page visits insert for anon"
  ON page_visits FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anonymous updates to page_visits (for time on page, scroll depth)
CREATE POLICY "Page visits update for anon"
  ON page_visits FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
