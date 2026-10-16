
const customers = [
  {name:'AEON Mall BSD City', lat:'-6.30380088', lon:'106.64447028', zone:'Tangerang Kabupaten', phone:'', addr:'AEON Mall BSD City, Sampora, Kec. Cisauk'},
  {name:'AEON Mall Deltamas Bekasi Reg', lat:'-6.3234', lon:'107.1695', zone:'Bekasi Kabupaten', phone:'', addr:'AEON Mall Deltamas, Sukamahi, Cikarang Pusat'},
  {name:'AEON Mall Jakarta Garden City', lat:'-6.17245161', lon:'106.95245495', zone:'Jakarta Timur', phone:'', addr:'AEON Mall Jakarta Garden City'},
  {name:'AEON Mall Sentul City', lat:'-6.498', lon:'106.871', zone:'Bogor Kabupaten', phone:'', addr:'AEON Mall Sentul City'},
]
export default function Customers(){
  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border p-3">
        <div className="grid grid-cols-[1.5fr_110px_110px_120px_1fr] gap-2">
          <input placeholder="Customer name" className="h-8 border rounded-lg px-2 text-[12px]"/>
          <input placeholder="Lat" className="h-8 border rounded-lg px-2 text-[12px]"/>
          <input placeholder="Lon" className="h-8 border rounded-lg px-2 text-[12px]"/>
          <input placeholder="Zone" className="h-8 border rounded-lg px-2 text-[12px]"/>
          <button className="h-8 px-4 bg-teal-600 text-white rounded-lg text-[12px]">Add</button>
        </div>
        <div className="flex gap-2 mt-3"><button className="h-7 px-3 border rounded-lg text-[11px]">Import CSV</button><button className="h-7 px-3 border rounded-lg text-[11px]">Export CSV</button><input placeholder="Filter by name, ref, zone, address..." className="ml-auto h-7 w-[280px] border rounded-lg px-2 text-[11px]"/></div>
      </div>
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="grid grid-cols-[1.5fr_110px_110px_120px_120px_60px_60px] bg-[#F8FAFC] text-[10px] uppercase opacity-60 p-2.5 border-b"><div>Customer</div><div>Lat</div><div>Lon</div><div>Zone</div><div>Phone</div><div>On</div><div>Remove</div></div>
        {customers.map(c=>(
          <div key={c.name} className="grid grid-cols-[1.5fr_110px_110px_120px_120px_60px_60px] p-2.5 border-b text-[12px] items-center hover:bg-[#F6FBFA]">
            <div><div className="font-medium truncate">{c.name}</div><div className="text-[10px] opacity-60 flex gap-1 items-center mt-0.5">📍 {c.addr}</div></div>
            <input defaultValue={c.lat} className="h-7 border rounded-md px-1 text-[11px]"/><input defaultValue={c.lon} className="h-7 border rounded-md px-1 text-[11px]"/><div className="text-[11px] px-2 py-0.5 bg-gray-100 rounded-full w-fit">{c.zone}</div><input className="h-7 border rounded-md px-1 text-[11px]"/><label className="relative inline-flex items-center cursor-pointer"><input type="checkbox" defaultChecked className="sr-only peer"/><div className="w-8 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div></label><button className="h-7 px-2 border rounded-md text-[11px]">Remove</button>
          </div>
        ))}
      </div>
    </div>
  )
}
