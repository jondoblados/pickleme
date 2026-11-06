// FR-017 weather icons: flat SVGs in the court-green / ball-lime palette. Decorative only —
// every icon is shown next to a text label, so they are hidden from screen readers.

const C = { court: '#14382b', court2: '#1f5a43', court3: '#2e7a5b', ball: '#d9f24a', cloud: '#ffffff', mist: '#9fb3a8' }
const stroke = { stroke: C.court, strokeWidth: 1.8, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const }

function Sun({ cx = 12, cy = 12, r = 4.6 }: { cx?: number; cy?: number; r?: number }) {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315].map(a => {
    const rad = (a * Math.PI) / 180
    return <line key={a} x1={cx + Math.cos(rad) * (r + 2)} y1={cy + Math.sin(rad) * (r + 2)}
      x2={cx + Math.cos(rad) * (r + 4)} y2={cy + Math.sin(rad) * (r + 4)} {...stroke} />
  })
  return <g>{rays}<circle cx={cx} cy={cy} r={r} fill={C.ball} {...stroke} /></g>
}
function Moon({ dx = 0, dy = 0 }: { dx?: number; dy?: number }) {
  return <path transform={`translate(${dx} ${dy})`} d="M15.5 4.2a7.5 7.5 0 1 0 4.3 12.4A6 6 0 0 1 15.5 4.2z" fill={C.ball} {...stroke} />
}
function Cloud({ dx = 0, dy = 0, fill = C.cloud }: { dx?: number; dy?: number; fill?: string }) {
  return <path transform={`translate(${dx} ${dy})`} fill={fill} {...stroke}
    d="M7.2 19h10a3.8 3.8 0 0 0 .4-7.6A5.4 5.4 0 0 0 7.3 10.6 4.2 4.2 0 0 0 7.2 19z" />
}
const drops = (xs: number[], y = 21) => xs.map(x => <line key={x} x1={x} y1={y} x2={x - 1} y2={y + 2.2} stroke={C.court3} strokeWidth={2} strokeLinecap="round" />)

export function WeatherIcon({ kind, size = 32 }: { kind: string; size?: number }) {
  let body
  switch (kind) {
    case 'clear': body = <Sun />; break
    case 'clear-night': body = <Moon />; break
    case 'partly': body = <><Sun cx={9} cy={8.5} r={3.6} /><Cloud dx={2} dy={1.5} /></>; break
    case 'partly-night': body = <><Moon dx={-4} dy={-2.5} /><Cloud dx={2} dy={1.5} /></>; break
    case 'fog': body = <><Cloud dy={-3} fill="#eef1ec" />{[18, 21].map(y => <line key={y} x1={4} y1={y} x2={20} y2={y} stroke={C.mist} strokeWidth={2} strokeLinecap="round" />)}</>; break
    case 'drizzle': body = <><Cloud dy={-3} />{drops([9, 15], 19.5)}</>; break
    case 'rain': body = <><Cloud dy={-3} />{drops([8, 12, 16], 19.5)}</>; break
    case 'showers': body = <><Sun cx={8} cy={6.5} r={3} /><Cloud dx={1} dy={-2} />{drops([10, 15], 20)}</>; break
    case 'thunder': body = <><Cloud dy={-3} fill="#e7ece8" /><path d="M12.8 15l-3 4.6h2.8l-1.6 4 4.6-5.6h-2.9l1.7-3z" fill={C.ball} stroke={C.court} strokeWidth={1.3} strokeLinejoin="round" /></>; break
    default: body = <Cloud dy={-1} />
  }
  return <svg className="wx-icon" width={size} height={size} viewBox="0 0 24 26" fill="none" aria-hidden="true" focusable="false">{body}</svg>
}
