
export default function DispatchLive(){
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-6 gap-2">
        {[{l:'STOPS',v:'4',s:'3 drivers assigned'},{l:'IN TRANSIT',v:'0',s:'idle fleet'},{l:'DELIVERED',v:'1',s:'25% of stops'},{l:'PENDING',v:'0',s:'not started'},{l:'DELAYED',v:'3',s:'past window'},{l:'AVG COMPLETE',v:'33.3%',s:'3 drivers'}].map(c=>(
          <div key={c.l} className="h-[72px] bg-white rounded-xl border p-2.5 border-t-2 border-t-teal-500">
            <div className="text-[9px] uppercase opacity-60">{c.l}</div><div className="font-bold text-[18px] leading-tight">{c.v}</div><div className="text-[11px] opacity-60">{c.s}</div>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border p-2.5">
        <div className="flex justify-between items-center mb-2"><div className="text-[10px] uppercase opacity-60">SLA TODAY · OTP 0% · 0/1 on window</div><button className="h-6 px-2 bg-[#0E2E3A] text-white rounded-full text-[10px]">Hide</button></div>
        <div className="grid grid-cols-5 gap-2">
          <div className="h-[60px] border rounded-xl p-2 border-t-2 border-t-teal-500"><div className="text-[9px] opacity-60">OTP</div><div className="font-bold">0%</div><div className="text-[10px] opacity-60">0/1 on window</div></div>
          <div className="h-[60px] border rounded-xl p-2 border-t-2 border-t-orange-400"><div className="text-[9px] opacity-60">LATE</div><div className="font-bold">1</div><div className="text-[10px] opacity-60">1 stop past window</div></div>
          <div className="h-[60px] border rounded-xl p-2 border-t-2 border-t-red-400"><div className="text-[9px] opacity-60">AT RISK</div><div className="font-bold">3</div><div className="text-[10px] opacity-60">window at risk</div></div>
          <div className="h-[60px] border rounded-xl p-2 border-t-2 border-t-amber-300"><div className="text-[9px] opacity-60">SKIPPED</div><div className="font-bold">0</div><div className="text-[10px] opacity-60">all attempted</div></div>
          <div className="h-[60px] border rounded-xl p-2 border-t-2 border-t-teal-500"><div className="text-[9px] opacity-60">PLAN LAG</div><div className="font-bold">—</div><div className="text-[10px] opacity-60">median delay</div></div>
        </div>
      </div>
      <div className="bg-white rounded-xl border p-2.5">
        <div className="flex justify-between items-center mb-2"><div className="text-[10px] uppercase font-semibold">EXCEPTIONS <span className="ml-2 px-1.5 py-0.5 bg-amber-100 rounded-full text-[9px]">3 OPEN</span></div><button className="h-6 px-2 bg-[#0E2E3A] text-white rounded-full text-[10px]">Hide</button></div>
        <div className="space-y-1.5">
          {['Jalan Katapang','Special Capital Region of Jakarta','Jalan Peternakan III'].map(name=>(
            <div key={name} className="h-12 flex items-center justify-between border rounded-lg px-3 bg-[#FFFBF5]">
              <div><div className="flex gap-1.5 items-center"><span className="text-[9px] px-1.5 py-0.5 bg-[#FBE9D0] rounded-full border">AT RISK</span><span className="text-[12px] font-semibold">At risk: {name}</span></div><div className="text-[10px] opacity-60">Past window end 12:00</div></div>
              <div className="flex gap-1"><button className="h-7 px-3 bg-[#0E2E3A] text-white rounded-full text-[11px]">Focus</button><button className="h-7 px-3 bg-[#0E2E3A] text-white rounded-full text-[11px]">Ack</button></div>
            </div>
          ))}
        </div>
      </div>
      <div className="bg-white rounded-xl border p-2">
        <div className="h-[280px] bg-[#F6F8F4] rounded-lg border grid place-items-center text-[11px] opacity-50">JAKARTA / BEKASI / BANDUNG MAP · Plan (dark) Phone actual (green) Armada actual (orange)</div>
      </div>
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="grid grid-cols-[80px_repeat(10,1fr)] text-[10px] uppercase opacity-60 p-2 border-b"><div>#</div><div>Order / Stop</div><div>Status</div><div>Start</div><div>End</div><div>POD</div><div>Plan</div><div>Phone</div><div>Vehicle</div></div>
        <div className="divide-y text-[12px]">
          <div className="bg-[#E8F7F6] p-2 font-medium text-[11px]">Driver2 · 2 stops · 0%</div>
          <div className="grid grid-cols-[80px_repeat(8,1fr)] p-2 items-center"><span>1</span><span>Special Capital Region of Jakarta</span><span className="px-1.5 py-0.5 bg-orange-100 rounded-full text-[10px]">DELAYED</span><span>—</span><span>—</span><span className="text-amber-700">Pending</span><span>-6.17, 106.82</span><span>—</span><span>—</span></div>
        </div>
      </div>
    </div>
  )
}
