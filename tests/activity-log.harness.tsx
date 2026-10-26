import { createRoot } from 'react-dom/client'
import { ActivityLog } from '../src/screens/ActivityLog'
import '../src/styles.css'
const role = new URLSearchParams(location.search).get('role') === 'organiser' ? 'organiser' : 'admin'
createRoot(document.getElementById('root')!).render(<main className="page"><ActivityLog group={{
  id: '00000000-0000-4000-8000-000000000001', name: 'Test group', role, timezone: 'Asia/Singapore', default_capacity: 16,
}} /></main>)
