-- Roles: who created a role, and when, is fixed once written.
create or replace function public.roles_audit() returns trigger
language plpgsql set search_path = '' as $$
declare
  who text := coalesce(auth.jwt() ->> 'email', 'claude-script');
begin
  if tg_op = 'INSERT' then
    new.created_by := who;
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := who;
  new.updated_at := now();
  return new;
end
$$;

-- Pin search_path on every function (Supabase advisor: mutable search_path).
create or replace function public.is_inogen() returns boolean
language sql stable set search_path = '' as $$
  select lower(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 2)) = 'inogen.ai'
     and coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'azure'
$$;
alter function public.touch_updated_at() set search_path = '';

-- Draft counts per role for the row badge, grouped in the database (no row cap).
create or replace function public.document_counts() returns table (role_id text, n bigint)
language sql stable security invoker set search_path = '' as $$
  select d.role_id, count(*)
    from public.documents d
   where d.deleted_at is null and d.user_id = auth.uid()
   group by d.role_id
$$;
revoke all on function public.document_counts() from anon, public;
grant execute on function public.document_counts() to authenticated;
