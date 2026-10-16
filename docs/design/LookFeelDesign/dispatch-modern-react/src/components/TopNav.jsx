
const tabs = [
  {id:'dispatch', label:'Dispatch'},
  {id:'live', label:'Live Ops'},
  {id:'dispatchLive', label:'Dispatch Live'},
  {id:'goods', label:'Goods & Stock'},
  {id:'customers', label:'Customers'},
]
export default function TopNav({active,onChange}){
  return (
    <header className="sticky top-0 z-50 bg-[#0E2E3A] text-white h-[52px] flex items-center px-4 gap-3 border-b border-white/10">
      <div className="flex items-center gap-2 mr-4">
        <div className="w-8 h-8 bg-teal-500 rounded-lg grid place-items-center font-bold">A</div>
        <div className="leading-tight"><div className="font-semibold text-[13px]">Dispatch</div><div className="text-[10px] opacity-60">Plan by day · search or map · assign · field execution</div></div>
      </div>
      <nav className="flex gap-1.5">
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>onChange(t.id)} className={`px-3.5 h-7 rounded-full text-[12px] font-medium border ${active===t.id?'bg-white text-[#0E2E3A] border-white':'bg-white/10 border-white/10 text-white/80 hover:bg-white/20'}`}>{t.label}</button>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2 text-[11px]">
        <span className="px-2 py-1 rounded-full bg-white/10">Warm · Mono · Color</span>
        <span className="px-2 py-1 rounded-full bg-black/30">0 jobs</span>
      </div>
    </header>
  )
}
