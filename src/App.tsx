import { useEffect, useMemo, useRef, useState } from "react";
import { userLabel } from "./lib/api";
import { DEFAULT_TRIP_BREAK_MIN, TIMEZONES } from "./lib/config";
import { formatHours, formatIdr, formatInt, formatKm, formatKmPerL, formatLiters, formatMeters, formatPct, formatRpm, formatSpeed, odoGpsDelta } from "./lib/format";
import { describeFuelSource, movingSharePct } from "./lib/metrics";
import { buildInsights, type InsightBlock, type InsightDepth } from "./lib/insight";
import { fetchAnalyzeStatus, requestAiInsights, type InsightSource } from "./lib/aiInsights";
import { buildTrackMap } from "./lib/trackMap";
import type { Period } from "./lib/types";
import { BehaviorDoughnut } from "./components/BehaviorDoughnut";
import { BehaviorTrend } from "./components/BehaviorTrend";
import { ComparisonPanel } from "./components/ComparisonPanel";
import { DistanceChart } from "./components/DistanceChart";
import { ElevationChart } from "./components/ElevationChart";
import { FuelChart } from "./components/FuelChart";
import { InsightsPanel } from "./components/InsightsPanel";
import { RoadChart } from "./components/RoadChart";
import { SpeedRpmChart } from "./components/SpeedRpmChart";
import { TrackMap } from "./components/TrackMap";
import { UtilizationChart } from "./components/UtilizationChart";
import { BrandMark } from "./components/BrandMark";
import { ViewNav } from "./components/ViewNav";
import { exportMetricsPdf } from "./lib/exportPdf";
import { describeLoadProgress } from "./lib/dayTracks";
import { useVehicleDashboard } from "./lib/useVehicleDashboard";

export default function App() {
  const {
    compact,
    hostLock,
    groups,
    users,
    groupId,
    setGroupId,
    userId,
    setUserId,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    timezone,
    setTimezone,
    period,
    setPeriod,
    minSpeed,
    setMinSpeed,
    tripBreakMin,
    setTripBreakMin,
    fuelPrice,
    setFuelPrice,
    refillThreshold,
    setRefillThreshold,
    harshBrake,
    setHarshBrake,
    harshAccel,
    setHarshAccel,
    harshCorner,
    setHarshCorner,
    speedLimit,
    setSpeedLimit,
    trips,
    setTrips,
    loading,
    bootError,
    loadError,
    loadWarning,
    progress,
    progressPct,
    selectedGroup,
    selectedUser,
    rows,
    totals,
    behavior,
    insightInput,
    handleLoad,
  } = useVehicleDashboard();

  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [insightDepth, setInsightDepth] = useState<InsightDepth>("standard");
  const [insightSource, setInsightSource] = useState<InsightSource>("template");
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiBlocks, setAiBlocks] = useState<InsightBlock[] | null>(null);
  const [aiError, setAiError] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const aiReqRef = useRef(0);

  const templateInsights = useMemo(() => {
    if (!insightInput) return [];
    return buildInsights(insightInput, insightDepth);
  }, [insightInput, insightDepth]);

  const displayedInsights =
    insightSource === "ai" && aiBlocks && aiBlocks.length > 0 ? aiBlocks : templateInsights;

  const mapData = useMemo(() => {
    if (!trips) return null;
    return buildTrackMap(trips, { dateFrom, dateTo, timezone });
  }, [trips, dateFrom, dateTo, timezone]);

  useEffect(() => {
    const ac = new AbortController();
    fetchAnalyzeStatus(ac.signal)
      .then(setAiConfigured)
      .catch(() => setAiConfigured(false));
    return () => ac.abort();
  }, []);

  useEffect(() => {
    aiReqRef.current += 1;
    setAiBlocks(null);
    setAiError("");
  }, [insightInput, insightDepth]);

  async function generateAiInsights() {
    if (!insightInput) return;
    const reqId = ++aiReqRef.current;
    setAiLoading(true);
    setAiError("");
    try {
      const blocks = await requestAiInsights(insightInput, insightDepth);
      if (reqId !== aiReqRef.current) return;
      setAiBlocks(blocks);
      setInsightSource("ai");
    } catch (err) {
      if (reqId !== aiReqRef.current) return;
      setAiError(err instanceof Error ? err.message : "AI analysis failed");
    } finally {
      if (reqId === aiReqRef.current) setAiLoading(false);
    }
  }

  const fallbackA = rows.length >= 2 ? rows[rows.length - 2].key : (rows[0]?.key ?? "");
  const fallbackB = rows[rows.length - 1]?.key ?? "";
  const baselineKey = rows.some((row) => row.key === compareA) ? compareA : fallbackA;
  const compareKey = rows.some((row) => row.key === compareB) ? compareB : fallbackB;

  function handleExport() {
    if (rows.length === 0) return;
    exportMetricsPdf({
      vehicle: selectedUser ? userLabel(selectedUser) : "Vehicle",
      group: selectedGroup?.name ?? "Group",
      dateFrom,
      dateTo,
      timezone,
      period,
      rows,
      behavior,
      insights: displayedInsights,
    });
  }

  return (
    <div className={compact ? "app embed" : "app"}>
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>Vehicle Metrics</h1>
            <p>Distance, utilization &amp; fuel · Armada embed</p>
          </div>
        </div>
        <div className="topbar-actions">
          <ViewNav current="full" />
          <button className="btn-ghost" type="button" onClick={handleExport} disabled={rows.length === 0}>
            Export PDF
          </button>
          <div className="vehicle-chip">
            {selectedUser ? userLabel(selectedUser) : "No vehicle selected"}
            {selectedGroup ? ` · ${selectedGroup.name}` : ""}
          </div>
        </div>
      </header>

      <main className="shell">
        <section className={compact ? "filters compact" : "filters"}>
          <div className="field">
            <label htmlFor="group">Group</label>
            <select
              id="group"
              value={groupId}
              disabled={hostLock.group}
              onChange={(e) => {
                setGroupId(e.target.value);
                setUserId("");
                setTrips(null);
              }}
            >
              <option value="">
                {bootError ? "Groups unavailable" : groups.length ? "Select a group" : "Loading groups…"}
              </option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name} · {group.usersIds.length} vehicles
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="user">Vehicle</label>
            <select
              id="user"
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                setTrips(null);
              }}
              disabled={!selectedGroup || hostLock.user}
            >
              <option value="">{selectedGroup ? "Select a vehicle" : "Choose a group first"}</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {userLabel(user)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="from">From</label>
            <input
              id="from"
              type="date"
              value={dateFrom}
              disabled={hostLock.from}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="to">To</label>
            <input
              id="to"
              type="date"
              value={dateTo}
              disabled={hostLock.to}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="tz">Timezone</label>
            <select
              id="tz"
              value={timezone}
              disabled={hostLock.tz}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </div>
          {!(compact && userId) && (
            <button className="btn btn-primary" type="button" onClick={() => void handleLoad()} disabled={!userId || loading}>
              {loading ? "Loading…" : "Load metrics"}
            </button>
          )}
          <div className="field" style={{ gridColumn: compact ? "1 / -1" : "1 / span 2" }}>
            <label>Period</label>
            <div className="period-switch" role="tablist" aria-label="Period">
              {(["daily", "weekly", "monthly"] as Period[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={period === item ? "active" : ""}
                  onClick={() => setPeriod(item)}
                >
                  {item[0].toUpperCase() + item.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="field filters-extra">
            <label htmlFor="minspeed">Min moving speed (km/h)</label>
            <input
              id="minspeed"
              type="number"
              min={0}
              step={0.1}
              value={minSpeed}
              onChange={(e) => setMinSpeed(Number(e.target.value) || 0)}
            />
          </div>
          <div className="field filters-extra">
            <label htmlFor="tripbreak">Trip break (min)</label>
            <input
              id="tripbreak"
              type="number"
              min={1}
              step={1}
              value={tripBreakMin}
              onChange={(e) => setTripBreakMin(Math.max(1, Number(e.target.value) || DEFAULT_TRIP_BREAK_MIN))}
            />
          </div>
          <div className="field filters-extra">
            <label htmlFor="fuelprice">Fuel price (IDR / L)</label>
            <input
              id="fuelprice"
              type="number"
              min={0}
              step={100}
              value={fuelPrice}
              onChange={(e) => setFuelPrice(Number(e.target.value) || 0)}
            />
          </div>
          <div className="field filters-extra">
            <label htmlFor="refill">Refill threshold (L)</label>
            <input
              id="refill"
              type="number"
              min={0}
              step={0.1}
              value={refillThreshold}
              onChange={(e) => setRefillThreshold(Number(e.target.value) || 0)}
            />
          </div>
        </section>

        {bootError && <div className="banner error">{bootError}</div>}
        {loadError && !loading && <div className="banner error">{loadError}</div>}
        {loadWarning && !loading && !loadError && <div className="banner warn">{loadWarning}</div>}
        {loading && progress && (
          <div className="banner progress">
            <span>
              {describeLoadProgress(progress)}
            </span>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}

        <section className="kpis">
          <article className="kpi" style={{ ["--tick" as string]: "var(--gps)" }}>
            <div className="label">GPS distance</div>
            <div className="value">{trips ? formatKm(totals.gps) : "—"}</div>
            <div className="unit">km · all points</div>
          </article>
          <article className="kpi" style={{ ["--tick" as string]: "var(--ign)" }}>
            <div className="label">Ignition distance</div>
            <div className="value">{trips ? formatKm(totals.ignition) : "—"}</div>
            <div className="unit">km · engine on</div>
          </article>
          <article className="kpi" style={{ ["--tick" as string]: "var(--odo)" }}>
            <div className="label">Odometer</div>
            <div className="value">{trips ? formatKm(totals.odometer) : "—"}</div>
            <div className="unit">
              km · {trips ? `vs GPS ${odoGpsDelta(totals.odometer, totals.ignition)}` : "CAN"}
            </div>
          </article>
          <article className="kpi" style={{ ["--tick" as string]: "var(--hrs)" }}>
            <div className="label">Active time</div>
            <div className="value">{trips ? formatHours(totals.hours) : "—"}</div>
            <div className="unit">hours moving</div>
          </article>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Distance &amp; active time</h2>
              <p>
                GPS (all points and ignition-on) against odometer, with moving hours on the right axis.
                Trips are driving sessions: they start when the vehicle is moving, end on ignition off,
                a stop or GPS gap longer than the trip-break time, and merge across Armada recordings
                when those do not apply.
              </p>
            </div>
            <div className="legend">
              <span>
                <i className="swatch" style={{ background: "var(--gps)" }} /> GPS all
              </span>
              <span>
                <i className="swatch" style={{ background: "var(--ign)" }} /> Ignition
              </span>
              <span>
                <i className="swatch" style={{ background: "var(--odo)" }} /> Odometer
              </span>
              <span>
                <i className="swatch line" style={{ background: "var(--hrs)" }} /> Hours
              </span>
            </div>
          </div>

          {!trips || rows.length === 0 ? (
            <div className="empty">
              <div>
                <div className="route-glyph" aria-hidden="true">
                  <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                    <path
                      d="M5 19c4-9 6.5-13 8-13s4 4 8 13"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                    <circle cx="13" cy="19" r="2" fill="currentColor" />
                  </svg>
                </div>
                <h3>{trips ? "No points in this range" : "Load a vehicle to see activity"}</h3>
                <p>
                  Choose a group and vehicle, set the date range in the vehicle’s timezone, then load
                  metrics. Period grouping updates instantly after data is in.
                </p>
              </div>
            </div>
          ) : (
            <DistanceChart rows={rows} />
          )}
        </section>

        {rows.length > 0 && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Speed &amp; RPM</h2>
                <p>
                  Averages skip zeros so parked and engine-off points do not pull the mean down. Max is
                  the highest reading in the period. Speed is GPS m/s × 3.6; RPM is CAN engine speed.
                </p>
              </div>
              <div className="legend">
                <span>
                  <i className="swatch line" style={{ background: "var(--gps)" }} /> Avg speed
                </span>
                <span>
                  <i className="swatch dash" style={{ borderColor: "var(--gps)" }} /> Max speed
                </span>
                <span>
                  <i className="swatch line" style={{ background: "var(--odo)" }} /> Avg RPM
                </span>
                <span>
                  <i className="swatch dash" style={{ borderColor: "var(--odo)" }} /> Max RPM
                </span>
              </div>
            </div>
            <div className="stat-strip four">
              <div className="mini-stat">
                <div className="l">Avg speed</div>
                <div className="v">
                  {totals.avgSpeed > 0 ? `${formatSpeed(totals.avgSpeed)} km/h` : "—"}
                </div>
              </div>
              <div className="mini-stat">
                <div className="l">Max speed</div>
                <div className="v">
                  {totals.maxSpeed > 0 ? `${formatSpeed(totals.maxSpeed)} km/h` : "—"}
                </div>
              </div>
              <div className="mini-stat">
                <div className="l">Avg RPM</div>
                <div className="v">{totals.avgRpm > 0 ? formatRpm(totals.avgRpm) : "—"}</div>
              </div>
              <div className="mini-stat">
                <div className="l">Max RPM</div>
                <div className="v">{totals.maxRpm > 0 ? formatRpm(totals.maxRpm) : "—"}</div>
              </div>
            </div>
            <SpeedRpmChart rows={rows} />
          </section>
        )}

        {rows.length > 0 && (
          <div className="panel-grid">
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Utilization</h2>
                  <p>
                    Engine-on time split into moving versus idle. Idle is ignition on and speed at or
                    below the minimum — not a fixed share of active hours.
                  </p>
                </div>
                <div className="legend">
                  <span>
                    <i className="swatch" style={{ background: "var(--gps)" }} /> Active
                  </span>
                  <span>
                    <i className="swatch" style={{ background: "#c47d3a" }} /> Idle
                  </span>
                </div>
              </div>
              <div className="stat-strip">
                <div className="mini-stat">
                  <div className="l">Active</div>
                  <div className="v">{formatHours(totals.hours)} h</div>
                </div>
                <div className="mini-stat">
                  <div className="l">Idle</div>
                  <div className="v">{formatHours(totals.idle)} h</div>
                </div>
                <div className="mini-stat">
                  <div className="l">Moving share</div>
                  <div className="v">{formatPct(movingSharePct(totals.hours, totals.idle))}</div>
                </div>
              </div>
              <UtilizationChart rows={rows} />
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Fuel</h2>
                  <p>
                    Cost and km/l prefer the CAN consumed counter when it increases; otherwise tank
                    identity (start + refills − end). CAN and tank are both shown so you can compare
                    sensors.
                  </p>
                </div>
                <div className="legend">
                  <span>
                    <i className="swatch" style={{ background: "var(--gps)" }} /> CAN
                  </span>
                  <span>
                    <i className="swatch" style={{ background: "var(--odo)" }} /> Tank
                  </span>
                  <span>
                    <i className="swatch" style={{ background: "var(--ign)" }} /> Refill
                  </span>
                </div>
              </div>
              <div className="stat-strip four">
                <div className="mini-stat">
                  <div className="l">Used for cost</div>
                  <div className="v">{formatLiters(totals.fuel)} L</div>
                  <div className="hint">{trips ? describeFuelSource(rows) : ""}</div>
                </div>
                <div className="mini-stat">
                  <div className="l">CAN used</div>
                  <div className="v">
                    {totals.canFuel > 0 ? `${formatLiters(totals.canFuel)} L` : "—"}
                  </div>
                </div>
                <div className="mini-stat">
                  <div className="l">Tank used</div>
                  <div className="v">
                    {totals.tankFuel > 0 ? `${formatLiters(totals.tankFuel)} L` : "—"}
                  </div>
                  <div className="hint">start + refill − end</div>
                </div>
                <div className="mini-stat">
                  <div className="l">Refill</div>
                  <div className="v">{formatLiters(totals.refill)} L</div>
                </div>
              </div>
              <div className="stat-strip two">
                <div className="mini-stat">
                  <div className="l">Cost</div>
                  <div className="v">{formatIdr(totals.cost)}</div>
                </div>
                <div className="mini-stat">
                  <div className="l">Efficiency</div>
                  <div className="v">
                    {totals.fuel > 0 ? `${formatKmPerL(totals.gps / totals.fuel)} km/l` : "—"}
                  </div>
                </div>
              </div>
              <FuelChart rows={rows} />
            </section>
          </div>
        )}

        {rows.length > 0 && totals.altitudeSamples > 0 && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Terrain</h2>
                <p>
                  Gain and loss ignore GPS dither under 5 m and rebase on altitude spikes. Terrain
                  impact is 0.1% extra fuel per metre of gain, per kilometre driven. Hills cost fuel,
                  so flat-terrain km/l is higher than actual.
                </p>
              </div>
              <div className="legend">
                <span>
                  <i className="swatch" style={{ background: "var(--odo)" }} /> Gain
                </span>
                <span>
                  <i className="swatch" style={{ background: "var(--gps)" }} /> Loss
                </span>
              </div>
            </div>
            <div className="stat-strip four">
              <div className="mini-stat">
                <div className="l">Elevation gain</div>
                <div className="v">{formatMeters(totals.elevationGainM)}</div>
                <div className="hint">
                  {totals.altitudeMinM !== null && totals.altitudeMaxM !== null
                    ? `${Math.round(totals.altitudeMinM)}–${Math.round(totals.altitudeMaxM)} m range`
                    : ""}
                </div>
              </div>
              <div className="mini-stat">
                <div className="l">Elevation loss</div>
                <div className="v">{formatMeters(totals.elevationLossM)}</div>
              </div>
              <div className="mini-stat">
                <div className="l">Terrain impact</div>
                <div className="v">
                  {totals.terrainImpactPct > 0 ? `~${formatPct(totals.terrainImpactPct)}` : "—"}
                </div>
                <div className="hint">extra fuel vs flat</div>
              </div>
              <div className="mini-stat">
                <div className="l">Flat-terrain km/l</div>
                <div className="v">
                  {totals.flatKmPerL > 0 ? `${formatKmPerL(totals.flatKmPerL)} km/l` : "—"}
                </div>
              </div>
            </div>
            <ElevationChart rows={rows} />
          </section>
        )}

        {rows.length > 0 && totals.roadSamples > 0 && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Road condition</h2>
                <p>
                  Accelerometer magnitude sqrt(X²+Y²+Z²) in mG. Smooth is 150 mG or below, rough
                  through 300 mG, bumpy above that — same buckets as V8. Hidden when the device
                  has no axisX/Y/Z.
                </p>
              </div>
              <div className="legend">
                <span>
                  <i className="swatch" style={{ background: "var(--gps)" }} /> Smooth
                </span>
                <span>
                  <i className="swatch" style={{ background: "#c47d3a" }} /> Rough
                </span>
                <span>
                  <i className="swatch" style={{ background: "var(--danger)" }} /> Bumpy
                </span>
              </div>
            </div>
            <div className="stat-strip four">
              <div className="mini-stat">
                <div className="l">Smooth</div>
                <div className="v">{formatPct(totals.roadSmoothPct)}</div>
              </div>
              <div className="mini-stat">
                <div className="l">Rough</div>
                <div className="v">{formatPct(totals.roadRoughPct)}</div>
              </div>
              <div className="mini-stat">
                <div className="l">Bumpy</div>
                <div className="v">{formatPct(totals.roadBumpyPct)}</div>
              </div>
              <div className="mini-stat">
                <div className="l">Avg vibration</div>
                <div className="v">{Math.round(totals.avgVibrationMg)} mG</div>
                <div className="hint">max {Math.round(totals.maxVibrationMg)} mG</div>
              </div>
            </div>
            <RoadChart rows={rows} />
          </section>
        )}

        {mapData && mapData.pointCount > 0 && <TrackMap data={mapData} />}

        {rows.length > 0 && (
          <InsightsPanel
            blocks={displayedInsights}
            source={insightSource}
            onSource={setInsightSource}
            depth={insightDepth}
            onDepth={setInsightDepth}
            aiConfigured={aiConfigured}
            aiLoading={aiLoading}
            aiError={aiError}
            aiHasResult={Boolean(aiBlocks && aiBlocks.length > 0)}
            onGenerate={() => void generateAiInsights()}
          />
        )}

        {behavior && rows.length > 0 && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Driving behavior</h2>
                <p>
                  Events are counted on the rising edge, so a stretch of overspeed is one incident, not
                  one tick per GPS point. Safety score is 100 at 0 events/100 km, 50 at 10, and 0 at 20+.
                </p>
              </div>
            </div>
            <div className="threshold-row">
              <div className="field">
                <label htmlFor="brake">Harsh brake (m/s²)</label>
                <input
                  id="brake"
                  type="number"
                  min={0}
                  step={0.1}
                  value={harshBrake}
                  onChange={(e) => setHarshBrake(Number(e.target.value) || 0)}
                />
              </div>
              <div className="field">
                <label htmlFor="accel">Harsh accel (m/s²)</label>
                <input
                  id="accel"
                  type="number"
                  min={0}
                  step={0.1}
                  value={harshAccel}
                  onChange={(e) => setHarshAccel(Number(e.target.value) || 0)}
                />
              </div>
              <div className="field">
                <label htmlFor="corner">Harsh corner (rad/s²)</label>
                <input
                  id="corner"
                  type="number"
                  min={0}
                  step={0.01}
                  value={harshCorner}
                  onChange={(e) => setHarshCorner(Number(e.target.value) || 0)}
                />
              </div>
              <div className="field">
                <label htmlFor="splimit">Speed limit (km/h)</label>
                <input
                  id="splimit"
                  type="number"
                  min={0}
                  step={1}
                  value={speedLimit}
                  onChange={(e) => setSpeedLimit(Number(e.target.value) || 0)}
                />
              </div>
            </div>
            <div className="stat-strip four">
              <div className="mini-stat">
                <div className="l">Braking</div>
                <div className="v">{behavior.harshBraking}</div>
              </div>
              <div className="mini-stat">
                <div className="l">Acceleration</div>
                <div className="v">{behavior.harshAcceleration}</div>
              </div>
              <div className="mini-stat">
                <div className="l">Cornering</div>
                <div className="v">{behavior.harshCornering}</div>
              </div>
              <div className="mini-stat">
                <div className="l">Overspeed</div>
                <div className="v">{behavior.overspeed}</div>
              </div>
            </div>
            <div className="stat-strip">
              <div className="mini-stat">
                <div className="l">Events / 100 km</div>
                <div className="v">{behavior.eventsPer100km.toFixed(2)}</div>
              </div>
              <div className="mini-stat">
                <div className="l">Safety score</div>
                <div className="v">{behavior.safetyScore.toFixed(0)} / 100</div>
              </div>
              <div className="mini-stat">
                <div className="l">Most frequent</div>
                <div className="v">{behavior.topIssue ?? "None"}</div>
              </div>
            </div>
            <div className="panel-grid">
              <div>
                <h3 className="subhead">Distribution</h3>
                <BehaviorDoughnut summary={behavior} />
              </div>
              <div>
                <h3 className="subhead">Events over time</h3>
                <BehaviorTrend rows={behavior.rows} />
              </div>
            </div>
          </section>
        )}

        {rows.length > 0 && (
          <ComparisonPanel
            rows={rows}
            baselineKey={baselineKey}
            compareKey={compareKey}
            onBaseline={setCompareA}
            onCompare={setCompareB}
          />
        )}

        {rows.length > 0 && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Period detail</h2>
                <p>
                    Distance, engine time, speed, RPM, fuel, and elevation for each period. Trip count
                    is sessions that started in the period.
                </p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="metrics">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th className="num">Trips</th>
                    <th className="num">GPS all (km)</th>
                    <th className="num">Ignition (km)</th>
                    <th className="num">Odometer (km)</th>
                    <th className="num">vs GPS</th>
                    <th className="num">Active (h)</th>
                    <th className="num">Idle (h)</th>
                    <th className="num">Avg km/h</th>
                    <th className="num">Max km/h</th>
                    <th className="num">Avg RPM</th>
                    <th className="num">Max RPM</th>
                    <th className="num">Fuel (L)</th>
                    <th className="num">CAN (L)</th>
                    <th className="num">Tank (L)</th>
                    <th className="num">Refill (L)</th>
                    <th className="num">km/l</th>
                    <th className="num">Gain (m)</th>
                    <th className="num">Loss (m)</th>
                    <th className="num">Flat km/l</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td className="num">{row.tripCount}</td>
                      <td className="num">{formatKm(row.gpsDistanceKm)}</td>
                      <td className="num">{formatKm(row.ignitionDistanceKm)}</td>
                      <td className="num">{formatKm(row.odometerKm)}</td>
                      <td className="num">{odoGpsDelta(row.odometerKm, row.ignitionDistanceKm)}</td>
                      <td className="num">{formatHours(row.activeHours)}</td>
                      <td className="num">{formatHours(row.idleHours)}</td>
                      <td className="num">{row.avgSpeedKmh > 0 ? formatSpeed(row.avgSpeedKmh) : "—"}</td>
                      <td className="num">{row.maxSpeedKmh > 0 ? formatSpeed(row.maxSpeedKmh) : "—"}</td>
                      <td className="num">{row.avgRpm > 0 ? formatRpm(row.avgRpm) : "—"}</td>
                      <td className="num">{row.maxRpm > 0 ? formatRpm(row.maxRpm) : "—"}</td>
                      <td className="num">{formatLiters(row.fuelUsedL)}</td>
                      <td className="num">
                        {row.canFuelUsedL > 0 ? formatLiters(row.canFuelUsedL) : "—"}
                      </td>
                      <td className="num">
                        {row.tankFuelUsedL > 0 ? formatLiters(row.tankFuelUsedL) : "—"}
                      </td>
                      <td className="num">{formatLiters(row.refillL)}</td>
                      <td className="num">{row.kmPerL > 0 ? formatKmPerL(row.kmPerL) : "—"}</td>
                      <td className="num">
                        {row.altitudeSamples > 0 ? Math.round(row.elevationGainM) : "—"}
                      </td>
                      <td className="num">
                        {row.altitudeSamples > 0 ? Math.round(row.elevationLossM) : "—"}
                      </td>
                      <td className="num">
                        {row.flatKmPerL > 0 ? formatKmPerL(row.flatKmPerL) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <footer className="foot">
          <span>
            {trips
              ? `${formatInt(totals.trips)} trips · ${formatInt(totals.points)} points`
              : compact
                ? "Waiting for host vehicle context"
                : "Ready to embed via iframe · query params: groupId, userId, from, to, tz, period · embed=1"}
          </span>
          <span>V17 kept as reference · metrics rewritten</span>
        </footer>
      </main>
    </div>
  );
}
