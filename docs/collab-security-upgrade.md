# Collaboration security and named-equipment upgrade

`005_collab_membership_and_named_equipment.sql` is additive. Apply it only after migrations `001`–`004`, through the normal Supabase migration process. This change was validated only in disposable local PostgreSQL containers; it does not contact a real Supabase project.

## Membership contract

- `public.collaboration_memberships` is the membership authority and is separate from `public.users` profile data.
- Existing administrators are seeded as `approved`; existing non-admin identities become `pending`.
- OAuth-created identities remain `pending` until an approved administrator updates the target user's row to `approved` or `revoked`.
- A user cannot insert/delete memberships, update their own status, or promote themselves through `users.role`.
- Pending/revoked users cannot read or mutate annotations, comments, likes, reservations, users, or collaboration views.
- The safe status API is:

  ```sql
  select public.current_collaboration_membership_status();
  ```

  It returns only the current authenticated identity's `pending`, `approved`, or `revoked` status; it returns `NULL` for an anonymous request.

- RLS controls collaboration table access and the views use `security_invoker = true`; anonymous callers have no collaboration view grants.

## Administrator bootstrap and approvals

After backing up the database and successfully applying `005`, use the Supabase SQL editor as the database owner. Obtain the actual auth UUID from Authentication → Users; never use an email or a guessed UUID. The user must first have signed in so the auth trigger created their profile and pending membership.

```sql
-- Replace the placeholder with the exact existing auth UUID before running.
begin;
update public.users set role = 'admin' where id = '<EXISTING-AUTH-UUID>'::uuid;
update public.collaboration_memberships
set status = 'approved', decided_at = now()
where user_id = '<EXISTING-AUTH-UUID>'::uuid;
commit;
```

Confirm both UPDATE counts are one, then read back the role and status before relying on the account. This is an owner operation, not a browser self-promotion endpoint. Keep at least one recoverable administrator account.

Approve/revoke members from the SQL editor or an authenticated approved-admin API client by updating the target row in `collaboration_memberships`. An admin cannot change their own membership through the Data API. There is no administrative web dashboard in this release. Approval/revocation is enforced on subsequent database operations; already downloaded content cannot be recalled. Refresh the site after approval to update the UI. On transport or missing-migration errors, the UI refuses collaboration rather than assuming approval.

Do not expose private SOP HTML just because `005` is installed: protect HTML, attachments, indexes, source repositories and preview domains separately. Before production, repeat identity tests through the real Supabase Data API and verify GitHub OAuth callbacks. Local PostgreSQL tests are not a substitute for that deployment check.

## Named-equipment booking contract

- `reservations.equipment_key` is a generated normalization of `lower(btrim(equipment))`.
- `NULL`, empty, and whitespace-only equipment names produce `NULL` keys and remain shared resources.
- Nonblank named equipment is exclusive for the half-open interval `[start_time, end_time)`. Adjacent bookings are valid. Case and surrounding whitespace do not create distinct equipment.
- Exclusivity is a PostgreSQL GiST exclusion constraint, so concurrent inserts cannot both reserve conflicting named equipment.

## Mandatory overlap preflight

The exclusion constraint cannot be added while old normalized named-equipment overlaps exist. Migration `005` creates a transaction, checks for these conflicts, raises an error, and rolls the entire migration back. It never deletes or moves reservations.

Before applying in a production-like database, run this read-only query against the pre-upgrade schema (or use the same join after temporarily adding the normalization expression):

```sql
select
  nullif(lower(btrim(left_reservation.equipment)), '') as equipment_key,
  left_reservation.id as first_reservation_id,
  right_reservation.id as second_reservation_id,
  left_reservation.start_time as first_start_time,
  left_reservation.end_time as first_end_time,
  right_reservation.start_time as second_start_time,
  right_reservation.end_time as second_end_time
from public.reservations as left_reservation
join public.reservations as right_reservation
  on nullif(lower(btrim(left_reservation.equipment)), '')
     = nullif(lower(btrim(right_reservation.equipment)), '')
 and left_reservation.id < right_reservation.id
 and tstzrange(left_reservation.start_time, left_reservation.end_time, '[)')
     && tstzrange(right_reservation.start_time, right_reservation.end_time, '[)')
where nullif(lower(btrim(left_reservation.equipment)), '') is not null;
```

Resolve every returned conflict explicitly with the affected users. Re-run the migration only after the query returns no rows. After a successful migration the retained diagnostic view is `public.reservation_named_equipment_overlap_preflight`; it is intentionally not granted to browser roles.

## Local verification

```bash
./scripts/verify-postgres-migrations.sh
./scripts/test-collab-security-postgres.sh
```

The first command validates a fresh migration replay and schema/privilege contracts. The second first proves RED on the original schema (normalized named-equipment overlaps were allowed), proves that migration `005` rejects legacy conflicts without data deletion, then repairs the disposable fixture and exercises real PostgreSQL roles, `auth.uid()` identities, RLS, approval/revocation, view protection, normalized booking exclusions, and concurrent booking attempts.
