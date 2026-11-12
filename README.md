# GridAccess

GridAccess is a community energy-access planning workspace for mapping a site's daily electricity need, generation mix, and storage assets, then testing how outages or demand growth change service reliability. It is designed for community-energy teams and infrastructure planners evaluating microgrid options, not as an automated dispatch or investment recommendation.

## Workflows

- Email/password authentication and private multi-organization workspaces.
- Community sites with population, average daily demand, critical-load share, and a service target.
- Solar, wind, hydro, diesel, grid, and battery asset records with availability, daily energy/power, cost, emissions, and battery efficiency assumptions.
- Multi-asset outage and demand-growth scenarios with stored, versioned daily energy-balance results.
- Reliability, unmet energy, critical-load share of shortages, operating cost, emissions, and service-target breach summaries.
- Organization membership enforced by Postgres RLS; no cross-tenant application queries.

## Model boundary

`daily-energy-balance-v1` is deterministic decision support. It aggregates demand and generation to daily energy totals, dispatches renewable sources before other sources, and applies battery state-of-charge, efficiency, and daily power limits. It does not model hourly peaks, load shedding priorities beyond proportional shortfall attribution, weather distributions, network losses, asset degradation, maintenance, fuel-price volatility, or probabilistic reliability. Results are scenario comparisons, not a forecast or engineering certification.

## Local setup

1. Install Node.js 22+ and run `npm ci`.
2. Copy `.env.example` to `.env.local` and set the approved MSE Product Suite project URL and publishable key.
3. Apply the migration in `supabase/migrations` only to project `tcstghomtslvvjvtbtmj`.
4. Add `gridaccess` to Supabase API settings > Exposed schemas. The migration gives access only to `authenticated`, enables RLS on all app tables, and does not expose its private policy-helper schema.
5. Allow local and deployed GridAccess origins in Supabase Auth redirect URLs.
6. Run `npm run dev`, `npm test`, `npm run lint`, and `npm run build`.

Never place a service-role/secret key in browser code or commit `.env.local`. The publishable key is constrained by database grants and RLS.

## Deployment status

The project code and migration are prepared for the MSE Product Suite project. The migration, API schema exposure, and production environment variables must be applied and verified before calling the app live or connected to production data.
