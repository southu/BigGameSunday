-- Tiebreak 4: when the card completed its first line (earliest completed line).
ALTER TABLE public.weekly_scores
  ADD COLUMN IF NOT EXISTS first_line_at timestamptz;
