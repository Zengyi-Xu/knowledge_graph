import fs from 'node:fs'
const r = JSON.parse(fs.readFileSync('mobile-e2e/out/results.json', 'utf8'))
const seen = new Map()
for (const x of r.filter((y) => y.mobile)) {
  for (const t of x.tapSmall || []) {
    const k = `${t.tag}|${t.w}x${t.h}|${t.text || ''}|${t.aria || ''}`
    if (!seen.has(k)) seen.set(k, { id: x.id, t })
  }
}
for (const [, { id, t }] of seen) {
  console.log(
    id.padEnd(30),
    t.tag,
    `${t.w}x${t.h}`,
    'text=' + JSON.stringify(t.text || ''),
    'aria=' + JSON.stringify(t.aria || ''),
    'cls=' + String(t.cls || '').slice(0, 55),
  )
}
console.log('--- distinct small targets: ' + seen.size)
