import type { MyStatus } from '../lib/api'

export function StatusChip({ me }: { me: MyStatus }) {
  if (me.status === 'playing') return <span className="chip chip-playing">Playing #{me.position}</span>
  if (me.status === 'waitlist') return <span className="chip chip-waitlist">Waitlist #{me.position}</span>
  return <span className="chip chip-none">Not signed up</span>
}
