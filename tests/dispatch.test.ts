import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateDispatch, type Asset, type Site } from "../src/lib/dispatch.ts";

const site: Site = {
  id: "village-1",
  name: "Coastal settlement",
  population: 1200,
  demand_kwh_day: 100,
  critical_load_pct: 35,
  service_target_pct: 95,
};

const solar: Asset = {
  id: "solar-1",
  site_id: site.id,
  name: "Solar field",
  asset_type: "solar",
  capacity_kwh_day: 120,
  availability_pct: 100,
  storage_kwh: 0,
  initial_soc_pct: 0,
  charge_efficiency_pct: 0,
  discharge_efficiency_pct: 0,
  variable_cost_per_kwh: 0.02,
  emissions_kg_per_kwh: 0.04,
};

test("available generation serves demand and reports operating impacts", () => {
  const result = simulateDispatch(site, [solar], { horizon_days: 3, demand_growth_pct: 0 }, []);
  assert.equal(result.total_demand_kwh, 300);
  assert.equal(result.total_served_kwh, 300);
  assert.equal(result.total_unserved_kwh, 0);
  assert.equal(result.service_pct, 100);
  assert.equal(result.operating_cost, 6);
  assert.equal(result.emissions_kg, 12);
});

test("an asset availability shock changes daily supply and service reliability", () => {
  const result = simulateDispatch(site, [solar], { horizon_days: 2, demand_growth_pct: 0 }, [
    { asset_id: solar.id, availability_pct: 25 },
  ]);
  assert.equal(result.total_unserved_kwh, 140);
  assert.equal(result.critical_unserved_kwh, 49);
  assert.equal(result.days_below_target, 2);
});

test("storage bridges shortfalls only within energy and daily power limits", () => {
  const battery: Asset = {
    ...solar,
    id: "battery-1",
    name: "Community battery",
    asset_type: "battery",
    capacity_kwh_day: 30,
    availability_pct: 100,
    storage_kwh: 50,
    initial_soc_pct: 100,
    charge_efficiency_pct: 90,
    discharge_efficiency_pct: 90,
    variable_cost_per_kwh: 0,
    emissions_kg_per_kwh: 0,
  };
  const result = simulateDispatch(site, [battery], { horizon_days: 2, demand_growth_pct: 0 }, []);
  assert.equal(result.daily[0].battery_discharge_kwh, 30);
  assert.ok(Math.abs(result.daily[1].battery_discharge_kwh - 15) < 1e-9);
  assert.equal(result.total_unserved_kwh, 155);
});

test("demand growth is applied consistently throughout the horizon", () => {
  const result = simulateDispatch(site, [solar], { horizon_days: 1, demand_growth_pct: 20 }, []);
  assert.equal(result.total_demand_kwh, 120);
  assert.equal(result.total_unserved_kwh, 0);
});

test("duplicate asset shocks and invalid battery efficiencies are rejected", () => {
  assert.throws(
    () => simulateDispatch(site, [solar], { horizon_days: 1, demand_growth_pct: 0 }, [
      { asset_id: solar.id, availability_pct: 0 },
      { asset_id: solar.id, availability_pct: 100 },
    ]),
    /only have one availability shock/,
  );
  assert.throws(
    () => simulateDispatch(site, [{ ...solar, id: "bad-battery", asset_type: "battery", storage_kwh: 25, discharge_efficiency_pct: 0 }], { horizon_days: 1, demand_growth_pct: 0 }, []),
    /positive storage and charge\/discharge efficiency/,
  );
});
