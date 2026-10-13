import { readSetting, writeSetting } from './env'

export interface GraphPhysics {
  repulsion: number
  linkStrength: number
  linkDistance: number
  gravity: number
}
export const DEFAULT_PHYSICS: GraphPhysics = { repulsion: 1.9, linkStrength: 0.55, linkDistance: 170, gravity: 0.45 }
export const PHYSICS_PRESETS: { id: string; label: string; physics: GraphPhysics }[] = [
  { id: 'tight', label: '紧凑', physics: { repulsion: 1.0, linkStrength: 1.4, linkDistance: 120, gravity: 1.0 } },
  { id: 'standard', label: '标准', physics: DEFAULT_PHYSICS },
  { id: 'loose', label: '宽松', physics: { repulsion: 2.7, linkStrength: 0.45, linkDistance: 190, gravity: 0.4 } },
  { id: 'sparse', label: '极散', physics: { repulsion: 3.8, linkStrength: 0.28, linkDistance: 230, gravity: 0.25 } },
]
const PHYSICS_KEY = 'graph-physics-v1'
export function loadPhysics(): GraphPhysics {
  try {
    const raw = readSetting(PHYSICS_KEY)
    if (!raw) return DEFAULT_PHYSICS
    const parsed = JSON.parse(raw) as Partial<GraphPhysics>
    const num = (v: unknown, fallback: number, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
    return {
      repulsion: num(parsed.repulsion, DEFAULT_PHYSICS.repulsion, 0.4, 4),
      linkStrength: num(parsed.linkStrength, DEFAULT_PHYSICS.linkStrength, 0, 2),
      linkDistance: num(parsed.linkDistance, DEFAULT_PHYSICS.linkDistance, 80, 320),
      gravity: num(parsed.gravity, DEFAULT_PHYSICS.gravity, 0, 2),
    }
  } catch { return DEFAULT_PHYSICS }
}
export function savePhysics(p: GraphPhysics): void { writeSetting(PHYSICS_KEY, JSON.stringify(p)) }
