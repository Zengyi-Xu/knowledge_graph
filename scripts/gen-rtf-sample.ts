import { buildCitationFieldRtf, wrapRtfDocument } from '@/lib/rtfField'
const item = { id: 'doe2020', type: 'article-journal', title: 'Test', issued: { 'date-parts': [[2020]] } }
process.stdout.write(wrapRtfDocument(buildCitationFieldRtf([item as never], 'gb')))
