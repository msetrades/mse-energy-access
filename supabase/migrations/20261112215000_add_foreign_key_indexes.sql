-- Index product foreign keys for joins and parent-row updates/deletes.
create index if not exists "mse_fk_energy_assets_1" on "gridaccess"."energy_assets" ("created_by");
create index if not exists "mse_fk_energy_assets_2" on "gridaccess"."energy_assets" ("site_id", "organization_id");
create index if not exists "mse_fk_organizations_1" on "gridaccess"."organizations" ("created_by");
create index if not exists "mse_fk_scenario_disruptions_1" on "gridaccess"."scenario_disruptions" ("asset_id", "site_id", "organization_id");
create index if not exists "mse_fk_scenario_disruptions_2" on "gridaccess"."scenario_disruptions" ("created_by");
create index if not exists "mse_fk_scenario_disruptions_3" on "gridaccess"."scenario_disruptions" ("organization_id");
create index if not exists "mse_fk_scenario_disruptions_4" on "gridaccess"."scenario_disruptions" ("scenario_id", "site_id", "organization_id");
create index if not exists "mse_fk_scenario_runs_1" on "gridaccess"."scenario_runs" ("created_by");
create index if not exists "mse_fk_scenario_runs_2" on "gridaccess"."scenario_runs" ("scenario_id", "site_id", "organization_id");
create index if not exists "mse_fk_scenarios_1" on "gridaccess"."scenarios" ("created_by");
create index if not exists "mse_fk_scenarios_2" on "gridaccess"."scenarios" ("organization_id");
create index if not exists "mse_fk_scenarios_3" on "gridaccess"."scenarios" ("site_id", "organization_id");
create index if not exists "mse_fk_sites_1" on "gridaccess"."sites" ("created_by");

