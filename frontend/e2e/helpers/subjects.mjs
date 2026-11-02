// Isolated catalog fixtures for UI tests; no production data is written.
export async function mockSubjectCatalog(page, frontend, names = []) {
  const subjects = [...new Set(['Математика', 'Java', 'Programming', 'Biology', 'Biology review', ...names])].map(name => ({ name, preset: name === 'Математика' }))
  await page.route('**/api/v1/subjects', async route => {
    const method = route.request().method()
    const headers = { 'Access-Control-Allow-Origin': new URL(frontend).origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers })
    let data = subjects
    if (method === 'POST') {
      const name = route.request().postDataJSON().name.normalize('NFKC').trim().replace(/\s+/g, ' ')
      let subject = subjects.find(value => value.name.toLocaleLowerCase('bg') === name.toLocaleLowerCase('bg'))
      if (!subject) { subject = { name, preset: false }; subjects.push(subject) }
      data = subject
    }
    return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(data) })
  })
}
