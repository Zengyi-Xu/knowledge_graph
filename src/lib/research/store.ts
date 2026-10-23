/**
 * 研究追问的存储：独立 sidecar（vault 内 attachments/ 一层文件），复用冻结的
 * desktop-bridge 附件通道（readAttachment/writeAttachment），不新增 front matter 字段。
 *
 * - 题库（全库一份）：attachments/research-bank.json
 * - 单篇追问记录：  attachments/research-<noteId>.json
 *
 * 读写都经过 zod 校验：格式不对返回 null（读）/ 抛错（写），绝不把坏数据当成功。
 */
import { readSetting, writeSetting } from '@/lib/env'
import { resolvedVaultDir } from '@/lib/vaultFs'
import { researchBankFileSchema, defaultBank, type ResearchBankFile, type ResearchQuestion } from './bank'
import { researchSessionFileSchema, type ResearchSessionFile } from './session'
import { DEFAULT_OLLAMA_BASE_URL, normalizeBaseUrl, type CloudProvider, type OllamaSettings } from './router'

const BANK_REL = 'attachments/research-bank.json'
const sessionRel = (noteId: string) => `attachments/research-${noteId}.json`
/** 一层安全文件名：noteId 是 uid() 生成的字母数字串，这里再兜一道 */
const NOTE_ID_RE = /^[a-zA-Z0-9_-]{1,120}$/

function desk() {
  const bridge = window.knowledgeGraphDesktop
  if (!bridge?.readAttachment || !bridge.writeAttachment) return null
  const dir = resolvedVaultDir()
  if (!dir) return null
  return { bridge, dir }
}

function encode(json: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(json, null, 2))
}

function decode(data: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(data))
}

// ---------- 题库 ----------

/** 读题库；不存在或格式不对返回 null（调用方负责落默认种子库） */
export async function readResearchBank(): Promise<ResearchBankFile | null> {
  const d = desk()
  if (!d) return null
  const data = await d.bridge.readAttachment(d.dir, BANK_REL).catch(() => null)
  if (!data) return null
  try {
    const parsed = researchBankFileSchema.safeParse(decode(data))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** 写题库（整份原子替换） */
export async function saveResearchBank(bank: ResearchBankFile): Promise<void> {
  const d = desk()
  if (!d) throw new Error('附件写盘不可用：需要桌面版或本机网页服务，并选择笔记目录')
  await d.bridge.writeAttachment(d.dir, BANK_REL, encode(bank))
}

/** 读不到有效题库时创建默认种子库并落盘 */
export async function ensureResearchBank(defaults: () => ResearchBankFile = defaultBank): Promise<ResearchBankFile> {
  const existing = await readResearchBank()
  if (existing) return existing
  const bank = defaults()
  await saveResearchBank(bank)
  return bank
}

// ---------- 单篇追问记录 ----------

export async function readResearchSession(noteId: string): Promise<ResearchSessionFile | null> {
  if (!NOTE_ID_RE.test(noteId)) return null
  const d = desk()
  if (!d) return null
  const data = await d.bridge.readAttachment(d.dir, sessionRel(noteId)).catch(() => null)
  if (!data) return null
  try {
    const parsed = researchSessionFileSchema.safeParse(decode(data))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function saveResearchSession(session: ResearchSessionFile): Promise<void> {
  if (!NOTE_ID_RE.test(session.noteId)) throw new Error('无效的笔记 id')
  const d = desk()
  if (!d) throw new Error('附件写盘不可用：需要桌面版或本机网页服务，并选择笔记目录')
  await d.bridge.writeAttachment(d.dir, sessionRel(session.noteId), encode(session))
}

// ---------- 本地设置（localStorage，随客户端走） ----------

const OLLAMA_SETTING_KEY = 'research-ollama-v1'
const CLOUD_SETTING_KEY = 'research-cloud-v1'

export function readOllamaSettings(): OllamaSettings {
  try {
    const raw = readSetting(OLLAMA_SETTING_KEY)
    if (!raw) return { baseUrl: DEFAULT_OLLAMA_BASE_URL, model: '' }
    const parsed = JSON.parse(raw) as { baseUrl?: unknown; model?: unknown }
    return {
      baseUrl: normalizeBaseUrl(typeof parsed.baseUrl === 'string' ? parsed.baseUrl : ''),
      model: typeof parsed.model === 'string' ? parsed.model.trim() : '',
    }
  } catch {
    return { baseUrl: DEFAULT_OLLAMA_BASE_URL, model: '' }
  }
}

export function saveOllamaSettings(settings: OllamaSettings): boolean {
  return writeSetting(OLLAMA_SETTING_KEY, JSON.stringify({ baseUrl: normalizeBaseUrl(settings.baseUrl), model: settings.model.trim() }))
}

export function readCloudProvider(): CloudProvider {
  return readSetting(CLOUD_SETTING_KEY) === 'kimi' ? 'kimi' : 'deepseek'
}

export function saveCloudProvider(provider: CloudProvider): boolean {
  return writeSetting(CLOUD_SETTING_KEY, provider)
}

// ---------- AI 收藏入库 ----------

/** 用户收藏的 AI 问题进入长期题库（source: ai-favorite） */
export function favoriteToQuestion(params: {
  id: string
  question: string
  why: string
  category: ResearchQuestion['category']
  noteType: ResearchQuestion['noteTypes']
  topic: string
  now: number
}): ResearchQuestion {
  return {
    id: params.id,
    text: params.question,
    why: params.why,
    category: params.category,
    noteTypes: params.noteType,
    topics: params.topic ? [params.topic] : [],
    tags: [],
    source: 'ai-favorite',
    usedCount: 1,
    answeredCount: 0,
    favoriteCount: 1,
    skippedCount: 0,
    lastUsedAt: params.now,
    enabled: true,
    createdAt: params.now,
    updatedAt: params.now,
  }
}
