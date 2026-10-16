
const goods = [
  {name:'blokA', sku:'blokA', unit:'pcs', sell:0, cost:0, hand:0},
  {name:'Mainan WL ASD D 21cm SNI', sku:'MAINAN-WL', unit:'pcs', sell:0, cost:0, hand:0},
  {name:'OIL LUBE OIL-01', sku:'OIL-01', unit:'pcs', sell:0, cost:0, hand:12},
]
export default function GoodsStock(){
  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border p-3">
        <div className="text-[11px] opacity-60 mb-2">Goods & Stock · Manage sellable goods and stock levels</div>
        <div className="grid grid-cols-[1.5fr_120px_90px_90px_80px_80px_80px_auto] gap-2 items-end">
          <div><div className="text-[10px] uppercase opacity-60">Product name</div><input className="h-8 w-full border rounded-lg px-2 text-[12px]" placeholder="Name"/></div>
          <div><div className="text-[10px] uppercase opacity-60">SKU</div><input className="h-8 w-full border rounded-lg px-2 text-[12px]" placeholder="SKU"/></div>
          <div><div className="text-[10px] uppercase opacity-60">Unit</div><select className="h-8 w-full border rounded-lg text-[12px]"><option>pcs</option></select></div>
          <div><div className="text-[10px] uppercase opacity-60">Sell Rp</div><input className="h-8 w-full border rounded-lg px-2 text-[12px]" placeholder="0"/></div>
          <div><div className="text-[10px] uppercase opacity-60">Cost Rp</div><input className="h-8 w-full border rounded-lg px-2 text-[12px]"/></div>
          <div><div className="text-[10px] uppercase opacity-60">m3/unit</div><input className="h-8 w-full border rounded-lg px-2 text-[12px]"/></div>
          <div><div className="text-[10px] uppercase opacity-60">On hand</div><input className="h-8 w-full border rounded-lg px-2 text-[12px]"/></div>
          <button className="h-8 px-4 bg-teal-600 text-white rounded-lg text-[12px]">Add</button>
        </div>
        <div className="flex gap-2 mt-3"><button className="h-7 px-3 border rounded-lg text-[11px]">Import CSV</button><button className="h-7 px-3 border rounded-lg text-[11px]">Export CSV</button><input placeholder="Filter by name, ref, zone, address..." className="ml-auto h-7 w-[280px] border rounded-lg px-2 text-[11px]"/></div>
      </div>
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="grid grid-cols-[1.5fr_100px_60px_80px_80px_80px_1fr] bg-[#F8FAFC] text-[10px] uppercase opacity-60 p-2.5 border-b"><div>Name</div><div>SKU</div><div>Unit</div><div>Sell</div><div>Cost</div><div>On hand</div><div>Actions</div></div>
        {goods.map(g=>(
          <div key={g.sku} className="grid grid-cols-[1.5fr_100px_60px_80px_80px_80px_1fr] p-2.5 border-b text-[12px] items-center hover:bg-[#F6FBFA]">
            <div className="font-medium truncate">{g.name}</div><div className="text-[11px] px-1.5 py-0.5 bg-gray-100 rounded-full w-fit">{g.sku}</div><div>{g.unit}</div><div>{g.sell}</div><div>{g.cost}</div><div><span className={`px-2 py-0.5 rounded-full text-[11px] ${g.hand>0?'bg-emerald-100 text-emerald-700':'bg-zinc-100'}`}>{g.hand} pcs</span></div>
            <div className="flex gap-1"><button className="w-7 h-7 border rounded-md grid place-items-center">👁</button><button className="w-7 h-7 border rounded-md">🗑</button><button className="w-7 h-7 border rounded-md">QR</button><button className="w-7 h-7 border rounded-md text-[10px]">NFC</button><button className="w-7 h-7 border rounded-md text-[10px]">Codes</button><button className="w-7 h-7 bg-teal-600 text-white rounded-md text-[10px]">Stock</button></div>
          </div>
        ))}
      </div>
    </div>
  )
}
