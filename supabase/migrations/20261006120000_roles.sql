create table public.roles (
  id          text primary key,
  title       text not null,
  org         text not null,
  market      text not null check (market in ('UK','NL','EU','Global')),
  location    text not null default '',
  remote      text not null default '',
  rate        text not null default '',
  ir35        text not null default '',
  duration    text not null default '',
  posted      date,
  deadline    date,
  next_date   date,
  fit         text not null check (fit in ('Strong','Good','Stretch')),
  status      text not null default 'Shortlist'
              check (status in ('Shortlist','Applied','Interviewing','Offer','Won','Rejected','Closed','Parked')),
  why         text not null default '',
  caveat      text not null default '',
  url         text not null default '',
  contact     text not null default '',
  next_step   text not null default '',
  notes       text not null default '',
  cv          text not null default '' check (cv in ('','A','B')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  text,
  updated_by  text
);

-- Exact domain match, case-insensitive. Rejects "x@inogen.ai.evil.com" and "x@notinogen.ai".
create or replace function public.is_inogen() returns boolean
language sql stable
as $$
  select lower(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 2)) = 'inogen.ai'
$$;

alter table public.roles enable row level security;

create policy roles_select on public.roles for select to authenticated using (public.is_inogen());
create policy roles_insert on public.roles for insert to authenticated with check (public.is_inogen());
create policy roles_update on public.roles for update to authenticated using (public.is_inogen()) with check (public.is_inogen());
create policy roles_delete on public.roles for delete to authenticated using (public.is_inogen());

create or replace function public.roles_audit() returns trigger
language plpgsql
as $$
declare
  who text := coalesce(auth.jwt() ->> 'email', 'claude-script');
begin
  if tg_op = 'INSERT' then
    new.created_by := who;
    new.created_at := now();
  end if;
  new.updated_by := who;
  new.updated_at := now();
  return new;
end
$$;

create trigger roles_audit before insert or update on public.roles
  for each row execute function public.roles_audit();

alter publication supabase_realtime add table public.roles;
