import { buildCitationFieldRtf, wrapRtfDocument } from '@/lib/rtfField'
import { formatCitationMarker } from '@/lib/literature'
const item = { id: 'doe2020', type: 'article-journal', title: 'Test', issued: { 'date-parts': [[2020]] } }
void (async () => {
  // 排版走 citation-js（动态 import），域代码的显示文本由它给出
  const display = await formatCitationMarker([item], 'gb')
  process.stdout.write(wrapRtfDocument(buildCitationFieldRtf([item as never], 'gb', display)))
})()
