import { useEffect } from "react";
import { BrandMark } from "../components/BrandMark";
import { DispatchGoodsCatalogPanel } from "../components/DispatchGoodsCatalogPanel";
import { ViewNav } from "../components/ViewNav";
import { jobsHref, navigateView } from "../lib/routing";

/** Desk Goods & Stock admin (catalog, per-depot stock, truck day-close, print/NFC). */
export default function DispatchGoodsPage() {
  useEffect(() => {
    document.title = "Goods & Stock · ARMADA M.1";
  }, []);

  const search = typeof window !== "undefined" ? window.location.search : "";

  return (
    <div className="app dispatch-page dispatch-goods-page">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>Goods &amp; Stock</h1>
            <p>Catalog · price · stock · operating cost rates</p>
          </div>
        </div>
        <div className="topbar-actions">
          <ViewNav current="dispatchGoods" />
          <button
            type="button"
            className="btn-secondary"
            onClick={() => navigateView(jobsHref(search))}
          >
            Back to Jobs
          </button>
        </div>
      </header>
      <main className="shell dispatch-shell dispatch-master-shell">
        <DispatchGoodsCatalogPanel />
      </main>
    </div>
  );
}
