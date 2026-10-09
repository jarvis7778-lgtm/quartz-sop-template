-- 005: additive collaboration membership gate and exclusive named-equipment bookings
--
-- Existing non-admin users are deliberately put into pending review. Existing
-- reservations are retained. If any existing normalized named equipment slots
-- overlap, this migration aborts before adding the exclusion constraint; repair
-- the reported data manually and rerun it. Nothing is deleted automatically.
-- The explicit transaction also guarantees a failed preflight leaves no partial
-- membership/RLS changes behind for a manual data repair and retry.

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Keep approval state separate from public profile data so ordinary users never
-- receive an UPDATE path that can approve or revoke themselves.
CREATE TABLE IF NOT EXISTS public.collaboration_memberships (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_collaboration_memberships_status
  ON public.collaboration_memberships (status);

DROP TRIGGER IF EXISTS update_collaboration_memberships_updated_at
  ON public.collaboration_memberships;
CREATE TRIGGER update_collaboration_memberships_updated_at
  BEFORE UPDATE ON public.collaboration_memberships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Existing administrators retain access. Everyone else requires an explicit
-- administrator approval after this upgrade.
INSERT INTO public.collaboration_memberships (user_id, status, decided_at)
SELECT u.id,
       CASE WHEN u.role = 'admin' THEN 'approved' ELSE 'pending' END,
       CASE WHEN u.role = 'admin' THEN now() ELSE NULL END
FROM public.users AS u
ON CONFLICT (user_id) DO NOTHING;

-- New OAuth identities are created pending, not automatically admitted.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_github_id text;
  v_username text;
  v_avatar_url text;
BEGIN
  v_username := COALESCE(
    new.raw_user_meta_data->>'user_name',
    new.raw_user_meta_data->>'preferred_username',
    new.raw_user_meta_data->>'name',
    CASE WHEN new.email IS NOT NULL THEN split_part(new.email, '@', 1) END,
    'user'
  );

  v_github_id := COALESCE(
    new.raw_user_meta_data->>'provider_id',
    new.raw_user_meta_data->>'sub',
    new.raw_user_meta_data->>'id',
    new.id::text
  );
  v_avatar_url := NULLIF(new.raw_user_meta_data->>'avatar_url', '');

  INSERT INTO public.users (id, github_id, username, email, avatar_url)
  VALUES (new.id, v_github_id, v_username, new.email, v_avatar_url)
  ON CONFLICT (id) DO UPDATE
  SET github_id = EXCLUDED.github_id,
      username = EXCLUDED.username,
      email = EXCLUDED.email,
      avatar_url = EXCLUDED.avatar_url,
      updated_at = now();

  INSERT INTO public.collaboration_memberships (user_id, status)
  VALUES (new.id, 'pending')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN new;
END;
$$;

-- SECURITY DEFINER helpers read the owner-managed table without exposing it to
-- ordinary clients. Fixed search paths avoid object-shadowing attacks.
CREATE OR REPLACE FUNCTION public.is_collaboration_approved()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.collaboration_memberships AS cm
       WHERE cm.user_id = auth.uid()
         AND cm.status = 'approved'
     )
$$;

CREATE OR REPLACE FUNCTION public.is_collaboration_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_collaboration_approved()
     AND EXISTS (
       SELECT 1
       FROM public.users AS u
       WHERE u.id = auth.uid()
         AND u.role = 'admin'
     )
$$;

-- This is the only membership read API for non-administrators. A missing row
-- fails closed as pending, including during interrupted legacy onboarding.
CREATE OR REPLACE FUNCTION public.current_collaboration_membership_status()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN NULL
    ELSE COALESCE(
      (SELECT cm.status
       FROM public.collaboration_memberships AS cm
       WHERE cm.user_id = auth.uid()),
      'pending'
    )
  END
$$;

REVOKE ALL ON FUNCTION public.is_collaboration_approved() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_collaboration_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_collaboration_membership_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_collaboration_approved() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_collaboration_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_collaboration_membership_status() TO authenticated;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_memberships ENABLE ROW LEVEL SECURITY;

-- Replace pre-upgrade policies that admitted every authenticated identity.
DROP POLICY IF EXISTS "用户可查看所有成员" ON public.users;
DROP POLICY IF EXISTS "用户可创建自己" ON public.users;
DROP POLICY IF EXISTS "成员可更新自己" ON public.users;
DROP POLICY IF EXISTS "管理员可更新自己" ON public.users;
DROP POLICY IF EXISTS "成员可查看注释" ON public.annotations;
DROP POLICY IF EXISTS "成员可创建注释" ON public.annotations;
DROP POLICY IF EXISTS "作者可更新注释" ON public.annotations;
DROP POLICY IF EXISTS "作者或管理员可删除注释" ON public.annotations;
DROP POLICY IF EXISTS "成员可查看评论" ON public.comments;
DROP POLICY IF EXISTS "成员可创建评论" ON public.comments;
DROP POLICY IF EXISTS "作者可更新评论" ON public.comments;
DROP POLICY IF EXISTS "作者或管理员可删除评论" ON public.comments;
DROP POLICY IF EXISTS "成员可查看点赞" ON public.comment_likes;
DROP POLICY IF EXISTS "成员可点赞" ON public.comment_likes;
DROP POLICY IF EXISTS "用户可取消自己的点赞" ON public.comment_likes;
DROP POLICY IF EXISTS "成员可查看预约" ON public.reservations;
DROP POLICY IF EXISTS "成员可创建预约" ON public.reservations;
DROP POLICY IF EXISTS "预约者可更新" ON public.reservations;
DROP POLICY IF EXISTS "预约者或管理员可删除" ON public.reservations;

CREATE POLICY collaboration_users_read ON public.users
  FOR SELECT USING (public.is_collaboration_approved());
CREATE POLICY collaboration_members_update_self ON public.users
  FOR UPDATE
  USING (id = auth.uid() AND role = 'member' AND public.is_collaboration_approved())
  WITH CHECK (id = auth.uid() AND role = 'member' AND public.is_collaboration_approved());
CREATE POLICY collaboration_admins_update_self ON public.users
  FOR UPDATE
  USING (id = auth.uid() AND role = 'admin' AND public.is_collaboration_admin())
  WITH CHECK (id = auth.uid() AND role = 'admin' AND public.is_collaboration_admin());

CREATE POLICY collaboration_annotations_read ON public.annotations
  FOR SELECT USING (public.is_collaboration_approved());
CREATE POLICY collaboration_annotations_insert ON public.annotations
  FOR INSERT WITH CHECK (public.is_collaboration_approved() AND user_id = auth.uid());
CREATE POLICY collaboration_annotations_update ON public.annotations
  FOR UPDATE USING (public.is_collaboration_approved() AND user_id = auth.uid())
  WITH CHECK (public.is_collaboration_approved() AND user_id = auth.uid());
CREATE POLICY collaboration_annotations_delete ON public.annotations
  FOR DELETE USING (public.is_collaboration_approved() AND (
    user_id = auth.uid() OR public.is_collaboration_admin()
  ));

CREATE POLICY collaboration_comments_read ON public.comments
  FOR SELECT USING (public.is_collaboration_approved());
CREATE POLICY collaboration_comments_insert ON public.comments
  FOR INSERT WITH CHECK (public.is_collaboration_approved() AND author_id = auth.uid());
CREATE POLICY collaboration_comments_update ON public.comments
  FOR UPDATE USING (public.is_collaboration_approved() AND author_id = auth.uid())
  WITH CHECK (public.is_collaboration_approved() AND author_id = auth.uid());
CREATE POLICY collaboration_comments_delete ON public.comments
  FOR DELETE USING (public.is_collaboration_approved() AND (
    author_id = auth.uid() OR public.is_collaboration_admin()
  ));

CREATE POLICY collaboration_likes_read ON public.comment_likes
  FOR SELECT USING (public.is_collaboration_approved());
CREATE POLICY collaboration_likes_insert ON public.comment_likes
  FOR INSERT WITH CHECK (public.is_collaboration_approved() AND user_id = auth.uid());
CREATE POLICY collaboration_likes_delete ON public.comment_likes
  FOR DELETE USING (public.is_collaboration_approved() AND user_id = auth.uid());

CREATE POLICY collaboration_reservations_read ON public.reservations
  FOR SELECT USING (public.is_collaboration_approved());
CREATE POLICY collaboration_reservations_insert ON public.reservations
  FOR INSERT WITH CHECK (public.is_collaboration_approved() AND user_id = auth.uid());
CREATE POLICY collaboration_reservations_update ON public.reservations
  FOR UPDATE USING (public.is_collaboration_approved() AND user_id = auth.uid())
  WITH CHECK (public.is_collaboration_approved() AND user_id = auth.uid());
CREATE POLICY collaboration_reservations_delete ON public.reservations
  FOR DELETE USING (public.is_collaboration_approved() AND (
    user_id = auth.uid() OR public.is_collaboration_admin()
  ));

-- The table is owner-managed: only currently approved administrators can read
-- or update somebody else's status, and no administrator can alter their own.
CREATE POLICY collaboration_memberships_admin_read ON public.collaboration_memberships
  FOR SELECT USING (public.is_collaboration_admin());
CREATE POLICY collaboration_memberships_admin_update ON public.collaboration_memberships
  FOR UPDATE
  USING (public.is_collaboration_admin() AND user_id <> auth.uid())
  WITH CHECK (
    public.is_collaboration_admin()
    AND user_id <> auth.uid()
    AND status IN ('pending', 'approved', 'revoked')
  );

-- Explicit Data API privileges; RLS remains the authorization boundary.
REVOKE ALL ON public.users, public.annotations, public.comments, public.comment_likes,
  public.reservations, public.collaboration_memberships FROM anon;
REVOKE ALL ON public.collaboration_memberships FROM authenticated;
GRANT SELECT (id, github_id, username, avatar_url, role, created_at, updated_at)
  ON public.users TO authenticated;
GRANT UPDATE (github_id, username, email, avatar_url) ON public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.annotations, public.comments,
  public.comment_likes, public.reservations TO authenticated;
GRANT SELECT, UPDATE (status, decided_at, decided_by) ON public.collaboration_memberships TO authenticated;

-- Views execute as the calling role, so the table policies above also gate
-- pending/revoked identities and all collaboration views.
ALTER VIEW public.comments_with_author SET (security_invoker = true);
ALTER VIEW public.reservations_with_user SET (security_invoker = true);
REVOKE ALL ON public.comments_with_author, public.reservations_with_user FROM anon;
GRANT SELECT ON public.comments_with_author, public.reservations_with_user TO authenticated;

-- A generated key preserves the original display value while treating named
-- equipment case-insensitively after trimming. NULL/blank equipment stays shared.
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS equipment_key text
  GENERATED ALWAYS AS (NULLIF(lower(btrim(equipment)), '')) STORED;
CREATE INDEX IF NOT EXISTS idx_reservations_equipment_key
  ON public.reservations (equipment_key)
  WHERE equipment_key IS NOT NULL;

CREATE OR REPLACE VIEW public.reservation_named_equipment_overlap_preflight
WITH (security_invoker = true) AS
SELECT
  left_reservation.equipment_key,
  left_reservation.id AS first_reservation_id,
  right_reservation.id AS second_reservation_id,
  left_reservation.start_time AS first_start_time,
  left_reservation.end_time AS first_end_time,
  right_reservation.start_time AS second_start_time,
  right_reservation.end_time AS second_end_time
FROM public.reservations AS left_reservation
JOIN public.reservations AS right_reservation
  ON left_reservation.equipment_key = right_reservation.equipment_key
 AND left_reservation.id < right_reservation.id
 AND tstzrange(left_reservation.start_time, left_reservation.end_time, '[)')
     && tstzrange(right_reservation.start_time, right_reservation.end_time, '[)')
WHERE left_reservation.equipment_key IS NOT NULL;
REVOKE ALL ON public.reservation_named_equipment_overlap_preflight FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.reservation_named_equipment_overlap_preflight) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'named-equipment reservation overlaps must be resolved before 005 can install exclusivity',
      DETAIL = 'Run the preflight query documented in docs/collab-security-upgrade.md against the old schema, repair data explicitly, then rerun this migration.',
      HINT = 'No reservations were deleted or changed by this migration.';
  END IF;
END;
$$;

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_named_equipment_no_overlap
  EXCLUDE USING gist (
    equipment_key WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
  ) WHERE (equipment_key IS NOT NULL);

COMMIT;
