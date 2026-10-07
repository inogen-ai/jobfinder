-- Shared: the posting text, same for everyone who can see the role.
alter table public.roles add column job_description text not null default '';

-- Private per user.
create table public.profiles (
  user_id        uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  headline       text not null default '',
  cv_text        text not null default '' check (char_length(cv_text) <= 40000),
  rate           text not null default '',
  available_from date,
  location       text not null default '',
  preferences    text not null default '',
  always_mention text not null default '',
  never_mention  text not null default '',
  updated_at     timestamptz not null default now()
);

create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role_id       text not null references public.roles(id) on delete cascade,
  kind          text not null check (kind in ('cover_letter','pitch','cv','answers')),
  title         text not null,
  body          text not null,
  questions     text not null default '',
  instruction   text not null default '',
  model         text not null,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index documents_user_role on public.documents (user_id, role_id) where deleted_at is null;
create index documents_user_created on public.documents (user_id, created_at);

-- Spend ledger: one row per model call (generate or fetch), written BEFORE the call, so stopped,
-- refused and failed runs count too. Users can insert and read their own rows, never change them.
create table public.usage_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action     text not null check (action in ('generate','fetch')),
  role_id    text not null,
  created_at timestamptz not null default now()
);
create index usage_log_user_action_created on public.usage_log (user_id, action, created_at);

revoke all on public.profiles, public.documents, public.usage_log from anon;

alter table public.profiles  enable row level security;
alter table public.documents enable row level security;
alter table public.usage_log enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (public.is_inogen() and user_id = auth.uid());
create policy profiles_insert on public.profiles for insert to authenticated
  with check (public.is_inogen() and user_id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_inogen() and user_id = auth.uid()) with check (public.is_inogen() and user_id = auth.uid());

create policy documents_select on public.documents for select to authenticated
  using (public.is_inogen() and user_id = auth.uid());
-- The role must be one the caller can see (roles RLS applies inside the subquery) and not soft-deleted.
create policy documents_insert on public.documents for insert to authenticated
  with check (
    public.is_inogen() and user_id = auth.uid()
    and exists (select 1 from public.roles r where r.id = documents.role_id and r.deleted_at is null)
  );
create policy documents_update on public.documents for update to authenticated
  using (public.is_inogen() and user_id = auth.uid()) with check (public.is_inogen() and user_id = auth.uid());
-- No delete policy: documents are soft-deleted (deleted_at), like roles.

create policy usage_log_select on public.usage_log for select to authenticated
  using (public.is_inogen() and user_id = auth.uid());
create policy usage_log_insert on public.usage_log for insert to authenticated
  with check (public.is_inogen() and user_id = auth.uid());
-- No update or delete policy: the ledger is append-only for users.

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end
$$;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Server-set timestamps: a client can never backdate a row to dodge the hourly limit.
create or replace function public.stamp_created_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_at := now();
  return new;
end
$$;
create trigger documents_stamp before insert on public.documents
  for each row execute function public.stamp_created_at();
create trigger usage_log_stamp before insert on public.usage_log
  for each row execute function public.stamp_created_at();

-- After insert, only title and body (and deleted_at) are the user's to change.
create or replace function public.documents_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.user_id := old.user_id;
  new.role_id := old.role_id;
  new.kind := old.kind;
  new.model := old.model;
  new.input_tokens := old.input_tokens;
  new.output_tokens := old.output_tokens;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end
$$;
create trigger documents_guard before update on public.documents
  for each row execute function public.documents_guard();

-- Count and record in one step under a per-user lock, so parallel requests cannot all pass.
-- Returns null when the call may proceed (and records it), or the time the limit frees up.
-- security invoker: runs as the caller, so RLS applies to every read and write.
create or replace function public.claim_usage(p_action text, p_role_id text, p_limit int)
returns timestamptz
language plpgsql security invoker set search_path = '' as $$
declare
  used int;
  oldest timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext(coalesce(auth.uid()::text, '') || ':' || p_action));
  select count(*), min(created_at) into used, oldest
    from public.usage_log
   where user_id = auth.uid() and action = p_action and created_at > now() - interval '1 hour';
  if used >= p_limit then
    return oldest + interval '1 hour';
  end if;
  insert into public.usage_log (action, role_id) values (p_action, p_role_id);
  return null;
end
$$;
revoke all on function public.claim_usage(text, text, int) from anon, public;
grant execute on function public.claim_usage(text, text, int) to authenticated;
