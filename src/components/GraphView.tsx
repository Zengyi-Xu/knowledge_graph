import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { NOTE_TYPE_META, GRADE_META, GRADE_COLORS } from '@/types/note'
import type { Note } from '@/types/note'
import { readSetting, writeSetting } from '@/lib/env'
import { buildTopicEdges } from '@/lib/topicLinks'
import { assignHubIds, clusterLiterature, type LitCluster } from '@/lib/litCluster'
import {
  buildTitleIndex,
  buildWikilinkEdges,
  computeDegreeById,
  computeNoteDegrees,
  literatureLinkedVisible,
  selectTopicLiterature,
  type GraphTier,
} from '@/lib/graphModel'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { ChevronLeft, RotateCcw, SlidersHorizontal, X } from 'lucide-react'

/**
 * 图谱物理参数（都写成「倍数」，方便用滑杆调）。
 * - repulsion    节点之间的斥力：越大越散
 * - linkStrength 双链带来的引力：越大相连节点拉得越近（也就是越「紧」）
 * - linkDistance 双链的目标长度（世界坐标 px）
 * - gravity      向心力：越大整体越往场地中心收
 */
import { DEFAULT_PHYSICS, PHYSICS_PRESETS, type GraphPhysics } from '@/lib/graphPhysics'
const PHYSICS_BASE = { repulsion: 2600, linkStrength: 0.02, gravity: 0.003 }

const TIER_KEY = 'graph-tier-v1'
const LINK_THRESHOLD_KEY = 'graph-link-threshold-v1'
const TOPIC_KEY = 'graph-topic-links-v1'
const HUB_ONLY_KEY = 'graph-hub-only-v1'
/** 「仅文献」档的聚类下钻开关（本地记忆） */
const CLUSTER_KEY = 'graph-lit-cluster-v1'

/** 话题相关边默认开；关掉后回到纯 [[双链]] 视图 */
function loadTopicLinks(): boolean {
  try {
    const raw = readSetting(TOPIC_KEY)
    if (raw === '0') return false
  } catch {
    /* ignore */
  }
  return true
}

/** 大节点优先渲染（只标大节点、其余虚化缩小）：默认关，由用户强制开启并本地记忆 */
function loadHubOnly(): boolean {
  try {
    return readSetting(HUB_ONLY_KEY) === '1'
  } catch {
    /* ignore */
  }
  return false
}

/** 文献聚类下钻（仅文献档）：默认开 —— 两千多篇铺开本来就只能看成一团雾 */
function loadClusterOn(): boolean {
  try {
    if (readSetting(CLUSTER_KEY) === '0') return false
  } catch {
    /* ignore */
  }
  return true
}

/**
 * 聚类节点的合成 id 前缀：这些节点不在 notes 里，位置只活在 nodesRef 里。
 * 用 `#` 开头，和真实笔记 id（`zotero-xxxx`）不会撞。
 */
const CLUSTER_NODE_PREFIX = '#cl:'

const TIER_OPTIONS: { id: GraphTier; label: string; hint: string }[] = [
  { id: 'no-literature', label: '无文献', hint: '只显示普通笔记（旧行为）' },
  { id: 'linked', label: '仅有关联', hint: '只显示与普通笔记有 [[双链]] 的文献（默认）' },
  { id: 'all', label: '全部', hint: '笔记 + 全部文献节点' },
  { id: 'literature-only', label: '仅文献', hint: '按聚类看文献：先只画几个簇，点一下簇就铺开它的文献（可关掉看全部）' },
]

/** 渲染节点数超过该值时自动进入「疏布模式」 */
const SPARSE_NODE_COUNT = 500

/** 度数 ≥ 该值的节点视为「枢纽」，疏布模式下启用渲染层（自身 + 2 跳内清晰，其余虚化） */
const HUB_DEGREE = 50

/** 标签基准字号（屏幕像素基准值，实际大小再乘视野缩放） */
const LABEL_FONT = 11

/** 圆环外沿：单维节点画在 r+4、多维扇区画到 r+6（见 sectorPath），标签间距以外沿为基准 */
const LABEL_RING_OUT = 6
/** 标签基线离圆环外沿的间距（屏幕像素，在「1 倍字号」下；随字号等比放大，见 textZoom） */
const LABEL_GAP = 14

/** 标签随视野缩放的上下限：放大时倍率封顶（免得字大到盖住图谱），缩小时倍率下限即「大节点优先」阈值 */
const LABEL_MAX_ZOOM = 2
const LABEL_CROWDED_ZOOM = 0.8

/** 只标大节点：按连接数取前 N 个「笔记」节点（文献本来就不标标题，不占名额），其余虚化 + 缩小且不标字。
 *  用排名而不是固定度数阈值：档位/筛选一变节点规模就差几十倍，固定阈值要么标满屏、要么一个不标。 */
const LABEL_HUB_COUNT = 10
/** 大节点优先渲染时，非大节点的不透明度与半径系数 */
const CROWDED_OPACITY = 0.3
const CROWDED_SHRINK = 0.6
/** 按中心上色的成员被压暗时的下限：0.3 叠上莫兰迪色辨不出色相，抬到能分辨 */
const HUB_DIM_OPACITY = 0.85

/**
 * 「仅文献」聚类视图的常量。
 * - 簇节点半径随成员数增长（封顶，免得一个 400 篇的簇占满屏幕）；
 * - 同一层里离重心远的节点虚化（SPREAD_IN/OUT 是「均方半径」的倍数）；
 * - 簇节点另用一份色板：它们不是笔记，不该和笔记类型色混淆。
 */
const CLUSTER_RADIUS_MIN = 15
const CLUSTER_RADIUS_MAX = 46
const SPREAD_IN = 1
const SPREAD_OUT = 1.7
const SPREAD_MAX_FADE = 0.66
/** 簇节点单独一提斥力：只有十来个节点时，按默认斥力会缩成一团 */
const CLUSTER_REPULSION_BOOST = 2.5

/**
 * 中心大节点（成员层里被标字的枢纽）的固定莫兰迪色号。
 * 成员的色 = 它最近的那个中心（多源 BFS，见 hubColors），
 * 所以「同一簇成员」一眼能看出分成了几摊、各自围着谁。
 * 低饱和、中等明度：十种同屏也不刺眼，叠在浅底上仍能互相区分。
 */
const HUB_COLORS = [
  '#ce8d8d', // 灰玫
  '#d2a684', // 灰杏
  '#cebd7c', // 灰黄
  '#b5c079', // 灰黄绿
  '#8dbe98', // 灰薄荷
  '#82bab6', // 灰青
  '#85aece', // 灰天蓝
  '#989bcc', // 灰长春花
  '#b490c6', // 灰丁香
  '#c78dae', // 灰洋红
]
const CLUSTER_COLORS = [
  '#2aa1a8', '#4a7de8', '#8b5cf6', '#e0663a', '#3fae7a',
  '#c2457a', '#b7893a', '#3a86b7', '#7a8a3a', '#9a5ad0',
]
/** 稳定的空数组：避免 `?? []` 每次渲染换新引用，把下游 memo 逐个打穿 */
const CLUSTER_EMPTY: LitCluster[] = []

/** 渲染用的簇节点（合成节点：一个簇一个圆） */
interface ClusterNode {
  id: string
  cluster: LitCluster
  color: string
  radius: number
}
const CLUSTER_NODES_EMPTY: ClusterNode[] = []

function clusterRadius(size: number): number {
  return clamp(
    CLUSTER_RADIUS_MIN + Math.sqrt(Math.max(size, 1)) * 1.5,
    CLUSTER_RADIUS_MIN,
    CLUSTER_RADIUS_MAX,
  )
}

/** 簇节点落位：中心一个环，顺序稳定 → 每次进同一层都是同一个布局 */
function clusterRingSpot(index: number, count: number, world: { w: number; h: number }) {
  const radius = Math.min(world.w, world.h) * (count <= 1 ? 0 : 0.2)
  const angle = (index / Math.max(1, count)) * 2 * Math.PI - Math.PI / 2
  return { x: world.w / 2 + radius * Math.cos(angle), y: world.h / 2 + radius * Math.sin(angle) }
}

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
  /** 并列视图：单击节点直接打开（不再需要先选中、再点一次）；图谱单栏保留两步 */
  openOnClick?: boolean
  /** 图谱单栏单击节点时把该笔记设为列表当前项（不切视图）；并列视图由 onOpenNote 代劳 */
  onSelectNote?: (id: string) => void
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

function noteMatches(n: Note, f: Filters): boolean {
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
  openOnClick = false,
  onSelectNote,
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
  /** 「仅有关联」档的关联阈值：与普通笔记的双链数 ≥ N 的文献才显示 */
  const [linkThreshold, setLinkThreshold] = useState<number>(loadLinkThreshold)
  /** 话题相关边（分类共现 + 标题相似）：让文献按相关性自组织成簇 */
  const [topicOn, setTopicOn] = useState<boolean>(loadTopicLinks)
  /** 大节点优先渲染：无视视野大小，只标连接数前 N 的笔记（本地记忆） */
  const [hubOnly, setHubOnly] = useState<boolean>(loadHubOnly)
  /** 「仅文献」档的聚类下钻（本地记忆） */
  const [clusterOn, setClusterOn] = useState<boolean>(loadClusterOn)
  /** 聚类下钻路径：空 = 停在簇这一层，[簇 id] = 铺开这一簇的文献 */
  const [drill, setDrill] = useState<string[]>([])
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
  /** 用户手动平移/缩放过：当前这一层的「自动装进视野」就不再插手 */
  const userAdjustedRef = useRef(false)
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

  const changeTopicOn = useCallback((next: boolean) => {
    setTopicOn(next)
    writeSetting(TOPIC_KEY, next ? '1' : '0')
  }, [])

  const changeHubOnly = useCallback((next: boolean) => {
    setHubOnly(next)
    writeSetting(HUB_ONLY_KEY, next ? '1' : '0')
  }, [])

  const changeClusterOn = useCallback((next: boolean) => {
    setClusterOn(next)
    writeSetting(CLUSTER_KEY, next ? '1' : '0')
    // 关掉聚类就从顶层重新开始，免得下次打开停在一个早已不存在的层级上
    setDrill([])
  }, [])

  // 标题 -> 笔记 索引：解析 [[双链]]（纯函数 buildTitleIndex，见 graphModel）
  const titleIndex = useMemo(() => buildTitleIndex(notes), [notes])

  // 文献与普通笔记的双链度数：linked 档唯一准入依据（只看双链，先于话题边计算）
  const noteDegreeById = useMemo(() => computeNoteDegrees(notes, titleIndex), [notes, titleIndex])

  /**
   * 「仅文献」档的聚类下钻（一级）：先只画几个簇，点一下簇就铺开它的成员文献。
   * 本机 1896 篇文献全铺开只是一团雾，所以按「Zotero 分类路径 + 标签 + 标题词」聚成两层簇
   * （算法与命名见 src/lib/litCluster.ts，离线报告 `npm run cluster:report`）。
   * 视图只渲染当前这一簇：其它簇的节点、连线一个都不存在（不是虚化，是根本不渲染）。
   */
  const clusterOnActive = clusterOn && tier === 'literature-only'
  /** 聚类只看筛选后的文献：簇的篇数必须和进去以后看到的篇数一致 */
  const filterLit = useMemo(
    () => notes.filter((n) => n.type === 'literature' && noteMatches(n, filters)),
    [notes, filters],
  )
  const clusterTree = useMemo(
    // 只要一级：点一下大簇就铺开它的成员文献，不再套一层小簇
    () => (clusterOnActive ? clusterLiterature(filterLit, { subLevels: false }) : null),
    [clusterOnActive, filterLit],
  )
  /** 下钻路径：截断到树上仍存在的最长前缀（筛选/开关一变，旧路径可能指向不存在的簇） */
  const drillClusters = useMemo(() => {
    if (!clusterTree) return CLUSTER_EMPTY
    const out: LitCluster[] = []
    for (const id of drill) {
      const c = clusterTree.byId.get(id)
      if (!c) break
      if (out.length > 0 && clusterTree.parentById.get(id) !== out[out.length - 1].id) break
      out.push(c)
    }
    return out
  }, [clusterTree, drill])
  const currentCluster = drillClusters.length > 0 ? drillClusters[drillClusters.length - 1] : null
  /** 当前层要显示的簇节点：没下钻 = 全部簇；已下钻 = 没有簇节点（改铺成员文献） */
  const levelClusters = currentCluster ? currentCluster.children : (clusterTree?.roots ?? CLUSTER_EMPTY)
  /**
   * 成员文献层：下钻进某个簇后直接铺它的成员（聚类只有一级，所以点进去就是文献）。
   * null 表示「当前层是簇节点，没有文献节点」。
   */
  const paperSet = useMemo(
    () => (currentCluster && levelClusters.length === 0 ? new Set(currentCluster.memberIds) : null),
    [currentCluster, levelClusters],
  )

  // 话题边只为「当前这一层真正会渲染的文献」构建：
  // 聚类视图下其余文献不渲染，给它们建 O(n²) 的边纯属浪费启动时间。
  const topicLiterature = useMemo(() => {
    const lit = notes.filter((n) => n.type === 'literature')
    if (clusterTree) return paperSet ? lit.filter((n) => paperSet.has(n.id)) : []
    return selectTopicLiterature(lit, noteDegreeById, tier, linkThreshold)
  }, [notes, noteDegreeById, tier, linkThreshold, clusterTree, paperSet])

  const topicEdges = useMemo(
    () => (topicOn ? buildTopicEdges(topicLiterature) : []),
    [topicOn, topicLiterature],
  )

  // 全量度数（双链 + 话题边）：只用于视觉（节点半径 / 枢纽判定 / 螺旋落位），不用于准入。
  const degreeById = useMemo(
    () => computeDegreeById(notes, titleIndex, topicEdges),
    [notes, titleIndex, topicEdges],
  )

  // 可见节点：先按筛选条件过滤，再按文献档位过滤，最后按聚类下钻的成员集合过滤
  const visible = useMemo(
    () =>
      notes.filter((n) => {
        if (!noteMatches(n, filters)) return false
        if (n.type === 'literature') {
          if (clusterTree) return paperSet ? paperSet.has(n.id) : false
          if (tier === 'no-literature') return false
          if (tier === 'literature-only') return true
          // linked：只保留「与普通笔记双链」达标的文献；文献间话题边不算关联，不再放行
          return literatureLinkedVisible(noteDegreeById.get(n.id), linkThreshold)
        }
        // 非文献节点在「仅文献」档隐藏
        return tier !== 'literature-only'
      }),
    [notes, filters, tier, linkThreshold, noteDegreeById, clusterTree, paperSet],
  )

  // 边 + 聚焦跳数。聚焦时不再隐藏节点，而是按到焦点的跳数逐层虚化
  // topicWeight > 0 表示这是话题相关边（样式与弹簧参数都和 [[双链]] 不同）
  const { shownIds, shownEdges, hopById } = useMemo(() => {
    const ids = new Set(visible.map((n) => n.id))
    const edgeSet = new Set<string>()
    const edges: { source: string; target: string; topicWeight?: number }[] = []
    for (const w of buildWikilinkEdges(notes, titleIndex)) {
      const key = w.source < w.target ? `${w.source}|${w.target}` : `${w.target}|${w.source}`
      edgeSet.add(key)
      edges.push(w)
    }
    for (const e of topicEdges) {
      if (edgeSet.has(`${e.a}|${e.b}`) || edgeSet.has(`${e.b}|${e.a}`)) continue
      edges.push({ source: e.a, target: e.b, topicWeight: e.weight })
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
  }, [notes, visible, focusId, topicEdges, titleIndex])

  const shownNotes = useMemo(() => visible.filter((n) => shownIds.has(n.id)), [visible, shownIds])
  /** 铺开成员文献的那一层：文献此时才该标标题（平时文献不标，两千篇标不动） */
  const paperMode = Boolean(paperSet)
  /** 聚焦只在焦点节点真的在屏上时才生效（可能被筛选条件或聚类下钻挡住） */
  const focusActive = Boolean(focusId) && shownIds.has(focusId ?? '')

  /**
   * 大节点集合：连接数排前 LABEL_HUB_COUNT 的节点（文献默认不标标题，不占名额）。
   * 度数相同的按 id 排序，保证同一份数据每次选中同一批，标签不会跳来跳去。
   * `order` 是排名（成员层按它分配莫兰迪色号），`set` 只用来判断「是不是中心」。
   */
  const labelHubs = useMemo(() => {
    const ranked = shownNotes
      .filter((n) => (paperMode || n.type !== 'literature') && (degreeById.get(n.id) ?? 0) > 0)
      .sort(
        (a, b) =>
          (degreeById.get(b.id) ?? 0) - (degreeById.get(a.id) ?? 0) || (a.id < b.id ? -1 : 1),
      )
      .slice(0, LABEL_HUB_COUNT)
    const order = ranked.map((n) => n.id)
    return { set: new Set(order), order }
  }, [shownNotes, degreeById, paperMode])

  /**
   * 成员层按「连到哪个中心」上色：中心 = 上面那批标签枢纽，每个一个固定莫兰迪色号
   * （色号跟着排名走，所以同一份数据每次进来同一个中心同一种颜色）。
   * 归属用**多源 BFS**：所有中心同时出发，谁先走到就归谁 —— O(V+E)，顺序固定，
   * 也就是说「离哪个中心近就染哪个色」，两个中心中间的成员归排名靠前的那个。
   * 别的档位（没有中心、或者不是文献成员层）返回空表，颜色照旧按笔记类型。
   */
  const hubColors = useMemo(() => {
    const map = new Map<string, string>()
    if (!paperMode || labelHubs.order.length === 0) return map
    const adjacency = new Map<string, string[]>()
    for (const e of shownEdges) {
      if (!adjacency.has(e.source)) adjacency.set(e.source, [])
      if (!adjacency.has(e.target)) adjacency.set(e.target, [])
      adjacency.get(e.source)!.push(e.target)
      adjacency.get(e.target)!.push(e.source)
    }
    const colorByHub = new Map(
      labelHubs.order.map((id, i) => [id, HUB_COLORS[i % HUB_COLORS.length]]),
    )
    for (const [id, hub] of assignHubIds(shownNotes, labelHubs.order, adjacency)) {
      map.set(id, colorByHub.get(hub)!)
    }
    return map
  }, [paperMode, labelHubs, shownEdges, shownNotes])

  /**
   * 当前层的簇节点（合成节点，不在 notes 里）：一个簇一个大圆 + 名字 + 篇数，单击铺开它的文献。
   * id 加 `#cl:` 前缀进 nodesRef，跟真实笔记共用同一套力导向与相机。
   */
  const clusterNodes = useMemo(() => {
    if (!clusterTree) return CLUSTER_NODES_EMPTY
    return levelClusters.map((c, i) => ({
      id: CLUSTER_NODE_PREFIX + c.id,
      cluster: c,
      color: CLUSTER_COLORS[i % CLUSTER_COLORS.length],
      radius: clusterRadius(c.memberIds.length),
    }))
  }, [clusterTree, levelClusters])

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

  /** 簇节点太少，默认斥力下会缩成一团：只看簇节点的这一层单独把斥力提上去 */
  const repulsionBoost = clusterNodes.length > 0 ? CLUSTER_REPULSION_BOOST : 1

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

  // 下钻/返回一层时也复位视野：上一层可能停在放大状态，进去容易「什么都看不到」
  const drillKey = drillClusters.map((c) => c.id).join('/')
  /**
   * 进入某一层时把这一层整体装进视野。
   * 并列视图里图谱只占很窄的一条（1440px 窗口下图谱列可能只有 480px），
   * 固定 100% 视野会让外圈的簇节点落在视野外 —— 那时它连点都点不到，
   * 所以按当前层节点的实际包围盒算一次缩放。（成员文献层要等力模拟摊开后再量一次。）
   */
  useEffect(() => {
    if (!clusterTree) return
    const ids = clusterNodes.length > 0 ? clusterNodes.map((c) => c.id) : shownNotes.map((n) => n.id)
    if (ids.length === 0) return
    userAdjustedRef.current = false
    const fit = () => {
      if (userAdjustedRef.current) return
      const map = nodesRef.current
      const pts: SimNode[] = []
      for (const id of ids) {
        const p = map.get(id)
        if (p) pts.push(p)
      }
      if (pts.length === 0) return
      const pad = 140
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const p of pts) {
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
        minY = Math.min(minY, p.y)
        maxY = Math.max(maxY, p.y)
      }
      const zoom = clamp(
        Math.min(size.w / (maxX - minX + pad * 2), size.h / (maxY - minY + pad * 2)),
        0.3,
        1.1,
      )
      setCam((c) => {
        const next = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom }
        return Math.abs(c.x - next.x) < 1 && Math.abs(c.y - next.y) < 1 && Math.abs(c.zoom - next.zoom) < 0.02
          ? c
          : next
      })
    }
    const first = window.setTimeout(fit, 60)
    const second = window.setTimeout(fit, paperSet ? 1600 : 400)
    return () => {
      window.clearTimeout(first)
      window.clearTimeout(second)
    }
  }, [drillKey, clusterTree, clusterNodes, shownNotes, paperSet, size.w, size.h])

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
   * 圆点的屏幕尺寸系数：窄列（并列视图里图谱只占一条）按比例缩小，
   * 否则圆点与文字在窄列里会互相压住。宽列不放大，保持 1。
   * 注意节点整组是 scale(uiScale/zoom)：圆点因此保持屏幕像素尺寸，
   * 标签再在组内乘一次 labelZoom 把视野缩放加回来（见下）。
   */
  const uiScale = clamp(size.w / 900, 0.72, 1)

  /**
   * 标签随视野缩放：放大时字变大（倍率封顶 LABEL_MAX_ZOOM），缩小时字变小
   * ——所以组内文字再乘一次 cam.zoom，正好抵消组上的 1/zoom。
   * 缩到 LABEL_CROWDED_ZOOM 以下时文字已挤不下 → 自动进入「大节点优先」渲染：
   * 只给 labelHubs（连接数前 LABEL_HUB_COUNT 的笔记）标字（字号停在阈值倍率上，不再继续变小），
   * 其余节点虚化 + 缩小，也不显示文字。用户也可用「只标大节点」开关强制开启，无视视野大小。
   */
  const labelZoom = clamp(cam.zoom, LABEL_CROWDED_ZOOM, LABEL_MAX_ZOOM)
  const crowded = cam.zoom < LABEL_CROWDED_ZOOM

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

  // 初始化新节点位置 & 移除消失节点（含聚类的合成节点）
  useEffect(() => {
    const map = nodesRef.current
    for (const n of shownNotes) {
      if (!map.has(n.id)) {
        const p = placeNode(degreeById.get(n.id) ?? 0)
        map.set(n.id, { id: n.id, x: p.x, y: p.y, vx: 0, vy: 0, r: 0 })
      }
    }
    // 簇节点按环落位（顺序稳定 → 每次进同一层都是同一个布局）
    clusterNodes.forEach((c, i) => {
      if (map.has(c.id)) return
      const p = clusterRingSpot(i, clusterNodes.length, world)
      map.set(c.id, { id: c.id, x: p.x, y: p.y, vx: 0, vy: 0, r: 0 })
    })
    const keep = new Set<string>(shownIds)
    for (const c of clusterNodes) keep.add(c.id)
    for (const id of [...map.keys()]) {
      if (!keep.has(id)) map.delete(id)
    }
  }, [shownNotes, shownIds, degreeById, placeNode, clusterNodes, world])

  /**
   * 外部入口（侧栏搜索 / 笔记列表 / 文献视图）打开的笔记可能落在视野外 ——
   * 并列视图里图谱只占很窄一条，100% 视野下多数节点都在框外。
   * 聚焦时把它平移进视野；已经在视野内就不动（点击图谱里的节点不会突然跳视野）。
   */
  useEffect(() => {
    if (!focusActive || !focusId) return
    // 等一帧，让新节点的初始落位与尺寸自适应先完成
    const timer = window.setTimeout(() => {
      const node = nodesRef.current.get(focusId)
      if (!node) return
      setCam((c) => {
        const margin = 80
        const sx = (node.x - c.x) * c.zoom + size.w / 2
        const sy = (node.y - c.y) * c.zoom + size.h / 2
        if (sx >= margin && sx <= size.w - margin && sy >= margin && sy <= size.h - margin) return c
        return { ...c, x: node.x, y: node.y }
      })
    }, 60)
    return () => window.clearTimeout(timer)
  }, [focusActive, focusId, size.w, size.h])

  // 力导向模拟（世界坐标）
  useEffect(() => {
    if (autoPaused) return
    let raf = 0
    let frame = 0
    ticksRef.current = 0
    stepEmaRef.current = 0
    // 场地越大越松：斥力按世界面积缩放，避免小窗口爆炸、大场地又挤在一起
    const areaScale = clamp((world.w * world.h) / (2600 * 1800), 0.55, 3.2)
    const repulsionConst = PHYSICS_BASE.repulsion * effPhysics.repulsion * areaScale * repulsionBoost
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
      // 话题相关边：目标距离更短（0.7×）、弹簧强度按相关度缩放 → 相关文献自然抱簇
      for (const e of shownEdges) {
        const a = map.get(e.source)
        const b = map.get(e.target)
        if (!a || !b) continue
        const topic = e.topicWeight !== undefined
        const target = topic ? effPhysics.linkDistance * 0.7 : effPhysics.linkDistance
        const k = topic ? springK * (0.4 + e.topicWeight! * 1.6) : springK
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
        const f = ((d - target) * k) / d
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
  }, [shownEdges, world.w, world.h, simNonce, effPhysics, autoPaused, repulsionBoost])

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
        userAdjustedRef.current = true
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
      if (!movedRef.current && Math.hypot(pt.x - drag.sx, pt.y - drag.sy) > 4) {
        movedRef.current = true
        userAdjustedRef.current = true
      }
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
      userAdjustedRef.current = true
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

  /**
   * 当前层节点的重心与均方半径（世界坐标）：离重心远的虚化。
   * 一个簇里总有几篇偏题的成员被斥力推到外围，让它们退到背景，簇心部分才读得清。
   * 只在聚类视图里生效，其它档位的渲染不受影响。
   */
  const spread = (() => {
    if (!clusterTree) return null
    const ids = clusterNodes.length > 0 ? clusterNodes.map((c) => c.id) : shownNotes.map((n) => n.id)
    if (ids.length < 4) return null
    let sx = 0
    let sy = 0
    let n = 0
    for (const id of ids) {
      const p = map.get(id)
      if (!p) continue
      sx += p.x
      sy += p.y
      n++
    }
    if (n < 4) return null
    const cx = sx / n
    const cy = sy / n
    let sq = 0
    for (const id of ids) {
      const p = map.get(id)
      if (!p) continue
      sq += (p.x - cx) ** 2 + (p.y - cy) ** 2
    }
    const rms = Math.sqrt(sq / n)
    return rms < 1 ? null : { cx, cy, rms }
  })()

  /** 0 = 在簇心附近，1 = 远到该虚化（按均方半径归一） */
  const spreadFade = (x: number, y: number): number => {
    if (!spread) return 0
    const d = Math.hypot(x - spread.cx, y - spread.cy) / spread.rms
    return clamp((d - SPREAD_IN) / (SPREAD_OUT - SPREAD_IN), 0, 1)
  }

  /** 把节点重新撒开（按落位规则），让布局在当前参数下重新收敛 */
  const relayout = useCallback(() => {
    placeRef.current = { seq: 0, park: 0 }
    const clusterIds = new Set(clusterNodes.map((c) => c.id))
    let ci = 0
    for (const [id, n] of nodesRef.current) {
      const p = clusterIds.has(id)
        ? clusterRingSpot(ci++, clusterNodes.length, world)
        : placeNode(degreeById.get(id) ?? 0)
      n.x = p.x
      n.y = p.y
      n.vx = 0
      n.vy = 0
    }
    setAutoPaused(false)
    setSimNonce((v) => v + 1)
  }, [placeNode, degreeById, clusterNodes, world])

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
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col items-start gap-2">
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border bg-background/95 p-1 text-xs shadow backdrop-blur">
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
              title="只显示与普通笔记关联数 ≥ N 的文献（文献间话题边不计）"
              className="ml-1 h-6 rounded border bg-background px-1 text-[11px]"
            >
              <option value={1}>关联≥1</option>
              <option value={2}>关联≥2</option>
              <option value={3}>关联≥3</option>
            </select>
          )}
        </div>
        {/* 大节点优先：无视视野大小，强制只标连接数前 N 的笔记 */}
        <label
          className="pointer-events-auto flex cursor-pointer items-center gap-1.5 rounded-lg border bg-background/95 px-2 py-1 text-xs shadow backdrop-blur"
          title={`无视视野大小，只标注连接数前 ${LABEL_HUB_COUNT} 的笔记节点；其余节点虚化 + 缩小且不显示文字（悬停/聚焦仍可看）`}
        >
          <input
            type="checkbox"
            checked={hubOnly}
            onChange={(e) => changeHubOnly(e.target.checked)}
            className="h-3.5 w-3.5 accent-teal-600"
          />
          <span className={hubOnly ? 'font-medium' : 'text-muted-foreground'}>只标大节点</span>
        </label>
        {/* 文献聚类下钻：只在「仅文献」档有意义 */}
        {tier === 'literature-only' && (
          <label
            className="pointer-events-auto flex cursor-pointer items-center gap-1.5 rounded-lg border bg-background/95 px-2 py-1 text-xs shadow backdrop-blur"
            title="把文献按 Zotero 分类 + 标题词聚成几个簇：先只画这几个簇（其它簇不渲染），点一下簇就铺开它的成员文献。关掉 = 铺开全部文献节点"
          >
            <input
              type="checkbox"
              checked={clusterOn}
              onChange={(e) => changeClusterOn(e.target.checked)}
              className="h-3.5 w-3.5 accent-teal-600"
            />
            <span className={clusterOn ? 'font-medium' : 'text-muted-foreground'}>文献聚类</span>
          </label>
        )}
        {/* 聚类视图的面包屑：点哪一层回哪一层 */}
        {clusterTree && (
          <div className="pointer-events-auto flex max-w-[22rem] flex-wrap items-center gap-1 rounded-lg border bg-background/95 px-2 py-1 text-xs shadow backdrop-blur">
            <button
              onClick={() => setDrill([])}
              className={
                drillClusters.length === 0
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:underline'
              }
              title={`全部 ${clusterTree.roots.length} 个簇`}
            >
              全部 {clusterTree.roots.length} 簇
            </button>
            {drillClusters.map((c, i) => (
              <span key={c.id} className="flex items-center gap-1">
                <span className="text-muted-foreground/60">›</span>
                <button
                  onClick={() => setDrill(drillClusters.slice(0, i + 1).map((d) => d.id))}
                  className={
                    i === drillClusters.length - 1
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:underline'
                  }
                  title={`${c.label} · ${c.memberIds.length} 篇`}
                >
                  {c.label.length > 12 ? c.label.slice(0, 11) + '…' : c.label}
                </button>
              </span>
            ))}
            {drillClusters.length > 0 && (
              <button
                onClick={() => setDrill(drillClusters.slice(0, -1).map((d) => d.id))}
                className="ml-0.5 flex items-center gap-0.5 rounded px-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="返回上一层（也可以右键簇节点）"
              >
                <ChevronLeft className="h-3 w-3" /> 返回
              </button>
            )}
          </div>
        )}
        {autoPaused && (
          <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-amber-400/60 bg-background/95 px-3 py-1.5 text-xs shadow backdrop-blur">
            布局已自动暂停（负载保护）
            <Button size="sm" className="h-6 px-2 text-[11px]" onClick={resumeSim}>
              继续
            </Button>
          </div>
        )}
      </div>

      {/* 力参数面板：斥力 / 双链引力 / 连线长度 / 中心聚集 */}
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex flex-col items-end gap-2">
        <div className="pointer-events-auto flex items-center gap-1.5">
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
          <div className="pointer-events-auto w-64 rounded-lg border bg-background/95 p-3 text-xs shadow-lg backdrop-blur">
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

            {/* 话题相关边开关 */}
            <label className="mb-2 flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-[11px]">
              <input
                type="checkbox"
                checked={topicOn}
                onChange={(e) => changeTopicOn(e.target.checked)}
                className="h-3.5 w-3.5 accent-teal-600"
              />
              <span className="min-w-0">
                <span className="font-medium">话题相关边</span>
                <span className="block text-muted-foreground">
                  按 Zotero 分类共现 + 标题相似连接相关文献（青绿色虚线）
                </span>
              </span>
            </label>

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
            const isTopic = e.topicWeight !== undefined
            const active =
              hoverId === e.source || hoverId === e.target || focusId === e.source || focusId === e.target
            const nearFocus =
              focusActive && (hopById.get(e.source) ?? 9) <= 1 && (hopById.get(e.target) ?? 9) <= 1
            // 枢纽渲染层：不在任何枢纽 2 跳范围内的边全部虚化
            const fadedByHub =
              !focusActive && Boolean(hubLayer) && (!hubLayer!.sharp.has(e.source) || !hubLayer!.sharp.has(e.target))
            let opacity = focusActive ? (nearFocus ? 0.6 : 0.07) : active ? 0.7 : 0.22
            if (isTopic) opacity = focusActive ? (nearFocus ? 0.4 : 0.05) : active ? 0.55 : 0.12
            if (fadedByHub && !active) opacity = Math.min(opacity, 0.08)
            const width = focusActive ? (nearFocus ? 1.6 : 1) : active ? 1.8 : 1.2
            // 两端属于同一个中心的边跟着中心的色号走（一小簇同色的连线，归属一眼看得出来）
            const hubA = hubColors.get(e.source)
            const hubB = hubColors.get(e.target)
            const sameHub = hubA && hubB && hubA === hubB ? hubA : null
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={
                  sameHub && !active
                    ? sameHub
                    : isTopic
                      ? '#2aa1a8'
                      : active
                        ? 'hsl(var(--primary))'
                        : 'hsl(var(--muted-foreground))'
                }
                strokeOpacity={opacity}
                strokeWidth={(isTopic ? width * 0.8 : width) / cam.zoom}
                strokeDasharray={isTopic ? `${6 / cam.zoom} ${4 / cam.zoom}` : undefined}
              />
            )
          })}

          {/* 节点（整组按 uiScale/zoom 缩放：圆点保持屏幕像素尺寸；文字再乘 labelZoom，随视野放大/缩小） */}
          {shownNotes.map((n) => {
            const node = map.get(n.id)
            if (!node) return null
            const meta = NOTE_TYPE_META[n.type]
            const isFocus = n.id === focusId
            const isHover = n.id === hoverId
            const typeColor = n.type === 'person' && n.grade ? GRADE_COLORS[n.grade] : meta.color
            // 成员层按「连到哪个中心」上色（中心自己也是它那个色号）；没有中心时按笔记类型
            const hubColor = hubColors.get(n.id)
            const color = hubColor ?? typeColor
            const degree = degreeById.get(n.id) ?? 0
            // 疏布模式下文献缩成小圆点（半径按度数分级），普通节点保持原尺寸
            const isLit = n.type === 'literature'
            const rBase =
              isFocus || isHover ? 13 : sparseActive && isLit ? clamp(3 + degree * 0.6, 3.5, 8) : 10
            // 大节点优先：视野缩到阈值以下自动生效，或用户强制开启（无视视野大小）
            const hubMode = crowded || hubOnly
            const isLabelHub = labelHubs.set.has(n.id)
            // 非大节点虚化 + 缩小（文字另见下）
            const dimmedByPriority = hubMode && !isLabelHub && !isHover && !isFocus
            // 离簇心远的成员也退到背景（聚类视图专有，见 spreadFade）；
            // 中心（带标签的锚点）不参与 —— 把锚点淡掉，一簇就没有「围着谁」可言了
            const fade = isHover || isFocus || isLabelHub ? 0 : spreadFade(node.x, node.y)
            const r = (dimmedByPriority ? rBase * CROWDED_SHRINK : rBase * (1 - 0.25 * fade))
            // 悬停/聚焦的节点至少按基准字号标字，免得刚点中的节点看不清
            // 标签的基线距离 = 圆环外沿（屏幕像素，不随字号变）+ LABEL_GAP × textZoom（随字号等比放大）
            const textZoom = isHover || isFocus ? Math.max(labelZoom, 1) : labelZoom
            const dims = noteDims(n)
            const lvl = focusActive ? blurLevel(hopById.get(n.id)) : 0
            // 枢纽渲染层：枢纽 + 2 跳内清晰，其余虚化（悬停时恢复）
            const fadedByHub =
              !focusActive && Boolean(hubLayer) && !isHover && !hubLayer!.sharp.has(n.id)
            // 标签策略：文献默认不显示标题（数量太大）；疏布模式下被枢纽层虚化的节点也不显示；
            // 大节点优先时只有连接数前 N 的笔记还有文字（悬停/聚焦的节点例外）
            const showLabel =
              (!hubMode || isLabelHub || isHover || isFocus) &&
              (isHover || isFocus || !isLit || paperMode) &&
              (!sparseActive || !isLit || isHover || isFocus) &&
              (!fadedByHub || !isLit)
            return (
              <g
                key={n.id}
                transform={`translate(${node.x},${node.y}) scale(${uiScale / cam.zoom})`}
                className="cursor-pointer"
                opacity={
                  (focusActive ? HOP_OPACITY[lvl] : 1) *
                  (fadedByHub ? 0.25 : 1) *
                  // 「大节点优先」已经把它们压暗了，就不叠「离簇心远」这一层（不然会淡到看不见）。
                  // 按中心上色时抬一点下限：0.3 叠上莫兰迪色根本看不出蓝的还是粉的。
                  (dimmedByPriority ? (hubColor ? HUB_DIM_OPACITY : CROWDED_OPACITY) : 1 - SPREAD_MAX_FADE * fade)
                }
                filter={lvl > 0 ? `url(#kgblur${lvl})` : undefined}
                onPointerDown={(e) => onPointerDown(e, n.id)}
                onMouseEnter={() => setHoverId(n.id)}
                onMouseLeave={() => setHoverId(null)}
                onClick={() => {
                  if (movedRef.current) return
                  // 并列视图：单击即打开（右侧正文换成这篇，左侧列表随之高亮）。
                  // 图谱单栏：单击只选中并聚焦（同时让左侧列表高亮），再次单击才打开 ——
                  // 单栏里打开会切到「笔记」视图，把图谱整个换掉。
                  if (openOnClick) {
                    onFocusChange(n.id)
                    onOpenNote(n.id)
                  } else if (isFocus) {
                    onOpenNote(n.id)
                  } else {
                    onFocusChange(n.id)
                    onSelectNote?.(n.id)
                  }
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
                  fillOpacity={hubColor ? (isLabelHub ? 1 : 0.85) : 0.85}
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
                  <g transform={`scale(${textZoom})`}>
                    <text
                      y={(r + LABEL_RING_OUT) / textZoom + LABEL_GAP}
                      textAnchor="middle"
                      className="pointer-events-none fill-foreground"
                      fontSize={LABEL_FONT}
                      style={{ userSelect: 'none' }}
                    >
                      {n.title.length > 14 ? n.title.slice(0, 13) + '…' : n.title}
                    </text>
                  </g>
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

          {/*
            簇节点（合成节点）：一个大圆 + 名字 + 篇数，单击铺开这一簇的文献。
            只有这些簇在 DOM 里 —— 点进某一簇之后，其它簇和它们的成员一个都不渲染。
          */}
          {clusterNodes.map((c) => {
            const node = map.get(c.id)
            if (!node) return null
            const isHover = hoverId === c.id
            const fade = isHover ? 0 : spreadFade(node.x, node.y)
            const r = c.radius * (isHover ? 1.08 : 1) * (1 - 0.2 * fade)
            const size = c.cluster.memberIds.length
            // 簇名是这一层唯一的信息，所以字号不再跟着视野缩小（labelZoom 下限 1）
            const nameZoom = Math.max(labelZoom, 1)
            return (
              <g
                key={c.id}
                transform={`translate(${node.x},${node.y}) scale(${uiScale / cam.zoom})`}
                className="cursor-pointer"
                opacity={1 - SPREAD_MAX_FADE * fade}
                onPointerDown={(e) => onPointerDown(e, c.id)}
                onMouseEnter={() => setHoverId(c.id)}
                onMouseLeave={() => setHoverId(null)}
                onClick={() => {
                  if (movedRef.current) return
                  setDrill([...drillClusters.map((d) => d.id), c.cluster.id])
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (movedRef.current || drillClusters.length === 0) return
                  setDrill(drillClusters.slice(0, -1).map((d) => d.id))
                }}
              >
                <title>{`${c.cluster.label} · ${size} 篇（单击铺开这些文献，右键返回上一层）`}</title>
                <circle r={r + 9} fill="transparent" />
                <circle r={r} fill={c.color} fillOpacity={0.92} stroke="hsl(var(--background))" strokeWidth={2} />
                <text
                  y={Math.min(4, r * 0.34)}
                  textAnchor="middle"
                  fontSize={clamp(r * 0.52, 10, 17)}
                  fill="#fff"
                  fontWeight={700}
                  className="pointer-events-none"
                  style={{ userSelect: 'none' }}
                >
                  {size}
                </text>
                <g transform={`scale(${nameZoom})`}>
                  <text
                    y={(r + LABEL_RING_OUT) / nameZoom + LABEL_GAP}
                    textAnchor="middle"
                    className="pointer-events-none fill-foreground"
                    fontSize={LABEL_FONT + 1}
                    fontWeight={600}
                    style={{ userSelect: 'none' }}
                  >
                    {c.cluster.label.length > 18 ? c.cluster.label.slice(0, 17) + '…' : c.cluster.label}
                  </text>
                </g>
              </g>
            )
          })}
        </g>
      </svg>

      {/* 统计信息 */}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-background/80 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur">
        {tierLabel} · 显示 {shownNotes.length + clusterNodes.length} / {notes.length} 篇笔记 · {shownEdges.length} 条连线 ·
        视野 {Math.round(cam.zoom * 100)}%
        {clusterTree ? (
          <span className="ml-2 text-muted-foreground/80">
            {paperSet
              ? `聚类「${currentCluster?.label}」：铺开 ${shownNotes.length} 篇（按连到的中心上色，离簇心远的已虚化）`
              : `聚类：${levelClusters.length} 个簇，点一下铺开它的文献`}
          </span>
        ) : null}
        {!clusterTree && (crowded || hubOnly) ? (
          <span className="ml-2 text-muted-foreground/80">
            只标大节点：连接数前 {LABEL_HUB_COUNT} 的笔记
            {hubOnly ? '（已强制开启）' : '（放大即恢复）'}
          </span>
        ) : null}
        {focusActive && focusId && noteById.get(focusId) && (
          <span className="ml-2 text-primary">
            焦点：{noteById.get(focusId)!.title}
            {openOnClick ? '（单击空白处取消）' : '（再次单击可打开，单击空白处取消）'}
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
