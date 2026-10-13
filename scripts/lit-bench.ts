import { buildTopicEdges } from '@/lib/topicLinks'
import type { Note } from '@/types/note'

const COLLECTIONS = ['硅光/调制器', '硅光/探测器', '量子计算/离子阱', 'AI/神经网络', '材料/钙钛矿', '通信/可见光', '激光/相干', '传感/LiDAR']
const WORDS = 'silicon photonics quantum neural network laser modulation detection chip integrated optical lithium niobate on-chip cavity waveguide sensor imaging'.split(' ')
const notes: Note[] = []
for (let i = 0; i < 2267; i++) {
  const col = [COLLECTIONS[i % COLLECTIONS.length]]
  if (i % 3 === 0) col.push(COLLECTIONS[(i + 2) % COLLECTIONS.length])
  const title = Array.from({ length: 5 }, (_, k) => WORDS[(i * 7 + k * 3) % WORDS.length]).join(' ')
  notes.push({
    id: `n${i}`, title, type: 'literature', grade: '', tags: [], content: '',
    createdAt: 0, updatedAt: 0,
    literature: { authors: [], venue: '', year: '', doi: '', citekey: '', attachments: [], collections: col },
  })
}
const t0 = performance.now()
const edges = buildTopicEdges(notes)
console.log(`2267 篇 → ${edges.length} 条话题边，耗时 ${(performance.now() - t0).toFixed(0)} ms`)
