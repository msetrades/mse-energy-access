export type Site = {
  id: string;
  name: string;
  region?: string;
  population: number;
  demand_kwh_day: number;
  critical_load_pct: number;
  service_target_pct: number;
};

export type Asset = {
  id: string;
  site_id: string;
  name: string;
  asset_type: "solar" | "wind" | "hydro" | "diesel" | "grid" | "battery";
  capacity_kwh_day: number;
  availability_pct: number;
  storage_kwh: number;
  initial_soc_pct: number;
  charge_efficiency_pct: number;
  discharge_efficiency_pct: number;
  variable_cost_per_kwh: number;
  emissions_kg_per_kwh: number;
};

export type AssetShock = { asset_id: string; availability_pct: number };
export type Scenario = { horizon_days: number; demand_growth_pct: number };
export type DayBalance = {
  day: number;
  demand_kwh: number;
  generated_kwh: number;
  battery_discharge_kwh: number;
  battery_charge_input_kwh: number;
  served_kwh: number;
  unserved_kwh: number;
  storage_end_kwh: number;
  service_pct: number;
};
export type DispatchResult = {
  model_version: string;
  horizon_days: number;
  total_demand_kwh: number;
  total_generated_kwh: number;
  total_served_kwh: number;
  total_unserved_kwh: number;
  service_pct: number;
  critical_unserved_kwh: number;
  days_below_target: number;
  operating_cost: number;
  emissions_kg: number;
  peak_daily_unserved_kwh: number;
  daily: DayBalance[];
  assumptions: string[];
};

const renewableOrder: Record<Asset["asset_type"], number> = {
  solar: 0,
  wind: 1,
  hydro: 2,
  grid: 3,
  diesel: 4,
  battery: 5,
};

export function simulateDispatch(
  site: Site,
  assets: Asset[],
  scenario: Scenario,
  shocks: AssetShock[],
): DispatchResult {
  if (!Number.isInteger(scenario.horizon_days) || scenario.horizon_days < 1 || scenario.horizon_days > 365) {
    throw new Error("Scenario horizon must be a whole number from 1 to 365 days.");
  }
  if (!Number.isFinite(scenario.demand_growth_pct) || scenario.demand_growth_pct < -100 || scenario.demand_growth_pct > 1000) {
    throw new Error("Demand change must be between -100% and 1,000%.");
  }
  if (!Number.isFinite(site.population) || site.population < 0 || !Number.isFinite(site.demand_kwh_day) || site.demand_kwh_day < 0 || !Number.isFinite(site.critical_load_pct) || site.critical_load_pct < 0 || site.critical_load_pct > 100 || !Number.isFinite(site.service_target_pct) || site.service_target_pct < 0 || site.service_target_pct > 100) {
    throw new Error("Site demand, critical-load share, or service target is invalid.");
  }
  for (const asset of assets) {
    if (asset.site_id !== site.id) throw new Error(`Asset ${asset.name} belongs to a different site.`);
    if (![asset.capacity_kwh_day, asset.storage_kwh, asset.variable_cost_per_kwh, asset.emissions_kg_per_kwh].every(Number.isFinite) || asset.capacity_kwh_day < 0 || asset.storage_kwh < 0 || asset.variable_cost_per_kwh < 0 || asset.emissions_kg_per_kwh < 0) {
      throw new Error(`Asset ${asset.name} has an invalid capacity or operating factor.`);
    }
    if (![asset.availability_pct, asset.initial_soc_pct, asset.charge_efficiency_pct, asset.discharge_efficiency_pct].every((value) => Number.isFinite(value) && value >= 0 && value <= 100)) {
      throw new Error(`Asset ${asset.name} has a percentage outside 0–100.`);
    }
    if (asset.asset_type === "battery" && (asset.storage_kwh <= 0 || asset.charge_efficiency_pct === 0 || asset.discharge_efficiency_pct === 0)) {
      throw new Error(`Battery ${asset.name} needs positive storage and charge/discharge efficiency.`);
    }
  }
  const shockMap = new Map<string, number>();
  for (const shock of shocks) {
    if (!Number.isFinite(shock.availability_pct) || shock.availability_pct < 0 || shock.availability_pct > 100) {
      throw new Error("Shock availability must be between 0 and 100 percent.");
    }
    if (shockMap.has(shock.asset_id)) throw new Error("An asset can only have one availability shock per scenario.");
    if (!assets.some((asset) => asset.id === shock.asset_id)) throw new Error("A disrupted asset is not part of this site.");
    shockMap.set(shock.asset_id, shock.availability_pct);
  }

  const generation = assets
    .filter((asset) => asset.asset_type !== "battery")
    .map((asset) => ({
      asset,
      output: asset.capacity_kwh_day * (shockMap.get(asset.id) ?? asset.availability_pct) / 100,
    }))
    .sort((a, b) => renewableOrder[a.asset.asset_type] - renewableOrder[b.asset.asset_type] || a.asset.variable_cost_per_kwh - b.asset.variable_cost_per_kwh);
  const batteries = assets.filter((asset) => asset.asset_type === "battery").map((asset) => {
    const availability = shockMap.get(asset.id) ?? asset.availability_pct;
    return {
      asset,
      availablePct: availability,
      stateKwh: asset.storage_kwh * asset.initial_soc_pct / 100 * availability / 100,
      maxStateKwh: asset.storage_kwh * availability / 100,
    };
  });

  const daily: DayBalance[] = [];
  let operatingCost = 0;
  let emissionsKg = 0;
  const demandMultiplier = 1 + scenario.demand_growth_pct / 100;

  for (let day = 1; day <= scenario.horizon_days; day += 1) {
    const demand = site.demand_kwh_day * demandMultiplier;
    let remainingDemand = demand;
    let generated = 0;
    const remainingBySource = generation.map((source) => ({ ...source }));
    for (const source of remainingBySource) {
      const used = Math.min(remainingDemand, source.output);
      remainingDemand -= used;
      generated += used;
      source.output -= used;
      operatingCost += used * source.asset.variable_cost_per_kwh;
      emissionsKg += used * source.asset.emissions_kg_per_kwh;
    }

    let batteryDischarge = 0;
    for (const battery of batteries) {
      if (remainingDemand <= 0) break;
      const limit = battery.asset.capacity_kwh_day * battery.availablePct / 100;
      const delivered = Math.min(remainingDemand, limit, battery.stateKwh * battery.asset.discharge_efficiency_pct / 100);
      battery.stateKwh -= delivered / (battery.asset.discharge_efficiency_pct / 100);
      remainingDemand -= delivered;
      batteryDischarge += delivered;
    }

    let surplus = Math.max(0, remainingBySource.reduce((sum, source) => sum + source.output, 0));
    let batteryChargeInput = 0;
    for (const battery of batteries) {
      if (surplus <= 0) break;
      const efficiency = battery.asset.charge_efficiency_pct / 100;
      const roomInput = (battery.maxStateKwh - battery.stateKwh) / efficiency;
      const rateLimit = battery.asset.capacity_kwh_day * battery.availablePct / 100;
      const input = Math.min(surplus, roomInput, rateLimit);
      battery.stateKwh += input * efficiency;
      surplus -= input;
      batteryChargeInput += input;
      generated += input;
      let remainingCharge = input;
      for (const source of remainingBySource) {
        const allocated = Math.min(remainingCharge, source.output);
        operatingCost += allocated * source.asset.variable_cost_per_kwh;
        emissionsKg += allocated * source.asset.emissions_kg_per_kwh;
        source.output -= allocated;
        remainingCharge -= allocated;
        if (remainingCharge <= 0) break;
      }
    }

    const unserved = Math.max(0, remainingDemand);
    const served = demand - unserved;
    daily.push({
      day,
      demand_kwh: demand,
      generated_kwh: generated,
      battery_discharge_kwh: batteryDischarge,
      battery_charge_input_kwh: batteryChargeInput,
      served_kwh: served,
      unserved_kwh: unserved,
      storage_end_kwh: batteries.reduce((sum, battery) => sum + battery.stateKwh, 0),
      service_pct: demand === 0 ? 100 : served / demand * 100,
    });
  }

  const totalDemand = daily.reduce((sum, row) => sum + row.demand_kwh, 0);
  const totalServed = daily.reduce((sum, row) => sum + row.served_kwh, 0);
  const totalUnserved = daily.reduce((sum, row) => sum + row.unserved_kwh, 0);
  return {
    model_version: "daily-energy-balance-v1",
    horizon_days: scenario.horizon_days,
    total_demand_kwh: totalDemand,
    total_generated_kwh: daily.reduce((sum, row) => sum + row.generated_kwh, 0),
    total_served_kwh: totalServed,
    total_unserved_kwh: totalUnserved,
    service_pct: totalDemand === 0 ? 100 : totalServed / totalDemand * 100,
    critical_unserved_kwh: totalUnserved * site.critical_load_pct / 100,
    days_below_target: daily.filter((row) => row.service_pct < site.service_target_pct).length,
    operating_cost: operatingCost,
    emissions_kg: emissionsKg,
    peak_daily_unserved_kwh: Math.max(0, ...daily.map((row) => row.unserved_kwh)),
    daily,
    assumptions: [
      "Generation and demand are represented as daily energy totals; intra-day peaks and hourly dispatch are not modeled.",
      "Generation is dispatched in renewable-first order, followed by lower-variable-cost non-renewable sources.",
      "Battery energy starts at the entered state of charge; charge/discharge efficiency and daily power limits apply.",
      "Unserved energy is rationed proportionally across critical and non-critical demand when supply is insufficient.",
      "Scenario availability replaces the asset's baseline availability for every day in the scenario horizon.",
      "Fuel price changes, asset degradation, network losses, maintenance outages, and weather variability are excluded.",
    ],
  };
}
