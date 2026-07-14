-- Fix plpgsql lint error in get_personal_notifications: UNION ALL queries
-- cannot use ORDER BY with column aliases that are expressions.  Wrap the
-- UNION in a subquery so the outer ORDER BY references named output columns.

begin;

create or replace function public.get_personal_notifications(p_limit integer default 20)
returns table (
  id uuid,
  event_type text,
  title text,
  subtitle text,
  link text,
  occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, private, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null
    or coalesce((((select auth.jwt())) ->> 'is_anonymous')::boolean, false)
  then
    return;
  end if;

  return query
  select * from (
    -- Product suggestion resolution
    select
      ps.id,
      'suggestion_resolved'::text as event_type,
      'Product suggestion ' || ps.status as title,
      ps.name as subtitle,
      '/drafts'::text as link,
      coalesce(ps.reviewed_at, ps.created_at) as occurred_at
    from private.product_suggestions ps
    where ps.user_id = v_user_id
      and ps.status in ('approved', 'rejected', 'duplicate')

    union all

    -- Store suggestion resolution
    select
      ss.id,
      'suggestion_resolved'::text,
      'Store suggestion ' || ss.status,
      coalesce(ss.store_name, ss.retailer_name),
      '/drafts'::text,
      coalesce(ss.reviewed_at, ss.created_at)
    from private.store_suggestions ss
    where ss.user_id = v_user_id
      and ss.status in ('approved', 'rejected', 'duplicate')

    union all

    -- Draft state changes (ready or needs_attention only — actionable states)
    select
      cd.id,
      'draft_state'::text,
      case cd.state
        when 'ready' then 'Draft ready to submit'
        when 'needs_attention' then 'Draft needs attention'
        else 'Draft updated'
      end,
      case cd.draft_type
        when 'sighting' then 'Sighting draft'
        when 'bounty' then 'Bounty draft'
      end,
      '/drafts'::text,
      cd.updated_at
    from private.contribution_drafts cd
    where cd.user_id = v_user_id
      and cd.state in ('ready', 'needs_attention')

    union all

    -- Bounty claim status changes (for bounty owners)
    select
      bc.id,
      'bounty_claim'::text,
      'Bounty claim ' || bc.status,
      coalesce(p.name, 'Unknown product'),
      '/bounties/' || b.id::text,
      bc.created_at
    from public.bounty_claims bc
    join public.bounties b on b.id = bc.bounty_id
    join public.products p on p.id = b.product_id
    where b.user_id = v_user_id
      and bc.status in ('accepted', 'rejected')

    union all

    -- Moderation actions on user's contributions
    select
      me.id,
      'moderation'::text,
      case me.new_status
        when 'approved' then 'Your contribution was approved'
        when 'rejected' then 'Your contribution was rejected'
        when 'hidden' then 'Your contribution was hidden'
        else 'Contribution moderated'
      end,
      case me.contribution_type
        when 'sighting' then 'Sighting'
        when 'bounty' then 'Bounty'
      end,
      case me.contribution_type
        when 'sighting' then '/sightings/' || me.contribution_id::text
        when 'bounty' then '/bounties/' || me.contribution_id::text
      end,
      me.created_at
    from private.contribution_moderation_events me
    where me.actor_id <> v_user_id
      and exists (
        select 1
        from public.sightings s
        where s.id = me.contribution_id
          and s.user_id = v_user_id
          and me.contribution_type = 'sighting'
        union all
        select 1
        from public.bounties b
        where b.id = me.contribution_id
          and b.user_id = v_user_id
          and me.contribution_type = 'bounty'
      )
  ) t
  order by t.occurred_at desc, t.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

revoke all on function public.get_personal_notifications(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_personal_notifications(integer)
  to authenticated;

notify pgrst, 'reload schema';

commit;
