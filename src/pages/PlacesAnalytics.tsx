import { useEffect, useState } from "react";
import { BrandMark } from "../components/BrandMark";
import { PlacesGeofenceMap } from "../components/PlacesGeofenceMap";
import { ViewNav } from "../components/ViewNav";
import {
  createServicePoint,
  fetchServicePoints,
  patchServicePoint,
  type ServicePoint,
} from "../lib/maintenance";
import {
  createNativeGeofence,
  deleteNativeGeofence,
  fetchPlacesPois,
  fetchPlacesSummary,
  formatPlacesWhen,
  placesAccessRows,
  type ArmadaPoi,
  type NativeGeofence,
  type PlacesSummary,
} from "../lib/places";
import { assetCopy } from "../lib/assetCopy";
import { exceptionsHref, writeLocationSearch } from "../lib/routing";
import { useEmbedTenant } from "../lib/useEmbedTenant";

export default function PlacesAnalytics() {
  const { query, ready, error: tenantError } = useEmbedTenant();
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<PlacesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bootError, setBootError] = useState("");
  const [reload, setReload] = useState(0);

  const [points, setPoints] = useState<ServicePoint[]>([]);
  const [pois, setPois] = useState<ArmadaPoi[]>([]);
  const [poiAvailable, setPoiAvailable] = useState(false);
  const [poiError, setPoiError] = useState("");
  const [linkPointId, setLinkPointId] = useState("");
  const [linkPoiId, setLinkPoiId] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkMsg, setLinkMsg] = useState("");
  const [newName, setNewName] = useState("");
  const [newLat, setNewLat] = useState("");
  const [newLon, setNewLon] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createMsg, setCreateMsg] = useState("");
  const [fenceName, setFenceName] = useState("");
  const [fenceKind, setFenceKind] = useState<"circle" | "polygon">("circle");
  const [fenceLat, setFenceLat] = useState("");
  const [fenceLon, setFenceLon] = useState("");
  const [fenceRadius, setFenceRadius] = useState("200");
  const [fenceRing, setFenceRing] = useState<Array<[number, number]>>([]);
  const [fenceBusy, setFenceBusy] = useState(false);
  const [fenceMsg, setFenceMsg] = useState("");
  const [nativeFences, setNativeFences] = useState<NativeGeofence[]>([]);

  useEffect(() => {
    document.title = "Places · ARMADA M.1";
  }, []);

  useEffect(() => {
    writeLocationSearch({ days: String(days) });
  }, [days]);

  useEffect(() => {
    if (tenantError) setBootError(tenantError);
  }, [tenantError]);

  useEffect(() => {
    if (!ready) return;
    if (!query.tenantKey) {
      setLoading(false);
      setError("Open this page with k= (embed tenant key) to load Places.");
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError("");
    fetchPlacesSummary(days, ac.signal)
      .then((data) => {
        setSummary(data);
        setNativeFences(data.nativeGeofences || []);
        setBootError("");
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setError(err.message);
        setSummary(null);
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [ready, query.tenantKey, days, reload]);

  useEffect(() => {
    if (!ready || !query.tenantKey) return;
    const ac = new AbortController();
    void Promise.all([
      fetchServicePoints(""),
      fetchPlacesPois("", ac.signal),
    ])
      .then(([pts, poiRes]) => {
        setPoints(pts);
        setPoiAvailable(Boolean(poiRes.available && !poiRes.native && !poiRes.skipped));
        setPoiError(
          poiRes.available && !poiRes.native && !poiRes.skipped
            ? ""
            : poiRes.error || "POI unavailable",
        );
        setPois(poiRes.pois || []);
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setPoiAvailable(false);
        setPoiError(err.message);
      });
    return () => ac.abort();
  }, [ready, query.tenantKey, reload]);

  function setDrawKind(kind: "circle" | "polygon") {
    setFenceKind(kind);
    setFenceRing([]);
    setFenceMsg("");
  }

  function onPickCircle(lat: number, lon: number) {
    setFenceLat(lat.toFixed(6));
    setFenceLon(lon.toFixed(6));
    setFenceRing([[lat, lon]]);
  }

  async function onCreateFence() {
    const name = fenceName.trim();
    if (!name) return;
    if (fenceKind === "polygon") {
      if (fenceRing.length < 3) {
        setFenceMsg("Click the map to add at least 3 vertices");
        return;
      }
      setFenceBusy(true);
      setFenceMsg("");
      try {
        const fence = await createNativeGeofence({ name, kind: "polygon", ring: fenceRing });
        setNativeFences((prev) => [fence, ...prev.filter((f) => f.id !== fence.id)]);
        setFenceName("");
        setFenceRing([]);
        setFenceMsg(`Added ${fence.name}`);
      } catch (err) {
        setFenceMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setFenceBusy(false);
      }
      return;
    }
    const lat = Number(fenceLat);
    const lon = Number(fenceLon);
    const radiusM = Number(fenceRadius);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusM) || radiusM <= 0) {
      setFenceMsg("Click the map for a center, or enter lat, lon, and radius in meters");
      return;
    }
    setFenceBusy(true);
    setFenceMsg("");
    try {
      const fence = await createNativeGeofence({ name, kind: "circle", lat, lon, radiusM });
      setNativeFences((prev) => [fence, ...prev.filter((f) => f.id !== fence.id)]);
      setFenceName("");
      setFenceMsg(`Added ${fence.name}`);
    } catch (err) {
      setFenceMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setFenceBusy(false);
    }
  }

  async function onDeleteFence(id: string, name: string) {
    if (!window.confirm(`Delete geofence “${name}”?`)) return;
    setFenceBusy(true);
    setFenceMsg("");
    try {
      await deleteNativeGeofence(id);
      setNativeFences((prev) => prev.filter((f) => f.id !== id));
      setFenceMsg(`Deleted ${name}`);
    } catch (err) {
      setFenceMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setFenceBusy(false);
    }
  }

  async function onCreatePoint() {
    const name = newName.trim();
    if (!name) return;
    const lat = newLat.trim() === "" ? null : Number(newLat);
    const lon = newLon.trim() === "" ? null : Number(newLon);
    if (newLat.trim() && !Number.isFinite(lat)) {
      setCreateMsg("Latitude must be a number");
      return;
    }
    if (newLon.trim() && !Number.isFinite(lon)) {
      setCreateMsg("Longitude must be a number");
      return;
    }
    setCreateBusy(true);
    setCreateMsg("");
    try {
      const point = await createServicePoint({
        name,
        lat,
        lon,
        notes: newNotes.trim(),
      });
      setPoints((prev) => [point, ...prev.filter((p) => p.id !== point.id)]);
      setNewName("");
      setNewLat("");
      setNewLon("");
      setNewNotes("");
      setCreateMsg(`Added ${point.name}`);
    } catch (err) {
      setCreateMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCreateBusy(false);
    }
  }

  async function onLinkPoi() {
    if (!linkPointId || !linkPoiId) return;
    const poi = pois.find((p) => String(p.id) === linkPoiId);
    const poiId = typeof poi?.id === "number" ? poi.id : Number(poi?.id);
    if (!poi || !Number.isInteger(poiId) || poiId <= 0) return;
    setLinkBusy(true);
    setLinkMsg("");
    try {
      const point = await patchServicePoint(linkPointId, {
        armadaPoiId: poiId,
        armadaPoiName: poi.name,
      });
      setPoints((prev) => prev.map((p) => (p.id === point.id ? point : p)));
      setLinkMsg(`Linked ${point.name} → ${poi.name}`);
      setLinkPoiId("");
    } catch (err) {
      setLinkMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLinkBusy(false);
    }
  }

  async function onUnlink(pointId: string) {
    setLinkBusy(true);
    setLinkMsg("");
    try {
      const point = await patchServicePoint(pointId, { armadaPoiId: null, armadaPoiName: "" });
      setPoints((prev) => prev.map((p) => (p.id === point.id ? point : p)));
      setLinkMsg(`Cleared Armada POI on ${point.name}`);
    } catch (err) {
      setLinkMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLinkBusy(false);
    }
  }

  const fenceHitTotal = summary?.fenceHits.reduce((n, f) => n + f.hits, 0) ?? 0;
  const search = typeof window !== "undefined" ? window.location.search : "";
  const skipArmada = Boolean(
    summary?.telematicsSource === "devices" || summary?.armada.geofences.skipped,
  );

  return (
    <div className="app places-page">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>Places</h1>
            <p>
              {skipArmada
                ? "Native geofences, Fleet Live alerts, and notifier hits"
                : "Native geofences · notifier hits · Armada fences & POI (read-only)"}
            </p>
          </div>
        </div>
        <div className="topbar-actions">
          <ViewNav current="places" />
          <div className="vehicle-chip">
            {loading ? "Loading…" : summary ? `${fenceHitTotal} fence hits · ${days}d` : "Places"}
          </div>
        </div>
      </header>

      <main className="shell">
        <section className="filters places-toolbar">
          <div className="field">
            <label htmlFor="places-days">Window</label>
            <select
              id="places-days"
              value={days}
              onChange={(e) => setDays(Number(e.target.value) || 30)}
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button type="button" className="btn-ghost" onClick={() => setReload((n) => n + 1)}>
              Refresh
            </button>
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <a className="btn-ghost" href={exceptionsHref(search)}>
              Exceptions
            </a>
          </div>
        </section>

        {(bootError || error) && <div className="banner error">{bootError || error}</div>}

        {loading && !summary ? <p className="muted">Loading places…</p> : null}

        {summary ? (
          <>
            <section className="places-kpis" aria-label="Places summary">
              <div>
                <span className="muted">Fence groups</span>
                <strong>{summary.geofenceGroups.length}</strong>
              </div>
              <div>
                <span className="muted">Native fences</span>
                <strong>{nativeFences.length}</strong>
              </div>
              <div>
                <span className="muted">Catalog fences</span>
                <strong>{skipArmada ? "—" : summary.geofences.length}</strong>
              </div>
              <div>
                <span className="muted">Fence hits ({days}d)</span>
                <strong>{fenceHitTotal}</strong>
              </div>
              <div>
                <span className="muted">Named fences hit</span>
                <strong>{summary.fenceHits.length}</strong>
              </div>
              {skipArmada ? null : (
                <div>
                  <span className="muted">Reports / templates</span>
                  <strong>
                    {summary.armada.reports.count ?? 0} / {summary.armada.reports.templates ?? 0}
                  </strong>
                </div>
              )}
            </section>

            {skipArmada ? null : (
            <section className="places-panel places-access">
              <h2>Armada access (this token)</h2>
              <p className="muted">
                Catalog APIs need Geofence / POI privileges in Armada. Fence-hit tables below still fill
                from Command notifier payloads (`GEOFENCE_NAME`) even when the catalog is denied.
              </p>
              <ul className="places-access-list">
                {placesAccessRows(summary).map((row) => (
                  <li key={row.label} className={row.ok ? "ok" : "denied"}>
                    <span className="places-access-mark" aria-hidden>
                      {row.ok ? "✓" : "✗"}
                    </span>
                    <strong>{row.label}</strong>
                    <span className="muted">{row.detail}</span>
                  </li>
                ))}
              </ul>
              {summary.armada.geofences.ok && summary.geofences.length === 0 ? (
                <p className="muted">
                  Geofence API OK but catalog is empty — create polygons in Armada if you need them listed
                  here.
                </p>
              ) : null}
            </section>
            )}

            <section className="places-panel">
              <h2>Native geofences</h2>
              <p className="muted">
                Circles and polygons stored in ARMADA M.1. Click the map to set a circle center or drop
                polygon vertices. They draw on Fleet Live / Live and can fire alert rules
                (`inside_geofence`, `geofence_name`).
              </p>
              <div className="places-fence-draw" role="group" aria-label="Geofence shape">
                <button
                  type="button"
                  className={fenceKind === "circle" ? "is-active" : undefined}
                  onClick={() => setDrawKind("circle")}
                >
                  Circle
                </button>
                <button
                  type="button"
                  className={fenceKind === "polygon" ? "is-active" : undefined}
                  onClick={() => setDrawKind("polygon")}
                >
                  Polygon
                </button>
              </div>
              <PlacesGeofenceMap
                fences={nativeFences}
                mode={fenceKind}
                radiusM={Number(fenceRadius) || 0}
                ring={
                  fenceKind === "circle" &&
                  fenceLat.trim() !== "" &&
                  fenceLon.trim() !== "" &&
                  Number.isFinite(Number(fenceLat)) &&
                  Number.isFinite(Number(fenceLon))
                    ? [[Number(fenceLat), Number(fenceLon)]]
                    : fenceRing
                }
                onPickCircle={onPickCircle}
                onRingChange={setFenceRing}
              />
              <div className="places-link-form">
                <label>
                  Name
                  <input
                    value={fenceName}
                    onChange={(e) => setFenceName(e.target.value)}
                    placeholder="Depot ring"
                  />
                </label>
                {fenceKind === "circle" ? (
                  <>
                    <label>
                      Lat
                      <input
                        value={fenceLat}
                        onChange={(e) => setFenceLat(e.target.value)}
                        placeholder="-6.2"
                      />
                    </label>
                    <label>
                      Lon
                      <input
                        value={fenceLon}
                        onChange={(e) => setFenceLon(e.target.value)}
                        placeholder="106.8"
                      />
                    </label>
                    <label>
                      Radius (m)
                      <input
                        value={fenceRadius}
                        onChange={(e) => setFenceRadius(e.target.value)}
                        placeholder="200"
                      />
                    </label>
                  </>
                ) : (
                  <p className="muted places-fence-hint">
                    {fenceRing.length === 0
                      ? "Click the map to add vertices."
                      : `${fenceRing.length} vertex${fenceRing.length === 1 ? "" : "es"}`}
                  </p>
                )}
                {fenceKind === "polygon" ? (
                  <>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={fenceRing.length === 0}
                      onClick={() => setFenceRing((prev) => prev.slice(0, -1))}
                    >
                      Undo last
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={fenceRing.length === 0}
                      onClick={() => setFenceRing([])}
                    >
                      Clear
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="btn"
                  disabled={
                    fenceBusy ||
                    !fenceName.trim() ||
                    (fenceKind === "polygon" && fenceRing.length < 3)
                  }
                  onClick={() => void onCreateFence()}
                >
                  {fenceKind === "polygon" ? "Add polygon" : "Add circle"}
                </button>
              </div>
              {fenceMsg ? <p className="muted">{fenceMsg}</p> : null}
              {nativeFences.length === 0 ? (
                <p className="muted">No native geofences yet.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Kind</th>
                        <th>Center</th>
                        <th>Size</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {nativeFences.map((f) => (
                        <tr key={f.id}>
                          <td>{f.name}</td>
                          <td>{f.kind}</td>
                          <td>
                            {f.lat != null && f.lon != null
                              ? `${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}`
                              : "—"}
                          </td>
                          <td>
                            {f.kind === "polygon"
                              ? `${f.ring.length} vertices`
                              : f.radiusM != null
                                ? `${Math.round(f.radiusM)} m`
                                : "—"}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn-ghost"
                              disabled={fenceBusy}
                              onClick={() => void onDeleteFence(f.id, f.name)}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="places-panel">
              <h2>Fence hits by name</h2>
              <p className="muted">
                {skipArmada
                  ? "Aggregated from Fleet Live geofence alerts and notifier rows."
                  : "Aggregated from Command notifier rows. Native polygons also fire inside_geofence on Fleet Live."}
              </p>
              {summary.fenceHits.length === 0 ? (
                <p className="muted">
                  {skipArmada
                    ? "No geofence-named Fleet Live alerts or notifier events in this window."
                    : "No geofence-named notifier events in this window. When an Exception includes a fence name, it will appear here."}
                </p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Fence</th>
                        <th>Hits</th>
                        <th>{assetCopy.assets}</th>
                        <th>Last</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.fenceHits.map((row) => (
                        <tr key={row.name}>
                          <td>{row.name}</td>
                          <td>{row.hits}</td>
                          <td>{row.vehicleCount}</td>
                          <td>{formatPlacesWhen(row.lastAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="places-panel">
              <h2>Recent fence events</h2>
              <ul className="exceptions-list places-recent">
                {summary.recentFenceEvents.length === 0 ? (
                  <li className="muted exceptions-empty">No recent fence events.</li>
                ) : (
                  summary.recentFenceEvents.map((ev, i) => (
                    <li key={`${ev.fenceName}-${ev.at}-${i}`}>
                      <div className="exceptions-row-main">
                        <strong>{ev.fenceName}</strong>
                        <span className="muted">
                          {ev.vehicle}
                          {ev.ruleName ? ` · ${ev.ruleName}` : ""} · {formatPlacesWhen(ev.at)}
                        </span>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </section>

            {summary.geofenceGroups.length > 0 ? (
              <section className="places-panel">
                <h2>Armada geofence groups</h2>
                <ul className="places-chip-list">
                  {summary.geofenceGroups.map((g) => (
                    <li key={g.id ?? g.name}>{g.name}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {(summary.reports?.length ?? 0) > 0 ? (
              <section className="places-panel">
                <h2>Armada reports (read-only)</h2>
                <p className="muted">Listed from Armada — run/export stays in Armada for now.</p>
                <ul className="places-chip-list">
                  {summary.reports!.map((r) => (
                    <li key={r.id ?? r.name}>{r.name}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}

        <section className="places-panel">
          <h2>Service points</h2>
          <p className="muted">
            Workshops, depots, and yards stored in ARMADA M.1. These are the native POI catalog for
            Dispatch, Fleet Live, and Live when Armada POI is not used.
          </p>
          <div className="places-link-form">
            <label>
              Name
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Depot A"
              />
            </label>
            <label>
              Lat
              <input value={newLat} onChange={(e) => setNewLat(e.target.value)} placeholder="-6.2" />
            </label>
            <label>
              Lon
              <input value={newLon} onChange={(e) => setNewLon(e.target.value)} placeholder="106.8" />
            </label>
            <label>
              Notes
              <input value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder="optional" />
            </label>
            <button
              type="button"
              className="btn"
              disabled={createBusy || !newName.trim()}
              onClick={() => void onCreatePoint()}
            >
              Add point
            </button>
          </div>
          {createMsg ? <p className="muted">{createMsg}</p> : null}
          <h3>Armada POI link</h3>
          <p className="muted">
            Optional link for workshop / depot points. POI catalog stays in Armada; ARMADA M.1 stores the id
            only.
          </p>
          {skipArmada ? (
            <p className="muted">
              Armada POI linking is hidden on devices-only tenants. Dispatch uses the service points
              above as the saved POI list.
            </p>
          ) : !poiAvailable ? (
            <div className="banner warn">
              {poiError ||
                "POI picker dormant until Armada allows poicategories on this token."}
            </div>
          ) : (
            <div className="places-link-form">
              <label>
                Service point
                <select value={linkPointId} onChange={(e) => setLinkPointId(e.target.value)}>
                  <option value="">Select…</option>
                  {points.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.armadaPoiName ? ` (→ ${p.armadaPoiName})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Armada POI
                <select value={linkPoiId} onChange={(e) => setLinkPoiId(e.target.value)}>
                  <option value="">Select…</option>
                  {pois.map((p) => (
                    <option key={p.id ?? p.name} value={String(p.id)}>
                      {p.categoryName ? `${p.categoryName} / ` : ""}
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn"
                disabled={linkBusy || !linkPointId || !linkPoiId}
                onClick={() => void onLinkPoi()}
              >
                Link
              </button>
            </div>
          )}
          {linkMsg ? <p className="muted">{linkMsg}</p> : null}
          {points.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Service point</th>
                    <th>Armada POI</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {points.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{p.armadaPoiName || (p.armadaPoiId != null ? `#${p.armadaPoiId}` : "—")}</td>
                      <td>
                        {p.armadaPoiId != null ? (
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={linkBusy}
                            onClick={() => void onUnlink(p.id)}
                          >
                            Unlink
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No service points yet — add one above.</p>
          )}
        </section>
      </main>
    </div>
  );
}
