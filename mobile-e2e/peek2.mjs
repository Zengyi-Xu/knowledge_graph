import fs from 'node:fs'
const r = JSON.parse(fs.readFileSync('mobile-e2e/out/results.json', 'utf8'))
const pick = (id) => r.find((x) => x.id === id)
for (const id of process.argv.slice(2)) {
  const x = pick(id)
  if (!x) { console.log(id, 'MISSING'); continue }
  console.log('=== ' + id + ' ===')
  console.log('  hydrated=' + x.hydrated, 'bodyTextLen=' + x.facts.bodyTextLen)
  console.log('  bodyText(first 300): ' + JSON.stringify(String(x.facts.bodyTextLen) + ' chars'))
  console.log('  controls=' + JSON.stringify(x.facts.controls))
  console.log('  listToggle=' + JSON.stringify(x.facts.listToggle))
  console.log('  viewTabs=' + JSON.stringify(x.facts.tabState))
  console.log('  shell=' + JSON.stringify(x.facts.shell))
}
const d = pick('360x800__default')
if (d) console.log('\nraw facts keys:', Object.keys(d.facts).join(', '))
