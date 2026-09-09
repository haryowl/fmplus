import { useEffect, useState } from "react";
import { BrandMark } from "../components/BrandMark";
import { ViewNav } from "../components/ViewNav";
import {
  fetchServicePoints,
  patchServicePoint,
  type ServicePoint,
} from "../lib/maintenance";
import {
  fetchPlacesPois,
  fetchPlacesSummary,
  formatPlacesWhen,
  placesAccessRows,
  type ArmadaPoi,
  type PlacesSummary,
} from "../lib/places";
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

  useEffect(() => {
    document.title = "Places · FM Plus";
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
        setPoiAvailable(poiRes.available);
        setPoiError(poiRes.available ? "" : poiRes.error || "POI unavailable");
        setPois(poiRes.pois || []);
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setPoiAvailable(false);
        setPoiError(err.message);
      });
    return () => ac.abort();
  }, [ready, query.tenantKey, reload]);

  async function onLinkPoi() {
    if (!linkPointId || !linkPoiId) return;
    const poi = pois.find((p) => String(p.id) === linkPoiId);
    if (!poi?.id) return;
    setLinkBusy(true);
    setLinkMsg("");
    try {
      const point = await patchServicePoint(linkPointId, {
        armadaPoiId: poi.id,
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

  return (
    <div className="app places-page">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>Places</h1>
            <p>Geofence analytics from notifier · Armada fences &amp; POI (read-only)</p>
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
                <span className="muted">Armada fences</span>
                <strong>{summary.geofences.length}</strong>
              </div>
              <div>
                <span className="muted">Fence hits ({days}d)</span>
                <strong>{fenceHitTotal}</strong>
              </div>
              <div>
                <span className="muted">Named fences hit</span>
                <strong>{summary.fenceHits.length}</strong>
              </div>
              <div>
                <span className="muted">Reports / templates</span>
                <strong>
                  {summary.armada.reports.count ?? 0} / {summary.armada.reports.templates ?? 0}
                </strong>
              </div>
            </section>

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

            <section className="places-panel">
              <h2>Fence hits by name</h2>
              <p className="muted">
                Aggregated from Command notifier rows (not polygon dwell). Edit fences in Armada.
              </p>
              {summary.fenceHits.length === 0 ? (
                <p className="muted">
                  No geofence-named notifier events in this window. When an Exception includes a fence
                  name, it will appear here.
                </p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Fence</th>
                        <th>Hits</th>
                        <th>Vehicles</th>
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
          <h2>Service points ↔ Armada POI</h2>
          <p className="muted">
            Optional link for workshop / depot points. POI catalog stays in Armada; FM Plus stores the id
            only.
          </p>
          {!poiAvailable ? (
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
            <p className="muted">No service points yet (create them from Maintenance).</p>
          )}
        </section>
      </main>
    </div>
  );
}
