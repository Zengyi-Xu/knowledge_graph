import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { NOTE_TYPE_META, GRADE_META, GRADE_COLORS } from '@/types/note'
import type { Note } from '@/types/note'
import { extractLinks } from '@/types/note'
import { readSetting, writeSetting } from '@/lib/env'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { RotateCcw, SlidersHorizontal, X } from 'lucide-react'

/**
 * 图谱物理参数（都写成「倍数」，方便用滑杆调）。
 * - repulsion    节点之间的斥力：越大越散
 * - linkStrength 双链带来的引力：越大相连节点拉得越近（也就是越「紧」）
 * - linkDistance 双链的目标长度（世界坐标 px）
 * - gravity      向心力：越大整体越往场地中心收
 */
export interface GraphPhysics {
  repulsion: number
  linkStrength: number
  linkDistance: number
  gravity: number
}

/** 1.0 倍对应的基础常数（旧版是 repulsion 2600 / gravity 0.003，整体偏紧） */
const PHYSICS_BASE = { repulsion: 2600, linkStrength: 0.02, gravity: 0.003 }

/** 默认值：比旧版明显松一些，解决「节点挤成一团」的问题 */
export const DEFAULT_PHYSICS: GraphPhysics = {
  repulsion: 1.9,
  linkStrength: 0.55,
  linkDistance: 170,
  gravity: 0.45,
}

export const PHYSICS_PRESETS: { id: string; label: string; physics: GraphPhysics }[] = [
  { id: 'tight', label: '紧凑', physics: { repulsion: 1.0, linkStrength: 1.4, linkDistance: 120, gravity: 1.0 } },
  { id: 'standard', label: '标准', physics: DEFAULT_PHYSICS },
  { id: 'loose', label: '宽松', physics: { repulsion: 2.7, linkStrength: 0.45, linkDistance: 190, gravity: 0.4 } },
  { id: 'sparse', label: '极散', physics: { repulsion: 3.8, linkStrength: 0.28, linkDistance: 230, gravity: 0.25 } },
]

const PHYSICS_KEY = 'graph-physics-v1'

// ---------------------------------------------------------------- 文献显示档位
export type GraphTier = 'no-literature' | 'linked' | 'all' | 'literature-only'

const TIER_KEY = 'graph-tier-v1'
const LINK_THRESHOLD_KEY = 'graph-link-threshold-v1'

export const TIER_OPTIONS: { id: GraphTier; label: string; hint: string }[] = [
  { id: 'no-literature', label: '无文献', hint: '只显示普通笔记（旧行为）' },
  { id: 'linked', label: '仅有关联', hint: '只显示至少有一条连线的文献节点（默认）' },
  { id: 'all', label: '全部', hint: '笔记 + 全部文献节点' },
  { id: 'literature-only', label: '仅文献', hint: '只看文献之间的连边' },
]

/** 渲染节点数超过该值时自动进入「疏布模式」 */
export const SPARSE_NODE_COUNT = 500

/** 度数 ≥ 该值的节点视为「枢纽」，疏布模式下启用渲染层（自身 + 2 跳内清晰，其余虚化） */
const HUB_DEGREE = 50

/** 节点数超过该值时，力模拟降频（隔帧运算），防止主线程被占满 */
const HEAVY_NODE_COUNT = 600

/** 单次加热最多模拟的步数；超过即自动暂停（负载保护，防止「碰碰车」拖死机器） */
const MAX_TICKS_PER_HEAT = 1500

/** 单步耗时的 EMA 超过该值（ms）也自动暂停 */
const MAX_STEP_MS_EMA = 24

function loadTier(): GraphTier {
  try {
    const raw = readSetting(TIER_KEY)
    if (raw && TIER_OPTIONS.some((t) => t.id === raw)) return raw as GraphTier
  } catch {
    /* ignore */
  }
  return 'linked'
}

function loadLinkThreshold(): number {
  try {
    const raw = readSetting(LINK_THRESHOLD_KEY)
    const n = Number(raw)
    if (Number.isFinite(n)) return clamp(Math.round(n), 1, 3)
  } catch {
    /* ignore */
  }
  return 1
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** 从 localStorage 读物理参数；缺字段/非法值一律回落到默认值 */
export function loadPhysics(): GraphPhysics {
  try {
    const raw = readSetting(PHYSICS_KEY)
    if (!raw) return DEFAULT_PHYSICS
    const parsed = JSON.parse(raw) as Partial<GraphPhysics>
    const num = (v: unknown, fallback: number, lo: number, hi: number) =>
      typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback
    return {
      repulsion: num(parsed.repulsion, DEFAULT_PHYSICS.repulsion, 0.4, 4),
      linkStrength: num(parsed.linkStrength, DEFAULT_PHYSICS.linkStrength, 0, 2),
      linkDistance: num(parsed.linkDistance, DEFAULT_PHYSICS.linkDistance, 80, 320),
      gravity: num(parsed.gravity, DEFAULT_PHYSICS.gravity, 0, 2),
    }
  } catch {
    return DEFAULT_PHYSICS
  }
}

export function savePhysics(p: GraphPhysics): void {
  writeSetting(PHYSICS_KEY, JSON.stringify(p))
}

// 多维分类：标签前缀 -> 维度颜色
const DIM_META: Record<string, { label: string; color: string }> = {
  功能: { label: '功能', color: '#3b82f6' },
  材料: { label: '材料', color: '#22c55e' },
  器件: { label: '器件', color: '#f97316' },
}
const DIM_ORDER = ['功能', '材料', '器件']

// 聚焦景深：按到焦点的跳数决定模糊档位与不透明度
const HOP_OPACITY = [1, 0.88, 0.62, 0.4]

function blurLevel(hop: number | undefined): number {
  if (hop === undefined) return 3
  if (hop <= 1) return 0
  return Math.min(hop - 1, 3)
}

function noteDims(n: Note): string[] {
  const dims = new Set<string>()
  for (const t of n.tags) {
    const i = t.indexOf(':')
    if (i > 0) {
      const p = t.slice(0, i)
      if (DIM_META[p]) dims.add(p)
    }
  }
  return DIM_ORDER.filter((d) => dims.has(d))
}

function sectorPath(r1: number, r2: number, a0: number, a1: number): string {
  const p0 = [r1 * Math.cos(a0), r1 * Math.sin(a0)]
  const p1 = [r1 * Math.cos(a1), r1 * Math.sin(a1)]
  const p2 = [r2 * Math.cos(a1), r2 * Math.sin(a1)]
  const p3 = [r2 * Math.cos(a0), r2 * Math.sin(a0)]
  const large = a1 - a0 > Math.PI ? 1 : 0
  const f = (v: number) => v.toFixed(3)
  return `M ${f(p0[0])} ${f(p0[1])} A ${r1} ${r1} 0 ${large} 1 ${f(p1[0])} ${f(p1[1])} L ${f(p2[0])} ${f(p2[1])} A ${r2} ${r2} 0 ${large} 0 ${f(p3[0])} ${f(p3[1])} Z`
}

interface Props {
  notes: Note[]
  onOpenNote: (id: string) => void
  filters: Filters
  focusId: string | null
  onFocusChange: (id: string | null) => void
  /** 力导向布局参数（斥力 / 双链引力 / 目标长度 / 向心力） */
  physics: GraphPhysics
  onPhysicsChange: (next: GraphPhysics) => void
}

export interface Filters {
  types: Set<string> // empty = all
  grades: Set<string> // empty = all
  tags: Set<string> // empty = all
  search: string
}

interface SimNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  r: number
}

/** 视野相机：cam.x/cam.y = 视野中心的世界坐标，zoom = 缩放 */
interface Cam {
  x: number
  y: number
  zoom: number
}

export function noteMatches(n: Note, f: Filters): boolean {
  if (f.types.size > 0 && !f.types.has(n.type)) return false
  if (f.grades.size > 0 && !(n.type === 'person' && f.grades.has(n.grade || 'none'))) return false
  if (f.tags.size > 0) {
    // 交集筛选：按标签前缀分组，同一前缀（同一维度）内满足任一即可，不同前缀之间须同时满足
    const groups = new Map<string, Set<string>>()
    for (const t of f.tags) {
      const i = t.indexOf(':')
      const key = i >= 0 ? t.slice(0, i) : ''
      if (!groups.has(key)) groups.set(key, new Set())
      groups.get(key)!.add(t)
    }
    for (const g of groups.values()) {
      if (!n.tags.some((t) => g.has(t))) return false
    }
  }
  if (f.search) {
    const q = f.search.toLowerCase()
    const hay = (n.title + ' ' + n.content + ' ' + n.tags.join(' ')).toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}

export function GraphView({
  notes,
  onOpenNote,
  filters,
  focusId,
  onFocusChange,
  physics,
  onPhysicsChange,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  /** 文献显示档位（本地记忆） */
  const [tier, setTier] = useState<GraphTier>(loadTier)
  /** 「仅有关联」档的度数阈值：度数 ≥ N 的文献才显示 */
  const [linkThreshold, setLinkThreshold] = useState<number>(loadLinkThreshold)
  /**
   * 疏布模式下用户手动改过力参数后为 true：本会话内不再自动覆盖。
   * 节点数回落到阈值以下时自动复位。
   */
  const [manualPhysics, setManualPhysics] = useState(false)
  /** 负载熔断：模拟步数/单步耗时超标后自动暂停，需用户点「继续」 */
  const [autoPaused, setAutoPaused] = useState(false)
  const [cam, setCam] = useState<Cam>({ x: 1300, y: 900, zoom: 1 })
  const nodesRef = useRef<Map<string, SimNode>>(new Map())
  /** 新节点落位计数：linked 用黄金角螺旋编号，isolated 用外环停车场编号 */
  const placeRef = useRef({ seq: 0, park: 0 })
  const ticksRef = useRef(0)
  const stepEmaRef = useRef(0)
  const dragRef = useRef<{ id: string; dx: number; dy: number; sx: number; sy: number } | null>(null)
  const panRef = useRef<{ lastX: number; lastY: number; camX: number; camY: number } | null>(null)
  const movedRef = useRef(false)
  const centeredTierRef = useRef<string>('')
  const [, forceTick] = useState(0)
  const [simNonce, setSimNonce] = useState(0)

  const changeTier = useCallback((next: GraphTier) => {
    setTier(next)
    writeSetting(TIER_KEY, next)
  }, [])

  const changeLinkThreshold = useCallback((next: number) => {
    const v = clamp(Math.round(next), 1, 3)
    setLinkThreshold(v)
    writeSetting(LINK_THRESHOLD_KEY, String(v))
  }, [])

  // 全量边 + 每个节点的度数（在文献档位过滤之前算，避免「只显示有连线的」变成自指）
  const { degreeById } = useMemo(() => {
    const degree = new Map<string, number>()
    const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1)
    for (const n of notes) {
      for (const t of extractLinks(n.content)) {
        const o = notes.find((x) => x.title.toLowerCase() === t.toLowerCase())
        if (!o || o.id === n.id) continue
        bump(n.id)
        bump(o.id)
      }
    }
    return { degreeById: degree }
  }, [notes])

  // 可见节点：先按筛选条件过滤，再按文献档位过滤
  const visible = useMemo(
    () =>
      notes.filter((n) => {
        if (!noteMatches(n, filters)) return false
        if (n.type === 'literature') {
          if (tier === 'no-literature') return false
          if (tier === 'literature-only') return true
          // linked：只保留度数达标的文献
          return (degreeById.get(n.id) ?? 0) >= linkThreshold
        }
        // 非文献节点在「仅文献」档隐藏
        return tier !== 'literature-only'
      }),
    [notes, filters, tier, linkThreshold, degreeById],
  )

  // 边 + 聚焦跳数。聚焦时不再隐藏节点，而是按到焦点的跳数逐层虚化
  const { shownIds, shownEdges, hopById } = useMemo(() => {
    const ids = new Set(visible.map((n) => n.id))
    const edgeSet = new Set<string>()
    const edges: { source: string; target: string }[] = []
    for (const n of notes) {
      for (const t of extractLinks(n.content)) {
        const o = notes.find((x) => x.title.toLowerCase() === t.toLowerCase())
        if (!o || o.id === n.id) continue
        const key = n.id < o.id ? `${n.id}|${o.id}` : `${o.id}|${n.id}`
        if (edgeSet.has(key)) continue
        edgeSet.add(key)
        edges.push({ source: n.id, target: o.id })
      }
    }
    const kept = edges.filter((e) => ids.has(e.source) && ids.has(e.target))
    const hop = new Map<string, number>()
    if (focusId && ids.has(focusId)) {
      hop.set(focusId, 0)
      let frontier = [focusId]
      let depth = 0
      while (frontier.length > 0) {
        depth += 1
        const next: string[] = []
        for (const id of frontier) {
          for (const e of kept) {
            let other: string | null = null
            if (e.source === id) other = e.target
            else if (e.target === id) other = e.source
            if (other && ids.has(other) && !hop.has(other)) {
              hop.set(other, depth)
              next.push(other)
            }
          }
        }
        frontier = next
      }
    }
    return { shownIds: ids, shownEdges: kept, hopById: hop }
  }, [notes, visible, focusId])

  const shownNotes = useMemo(() => visible.filter((n) => shownIds.has(n.id)), [visible, shownIds])
  const focusActive = Boolean(focusId)

  /** 疏布模式：节点太多时自动拉大距离、降低引力/斥力，并做标签渲染降级 */
  const sparseActive = shownNotes.length > SPARSE_NODE_COUNT

  // 节点数回落到阈值以下时，允许疏布模式下次再自动接管
  useEffect(() => {
    if (!sparseActive) setManualPhysics(false)
  }, [sparseActive])

  /**
   * 实际生效的力参数。疏布模式自动套用「距离 ×1.8、斥力 ×0.4、引力 ×0.5、向心 ×0.3」；
   * 用户手动调过任何滑杆/预设后本会话内以用户为准。
   */
  const effPhysics: GraphPhysics = useMemo(
    () =>
      sparseActive && !manualPhysics
        ? {
            repulsion: physics.repulsion * 0.4,
            linkStrength: physics.linkStrength * 0.5,
            linkDistance: physics.linkDistance * 1.8,
            gravity: physics.gravity * 0.3,
          }
        : physics,
    [sparseActive, manualPhysics, physics],
  )

  /** 用户在图谱里调力参数：记为手动覆盖，疏布模式不再自动改写 */
  const changePhysics = useCallback(
    (next: GraphPhysics) => {
      setManualPhysics(true)
      onPhysicsChange(next)
    },
    [onPhysicsChange],
  )

  /**
   * 世界（场地）：比视野大得多。视野只是世界的一个窗口（可平移缩放）。
   * 世界尺寸随节点数增长，保证「全部」档位下节点有地方摊开。
   */
  const world = useMemo(() => {
    const n = Math.max(shownNotes.length, 1)
    const span = Math.ceil(Math.sqrt(n))
    const w = Math.max(size.w * 2.2, span * 130, 2600)
    const h = Math.max(size.h * 2.2, span * 130, 1800)
    return { w, h }
  }, [size.w, size.h, shownNotes.length])

  // 切档位时把视野重置到世界中心（不同档位的世界尺度完全不同）
  useEffect(() => {
    if (centeredTierRef.current === tier) return
    centeredTierRef.current = tier
    setCam({ x: world.w / 2, y: world.h / 2, zoom: 1 })
  }, [tier, world.w, world.h])

  /**
   * 枢纽渲染层：疏布模式下，度数 ≥ HUB_DEGREE 的节点是「枢纽」。
   * 只让 枢纽 + 2 跳内 的节点清晰渲染，其余全部虚化（不删除，仍可悬停查看）。
   */
  const hubLayer = useMemo(() => {
    if (!sparseActive) return null
    const hubs = shownNotes.filter((n) => (degreeById.get(n.id) ?? 0) >= HUB_DEGREE).map((n) => n.id)
    if (hubs.length === 0) return null
    const adj = new Map<string, string[]>()
    const push = (a: string, b: string) => {
      if (!adj.has(a)) adj.set(a, [])
      adj.get(a)!.push(b)
    }
    for (const e of shownEdges) {
      push(e.source, e.target)
      push(e.target, e.source)
    }
    const sharp = new Set(hubs)
    let frontier = [...hubs]
    for (let d = 0; d < 2 && frontier.length > 0; d++) {
      const next: string[] = []
      for (const id of frontier) {
        for (const o of adj.get(id) ?? []) {
          if (!sharp.has(o)) {
            sharp.add(o)
            next.push(o)
          }
        }
      }
      frontier = next
    }
    return { hubs: new Set(hubs), sharp }
  }, [sparseActive, shownNotes, shownEdges, degreeById])

  // 尺寸自适应
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      setSize({ w: rect.width, h: rect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /**
   * 新节点落位（世界坐标）：
   * - 有连接的节点：黄金角螺旋（phylotaxis）——任意两个新节点天然拉开距离，
   *   避免「全部」档位下 2000+ 节点从拥挤初值再炸开；
   * - 孤立节点（度数 0）：停放到世界外缘的多层同心环「停车场」，
   *   不参与中心区域的拥挤，也不产生长程斥力消耗。
   */
  const placeNode = useCallback(
    (degree: number): { x: number; y: number } => {
      const cx = world.w / 2
      const cy = world.h / 2
      const golden = 2.399963229728653
      if (degree === 0) {
        let i = placeRef.current.park++
        let ring = 0
        const base = Math.min(world.w, world.h) * 0.36
        for (;;) {
          const R = base + ring * 110
          const cap = Math.max(6, Math.floor((2 * Math.PI * R) / 52))
          if (i < cap) {
            const a = (i / cap) * 2 * Math.PI + ring * 0.7
            return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) }
          }
          i -= cap
          ring++
        }
      }
      const i = placeRef.current.seq++
      const rad = 26 * Math.sqrt(i + 1)
      const a = i * golden
      return { x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) }
    },
    [world.w, world.h],
  )

  // 初始化新节点位置 & 移除消失节点
  useEffect(() => {
    const map = nodesRef.current
    for (const n of shownNotes) {
      if (!map.has(n.id)) {
        const p = placeNode(degreeById.get(n.id) ?? 0)
        map.set(n.id, { id: n.id, x: p.x, y: p.y, vx: 0, vy: 0, r: 0 })
      }
    }
    for (const id of [...map.keys()]) {
      if (!shownIds.has(id)) map.delete(id)
    }
  }, [shownNotes, shownIds, degreeById, placeNode])

  // 力导向模拟（世界坐标）
  useEffect(() => {
    if (autoPaused) return
    let raf = 0
    let frame = 0
    ticksRef.current = 0
    stepEmaRef.current = 0
    // 场地越大越松：斥力按世界面积缩放，避免小窗口爆炸、大场地又挤在一起
    const areaScale = clamp((world.w * world.h) / (2600 * 1800), 0.55, 3.2)
    const repulsionConst = PHYSICS_BASE.repulsion * effPhysics.repulsion * areaScale
    const springK = PHYSICS_BASE.linkStrength * effPhysics.linkStrength
    const gravity = PHYSICS_BASE.gravity * effPhysics.gravity
    const cx = world.w / 2
    const cy = world.h / 2
    // 斥力截断距离：按 1/d² 衰减，远处的合力贡献可忽略
    const cutoff = Math.max(500, effPhysics.linkDistance * 2.2)
    const cutoff2 = cutoff * cutoff
    // 空间哈希格子边长：斥力计算只查 3×3 邻格，O(n·k) 代替 O(n²)
    const cell = Math.max(140, cutoff / 1.5)
    const heavy = () => nodesRef.current.size > HEAVY_NODE_COUNT

    const step = () => {
      const t0 = performance.now()
      const map = nodesRef.current
      const arr = [...map.values()]

      // 斥力：节点多时用空间哈希，只算邻近格内的点对
      if (arr.length > 300) {
        const grid = new Map<string, number[]>()
        const keyOf = (x: number, y: number) => `${Math.floor(x / cell)}|${Math.floor(y / cell)}`
        for (let i = 0; i < arr.length; i++) {
          const k = keyOf(arr[i].x, arr[i].y)
          if (!grid.has(k)) grid.set(k, [])
          grid.get(k)!.push(i)
        }
        const seen = new Set<string>()
        for (let i = 0; i < arr.length; i++) {
          const a = arr[i]
          const gx = Math.floor(a.x / cell)
          const gy = Math.floor(a.y / cell)
          for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
              const bucket = grid.get(`${gx + ox}|${gy + oy}`)
              if (!bucket) continue
              for (const j of bucket) {
                if (j <= i) continue
                const pk = `${i}|${j}`
                if (seen.has(pk)) continue
                seen.add(pk)
                applyRepulsion(a, arr[j])
              }
            }
          }
        }
      } else {
        for (let i = 0; i < arr.length; i++) {
          for (let j = i + 1; j < arr.length; j++) {
            applyRepulsion(arr[i], arr[j])
          }
        }
      }

      function applyRepulsion(a: SimNode, b: SimNode) {
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d2 = dx * dx + dy * dy
        if (d2 > cutoff2) return
        if (d2 < 1) {
          dx = Math.random() - 0.5
          dy = Math.random() - 0.5
          d2 = 1
        }
        const f = repulsionConst / d2
        const d = Math.sqrt(d2)
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        a.vx -= fx
        a.vy -= fy
        b.vx += fx
        b.vy += fy
      }

      // 双链引力：类似弹簧，长度 > linkDistance 时相吸、短于目标才推开
      for (const e of shownEdges) {
        const a = map.get(e.source)
        const b = map.get(e.target)
        if (!a || !b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
        const f = ((d - effPhysics.linkDistance) * springK) / d
        a.vx += dx * f
        a.vy += dy * f
        b.vx -= dx * f
        b.vy -= dy * f
      }
      // 向心 & 阻尼；位置约束在世界边界内（不是视野边界）
      for (const n of arr) {
        if (dragRef.current?.id === n.id) continue
        n.vx += (cx - n.x) * gravity
        n.vy += (cy - n.y) * gravity
        n.vx *= 0.82
        n.vy *= 0.82
        n.x += Math.max(-12, Math.min(12, n.vx))
        n.y += Math.max(-12, Math.min(12, n.vy))
        n.x = Math.max(30, Math.min(world.w - 30, n.x))
        n.y = Math.max(30, Math.min(world.h - 30, n.y))
      }
      let maxV = 0
      for (const n of arr) maxV = Math.max(maxV, Math.abs(n.vx), Math.abs(n.vy))

      // 负载熔断：单步耗时 EMA 或总步数超标 → 自动暂停，交给用户决定
      const dt = performance.now() - t0
      stepEmaRef.current = stepEmaRef.current === 0 ? dt : stepEmaRef.current * 0.9 + dt * 0.1
      ticksRef.current++
      if (ticksRef.current > MAX_TICKS_PER_HEAT || (ticksRef.current > 40 && stepEmaRef.current > MAX_STEP_MS_EMA)) {
        setAutoPaused(true)
        return
      }
      forceTick((t) => t + 1)
      // 速度足够小就停住，避免节点持续漂移导致难以点中
      if (maxV > 0.05) raf = requestAnimationFrame(loop)
    }

    // 重载模式：隔帧运算 + 隔帧渲染，把主线程让出来
    const loop = () => {
      frame++
      if (heavy() && frame % 2 === 0) {
        raf = requestAnimationFrame(loop)
        return
      }
      step()
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [shownEdges, world.w, world.h, simNonce, effPhysics, autoPaused])

  // 屏幕坐标（clientX/Y）→ 世界坐标
  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current
      if (!svg) return { x: 0, y: 0 }
      const pt = svg.createSVGPoint()
      pt.x = clientX
      pt.y = clientY
      const s = pt.matrixTransform(svg.getScreenCTM()!.inverse())
      return {
        x: (s.x - size.w / 2) / cam.zoom + cam.x,
        y: (s.y - size.h / 2) / cam.zoom + cam.y,
      }
    },
    [size.w, size.h, cam],
  )

  // 屏幕坐标 → svg 视口坐标（不含相机变换）
  const toViewport = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    return pt.matrixTransform(svg.getScreenCTM()!.inverse())
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      const pt = toWorld(e.clientX, e.clientY)
      const node = nodesRef.current.get(id)
      if (!node) return
      movedRef.current = false
      dragRef.current = { id, dx: pt.x - node.x, dy: pt.y - node.y, sx: pt.x, sy: pt.y }
      setSimNonce((v) => v + 1)
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
    },
    [toWorld],
  )

  /** 空白处按下 = 平移视野（世界比视野大，视野是可以动的窗口） */
  const onBackgroundPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.target !== svgRef.current) return
      movedRef.current = false
      panRef.current = { lastX: e.clientX, lastY: e.clientY, camX: cam.x, camY: cam.y }
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
    },
    [cam.x, cam.y],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (panRef.current) {
        const dx = e.clientX - panRef.current.lastX
        const dy = e.clientY - panRef.current.lastY
        if (!movedRef.current && Math.hypot(dx, dy) > 4) movedRef.current = true
        setCam((c) => ({
          ...c,
          x: panRef.current!.camX - dx / c.zoom,
          y: panRef.current!.camY - dy / c.zoom,
        }))
        return
      }
      const drag = dragRef.current
      if (!drag) return
      const node = nodesRef.current.get(drag.id)
      if (!node) return
      const pt = toWorld(e.clientX, e.clientY)
      // 位移超过阈值即视为拖动，松手后不会触发点击
      if (!movedRef.current && Math.hypot(pt.x - drag.sx, pt.y - drag.sy) > 4) movedRef.current = true
      node.x = pt.x - drag.dx
      node.y = pt.y - drag.dy
      node.vx = 0
      node.vy = 0
    },
    [toWorld],
  )

  const onPointerUp = useCallback(() => {
    dragRef.current = null
    panRef.current = null
  }, [])

  /** 滚轮缩放：以光标为中心 */
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const factor = Math.exp(-e.deltaY * 0.0012)
      setCam((c) => {
        const z2 = clamp(c.zoom * factor, 0.15, 3.5)
        const s = toViewport(e.clientX, e.clientY)
        // 保持光标下的世界点不动
        const wx = (s.x - size.w / 2) / c.zoom + c.x
        const wy = (s.y - size.h / 2) / c.zoom + c.y
        return { x: wx - (s.x - size.w / 2) / z2, y: wy - (s.y - size.h / 2) / z2, zoom: z2 }
      })
    },
    [toViewport, size.w, size.h],
  )

  const noteById = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes])
  const map = nodesRef.current

  /** 把节点重新撒开（按落位规则），让布局在当前参数下重新收敛 */
  const relayout = useCallback(() => {
    placeRef.current = { seq: 0, park: 0 }
    for (const n of nodesRef.current.values()) {
      const p = placeNode(degreeById.get(n.id) ?? 0)
      n.x = p.x
      n.y = p.y
      n.vx = 0
      n.vy = 0
    }
    setAutoPaused(false)
    setSimNonce((v) => v + 1)
  }, [placeNode, degreeById])

  const resumeSim = useCallback(() => {
    setAutoPaused(false)
    setSimNonce((v) => v + 1)
  }, [])

  const activePreset = PHYSICS_PRESETS.find(
    (p) =>
      Math.abs(p.physics.repulsion - physics.repulsion) < 1e-6 &&
      Math.abs(p.physics.linkStrength - physics.linkStrength) < 1e-6 &&
      Math.abs(p.physics.linkDistance - physics.linkDistance) < 1e-6 &&
      Math.abs(p.physics.gravity - physics.gravity) < 1e-6,
  )?.id

  const tierLabel = TIER_OPTIONS.find((t) => t.id === tier)?.label ?? ''

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border bg-card">
      {/* 文献显示档位 + 熔断提示 */}
      <div className="absolute left-3 top-3 z-10 flex flex-col items-start gap-2">
        <div className="flex items-center gap-0.5 rounded-lg border bg-background/95 p-1 text-xs shadow backdrop-blur">
          {TIER_OPTIONS.map((t) => (
            <button
              key={t.id}
              title={t.hint}
              onClick={() => changeTier(t.id)}
              className={`rounded px-2 py-1 transition-colors ${
                tier === t.id
                  ? 'bg-primary font-medium text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {t.label}
            </button>
          ))}
          {tier === 'linked' && (
            <select
              value={linkThreshold}
              onChange={(e) => changeLinkThreshold(Number(e.target.value))}
              title="只显示连线数 ≥ N 的文献"
              className="ml-1 h-6 rounded border bg-background px-1 text-[11px]"
            >
              <option value={1}>度数≥1</option>
              <option value={2}>度数≥2</option>
              <option value={3}>度数≥3</option>
            </select>
          )}
        </div>
        {autoPaused && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-400/60 bg-background/95 px-3 py-1.5 text-xs shadow backdrop-blur">
            布局已自动暂停（负载保护）
            <Button size="sm" className="h-6 px-2 text-[11px]" onClick={resumeSim}>
              继续
            </Button>
          </div>
        )}
      </div>

      {/* 力参数面板：斥力 / 双链引力 / 连线长度 / 中心聚集 */}
      <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-2">
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={relayout} title="把节点重新撒开，按当前参数重新收敛">
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> 重新布局
          </Button>
          <Button
            variant={panelOpen ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPanelOpen((v) => !v)}
            title="节点斥力与双链引力"
          >
            {panelOpen ? (
              <X className="mr-1 h-3.5 w-3.5" />
            ) : (
              <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
            )}
            力参数
          </Button>
        </div>

        {panelOpen && (
          <div className="w-64 rounded-lg border bg-background/95 p-3 text-xs shadow-lg backdrop-blur">
            <div className="mb-2 flex flex-wrap gap-1">
              {PHYSICS_PRESETS.map((p) => (
                <Button
                  key={p.id}
                  variant={activePreset === p.id ? 'default' : 'outline'}
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => changePhysics({ ...p.physics })}
                >
                  {p.label}
                </Button>
              ))}
            </div>

            {sparseActive &&
              (manualPhysics ? (
                <div className="mb-2 rounded border border-amber-400/50 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                  疏布模式已按你的手动参数运行。
                  <button className="ml-1 underline" onClick={() => setManualPhysics(false)}>
                    恢复自动
                  </button>
                </div>
              ) : (
                <div className="mb-2 rounded border bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                  节点较多：已自动拉开距离、降低引力/斥力，并隐藏大部分标签。
                </div>
              ))}

            <PhysicsSlider
              label="节点斥力"
              hint="调大 → 节点之间更松散"
              value={physics.repulsion}
              min={0.4}
              max={4}
              step={0.1}
              format={(v) => `×${v.toFixed(1)}`}
              onChange={(v) => changePhysics({ ...physics, repulsion: v })}
            />
            <PhysicsSlider
              label="双链引力"
              hint="调大 → 有双链的笔记拉得更近（越紧）"
              value={physics.linkStrength}
              min={0}
              max={2}
              step={0.05}
              format={(v) => `×${v.toFixed(2)}`}
              onChange={(v) => changePhysics({ ...physics, linkStrength: v })}
            />
            <PhysicsSlider
              label="连线长度"
              hint="一对双链笔记的舒适距离"
              value={physics.linkDistance}
              min={80}
              max={320}
              step={10}
              format={(v) => `${Math.round(v)} px`}
              onChange={(v) => changePhysics({ ...physics, linkDistance: v })}
            />
            <PhysicsSlider
              label="中心聚集"
              hint="调小 → 整体更铺开、更少往中心挤"
              value={physics.gravity}
              min={0}
              max={2}
              step={0.05}
              format={(v) => `×${v.toFixed(2)}`}
              onChange={(v) => changePhysics({ ...physics, gravity: v })}
            />

            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-7 w-full text-[11px]"
              onClick={() => changePhysics({ ...DEFAULT_PHYSICS })}
            >
              <RotateCcw className="mr-1 h-3 w-3" /> 恢复默认力参数
            </Button>
          </div>
        )}
      </div>

      <svg
        ref={svgRef}
        className="h-full w-full touch-none select-none"
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onClick={(e) => {
          if (e.target === svgRef.current && !movedRef.current) onFocusChange(null)
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <filter id="kgblur1" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="1.1" />
          </filter>
          <filter id="kgblur2" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.1" />
          </filter>
          <filter id="kgblur3" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.2" />
          </filter>
        </defs>

        {/* 世界层：视野只是世界的窗口，可平移缩放 */}
        <g transform={`translate(${size.w / 2},${size.h / 2}) scale(${cam.zoom}) translate(${-cam.x},${-cam.y})`}>
          {/* 边 */}
          {shownEdges.map((e, i) => {
            const a = map.get(e.source)
            const b = map.get(e.target)
            if (!a || !b) return null
            const active =
              hoverId === e.source || hoverId === e.target || focusId === e.source || focusId === e.target
            const nearFocus =
              focusActive && (hopById.get(e.source) ?? 9) <= 1 && (hopById.get(e.target) ?? 9) <= 1
            // 枢纽渲染层：不在任何枢纽 2 跳范围内的边全部虚化
            const fadedByHub =
              !focusActive && Boolean(hubLayer) && (!hubLayer!.sharp.has(e.source) || !hubLayer!.sharp.has(e.target))
            let opacity = focusActive ? (nearFocus ? 0.6 : 0.07) : active ? 0.7 : 0.22
            if (fadedByHub && !active) opacity = Math.min(opacity, 0.08)
            const width = focusActive ? (nearFocus ? 1.6 : 1) : active ? 1.8 : 1.2
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={active ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'}
                strokeOpacity={opacity}
                strokeWidth={width / cam.zoom}
              />
            )
          })}

          {/* 节点（整组按 1/zoom 缩放：圆点与文字保持屏幕大小，不随世界缩放变形） */}
          {shownNotes.map((n) => {
            const node = map.get(n.id)
            if (!node) return null
            const meta = NOTE_TYPE_META[n.type]
            const isFocus = n.id === focusId
            const isHover = n.id === hoverId
            const color = n.type === 'person' && n.grade ? GRADE_COLORS[n.grade] : meta.color
            const degree = degreeById.get(n.id) ?? 0
            // 疏布模式下文献缩成小圆点（半径按度数分级），普通节点保持原尺寸
            const isLit = n.type === 'literature'
            const r =
              isFocus || isHover ? 13 : sparseActive && isLit ? clamp(3 + degree * 0.6, 3.5, 8) : 10
            const dims = noteDims(n)
            const lvl = focusActive ? blurLevel(hopById.get(n.id)) : 0
            // 枢纽渲染层：枢纽 + 2 跳内清晰，其余虚化（悬停时恢复）
            const fadedByHub =
              !focusActive && Boolean(hubLayer) && !isHover && !hubLayer!.sharp.has(n.id)
            // 标签策略：文献默认不显示标题（数量太大）；疏布模式下被枢纽层虚化的节点也不显示
            const showLabel =
              (isHover || isFocus || !isLit) &&
              (!sparseActive || !isLit || isHover || isFocus) &&
              (!fadedByHub || !isLit)
            return (
              <g
                key={n.id}
                transform={`translate(${node.x},${node.y}) scale(${1 / cam.zoom})`}
                className="cursor-pointer"
                opacity={(focusActive ? HOP_OPACITY[lvl] : 1) * (fadedByHub ? 0.25 : 1)}
                filter={lvl > 0 ? `url(#kgblur${lvl})` : undefined}
                onPointerDown={(e) => onPointerDown(e, n.id)}
                onMouseEnter={() => setHoverId(n.id)}
                onMouseLeave={() => setHoverId(null)}
                onClick={() => {
                  if (movedRef.current) return
                  // 未选中 → 选中并聚焦；已选中 → 打开笔记
                  if (isFocus) onOpenNote(n.id)
                  else onFocusChange(n.id)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (movedRef.current) return
                  onFocusChange(isFocus ? null : n.id)
                }}
              >
                <circle r={r + 7} fill="transparent" />
                <circle
                  r={r}
                  fill={color}
                  fillOpacity={0.85}
                  stroke={isFocus ? 'hsl(var(--primary))' : 'hsl(var(--background))'}
                  strokeWidth={isFocus ? 3 : 1.5}
                  style={{ transition: 'r 0.15s' }}
                />
                {dims.length === 1 && (
                  <circle r={r + 4} fill="none" stroke={DIM_META[dims[0]].color} strokeWidth={4} />
                )}
                {dims.length > 1 && (
                  <g>
                    {dims.map((d, i) => {
                      const a0 = (i / dims.length) * 2 * Math.PI - Math.PI / 2
                      const a1 = ((i + 1) / dims.length) * 2 * Math.PI - Math.PI / 2
                      return (
                        <path
                          key={d}
                          d={sectorPath(r + 2, r + 6, a0, a1)}
                          fill={DIM_META[d].color}
                          fillOpacity={0.9}
                        />
                      )
                    })}
                  </g>
                )}
                {showLabel && (
                  <text
                    y={r + 14}
                    textAnchor="middle"
                    className="pointer-events-none fill-foreground"
                    fontSize={11}
                    style={{ userSelect: 'none' }}
                  >
                    {n.title.length > 14 ? n.title.slice(0, 13) + '…' : n.title}
                  </text>
                )}
                {n.type === 'person' && n.grade && (
                  <text
                    y={4}
                    textAnchor="middle"
                    className="pointer-events-none"
                    fontSize={8}
                    fill="#fff"
                    fontWeight={700}
                  >
                    {(GRADE_META[n.grade] ?? '')[0]}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>

      {/* 统计信息 */}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-background/80 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur">
        {tierLabel} · 显示 {shownNotes.length} / {notes.length} 篇笔记 · {shownEdges.length} 条连线 ·
        视野 {Math.round(cam.zoom * 100)}%
        {focusId && noteById.get(focusId) && (
          <span className="ml-2 text-primary">
            焦点：{noteById.get(focusId)!.title}（再次单击可打开，单击空白处取消）
          </span>
        )}
      </div>
    </div>
  )
}

/** 力参数面板里的一行滑杆 */
function PhysicsSlider({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <div className="mb-2.5">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">{format(value)}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        aria-label={label}
      />
      <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
    </div>
  )
}
