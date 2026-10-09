#!/usr/bin/env bash
# Fresh-schema structural checks for every local PostgreSQL migration.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
name="quartz-pg-migrations-${RANDOM}-${RANDOM}"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for PostgreSQL migration verification." >&2
  exit 1
fi

docker run --name "$name" -e POSTGRES_PASSWORD=postgres -d postgres:17-alpine >/dev/null
for _ in $(seq 1 30); do
  docker exec "$name" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$name" pg_isready -U postgres >/dev/null

docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres postgres <<'SQL'
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb
);
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
SQL

for migration in "$root"/supabase/migrations/*.sql; do
  printf 'Applying %s\n' "$(basename "$migration")"
  docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres postgres < "$migration" >/dev/null
done

docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres postgres <<'SQL'
DO $$
DECLARE
  view_name text;
BEGIN
  FOREACH view_name IN ARRAY ARRAY[
    'comments_with_author',
    'reservations_with_user',
    'reservation_named_equipment_overlap_preflight'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = view_name
        AND c.relkind = 'v'
        AND 'security_invoker=true' = ANY(c.reloptions)
    ) THEN
      RAISE EXCEPTION 'collaboration view % must use security_invoker', view_name;
    END IF;
  END LOOP;

  IF has_table_privilege('anon', 'public.comments_with_author', 'SELECT')
     OR has_table_privilege('anon', 'public.reservations_with_user', 'SELECT')
     OR has_table_privilege('anon', 'public.reservation_named_equipment_overlap_preflight', 'SELECT') THEN
    RAISE EXCEPTION 'anon must not read collaboration views';
  END IF;

  IF has_column_privilege('authenticated', 'public.users', 'email', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.users', 'username', 'SELECT') THEN
    RAISE EXCEPTION 'users column grants are incorrect';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reservations'::regclass
      AND conname = 'reservations_named_equipment_no_overlap'
      AND contype = 'x'
  ) THEN
    RAISE EXCEPTION 'named-equipment exclusion constraint is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'reservations'
      AND column_name = 'equipment_key'
      AND is_generated = 'ALWAYS'
  ) THEN
    RAISE EXCEPTION 'normalized equipment_key generated column is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'collaboration_memberships'
      AND c.relkind = 'r'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'collaboration_memberships must exist with RLS enabled';
  END IF;

  IF has_table_privilege('anon', 'public.collaboration_memberships', 'SELECT')
     OR has_table_privilege('authenticated', 'public.collaboration_memberships', 'INSERT')
     OR has_table_privilege('authenticated', 'public.collaboration_memberships', 'DELETE') THEN
    RAISE EXCEPTION 'membership table grants must be owner-managed';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.current_collaboration_membership_status()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.current_collaboration_membership_status()', 'EXECUTE') THEN
    RAISE EXCEPTION 'membership status RPC grants are incorrect';
  END IF;

  IF (SELECT count(*) FROM pg_constraint WHERE conname IN (
    'comments_content_length',
    'reservations_title_length',
    'reservations_description_length',
    'annotations_note_length'
  ) AND convalidated) <> 4 THEN
    RAISE EXCEPTION 'content constraints are incomplete';
  END IF;
END;
$$;
SQL

echo "PostgreSQL migration verification passed."
