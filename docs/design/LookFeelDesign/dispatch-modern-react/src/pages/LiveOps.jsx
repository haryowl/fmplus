
const vehicles = [
  {plate:'B 9451 BBF', ago:'132 d ago', speed:'0.0 km/h', state:'Stale'},
  {plate:'B 9512 BBF', ago:'61 d ago', speed:'0.0 km/h', state:'Stale'},
  {plate:'B 9449 BBF', ago:'46 min ago', speed:'0.0 km/h', state:'Stale'},
  {plate:'B 9516 BBF', ago:'63 d ago', speed:'0.0 km/h', state:'Stale'},
]
export default function LiveOps(){
  return (
    <div className="space-y-2">
      <div className="bg-white rounded-xl border p-2.5 flex gap-2 items-end">
        <div><div className="text-[9px] uppercase opacity-60 mb-1">Group</div><select className="h-8 w-[220px] border rounded-lg px-2 text-[12px]"><option>All Unit · 85 vehicles · 1137</option></select></div>
        <div><div className="text-[9px] uppercase opacity-60 mb-1">Timezone</div><select className="h-8 w-[180px] border rounded-lg px-2 text-[12px]"><option>WITA - UTC+8</option></select></div>
        <div><div className="text-[9px] uppercase opacity-60 mb-1">Search</div><input placeholder="Name or id" className="h-8 w-[160px] border rounded-lg px-2 text-[12px]"/></div>
        <div className="ml-auto flex gap-2"><button className="h-8 px-6 bg-[#F2F5F6] border rounded-lg text-[12px]">Refresh</button><button className="h-8 px-8 bg-[#0E2E3A] text-white rounded-full text-[12px]">Excel</button></div>
      </div>
      <div className="flex gap-2 items-center text-[12px]"><button className="px-2 h-6 border rounded text-[11px] bg-white">All classes</button><button className="px-2 h-6 border rounded text-[11px] bg-white">Clear</button>
        <label className="flex gap-1 items-center ml-2"><input type="checkbox" defaultChecked/> <span className="w-2 h-2 bg-emerald-700 rounded-full inline-block"/> Moving (10)</label>
        <label className="flex gap-1 items-center"><input type="checkbox" defaultChecked/> <span className="w-2 h-2 bg-amber-500 rounded-full inline-block"/> Idle (2)</label>
        <label className="flex gap-1 items-center"><input type="checkbox" defaultChecked/> <span className="w-2 h-2 bg-zinc-500 rounded-full inline-block"/> Off (9)</label>
        <label className="flex gap-1 items-center"><input type="checkbox" defaultChecked/> <span className="w-2 h-2 bg-red-700 rounded-full inline-block"/> Stale (64)</label>
        <label className="flex gap-1 items-center"><input type="checkbox" defaultChecked/> <span className="w-2 h-2 bg-zinc-300 rounded-full inline-block"/> No fix (0)</label>
      </div>
      <div className="grid grid-cols-[1fr_340px] gap-3 h-[560px]">
        <div className="bg-[#E8ECEE] rounded-lg border relative grid place-items-center"><div className="text-[11px] opacity-50">INDONESIA MAP · placeholder with dots</div><div className="absolute top-2 left-2 flex flex-col"><button className="w-7 h-7 bg-white border">+</button><button className="w-7 h-7 bg-white border">−</button></div></div>
        <div className="bg-white rounded-lg border flex flex-col"><div className="p-2 font-semibold text-[13px] border-b">Vehicles</div><div className="overflow-auto divide-y">
          {vehicles.map(v=>(
            <div key={v.plate} className="p-2.5 hover:bg-[#F6FBFA]">
              <div className="flex gap-1.5 items-center"><span className="w-2 h-2 bg-red-700 rounded-full"/><span className="font-semibold text-[12px]">{v.plate}</span></div>
              <div className="text-[11px] opacity-70 mt-0.5">{v.state} · {v.ago} · {v.speed}</div>
              <div className="flex gap-2 mt-1 text-[11px] text-blue-700 underline"><a>Trips</a><a>Full</a><a>Maintenance</a></div>
            </div>
          ))}
        </div></div>
      </div>
    </div>
  )
}
