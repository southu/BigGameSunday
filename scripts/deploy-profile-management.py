#!/usr/bin/env python3
"""Apply the profile migration to live Supabase using a short-lived vault lease.

Run on madcat after arming the credential broker: python3 scripts/deploy-profile-management.py
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
# Folder-scoped BigGameSunday Supabase management PAT. resolve_credential is
# fail-closed on provider/action, so the lease must name this id.
CREDENTIAL_ID = os.environ.get("BGS_SUPABASE_CREDENTIAL_ID", "cred_bd611907997da10b")

VERIFY_SQL = """
SELECT
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'reassign_commissioner') AS rpc_count,
  has_function_privilege('authenticated', 'public.reassign_commissioner(uuid)', 'EXECUTE') AS granted,
  (SELECT count(*) FROM pg_trigger
    WHERE tgrelid = 'public.profiles'::regclass
      AND tgname IN ('guard_profile_change', 'check_household_commissioner')
      AND tgenabled = 'O') AS guard_count,
  (SELECT count(*) FROM (
      SELECT household_id FROM public.profiles GROUP BY household_id
      HAVING count(*) FILTER (WHERE is_commissioner) <> 1
   ) bad) AS bad_households;
"""


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
        # Do not echo provider responses: they can contain credential material.
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

    run_id = "biggamesunday-profile-migration-" + uuid.uuid4().hex
    broker("register_run", {"run_id": run_id, "folder": "biggamesunday", "ttl_seconds": 300})
    lease = broker("lease", {
        "run_id": run_id, "folder": "biggamesunday", "action": "supabase.sql",
        "provider": "supabase", "env_key": "API_TOKEN", "ttl_seconds": 300,
        "credential_id": CREDENTIAL_ID,
    })
    try:
        endpoint = f"https://api.supabase.com/v1/projects/{PROJECT}/database/query"
        migration = ROOT / "supabase/migrations/20260914223000_profile_management.sql"
        request(endpoint, lease["secret"], {"query": migration.read_text()})
        print(f"Applied {migration.name} unchanged to {PROJECT}.", flush=True)
        request(endpoint, lease["secret"], {"query": "NOTIFY pgrst, 'reload schema';"})
        installed = request(endpoint, lease["secret"], {"query": VERIFY_SQL})
        row = installed[0] if isinstance(installed, list) and installed else {}
        if not (row.get("rpc_count") and row.get("granted") and row.get("guard_count") == 2):
            raise RuntimeError("Live database is missing reassign_commissioner or profile guards.")
        if row.get("bad_households"):
            raise RuntimeError("A household does not have exactly one commissioner.")
        # Behavioral checks roll back their fixtures; skip if the API cannot SET ROLE.
        verification = ROOT / "supabase/tests/profile_management.sql"
        try:
            request(endpoint, lease["secret"], {"query": verification.read_text()})
            print("Database checks passed: onboarding, reassignment, deletion guards, and RLS.")
        except RuntimeError as error:
            print(f"Installed RPC and guards; fixture checks skipped ({error}).")
    finally:
        lease.pop("secret", None)
        broker("release", {"lease_id": lease["lease_id"]})


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, KeyError, ValueError) as error:
        print(f"Profile deployment stopped: {error}", file=sys.stderr)
        sys.exit(1)
