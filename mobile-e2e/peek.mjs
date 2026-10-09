import fs from 'node:fs'
const r = JSON.parse(fs.readFileSync('mobile-e2e/out/results.json', 'utf8'))
const pick = (id) => r.find((x) => x.id === id)
for (const id of process.argv.slice(2)) {
  const x = pick(id)
  if (!x) {
    console.log(id, 'MISSING')
    continue
  }
  console.log('=== ' + id + ' ===')
  console.log('  shellMobile=' + x.facts.shellMobileOverride, 'listToggle=' + JSON.stringify(x.facts.listToggle))
  console.log('  aside=' + JSON.stringify(x.facts.shell.aside))
  console.log('  main=' + JSON.stringify(x.facts.shell.main))
  console.log('  header=' + JSON.stringify(x.facts.shell.header))
  console.log('  write=' + JSON.stringify(x.facts.write))
  console.log('  writeInner=' + JSON.stringify(x.facts.writeInner))
  console.log('  flagged=' + (x.overflowTop || []).length)
  for (const f of (x.overflowTop || []).slice(0, 5)) {
    console.log('     ' + f.tag + ' | ' + String(f.cls || '').slice(0, 46) + ' | rect=' + JSON.stringify(f.rect) + ' | ' + String(f.text || '').slice(0, 24))
  }
}
