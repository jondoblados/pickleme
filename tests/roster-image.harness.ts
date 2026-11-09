// FR-018 review harness: renders roster PNGs from fictional fixtures (no network).
// npm run dev, then open /pickleme/tests/roster-image.harness.html
import { renderRosterImage, type RosterImageEntry } from '../src/lib/roster-image.js'

/** Fictional stand-in "photo": a plain silhouette on a soft gradient (no real people). */
async function standIn(hue: number): Promise<ImageBitmap> {
  const c = document.createElement('canvas'); c.width = c.height = 512
  const x = c.getContext('2d')!
  const g = x.createLinearGradient(0, 0, 512, 512); g.addColorStop(0, `hsl(${hue} 35% 85%)`); g.addColorStop(1, `hsl(${hue} 30% 65%)`)
  x.fillStyle = g; x.fillRect(0, 0, 512, 512)
  x.fillStyle = `hsl(${hue} 40% 35%)`
  x.beginPath(); x.arc(256, 200, 92, 0, Math.PI * 2); x.fill()
  x.beginPath(); x.ellipse(256, 520, 190, 200, 0, Math.PI, 0); x.fill()
  return createImageBitmap(c)
}
const names = ['Kev', 'Santhosh', 'Sreeni', 'Greg', 'Esther', 'KAS', 'CK', 'Agnes Teo SE', 'Jon', 'Selvin', 'Hui En', 'Priyanka Singh',
  'Shawn', 'Shalini', 'Jay Perera', 'WendyK']
const withPhoto: Record<string, number> = { Santhosh: 20, Esther: 40, Jon: 210, 'Hui En': 150, 'Jay Perera': 280, Dobi: 30 }
async function entries(list: string[]): Promise<RosterImageEntry[]> {
  return Promise.all(list.map(async (name, i) => ({ name, userId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}${name}`,
    photo: name in withPhoto ? await standIn(withPhoto[name]) : null })))
}
const base = { title: 'Tuesday Socials (Weekly Game)', date: 'Tuesday, 10 November 2026', time: '6:00 pm – 9:00 pm (Asia/Singapore)',
  location: 'CBP1 L6 Multi-purpose Courts', capacity: 16 }
const cases: [string, Parameters<typeof renderRosterImage>[0]][] = [
  ['full', { ...base, playing: await entries(names), waitlist: await entries(['Dobi', 'Marcus Lim']), snapshot: '9 Nov 2026, 10:44:54 (Asia/Singapore)' }],
  ['open', { ...base, playing: await entries(names.slice(0, 9)), waitlist: [], snapshot: '8 Nov 2026, 09:15:02 (Asia/Singapore)' }],
  ['long', { ...base, title: 'CANCELLED: Tuesday Socials (Weekly Game) with a much longer name than usual', playing: await entries([...names.slice(0, 15), 'Bartholomew Alexander Fitzgerald-Montgomery III']),
    waitlist: await entries(['Ravi Kumar', 'Mei Ling Tan', 'Arjun', 'Siti Nurhaliza', 'Daniel Wong', 'Farah', 'Kenji Sato', 'Nadia Rahman', 'Leo', 'Grace Lim']), snapshot: '9 Nov 2026, 11:00:00 (Asia/Singapore)' }],
]
const out = document.getElementById('out')!
for (const [id, model] of cases) {
  const blob = await renderRosterImage(model)
  const img = new Image(); img.id = id; img.src = URL.createObjectURL(blob); img.width = 900
  out.append(img)
}
document.body.dataset.ready = '1'
