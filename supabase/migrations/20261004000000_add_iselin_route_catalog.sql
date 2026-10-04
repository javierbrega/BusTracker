create table if not exists public.route_groups (
  id text primary key,
  display_id text not null,
  display_name text not null,
  color text,
  alert_message text not null default '',
  imported_at timestamptz not null default now()
);

alter table public.routes
  add column if not exists group_id text,
  add column if not exists geometry jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'routes_group_id_fkey'
      and conrelid = 'public.routes'::regclass
  ) then
    alter table public.routes
      add constraint routes_group_id_fkey
      foreign key (group_id) references public.route_groups(id);
  end if;
end;
$$;

alter table public.stops
  add column if not exists source_key text;

alter table public.trips
  add column if not exists source_id text,
  add column if not exists service_description text,
  add column if not exists season text;

alter table public.stop_times
  add column if not exists source_id text;

create unique index if not exists routes_code_key
  on public.routes (code);
create unique index if not exists stops_source_key_key
  on public.stops (source_key);
create unique index if not exists trips_source_id_key
  on public.trips (source_id);
create unique index if not exists stop_times_source_id_key
  on public.stop_times (source_id);
create index if not exists routes_group_id_idx
  on public.routes (group_id);
create index if not exists trips_route_id_idx
  on public.trips (route_id);

alter table public.route_groups enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'route_groups'
      and policyname = 'Public can read route groups'
  ) then
    create policy "Public can read route groups"
      on public.route_groups
      for select
      to anon, authenticated
      using (true);
  end if;
end;
$$;

grant select on public.route_groups to anon, authenticated;
grant all on public.route_groups to service_role;
