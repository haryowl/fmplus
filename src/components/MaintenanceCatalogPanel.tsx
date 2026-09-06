import { useEffect, useState, type FormEvent } from "react";
import {
  createMaintCatalogItem,
  deleteMaintCatalogItem,
  fetchMaintenanceCatalog,
  LINE_KIND_LABELS,
  patchMaintCatalogItem,
  type CatalogGroup,
  type CatalogItem,
} from "../lib/maintenance";

type Props = {
  onClose?: () => void;
};

export function MaintenanceCatalogPanel({ onClose }: Props) {
  const [groups, setGroups] = useState<CatalogGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState<Record<string, string>>({});
  const [newPrice, setNewPrice] = useState<Record<string, string>>({});
  const [newCost, setNewCost] = useState<Record<string, string>>({});

  async function reload(signal?: AbortSignal) {
    const next = await fetchMaintenanceCatalog(signal);
    setGroups(next);
  }

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError("");
    void reload(ac.signal)
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, []);

  async function addItem(group: CatalogGroup, e: FormEvent) {
    e.preventDefault();
    const name = (newName[group.id] || "").trim();
    if (!name) return;
    setBusy(true);
    setError("");
    try {
      const priceRaw = newPrice[group.id];
      const costRaw = newCost[group.id];
      await createMaintCatalogItem({
        groupId: group.id,
        name,
        unitPrice: priceRaw === undefined || priceRaw === "" ? null : Number(priceRaw),
        unitCost: costRaw === undefined || costRaw === "" ? null : Number(costRaw),
      });
      setNewName((p) => ({ ...p, [group.id]: "" }));
      setNewPrice((p) => ({ ...p, [group.id]: "" }));
      setNewCost((p) => ({ ...p, [group.id]: "" }));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveItem(item: CatalogItem, patch: Partial<CatalogItem>) {
    setBusy(true);
    setError("");
    try {
      await patchMaintCatalogItem(item.id, patch);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(item: CatalogItem) {
    if (!window.confirm(`Remove “${item.name}” from catalog?`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteMaintCatalogItem(item.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="maintenance-catalog-panel">
      <div className="maintenance-catalog-head">
        <div>
          <h2>Parts &amp; service catalog</h2>
          <p className="muted">
            Defaults for job lines. Field picks Part / Service items; Others is always free text.
          </p>
        </div>
        {onClose ? (
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>
      {error ? <div className="banner error">{error}</div> : null}
      {loading ? <p className="muted">Loading catalog…</p> : null}
      {!loading &&
        groups.map((group) => (
          <div key={group.id} className="maintenance-catalog-group">
            <h3>
              {LINE_KIND_LABELS[group.key as keyof typeof LINE_KIND_LABELS] || group.name}
            </h3>
            {group.key === "other" ? (
              <p className="muted">Others has no preset items — technicians enter free text on the job.</p>
            ) : (
              <>
                <ul className="maintenance-catalog-list">
                  {group.items.map((item) => (
                    <li key={item.id} className={!item.enabled ? "is-disabled" : ""}>
                      <input
                        className="catalog-name"
                        defaultValue={item.name}
                        disabled={busy}
                        onBlur={(e) => {
                          const name = e.target.value.trim();
                          if (name && name !== item.name) void saveItem(item, { name });
                        }}
                      />
                      <input
                        type="number"
                        step="any"
                        placeholder="Price"
                        defaultValue={item.unitPrice ?? ""}
                        disabled={busy}
                        onBlur={(e) => {
                          const v = e.target.value === "" ? null : Number(e.target.value);
                          if (v !== item.unitPrice) void saveItem(item, { unitPrice: v });
                        }}
                      />
                      <input
                        type="number"
                        step="any"
                        placeholder="Cost"
                        defaultValue={item.unitCost ?? ""}
                        disabled={busy}
                        onBlur={(e) => {
                          const v = e.target.value === "" ? null : Number(e.target.value);
                          if (v !== item.unitCost) void saveItem(item, { unitCost: v });
                        }}
                      />
                      <label className="catalog-enabled">
                        <input
                          type="checkbox"
                          checked={item.enabled}
                          disabled={busy}
                          onChange={(e) => void saveItem(item, { enabled: e.target.checked })}
                        />
                        On
                      </label>
                      <button
                        type="button"
                        className="btn-ghost btn-compact"
                        disabled={busy}
                        onClick={() => void removeItem(item)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
                <form className="maintenance-catalog-add" onSubmit={(e) => void addItem(group, e)}>
                  <input
                    placeholder="New item name"
                    value={newName[group.id] || ""}
                    onChange={(e) => setNewName((p) => ({ ...p, [group.id]: e.target.value }))}
                    disabled={busy}
                  />
                  <input
                    type="number"
                    step="any"
                    placeholder="Price"
                    value={newPrice[group.id] || ""}
                    onChange={(e) => setNewPrice((p) => ({ ...p, [group.id]: e.target.value }))}
                    disabled={busy}
                  />
                  <input
                    type="number"
                    step="any"
                    placeholder="Cost"
                    value={newCost[group.id] || ""}
                    onChange={(e) => setNewCost((p) => ({ ...p, [group.id]: e.target.value }))}
                    disabled={busy}
                  />
                  <button type="submit" className="btn-secondary" disabled={busy}>
                    Add
                  </button>
                </form>
              </>
            )}
          </div>
        ))}
    </section>
  );
}
