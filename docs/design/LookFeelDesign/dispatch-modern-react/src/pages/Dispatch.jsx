
export default function Dispatch(){
  return (
    <div className="space-y-3">
      <div className="h-12 bg-white rounded-xl border flex items-center px-3 gap-2">
        <button className="w-7 h-7 border rounded-md">‹</button>
        <div className="px-3 h-7 border rounded-md text-[12px] grid place-items-center">Wed, 14 Oct 2026</div>
        <button className="w-7 h-7 border rounded-md">›</button>
        <div className="flex gap-2 ml-2">
          <div className="px-3 h-9 bg-[#F6FBFA] border rounded-lg"><div className="text-[9px] uppercase opacity-60">Unassigned</div><div className="font-bold text-[13px]">0</div></div>
          <div className="px-3 h-9 bg-[#F6FBFA] border rounded-lg"><div className="text-[9px] uppercase opacity-60">Open Jobs</div><div className="font-bold text-[13px]">0</div></div>
          <div className="px-3 h-9 bg-[#F6FBFA] border rounded-lg"><div className="text-[9px] uppercase opacity-60">Avg Fill</div><div className="font-bold text-[13px] text-emerald-700">0%</div></div>
        </div>
        <div className="ml-auto flex gap-2"><button className="h-8 px-3 border rounded-lg text-[12px]">Refresh</button><button className="h-8 px-3 border rounded-lg text-[12px]">Auto-plan day</button><button className="h-8 px-4 bg-teal-600 text-white rounded-lg text-[12px]">New job</button></div>
      </div>
      <div className="grid grid-cols-[320px_1fr_320px] gap-3 h-[720px]">
        <div className="bg-white rounded-xl border p-3 flex flex-col gap-2">
          <div className="flex justify-between items-center"><span className="text-[10px] uppercase opacity-60">Inbox · Wed, 14 Oct 2026</span><span className="font-semibold text-[14px]">Orders</span></div>
          <div className="grid grid-cols-2 gap-1.5"><button className="h-7 border rounded-lg text-[11px]">Generate routines</button><button className="h-7 border rounded-lg text-[11px]">Routines (2)</button><button className="h-7 border rounded-lg text-[11px]">Goods & Stock (3)</button><button className="h-7 border rounded-lg text-[11px]">Customers (85)</button></div>
          <button className="h-7 border rounded-lg text-[11px]">Import orders CSV</button>
          <div className="flex bg-[#EEF4F6] rounded-lg p-0.5"><button className="flex-1 h-6 bg-white rounded-md text-[11px] shadow-sm">POI</button><button className="flex-1 h-6 text-[11px] opacity-70">Street / other</button><button className="flex-1 h-6 text-[11px] opacity-70">Customers</button></div>
          <div className="space-y-2 pt-1">
            <div><div className="text-[9px] uppercase opacity-50 mb-1">Filter POIs</div><input placeholder="Type to narrow the list..." className="w-full h-8 border rounded-lg px-2 text-[12px]"/></div>
            <div><div className="text-[9px] uppercase opacity-50 mb-1">Armada POI</div><select className="w-full h-8 border rounded-lg px-2 text-[12px]"><option>Select POI (2)</option></select></div>
            <div><div className="text-[9px] uppercase opacity-50 mb-1">Search Orders</div><input placeholder="Customer, ref, zone, address..." className="w-full h-8 border rounded-lg px-2 text-[12px]"/></div>
          </div>
          <div className="flex-1 grid place-items-center text-center py-8"><div><div className="text-[13px] font-medium">No pending orders</div><div className="text-[11px] opacity-60 mt-1">Search a place or pin the map to start a run.</div></div></div>
          <div className="space-y-1.5"><button className="w-full h-8 bg-teal-600/40 text-white rounded-lg text-[12px] font-medium">Select orders to assign</button><button className="w-full h-7 border rounded-lg text-[11px] opacity-60">New trip for this driver</button><button className="w-full h-7 border rounded-lg text-[11px] opacity-60">Move selected to next day</button><button className="w-full h-7 border rounded-lg text-[11px] opacity-60">Carry all leftover</button></div>
        </div>
        <div className="bg-white rounded-xl border p-2 flex flex-col"><div className="flex justify-between items-center px-1 pb-2"><div><div className="text-[9px] uppercase opacity-50">Live Board · Wed, 14 Oct 2026</div><div className="font-semibold text-[13px]">Route map</div></div><span className="text-[10px] px-2 py-0.5 bg-[#EEF4F6] border rounded-full">0 stops</span></div><div className="flex-1 bg-[#F5F7F4] rounded-lg border relative grid place-items-center"><span className="text-[11px] opacity-40">BANDUNG map · Leaflet placeholder</span><div className="absolute top-2 left-2 flex flex-col"><button className="w-7 h-7 bg-white border">+</button><button className="w-7 h-7 bg-white border">−</button></div></div></div>
        <div className="bg-white rounded-xl border grid place-items-center text-center p-6"><div><div className="text-[10px] uppercase opacity-60">Vehicle</div><div className="font-bold text-[18px] mt-1">No job selected</div><div className="text-[12px] opacity-60 mt-1 max-w-[200px]">Create a job, then assign pinned orders from the pool.</div></div></div>
      </div>
    </div>
  )
}
