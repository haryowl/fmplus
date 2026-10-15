import { useEffect } from "react";
import { BrandMark } from "../components/BrandMark";
import { DispatchGoodsCatalogPanel } from "../components/DispatchGoodsCatalogPanel";
import { DispatchMasterNav } from "../components/DispatchMasterNav";
import { ViewNav } from "../components/ViewNav";

/** Desk Goods & Stock admin (catalog, per-depot stock, truck day-close, print/NFC). */
export default function DispatchGoodsPage() {
  useEffect(() => {
    document.title = "Goods & Stock · ARMADA M.1";
  }, []);

  return (
    <div className="app dispatch-page dispatch-goods-page dispatch-master-page">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>Goods &amp; Stock</h1>
            <p>Products, pricing, stock levels</p>
          </div>
        </div>
        <div className="topbar-actions">
          <ViewNav current="dispatchGoods" />
        </div>
      </header>
      <main className="shell dispatch-shell dispatch-master-shell">
        <DispatchMasterNav current="dispatchGoods" />
        <DispatchGoodsCatalogPanel />
      </main>
    </div>
  );
}
