
import { useState } from 'react'
import TopNav from './components/TopNav.jsx'
import Dispatch from './pages/Dispatch.jsx'
import LiveOps from './pages/LiveOps.jsx'
import DispatchLive from './pages/DispatchLive.jsx'
import GoodsStock from './pages/GoodsStock.jsx'
import Customers from './pages/Customers.jsx'

export default function App(){
  const [tab,setTab] = useState('dispatch')
  return (
    <div className="min-h-screen">
      <TopNav active={tab} onChange={setTab} />
      <main className="max-w-[1320px] mx-auto px-4 py-4">
        {tab==='dispatch' && <Dispatch/>}
        {tab==='live' && <LiveOps/>}
        {tab==='dispatchLive' && <DispatchLive/>}
        {tab==='goods' && <GoodsStock/>}
        {tab==='customers' && <Customers/>}
      </main>
    </div>
  )
}
