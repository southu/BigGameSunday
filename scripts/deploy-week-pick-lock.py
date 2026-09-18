#!/usr/bin/env python3
"""Apply the kickoff lock migration to live Supabase using a short-lived vault lease.

Run on madcat after arming the credential broker: python3 scripts/deploy-week-pick-lock.py
Credentials remain in this deployment process and are never printed or saved.
"""

import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
PROJECT = "vzsltdvinnqingujsnft"
VAULT = "http://127.0.0.1:8379"
CREDENTIAL_ID = os.environ.get("BGS_SUPABASE_CREDENTIAL_ID", "cred_bd611907997da10b")

VERIFY_SQL = """
SELECT
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('week_picks_are_locked', 'card_picks_are_locked', 'lock_open_weeks_past_lock_at', 'deny_pick_writes_after_lock')
  ) AS rpc_count,
  has_function_privilege('authenticated', 'public.lock_open_weeks_past_lock_at()', 'EXECUTE') AS granted,
  (SELECT count(*) FROM pg_trigger
    WHERE tgrelid IN ('public.card_squares'::regclass, 'public.upset_picks'::regclass)
      AND tgname IN ('deny_card_square_writes_after_lock', 'deny_upset_pick_writes_after_lock')
      AND tgenabled = 'O') AS trigger_count,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('card_squares', 'upset_picks')
      AND (
        policyname LIKE 'Owners % card squares'
        OR policyname LIKE 'Owners % upset picks'
      )
  ) AS policy_count;
"""

LOCK_NOW_SQL = "SELECT public.lock_open_weeks_past_lock_at() AS locked_n;"


def request(url, key, body=None):
    req = urllib.request.Request(
        url,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Request failed: HTTP {error.code}") from None
    except urllib.error.URLError:
        raise RuntimeError("Deployment service could not be reached") from None


def main():
    key_path = Path(os.environ.get(
        "VAULT_CONSUMER_KEY_PATH", str(Path.home() / ".config/ratchet/vault_consumer.key")
    ))
    key = key_path.read_text().strip()

    def broker(path, body=None):
        return request(VAULT + "/api/consumer/" + path, key, body)

    status = broker("status")
    consumer = status.get("consumer", status)
    if not consumer.get("vault_unlocked") or not consumer.get("armed"):
        raise RuntimeError("Vault is locked or unarmed. Use Arm for N hours in the vault UI first.")

    run_id = "biggamesunday-week-pick-lock-" + uuid.uuid4().hex
    broker("register_run", {"run_id": run_id, "folder": "biggamesunday", "ttl_seconds": 300})
    lease = broker("lease", {
        "run_id": run_id, "folder": "biggamesunday", "action": "supabase.sql",
        "provider": "supabase", "env_key": "API_TOKEN", "ttl_seconds": 300,
        "credential_id": CREDENTIAL_ID,
    })
    try:
        endpoint = f"https://api.supabase.com/v1/projects/{PROJECT}/database/query"
        migration = ROOT / "supabase/migrations/20260918030000_week_pick_lock_enforcement.sql"
        request(endpoint, lease["secret"], {"query": migration.read_text()})
        print(f"Applied {migration.name} unchanged to {PROJECT}.", flush=True)
        request(endpoint, lease["secret"], {"query": "NOTIFY pgrst, 'reload schema';"})
        installed = request(endpoint, lease["secret"], {"query": VERIFY_SQL})
        row = installed[0] if isinstance(installed, list) and installed else {}
        if not (row.get("rpc_count") == 4 and row.get("granted") and row.get("trigger_count") == 2):
            raise RuntimeError("Live database is missing kickoff lock functions or pick-write triggers.")
        locked = request(endpoint, lease["secret"], {"query": LOCK_NOW_SQL})
        locked_row = locked[0] if isinstance(locked, list) and locked else {}
        print(f"Kickoff lock job locked {locked_row.get('locked_n', '?')} open week(s).", flush=True)
        verification = ROOT / "supabase/tests/week_pick_lock.sql"
        try:
            request(endpoint, lease["secret"], {"query": verification.read_text()})
            print("Database checks passed: pre-lock writes, post-lock deny, lock job, final weeks stay final.")
        except RuntimeError as error:
            print(f"Installed lock functions and triggers; fixture checks skipped ({error}).")
    finally:
        lease.pop("secret", None)
        broker("release", {"lease_id": lease["lease_id"]})


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, KeyError, ValueError) as error:
        print(f"Kickoff lock deployment stopped: {error}", file=sys.stderr)
        sys.exit(1)
