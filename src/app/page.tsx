"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { simulateDispatch, type Asset, type AssetShock, type DispatchResult, type Site } from "@/lib/dispatch";

type Organization = { id: string; name: string; region: string; team_code: string };
type ScenarioRow = { id: string; site_id: string; name: string; horizon_days: number; demand_growth_pct: number; created_at: string };
type RunRow = { id: string; scenario_id: string; result: DispatchResult; created_at: string };
type Tab = "overview" | "sites" | "assets" | "scenarios";

const supabase = createClient();
const assetTypes: Asset["asset_type"][] = ["solar", "wind", "hydro", "diesel", "grid", "battery"];

function number(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function fmt(value: number, digits = 0) { return new Intl.NumberFormat("en", { maximumFractionDigits: digits }).format(value); }
function pct(value: number) { return `${value.toFixed(1)}%`; }

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSiteForm, setShowSiteForm] = useState(false);
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [showScenarioForm, setShowScenarioForm] = useState(false);
  const [scenarioResult, setScenarioResult] = useState<DispatchResult | null>(null);
  const [scenarioShocks, setScenarioShocks] = useState<Record<string, number>>({});
  const db = supabase?.schema("gridaccess");

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setUser(data.session?.user ?? null); setAuthReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    void loadOrganizations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!organization || !db) return;
    void loadWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization?.id]);

  async function loadOrganizations() {
    if (!db || !user) return;
    const { data, error } = await db.from("organization_members").select("organization_id, organizations(id,name,region,team_code)").eq("user_id", user.id);
    if (error) { setMessage(error.message); return; }
    const list = (data ?? []).flatMap((row) => Array.isArray(row.organizations) ? row.organizations : row.organizations ? [row.organizations] : []) as Organization[];
    setOrganizations(list);
    setOrganization((current) => list.find((item) => item.id === current?.id) ?? list[0] ?? null);
  }

  async function loadWorkspace() {
    if (!db || !organization) return;
    const [siteRes, assetRes, scenarioRes, runRes] = await Promise.all([
      db.from("sites").select("*").eq("organization_id", organization.id).order("created_at", { ascending: true }),
      db.from("energy_assets").select("*").eq("organization_id", organization.id).order("created_at", { ascending: true }),
      db.from("scenarios").select("*").eq("organization_id", organization.id).order("created_at", { ascending: false }),
      db.from("scenario_runs").select("*").eq("organization_id", organization.id).order("created_at", { ascending: false }).limit(20),
    ]);
    const firstError = siteRes.error ?? assetRes.error ?? scenarioRes.error ?? runRes.error;
    if (firstError) { setMessage(firstError.message); return; }
    const siteRows = (siteRes.data ?? []) as Site[];
    setSites(siteRows); setAssets((assetRes.data ?? []) as Asset[]); setScenarios((scenarioRes.data ?? []) as ScenarioRow[]); setRuns((runRes.data ?? []) as RunRow[]);
    setSelectedSiteId((current) => siteRows.some((site) => site.id === current) ? current : siteRows[0]?.id ?? "");
  }

  const selectedSite = sites.find((site) => site.id === selectedSiteId) ?? null;
  const siteAssets = assets.filter((asset) => asset.site_id === selectedSiteId);
  const preview = useMemo(() => selectedSite ? simulateDispatch(selectedSite, siteAssets, { horizon_days: 30, demand_growth_pct: 0 }, []) : null, [selectedSite, siteAssets]);
  const latestRun = runs[0]?.result;
  const chartRows = latestRun?.daily ?? preview?.daily ?? [];
  const chartMax = Math.max(1, ...chartRows.map((row) => row.demand_kwh));

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return;
    setBusy(true); setMessage("");
    const result = authMode === "signin"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/` } });
    setBusy(false);
    setMessage(result.error?.message ?? (authMode === "signup" ? "Check your email to confirm your account, then sign in." : "Signed in."));
    if (!result.error && authMode === "signin") setUser(result.data.user);
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!db) return;
    const form = new FormData(event.currentTarget); setBusy(true); setMessage("");
    const { data, error } = await db.rpc("create_organization", { p_name: String(form.get("name") ?? ""), p_region: String(form.get("region") ?? "") });
    setBusy(false); if (error) { setMessage(error.message); return; }
    setMessage("Workspace created. Save the team code to invite collaborators."); await loadOrganizations();
    if (data) { const { data: org } = await db.from("organizations").select("*").eq("id", data).single(); if (org) setOrganization(org as Organization); }
  }

  async function joinWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!db) return;
    const form = new FormData(event.currentTarget); setBusy(true);
    const { data, error } = await db.rpc("join_organization", { p_team_code: String(form.get("team_code") ?? "") });
    setBusy(false); setMessage(error?.message ?? "Joined workspace."); if (!error) await loadOrganizations();
    if (data) { const { data: org } = await db.from("organizations").select("*").eq("id", data).single(); if (org) setOrganization(org as Organization); }
  }

  async function addSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!db || !organization || !user) return;
    const form = new FormData(event.currentTarget);
    const payload = { organization_id: organization.id, created_by: user.id, name: String(form.get("name") ?? ""), region: String(form.get("region") ?? ""), population: number(form.get("population")), demand_kwh_day: number(form.get("demand")), critical_load_pct: number(form.get("critical"), 35), service_target_pct: number(form.get("target"), 95) };
    setBusy(true); const { error } = await db.from("sites").insert(payload); setBusy(false);
    if (error) setMessage(error.message); else { setMessage("Site added."); setShowSiteForm(false); await loadWorkspace(); }
  }

  async function addAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!db || !organization || !user || !selectedSite) return;
    const form = new FormData(event.currentTarget); const kind = String(form.get("type")) as Asset["asset_type"];
    const payload = { organization_id: organization.id, site_id: selectedSite.id, created_by: user.id, name: String(form.get("name") ?? ""), asset_type: kind, capacity_kwh_day: number(form.get("capacity")), availability_pct: number(form.get("availability"), 100), storage_kwh: kind === "battery" ? number(form.get("storage")) : 0, initial_soc_pct: kind === "battery" ? number(form.get("soc")) : 0, charge_efficiency_pct: kind === "battery" ? number(form.get("charge_efficiency"), 90) : 0, discharge_efficiency_pct: kind === "battery" ? number(form.get("discharge_efficiency"), 90) : 0, variable_cost_per_kwh: number(form.get("cost")), emissions_kg_per_kwh: number(form.get("emissions")) };
    setBusy(true); const { error } = await db.from("energy_assets").insert(payload); setBusy(false);
    if (error) setMessage(error.message); else { setMessage("Energy asset added."); setShowAssetForm(false); await loadWorkspace(); }
  }

  async function runScenario(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!db || !organization || !user || !selectedSite) return;
    const form = new FormData(event.currentTarget); const horizon = number(form.get("horizon"), 30); const growth = number(form.get("growth"));
    const shocks: AssetShock[] = Object.entries(scenarioShocks).filter(([, availability]) => availability < 100).map(([asset_id, availability_pct]) => ({ asset_id, availability_pct }));
    let result: DispatchResult;
    try { result = simulateDispatch(selectedSite, siteAssets, { horizon_days: horizon, demand_growth_pct: growth }, shocks); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Scenario inputs are invalid."); return; }
    const name = String(form.get("name") ?? "Resilience scenario"); setBusy(true);
    const { data: scenario, error: scenarioError } = await db.from("scenarios").insert({ organization_id: organization.id, site_id: selectedSite.id, created_by: user.id, name, horizon_days: horizon, demand_growth_pct: growth }).select("id").single();
    if (scenarioError || !scenario) { setBusy(false); setMessage(scenarioError?.message ?? "Could not create scenario."); return; }
    const disruptionRows = shocks.map((shock) => ({ organization_id: organization.id, site_id: selectedSite.id, scenario_id: scenario.id, asset_id: shock.asset_id, availability_pct: shock.availability_pct, created_by: user.id, note: "Scenario availability assumption" }));
    if (disruptionRows.length) {
      const { error } = await db.from("scenario_disruptions").insert(disruptionRows);
      if (error) { setBusy(false); setMessage(error.message); return; }
    }
    const { error: runError } = await db.from("scenario_runs").insert({ organization_id: organization.id, site_id: selectedSite.id, scenario_id: scenario.id, created_by: user.id, model_version: result.model_version, result, assumptions: result.assumptions });
    setBusy(false); if (runError) { setMessage(runError.message); return; }
    setScenarioResult(result); setShowScenarioForm(false); setScenarioShocks({}); setMessage("Scenario saved with a versioned model result."); await loadWorkspace();
  }

  async function deleteSite(siteId: string) {
    if (!db || !organization || !window.confirm("Delete this site and its assets and scenarios?")) return;
    const { error } = await db.from("sites").delete().eq("id", siteId).eq("organization_id", organization.id);
    setMessage(error?.message ?? "Site deleted."); if (!error) await loadWorkspace();
  }

  if (!authReady) return <main className="loading-screen"><div className="brand-mark">G</div><p>Preparing your planning workspace…</p></main>;
  if (!supabase) return <main className="auth-screen"><section className="auth-card"><Brand /><p className="eyebrow">COMMUNITY ENERGY PLANNING</p><h1>Make reliability visible.</h1><p className="muted">GridAccess turns site demand, generation, storage and outage assumptions into transparent resilience scenarios.</p><div className="setup-note"><strong>Workspace setup needed</strong><p>Add the Supabase project URL and publishable key in the deployment environment, then apply the GridAccess migration to enable secure team workspaces.</p></div></section></main>;
  if (!user) return <main className="auth-screen"><section className="auth-card"><Brand /><p className="eyebrow">COMMUNITY ENERGY PLANNING</p><h1>Plan for power that holds.</h1><p className="muted">Map local demand and energy assets. Test what outages and growth could mean for dependable service.</p><form className="form-stack" onSubmit={submitAuth}><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete={authMode === "signin" ? "current-password" : "new-password"} /></label><button className="button primary" disabled={busy}>{busy ? "Please wait…" : authMode === "signin" ? "Sign in" : "Create account"}</button></form><button className="text-button" onClick={() => setAuthMode(authMode === "signin" ? "signup" : "signin")}>{authMode === "signin" ? "New to GridAccess? Create an account" : "Already have an account? Sign in"}</button><p className="feedback">{message}</p><p className="fine-print">Planning support only. Results are scenario estimates, not engineering certification.</p></section></main>;

  const navItems: { id: Tab; title: string; icon: string }[] = [{ id: "overview", title: "Overview", icon: "◫" }, { id: "sites", title: "Sites", icon: "⌖" }, { id: "assets", title: "Energy assets", icon: "⌁" }, { id: "scenarios", title: "Scenarios", icon: "↗" }];
  return <main className="app-shell">
    <aside className="sidebar"><Brand /><div className="workspace-picker"><span className="eyebrow">WORKSPACE</span>{organization ? <select aria-label="Choose workspace" value={organization.id} onChange={(event) => setOrganization(organizations.find((item) => item.id === event.target.value) ?? null)}>{organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <span className="muted small">No workspace yet</span>}</div>
      <nav className="main-nav">{navItems.map((item) => <button key={item.id} className={tab === item.id ? "nav-item active" : "nav-item"} onClick={() => setTab(item.id)}><span>{item.icon}</span>{item.title}</button>)}</nav>
      <div className="sidebar-bottom"><div className="invite-code"><span className="eyebrow">TEAM INVITE CODE</span><strong>{organization?.team_code ?? "—"}</strong><span className="muted small">Share with teammates to collaborate.</span></div><span className="user-email">{user.email}</span><button className="nav-item" onClick={() => supabase.auth.signOut()}>↪ <span>Sign out</span></button></div>
    </aside>
    <section className="main-panel">
      <header className="topbar"><div><p className="eyebrow">GRIDACCESS / {organization?.name ?? "WORKSPACES"}</p><h1>{organization ? navItems.find((item) => item.id === tab)?.title : "Your planning workspace"}</h1></div><div className="top-actions">{organization && sites.length > 0 && <select value={selectedSiteId} onChange={(event) => setSelectedSiteId(event.target.value)} aria-label="Select community site">{sites.map((site) => <option value={site.id} key={site.id}>{site.name}</option>)}</select>}<button className="button quiet" onClick={() => { setMessage(""); void loadOrganizations(); if (organization) void loadWorkspace(); }}>Refresh</button></div></header>
      {message && <div className="toast" role="status">{message}<button aria-label="Dismiss message" onClick={() => setMessage("")}>×</button></div>}
      {!organization ? <section className="empty-workspace"><div className="section-kicker">A shared operating picture</div><h2>Start with your team’s first workspace.</h2><p>Keep site assumptions, energy assets and scenario runs together. Team access is protected by organization-level database policies.</p><div className="workspace-forms"><form className="panel form-stack" onSubmit={createWorkspace}><h3>Create a workspace</h3><label>Team or organization name<input name="name" required minLength={2} maxLength={100} placeholder="e.g. Coastal Energy Cooperative" /></label><label>Primary region<input name="region" maxLength={120} placeholder="District, state or region" /></label><button className="button primary" disabled={busy}>Create workspace</button></form><form className="panel form-stack" onSubmit={joinWorkspace}><h3>Join a workspace</h3><label>Team invite code<input name="team_code" required placeholder="10-character code" /></label><button className="button secondary" disabled={busy}>Join team</button></form></div></section> : <>
        {tab === "overview" && <>
          <section className="hero-band"><div><p className="eyebrow">ENERGY ACCESS / RESILIENCE PLANNING</p><h2>Understand the weak points <em>before</em> the lights go out.</h2><p>Model daily energy service, test supply disruptions and compare what changes when demand grows.</p></div><div className="hero-stamp"><span>PLANNING MODEL</span><strong>DAILY<br />BALANCE</strong><small>Transparent · Deterministic</small></div></section>
          {!sites.length ? <section className="empty-state"><span className="empty-icon">⌖</span><div><h3>Start with a community site</h3><p>Add population, daily electricity demand and the service target. Then build its energy mix.</p></div><button className="button primary" onClick={() => setShowSiteForm(true)}>Add first site <span>＋</span></button></section> : <>
            <div className="metric-grid"><Metric label="DAILY DEMAND" value={`${fmt(selectedSite?.demand_kwh_day ?? 0)} kWh`} note={`${fmt(selectedSite?.population ?? 0)} people in this site`} icon="↘" /><Metric label="BASELINE SERVICE" value={preview ? pct(preview.service_pct) : "—"} note={selectedSite ? `Target ${selectedSite.service_target_pct}% · daily model` : "Select a site"} icon="◌" accent={Boolean(preview && preview.service_pct >= (selectedSite?.service_target_pct ?? 95))} /><Metric label="ENERGY ASSETS" value={fmt(siteAssets.length)} note={`${fmt(siteAssets.filter((asset) => asset.asset_type === "battery").length)} storage systems`} icon="⌁" /><Metric label="SAVED SCENARIOS" value={fmt(scenarios.length)} note={runs.length ? `${fmt(runs.length)} versioned runs` : "Test an outage or demand change"} icon="▤" /></div>
            <div className="content-grid"><section className="panel chart-panel"><div className="panel-heading"><div><p className="eyebrow">SUPPLY VS DEMAND</p><h3>Daily energy balance</h3></div><span className="tag">{latestRun ? "LATEST SAVED RUN" : "BASELINE · 30 DAYS"}</span></div><div className="chart-legend"><span><i className="legend-demand" /> Demand</span><span><i className="legend-served" /> Served</span><span><i className="legend-gap" /> Unserved</span></div><div className="bar-chart" role="img" aria-label="Daily demand and served electricity chart">{chartRows.slice(0, 30).map((row) => <div className="bar-group" key={row.day} title={`Day ${row.day}: demand ${fmt(row.demand_kwh, 1)} kWh, served ${fmt(row.served_kwh, 1)} kWh`}><div className="bar-pair"><div className="bar demand-bar" style={{ height: `${Math.max(3, row.demand_kwh / chartMax * 100)}%` }} /><div className="bar served-bar" style={{ height: `${Math.max(3, row.served_kwh / chartMax * 100)}%` }} /></div><span>{row.day % 5 === 0 || row.day === 1 ? row.day : ""}</span></div>)}</div><div className="chart-footer"><span>Day of simulation</span><span>{fmt(preview?.total_demand_kwh ?? 0)} kWh modeled · 30-day baseline</span></div></section>
              <section className="panel insight-panel"><p className="eyebrow">RESILIENCE SNAPSHOT</p><h3>{preview && preview.days_below_target === 0 ? "Baseline meets the service target." : "Baseline has reliability gaps."}</h3><p className="muted">{preview ? `${fmt(preview.total_unserved_kwh, 1)} kWh of unmet energy across the 30-day baseline.` : "Add generation and storage assets to calculate service."}</p><div className="insight-rule" /><div className="insight-line"><span>Critical-load exposure</span><strong>{fmt(preview?.critical_unserved_kwh ?? 0, 1)} kWh</strong></div><div className="insight-line"><span>Operating cost</span><strong>{fmt(preview?.operating_cost ?? 0, 2)} units</strong></div><div className="insight-line"><span>Operational emissions</span><strong>{fmt(preview?.emissions_kg ?? 0, 1)} kg CO₂e</strong></div><button className="button secondary full-width" onClick={() => setTab("scenarios")}>Explore scenarios <span>↗</span></button></section></div>
            <div className="section-heading"><div><p className="eyebrow">PLANNING DATA</p><h3>Sites and system assets</h3></div><div className="action-row"><button className="button quiet" onClick={() => setShowAssetForm(true)} disabled={!selectedSite}>＋ Add asset</button><button className="button secondary" onClick={() => setShowSiteForm(true)}>＋ Add site</button></div></div>
            <div className="data-grid">{selectedSite && <article className="data-card"><div className="data-card-top"><span className="round-icon">⌖</span><span className="tag">COMMUNITY SITE</span></div><h4>{selectedSite.name}</h4><p>{selectedSite.region || "Region not specified"} · {fmt(selectedSite.population)} residents</p><div className="data-stats"><span><b>{fmt(selectedSite.demand_kwh_day)}</b> kWh / day</span><span><b>{selectedSite.critical_load_pct}%</b> critical load</span></div><button className="text-button danger" onClick={() => void deleteSite(selectedSite.id)}>Delete site</button></article>}{siteAssets.slice(0, 2).map((asset) => <article className="data-card" key={asset.id}><div className="data-card-top"><span className="round-icon">{asset.asset_type === "battery" ? "▰" : "ϟ"}</span><span className="tag">{asset.asset_type.toUpperCase()}</span></div><h4>{asset.name}</h4><p>{fmt(asset.capacity_kwh_day)} kWh/day available before derating</p><div className="data-stats"><span><b>{asset.availability_pct}%</b> availability</span>{asset.asset_type === "battery" && <span><b>{fmt(asset.storage_kwh)}</b> kWh storage</span>}</div></article>)}{!siteAssets.length && <div className="data-card add-card" onClick={() => setShowAssetForm(true)}><span>＋</span><h4>Add first energy asset</h4><p>Record generation, backup supply or storage capacity.</p></div>}</div>
          </>}
        </>}
        {tab === "sites" && <section className="section-view"><div className="section-heading"><div><p className="eyebrow">PLANNING INPUTS</p><h2>Community sites</h2><p>Define demand and service priorities for each place.</p></div><button className="button primary" onClick={() => setShowSiteForm(true)}>＋ Add site</button></div><div className="data-grid">{sites.map((site) => <article className="data-card" key={site.id}><div className="data-card-top"><span className="round-icon">⌖</span><span className="tag">{site.service_target_pct}% SERVICE TARGET</span></div><h4>{site.name}</h4><p>{site.region || "Region not specified"} · {fmt(site.population)} residents</p><div className="data-stats"><span><b>{fmt(site.demand_kwh_day)}</b> kWh / day</span><span><b>{site.critical_load_pct}%</b> critical load</span></div><button className="button quiet" onClick={() => { setSelectedSiteId(site.id); setTab("overview"); }}>Open site</button></article>)}{!sites.length && <EmptyCard title="No sites yet" text="Add your first site to begin a reliable energy access plan." onClick={() => setShowSiteForm(true)} />}</div></section>}
        {tab === "assets" && <section className="section-view"><div className="section-heading"><div><p className="eyebrow">SUPPLY MIX</p><h2>Energy assets</h2><p>Track generation, backup and storage assumptions by site.</p></div><button className="button primary" onClick={() => setShowAssetForm(true)} disabled={!selectedSite}>＋ Add asset</button></div>{sites.length > 0 && <label className="site-select-label">SITE<select value={selectedSiteId} onChange={(event) => setSelectedSiteId(event.target.value)}>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>}<div className="data-grid">{siteAssets.map((asset) => <article className="data-card" key={asset.id}><div className="data-card-top"><span className="round-icon">{asset.asset_type === "battery" ? "▰" : "ϟ"}</span><span className="tag">{asset.asset_type.toUpperCase()}</span></div><h4>{asset.name}</h4><p>{fmt(asset.capacity_kwh_day)} kWh/day capacity · {asset.availability_pct}% available</p><div className="data-stats"><span><b>{fmt(asset.variable_cost_per_kwh, 3)}</b> cost / kWh</span><span><b>{fmt(asset.emissions_kg_per_kwh, 2)}</b> kg CO₂e / kWh</span></div>{asset.asset_type === "battery" && <p className="small muted">{fmt(asset.storage_kwh)} kWh storage · {asset.initial_soc_pct}% starting charge</p>}</article>)}{!siteAssets.length && <EmptyCard title="No assets at this site" text="Add generation, backup or battery storage to calculate reliability." onClick={() => setShowAssetForm(true)} />}</div></section>}
        {tab === "scenarios" && <section className="section-view"><div className="section-heading"><div><p className="eyebrow">STRESS TESTS</p><h2>Resilience scenarios</h2><p>Test asset outages and demand change over a selectable planning horizon.</p></div><button className="button primary" onClick={() => setShowScenarioForm(true)} disabled={!selectedSite || !siteAssets.length}>＋ New scenario</button></div>{scenarioResult && <div className="result-banner"><div><p className="eyebrow">LATEST RUN RESULT · {scenarioResult.model_version}</p><strong>{pct(scenarioResult.service_pct)} service</strong><span>{fmt(scenarioResult.total_unserved_kwh, 1)} kWh unserved · {scenarioResult.days_below_target} days below site target</span></div><button className="text-button" onClick={() => setScenarioResult(null)}>Dismiss</button></div>}<div className="scenario-list">{scenarios.map((scenario) => { const run = runs.find((item) => item.scenario_id === scenario.id); return <article className="scenario-row" key={scenario.id}><div className="scenario-icon">↗</div><div className="scenario-main"><h3>{scenario.name}</h3><p>{sites.find((site) => site.id === scenario.site_id)?.name ?? "Site"} · {scenario.horizon_days} days · {scenario.demand_growth_pct > 0 ? "+" : ""}{scenario.demand_growth_pct}% demand</p></div><div className="scenario-result">{run ? <><strong>{pct(run.result.service_pct)}</strong><span>{fmt(run.result.total_unserved_kwh, 1)} kWh unserved</span></> : <span className="muted">Run not saved</span>}</div></article>; })}{!scenarios.length && <div className="empty-state compact"><div><h3>No scenarios run yet</h3><p>Test the impact of a generator outage, reduced solar availability or rising demand.</p></div><button className="button primary" onClick={() => setShowScenarioForm(true)} disabled={!selectedSite || !siteAssets.length}>Create scenario</button></div>}</div><div className="model-note"><strong>Model boundary</strong><p>Daily energy-balance estimates only. No hourly demand peaks, weather distributions, network losses or probabilistic outage modeling. Use results for comparison and planning discussion, not engineering certification.</p></div></section>}
      </>}</section>

    {(showSiteForm || showAssetForm || showScenarioForm) && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setShowSiteForm(false); setShowAssetForm(false); setShowScenarioForm(false); } }}><section className="modal" role="dialog" aria-modal="true"><div className="modal-heading"><div><p className="eyebrow">{showSiteForm ? "COMMUNITY PROFILE" : showAssetForm ? "ENERGY SYSTEM" : "SCENARIO BUILDER"}</p><h2>{showSiteForm ? "Add a site" : showAssetForm ? "Add energy asset" : "Stress-test the system"}</h2></div><button className="close-button" aria-label="Close" onClick={() => { setShowSiteForm(false); setShowAssetForm(false); setShowScenarioForm(false); }}>×</button></div>
      {showSiteForm && <form className="form-stack" onSubmit={addSite}><label>Site name<input name="name" required maxLength={140} placeholder="e.g. Ikot Abasi community" /></label><label>Region<input name="region" maxLength={120} placeholder="Local government / district" /></label><div className="form-grid"><label>Population<input name="population" type="number" min="0" step="1" defaultValue="0" required /></label><label>Daily demand (kWh)<input name="demand" type="number" min="0" step="0.1" defaultValue="1000" required /></label><label>Critical load (%)<input name="critical" type="number" min="0" max="100" step="1" defaultValue="35" required /></label><label>Service target (%)<input name="target" type="number" min="0" max="100" step="1" defaultValue="95" required /></label></div><button className="button primary" disabled={busy}>Save community site</button></form>}
      {showAssetForm && <form className="form-stack" onSubmit={addAsset}><label>Asset name<input name="name" required maxLength={140} placeholder="e.g. Market solar array" /></label><div className="form-grid"><label>Technology<select name="type">{assetTypes.map((type) => <option value={type} key={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}</select></label><label>Daily output / power limit (kWh)<input name="capacity" type="number" min="0" step="0.1" defaultValue="300" required /></label><label>Availability (%)<input name="availability" type="number" min="0" max="100" step="1" defaultValue="95" required /></label><label>Variable cost per kWh<input name="cost" type="number" min="0" step="0.001" defaultValue="0.05" required /></label><label>Emissions kg per kWh<input name="emissions" type="number" min="0" step="0.001" defaultValue="0.05" required /></label></div><details><summary>Battery storage assumptions (used when technology is Battery)</summary><div className="form-grid details-grid"><label>Storage (kWh)<input name="storage" type="number" min="0" step="0.1" defaultValue="100" /></label><label>Starting charge (%)<input name="soc" type="number" min="0" max="100" defaultValue="70" /></label><label>Charge efficiency (%)<input name="charge_efficiency" type="number" min="0.1" max="100" defaultValue="90" /></label><label>Discharge efficiency (%)<input name="discharge_efficiency" type="number" min="0.1" max="100" defaultValue="90" /></label></div></details><button className="button primary" disabled={busy}>Save energy asset</button></form>}
      {showScenarioForm && <form className="form-stack" onSubmit={runScenario}><label>Scenario name<input name="name" required maxLength={140} defaultValue="Supply disruption test" /></label><div className="form-grid"><label>Horizon (days)<input name="horizon" type="number" min="1" max="365" defaultValue="30" required /></label><label>Demand growth (%)<input name="growth" type="number" min="-100" max="1000" step="1" defaultValue="0" required /></label></div><div className="shock-list"><p className="eyebrow">ASSET AVAILABILITY UNDER SCENARIO</p><p className="small muted">100% keeps baseline availability. Set an asset lower to model an outage or disruption.</p>{siteAssets.map((asset) => <label className="shock-input" key={asset.id}><span>{asset.name}<small>{asset.asset_type} · baseline {asset.availability_pct}%</small></span><span className="range-value">{scenarioShocks[asset.id] ?? 100}%</span><input aria-label={`${asset.name} availability`} type="range" min="0" max="100" step="5" value={scenarioShocks[asset.id] ?? 100} onChange={(event) => setScenarioShocks((current) => ({ ...current, [asset.id]: Number(event.target.value) }))} /></label>)}</div><button className="button primary" disabled={busy}>{busy ? "Calculating…" : "Run and save scenario"}</button></form>}
    </section></div>}
  </main>;
}

function Brand() { return <Link className="brand" href="/" aria-label="GridAccess home"><span className="brand-mark">G</span><span><strong>gridaccess</strong><small>Energy resilience planner</small></span></Link>; }
function Metric({ label, value, note, icon, accent = false }: { label: string; value: string; note: string; icon: string; accent?: boolean }) { return <article className="metric-card"><div className="metric-top"><span className="eyebrow">{label}</span><span className={accent ? "metric-icon green" : "metric-icon"}>{icon}</span></div><strong className={accent ? "metric-value green-text" : "metric-value"}>{value}</strong><span className="muted small">{note}</span></article>; }
function EmptyCard({ title, text, onClick }: { title: string; text: string; onClick: () => void }) { return <button className="data-card add-card" onClick={onClick}><span>＋</span><h4>{title}</h4><p>{text}</p></button>; }
