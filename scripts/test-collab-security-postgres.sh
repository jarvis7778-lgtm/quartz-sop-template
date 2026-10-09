#!/usr/bin/env bash
# Disposable PostgreSQL regression suite for collaboration membership and bookings.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="postgres:17-alpine"
name="quartz-collab-rls-${RANDOM}-${RANDOM}"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

run_sql() {
  docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres postgres
}

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the disposable PostgreSQL regression suite." >&2
  exit 1
fi

docker run --name "$name" -e POSTGRES_PASSWORD=postgres -d "$image" >/dev/null
for _ in $(seq 1 30); do
  docker exec "$name" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$name" pg_isready -U postgres >/dev/null

# This models Supabase auth.uid() from the request JWT subject. Every RLS
# assertion below uses an actual PostgreSQL role and a distinct identity.
run_sql <<'SQL'
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb
);
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
SQL

for migration in \
  "$root/supabase/migrations/001_initial_schema.sql" \
  "$root/supabase/migrations/002_user_sync_and_rls_patch.sql" \
  "$root/supabase/migrations/003_annotations_schema_update.sql" \
  "$root/supabase/migrations/004_security_and_content_constraints.sql"; do
  printf 'Applying %s\n' "$(basename "$migration")"
  run_sql < "$migration" >/dev/null
done

# RED baseline: the pre-upgrade schema permits overlapping named equipment.
run_sql <<'SQL'
INSERT INTO public.users (id, github_id, username, email, role) VALUES
  ('00000000-0000-0000-0000-000000000101', 'legacy-one', 'legacy-one', 'legacy-one@example.test', 'member'),
  ('00000000-0000-0000-0000-000000000102', 'legacy-two', 'legacy-two', 'legacy-two@example.test', 'member');
INSERT INTO public.reservations (id, title, equipment, user_id, start_time, end_time) VALUES
  ('10000000-0000-0000-0000-000000000101', 'legacy overlap one', ' Legacy Analyzer ', '00000000-0000-0000-0000-000000000101', '2030-01-01 10:00+00', '2030-01-01 11:00+00'),
  ('10000000-0000-0000-0000-000000000102', 'legacy overlap two', 'legacy analyzer', '00000000-0000-0000-0000-000000000102', '2030-01-01 10:30+00', '2030-01-01 11:30+00');
DO $$
BEGIN
  IF (SELECT count(*) FROM public.reservations WHERE lower(btrim(equipment)) = 'legacy analyzer') <> 2 THEN
    RAISE EXCEPTION 'RED baseline did not create the original-schema overlap';
  END IF;
END;
$$;
SQL
printf 'RED confirmed: original schema permits a normalized named-equipment overlap.\n'

migration="$root/supabase/migrations/005_collab_membership_and_named_equipment.sql"
if [[ ! -f "$migration" ]]; then
  echo "RED confirmed: required upgrade migration is absent: $migration" >&2
  exit 1
fi

# Existing overlaps must block the migration without deleting legacy data.
set +e
run_sql < "$migration" >/dev/null 2>&1
migration_status=$?
set -e
if [[ $migration_status -eq 0 ]]; then
  echo "Expected the named-equipment preflight to reject existing overlaps." >&2
  exit 1
fi
run_sql <<'SQL'
DO $$
BEGIN
  IF (SELECT count(*) FROM public.reservations WHERE id IN (
    '10000000-0000-0000-0000-000000000101',
    '10000000-0000-0000-0000-000000000102'
  )) <> 2 THEN
    RAISE EXCEPTION 'failed preflight deleted legacy reservations';
  END IF;
END;
$$;
-- Resolve the data conflict explicitly; the migration must never do this itself.
UPDATE public.reservations
SET start_time = '2030-01-01 11:00+00', end_time = '2030-01-01 12:00+00'
WHERE id = '10000000-0000-0000-0000-000000000102';
SQL

printf 'Applying %s after explicit overlap repair\n' "$(basename "$migration")"
run_sql < "$migration" >/dev/null

# Deliberately broad test grants ensure the following denials are RLS decisions,
# not accidental omission of a grant. The migration's production grants remain
# checked by verify-postgres-migrations.sh.
run_sql <<'SQL'
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.annotations, public.comments, public.comment_likes, public.reservations TO authenticated;
GRANT SELECT ON public.comments_with_author, public.reservations_with_user, public.reservation_named_equipment_overlap_preflight TO authenticated;
GRANT SELECT, UPDATE ON public.collaboration_memberships TO authenticated;
GRANT UPDATE (role) ON public.users TO authenticated;

CREATE OR REPLACE FUNCTION public.test_assert(condition boolean, message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT condition THEN
    RAISE EXCEPTION '%', message;
  END IF;
END;
$$;

SELECT public.test_assert(
  (SELECT count(*) FROM public.collaboration_memberships cm
   WHERE cm.user_id IN ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000102')
     AND cm.status = 'pending') = 2,
  'legacy non-admin users must be pending after the additive migration'
);
SELECT public.test_assert(
  (SELECT equipment_key FROM public.reservations WHERE id = '10000000-0000-0000-0000-000000000101') = 'legacy analyzer',
  'equipment normalization was not persisted'
);

INSERT INTO public.users (id, github_id, username, email, role) VALUES
  ('00000000-0000-0000-0000-000000000a01', 'admin', 'admin', 'admin@example.test', 'admin'),
  ('00000000-0000-0000-0000-000000000b01', 'pending', 'pending', 'pending@example.test', 'member'),
  ('00000000-0000-0000-0000-000000000c01', 'member-one', 'member-one', 'member-one@example.test', 'member'),
  ('00000000-0000-0000-0000-000000000d01', 'member-two', 'member-two', 'member-two@example.test', 'member'),
  ('00000000-0000-0000-0000-000000000e01', 'revoked', 'revoked', 'revoked@example.test', 'member');
INSERT INTO public.collaboration_memberships (user_id, status) VALUES
  ('00000000-0000-0000-0000-000000000a01', 'approved'),
  ('00000000-0000-0000-0000-000000000b01', 'pending'),
  ('00000000-0000-0000-0000-000000000c01', 'approved'),
  ('00000000-0000-0000-0000-000000000d01', 'approved'),
  ('00000000-0000-0000-0000-000000000e01', 'revoked');
SQL

# Anonymous cannot read collaboration tables or views.
run_sql <<'SQL'
SET ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.comments_with_author;
    RAISE EXCEPTION 'anon unexpectedly read comments_with_author';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.reservations_with_user;
    RAISE EXCEPTION 'anon unexpectedly read reservations_with_user';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;
SQL

# Pending users see only their own status through the safe RPC, and have no
# direct membership or collaboration access.
run_sql <<'SQL'
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000b01', false);
SELECT public.test_assert(public.current_collaboration_membership_status() = 'pending', 'pending user cannot read own status through RPC');
SELECT public.test_assert((SELECT count(*) FROM public.collaboration_memberships) = 0, 'pending user read membership table');
SELECT public.test_assert((SELECT count(*) FROM public.annotations) = 0, 'pending user read annotations');
SELECT public.test_assert((SELECT count(*) FROM public.comments_with_author) = 0, 'pending user read comments view');
SELECT public.test_assert((SELECT count(*) FROM public.reservations_with_user) = 0, 'pending user read reservations view');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.annotations (page_slug, anchor, note, user_id)
    VALUES ('pending', '{}'::jsonb, 'must fail', '00000000-0000-0000-0000-000000000b01');
    RAISE EXCEPTION 'pending user inserted annotation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
UPDATE public.collaboration_memberships SET status = 'approved'
WHERE user_id = '00000000-0000-0000-0000-000000000b01';
SELECT public.test_assert(public.current_collaboration_membership_status() = 'pending', 'pending user self-approved');
RESET ROLE;
SQL

# Approved users can collaborate as themselves, not impersonate or escalate.
run_sql <<'SQL'
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000c01', false);
INSERT INTO public.comments (id, page_path, content, author_id)
VALUES ('20000000-0000-0000-0000-000000000c01', '/approved', 'member one', '00000000-0000-0000-0000-000000000c01');
UPDATE public.comments SET content = 'member one edited'
WHERE id = '20000000-0000-0000-0000-000000000c01';
DO $$
BEGIN
  BEGIN
    INSERT INTO public.comments (page_path, content, author_id)
    VALUES ('/spoof', 'must fail', '00000000-0000-0000-0000-000000000d01');
    RAISE EXCEPTION 'approved user inserted another user comment';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
DO $$
BEGIN
  BEGIN
    UPDATE public.users SET role = 'admin' WHERE id = '00000000-0000-0000-0000-000000000c01';
    RAISE EXCEPTION 'approved user self-promoted';
  EXCEPTION WHEN insufficient_privilege OR with_check_option_violation THEN NULL;
  END;
END;
$$;
RESET ROLE;
SELECT public.test_assert(
  (SELECT role FROM public.users WHERE id = '00000000-0000-0000-0000-000000000c01') = 'member',
  'approved user self-promoted'
);
SQL

# An approved admin manages other memberships but cannot alter their own status.
run_sql <<'SQL'
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000a01', false);
SELECT public.test_assert((SELECT count(*) FROM public.comments_with_author) = 1, 'admin cannot read collaboration view');
UPDATE public.collaboration_memberships SET status = 'approved'
WHERE user_id = '00000000-0000-0000-0000-000000000b01';
SELECT public.test_assert(
  (SELECT status FROM public.collaboration_memberships WHERE user_id = '00000000-0000-0000-0000-000000000b01') = 'approved',
  'admin could not approve pending user'
);
UPDATE public.collaboration_memberships SET status = 'pending'
WHERE user_id = '00000000-0000-0000-0000-000000000a01';
SELECT public.test_assert(
  (SELECT status FROM public.collaboration_memberships WHERE user_id = '00000000-0000-0000-0000-000000000a01') = 'approved',
  'admin changed own membership'
);
UPDATE public.collaboration_memberships SET status = 'revoked'
WHERE user_id = '00000000-0000-0000-0000-000000000c01';
RESET ROLE;
SQL

# Revocation immediately removes read and write access.
run_sql <<'SQL'
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000c01', false);
SELECT public.test_assert(public.current_collaboration_membership_status() = 'revoked', 'revoked user cannot read own status through RPC');
SELECT public.test_assert((SELECT count(*) FROM public.comments) = 0, 'revocation did not remove read access');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.comments (page_path, content, author_id)
    VALUES ('/revoked-now', 'must fail', '00000000-0000-0000-0000-000000000c01');
    RAISE EXCEPTION 'revocation did not remove write access';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;
SQL

# Named resources are exclusive in [start,end); case/trim are normalized.
run_sql <<'SQL'
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000d01', false);
INSERT INTO public.reservations (id, title, equipment, user_id, start_time, end_time)
VALUES ('30000000-0000-0000-0000-000000000d01', 'first microscope', 'Microscope', '00000000-0000-0000-0000-000000000d01', '2030-03-01 10:00+00', '2030-03-01 11:00+00');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.reservations (title, equipment, user_id, start_time, end_time)
    VALUES ('conflict', ' microscope ', '00000000-0000-0000-0000-000000000d01', '2030-03-01 10:30+00', '2030-03-01 11:30+00');
    RAISE EXCEPTION 'overlapping named equipment booking succeeded';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;
END;
$$;
INSERT INTO public.reservations (title, equipment, user_id, start_time, end_time) VALUES
  ('adjacent', 'MICROSCOPE', '00000000-0000-0000-0000-000000000d01', '2030-03-01 11:00+00', '2030-03-01 12:00+00'),
  ('different resource', 'Centrifuge', '00000000-0000-0000-0000-000000000d01', '2030-03-01 10:30+00', '2030-03-01 11:30+00'),
  ('unnamed null', NULL, '00000000-0000-0000-0000-000000000d01', '2030-03-01 10:30+00', '2030-03-01 11:30+00'),
  ('unnamed blank', '   ', '00000000-0000-0000-0000-000000000d01', '2030-03-01 10:30+00', '2030-03-01 11:30+00');
RESET ROLE;
SQL

# Two simultaneous sessions attempt the same named slot. Exactly one may commit.
set +e
(
  run_sql <<'SQL'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000d01', true);
INSERT INTO public.reservations (id, title, equipment, user_id, start_time, end_time)
VALUES ('40000000-0000-0000-0000-000000000d01', 'concurrent one', 'Laser', '00000000-0000-0000-0000-000000000d01', '2030-04-01 10:00+00', '2030-04-01 11:00+00');
SELECT pg_sleep(1);
COMMIT;
SQL
) >/dev/null 2>&1 &
first_pid=$!
sleep 0.2
(
  run_sql <<'SQL'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000d01', true);
INSERT INTO public.reservations (id, title, equipment, user_id, start_time, end_time)
VALUES ('40000000-0000-0000-0000-000000000d02', 'concurrent two', ' laser ', '00000000-0000-0000-0000-000000000d01', '2030-04-01 10:30+00', '2030-04-01 11:30+00');
COMMIT;
SQL
) >/dev/null 2>&1 &
second_pid=$!
wait "$first_pid"
first_status=$?
wait "$second_pid"
second_status=$?
set -e
if [[ $first_status -eq 0 && $second_status -eq 0 ]]; then
  echo "Concurrent named-equipment inserts both committed." >&2
  exit 1
fi
if [[ $first_status -ne 0 && $second_status -ne 0 ]]; then
  echo "Concurrent named-equipment inserts both failed." >&2
  exit 1
fi
run_sql <<'SQL'
SELECT public.test_assert(
  (SELECT count(*) FROM public.reservations
   WHERE equipment_key = 'laser'
     AND start_time < '2030-04-01 11:00+00'
     AND end_time > '2030-04-01 10:00+00') = 1,
  'concurrent named-equipment conflict did not leave exactly one booking'
);
SQL

echo "Collaboration membership and booking PostgreSQL regression suite passed."
