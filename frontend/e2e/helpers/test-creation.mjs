export async function chooseTestCreation(page, mode) {
  const choiceName = mode === 'manual' ? /^Ръчно/ : /^С AI/
  await page.getByRole('button', { name: 'Създай тест', exact: true }).click()
  await page.getByRole('button', { name: choiceName }).click()
}
