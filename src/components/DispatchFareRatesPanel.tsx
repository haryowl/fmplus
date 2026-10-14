import { useEffect, useState, type FormEvent } from "react";
import { formatIdr } from "../lib/format";
import {
  fetchDispatchDepots,
  fetchDispatchFareRates,
  saveDispatchFareRates,
  type DispatchDepot,
  type DispatchFareRates,
} from "../lib/dispatch";

/** Desk editor for passenger fare: km × rate + fixed booking. */
export function DispatchFareRatesPanel() {
  const [depots, setDepots] = useState<DispatchDepot[]>([]);
  const [rates, setRates] = useState<DispatchFareRates[]>([]);
  const [depotId, setDepotId] = useState("");
  const [rateKm, setRateKm] = useState("0");
  const [fixedBooking, setFixedBooking] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function applyForm(list: DispatchFareRates[], id: string) {
    const row =
      list.find((r) => (id ? r.depotId === id : !r.depotId)) ||
      (!id ? list.find((r) => !r.depotId) : null);
    setRateKm(String(row?.rateKm ?? 0));
    setFixedBooking(String(row?.fixedBooking ?? 0));
  }

  async function reload(signal?: AbortSignal) {
    const [depotList, fareList] = await Promise.all([
      fetchDispatchDepots(),
      fetchDispatchFareRates(signal),
    ]);
    setDepots(depotList);
    setRates(fareList);
    applyForm(fareList, depotId);
  }

  useEffect(() => {
    const ac = new AbortController();
    void reload(ac.signal).catch((err: Error) => {
      if (err.name !== "AbortError") setError(err.message);
    });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { rates: next } = await saveDispatchFareRates({
        depotId: depotId || null,
        rateKm: Number(rateKm) || 0,
        fixedBooking: Number(fixedBooking) || 0,
      });
      setRates(next);
      applyForm(next, depotId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save fare rates failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dispatch-opex-rates">
      <p className="dispatch-eyebrow">Passenger fare rates</p>
      <p className="dispatch-search-hint">
        Fare ≈ distance × Rp/km + fixed booking. Global applies when a depot has none.
      </p>
      {error ? (
        <p className="dispatch-window-warn" role="alert">
          {error}
        </p>
      ) : null}
      <form className="dispatch-opex-rates-form" onSubmit={(e) => void onSave(e)}>
        <div className="field">
          <label htmlFor="fare-rate-depot">Scope</label>
          <select
            id="fare-rate-depot"
            value={depotId}
            disabled={busy}
            onChange={(e) => {
              const id = e.target.value;
              setDepotId(id);
              applyForm(rates, id);
            }}
          >
            <option value="">Global</option>
            {depots.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="fare-rate-km">Rp / km</label>
          <input
            id="fare-rate-km"
            type="number"
            min="0"
            step="1"
            value={rateKm}
            disabled={busy}
            onChange={(e) => setRateKm(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="fare-rate-fixed">Fixed booking</label>
          <input
            id="fare-rate-fixed"
            type="number"
            min="0"
            step="1"
            value={fixedBooking}
            disabled={busy}
            onChange={(e) => setFixedBooking(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>
          Save fare
        </button>
      </form>
      {rates.length ? (
        <ul className="dispatch-opex-rates-list">
          {rates.map((r) => (
            <li key={r.id || r.depotId || "global"}>
              <span>{r.depotId ? r.depotName || "Depot" : "Global"}</span>
              <span>
                {formatIdr(r.rateKm)}/km · {formatIdr(r.fixedBooking)} fixed
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
