-- GridAccess tenant-isolated schema for the MSE Product Suite Free-tier project.
-- Apply only to project tcstghomtslvvjvtbtmj after confirming the target.
create schema if not exists gridaccess;
create schema if not exists gridaccess_private;
revoke all on schema gridaccess from anon, public;
revoke all on schema gridaccess_private from anon, public, authenticated;
grant usage on schema gridaccess to authenticated;

create table if not exists gridaccess.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  region text not null default '' check (char_length(region) <= 120),
  team_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists gridaccess.organization_members (
  organization_id uuid not null references gridaccess.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index if not exists gridaccess_members_user_idx on gridaccess.organization_members(user_id, organization_id);

create table if not exists gridaccess.sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references gridaccess.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 140),
  region text not null default '' check (char_length(region) <= 120),
  population integer not null default 0 check (population >= 0),
  demand_kwh_day numeric(14,3) not null check (demand_kwh_day >= 0),
  critical_load_pct numeric(5,2) not null default 35 check (critical_load_pct between 0 and 100),
  service_target_pct numeric(5,2) not null default 95 check (service_target_pct between 0 and 100),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, name)
);
create index if not exists gridaccess_sites_org_idx on gridaccess.sites(organization_id, name);

create table if not exists gridaccess.energy_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references gridaccess.organizations(id) on delete cascade,
  site_id uuid not null,
  name text not null check (char_length(name) between 1 and 140),
  asset_type text not null check (asset_type in ('solar', 'wind', 'hydro', 'diesel', 'grid', 'battery')),
  capacity_kwh_day numeric(14,3) not null default 0 check (capacity_kwh_day >= 0),
  availability_pct numeric(5,2) not null default 100 check (availability_pct between 0 and 100),
  storage_kwh numeric(14,3) not null default 0 check (storage_kwh >= 0),
  initial_soc_pct numeric(5,2) not null default 0 check (initial_soc_pct between 0 and 100),
  charge_efficiency_pct numeric(5,2) not null default 90 check (charge_efficiency_pct between 0 and 100),
  discharge_efficiency_pct numeric(5,2) not null default 90 check (discharge_efficiency_pct between 0 and 100),
  variable_cost_per_kwh numeric(12,5) not null default 0 check (variable_cost_per_kwh >= 0),
  emissions_kg_per_kwh numeric(12,5) not null default 0 check (emissions_kg_per_kwh >= 0),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, site_id, organization_id),
  unique (organization_id, site_id, name),
  foreign key (site_id, organization_id) references gridaccess.sites(id, organization_id) on delete cascade,
  check (asset_type <> 'battery' or (storage_kwh > 0 and capacity_kwh_day > 0 and charge_efficiency_pct > 0 and discharge_efficiency_pct > 0))
);
create index if not exists gridaccess_assets_site_idx on gridaccess.energy_assets(organization_id, site_id, asset_type);

create table if not exists gridaccess.scenarios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references gridaccess.organizations(id) on delete cascade,
  site_id uuid not null,
  name text not null check (char_length(name) between 1 and 140),
  horizon_days integer not null check (horizon_days between 1 and 365),
  demand_growth_pct numeric(7,2) not null default 0 check (demand_growth_pct between -100 and 1000),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, site_id, organization_id),
  foreign key (site_id, organization_id) references gridaccess.sites(id, organization_id) on delete cascade
);

create table if not exists gridaccess.scenario_disruptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references gridaccess.organizations(id) on delete cascade,
  site_id uuid not null,
  scenario_id uuid not null,
  asset_id uuid not null,
  availability_pct numeric(5,2) not null check (availability_pct between 0 and 100),
  note text not null default '' check (char_length(note) <= 500),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (scenario_id, asset_id),
  foreign key (scenario_id, site_id, organization_id) references gridaccess.scenarios(id, site_id, organization_id) on delete cascade,
  foreign key (asset_id, site_id, organization_id) references gridaccess.energy_assets(id, site_id, organization_id) on delete cascade
);

create table if not exists gridaccess.scenario_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references gridaccess.organizations(id) on delete cascade,
  site_id uuid not null,
  scenario_id uuid not null,
  model_version text not null check (char_length(model_version) <= 80),
  result jsonb not null,
  assumptions jsonb not null default '[]'::jsonb,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (scenario_id, site_id, organization_id) references gridaccess.scenarios(id, site_id, organization_id) on delete cascade
);
create index if not exists gridaccess_runs_org_idx on gridaccess.scenario_runs(organization_id, site_id, created_at desc);

create or replace function gridaccess_private.is_member(p_organization_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from gridaccess.organization_members m
    where m.organization_id = p_organization_id and m.user_id = (select auth.uid())
  );
$$;
revoke all on function gridaccess_private.is_member(uuid) from public, anon;
grant usage on schema gridaccess_private to authenticated;
grant execute on function gridaccess_private.is_member(uuid) to authenticated;

create or replace function gridaccess.create_organization(p_name text, p_region text default '')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_user_id uuid := auth.uid(); v_organization_id uuid;
begin
  if v_user_id is null then raise exception 'Sign in is required.'; end if;
  if char_length(trim(p_name)) not between 2 and 100 then raise exception 'Workspace name must be 2 to 100 characters.'; end if;
  insert into gridaccess.organizations(name, region, created_by)
  values (trim(p_name), coalesce(trim(p_region), ''), v_user_id)
  returning id into v_organization_id;
  insert into gridaccess.organization_members(organization_id, user_id, role)
  values (v_organization_id, v_user_id, 'owner');
  return v_organization_id;
end;
$$;

create or replace function gridaccess.join_organization(p_team_code text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_user_id uuid := auth.uid(); v_organization_id uuid;
begin
  if v_user_id is null then raise exception 'Sign in is required.'; end if;
  select o.id into v_organization_id from gridaccess.organizations o where o.team_code = upper(trim(p_team_code));
  if v_organization_id is null then raise exception 'That team code was not found.'; end if;
  insert into gridaccess.organization_members(organization_id, user_id, role)
  values (v_organization_id, v_user_id, 'member') on conflict (organization_id, user_id) do nothing;
  return v_organization_id;
end;
$$;

revoke all on function gridaccess.create_organization(text, text) from public, anon;
revoke all on function gridaccess.join_organization(text) from public, anon;
grant execute on function gridaccess.create_organization(text, text) to authenticated;
grant execute on function gridaccess.join_organization(text) to authenticated;

grant select on gridaccess.organizations, gridaccess.organization_members, gridaccess.sites,
  gridaccess.energy_assets, gridaccess.scenarios, gridaccess.scenario_disruptions, gridaccess.scenario_runs to authenticated;
grant insert, update, delete on gridaccess.sites, gridaccess.energy_assets, gridaccess.scenarios,
  gridaccess.scenario_disruptions, gridaccess.scenario_runs to authenticated;
revoke insert, update, delete on gridaccess.organizations, gridaccess.organization_members from anon, authenticated;

alter table gridaccess.organizations enable row level security;
alter table gridaccess.organization_members enable row level security;
alter table gridaccess.sites enable row level security;
alter table gridaccess.energy_assets enable row level security;
alter table gridaccess.scenarios enable row level security;
alter table gridaccess.scenario_disruptions enable row level security;
alter table gridaccess.scenario_runs enable row level security;

create policy "members read organizations" on gridaccess.organizations for select to authenticated
  using (gridaccess_private.is_member(id));
create policy "members read memberships" on gridaccess.organization_members for select to authenticated
  using (user_id = (select auth.uid()) or gridaccess_private.is_member(organization_id));

do $$
declare t text;
begin
  foreach t in array array['sites','energy_assets','scenarios','scenario_disruptions','scenario_runs'] loop
    execute format('create policy %I on gridaccess.%I for select to authenticated using (gridaccess_private.is_member(organization_id))', t || ' member select', t);
    execute format('create policy %I on gridaccess.%I for insert to authenticated with check (gridaccess_private.is_member(organization_id) and created_by = (select auth.uid()))', t || ' member insert', t);
    execute format('create policy %I on gridaccess.%I for update to authenticated using (gridaccess_private.is_member(organization_id)) with check (gridaccess_private.is_member(organization_id))', t || ' member update', t);
    execute format('create policy %I on gridaccess.%I for delete to authenticated using (gridaccess_private.is_member(organization_id))', t || ' member delete', t);
  end loop;
end;
$$;
