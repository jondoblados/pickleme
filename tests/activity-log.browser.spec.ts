import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
const game = '00000000-0000-4000-8000-000000000002'
const person = '00000000-0000-4000-8000-000000000003'
const at = '2026-10-26T03:00:00Z'
const events = Array.from({ length: 150 }, (_, i) => ({
  id: String(150-i), created_at: at, action: i === 0 ? 'game_updated' : i % 2 ? 'withdrew' : 'joined',
  actor_id: person, actor_name: i === 2 ? '=SUM(1,2)' : 'Mario', target_user_id: i === 0 ? null : person,
  target_name: i === 0 ? null : 'Greg', game_id: game, game_title: 'Retained game', game_starts_at: at,
  context_origin: i === 3 ? 'backfilled_current' : 'captured_at_event',
  details: i === 0 ? { changes: { location: { before: 'Court A', after: 'Court B' } } } : {},
}))
async function mock(page: Page, options: { deny?: () => boolean; delayExport?: () => boolean } = {}) {
  const calls: Record<string, unknown>[] = []
  await page.route('**/rest/v1/rpc/**', async route => {
    const body = route.request().postDataJSON(); calls.push(body)
    if (options.deny?.()) {
      await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'forbidden' }) }); return
    }
    if (route.request().url().endsWith('activity_filter_options')) {
      await route.fulfill({ json: { games: [{ id: game, name: 'Retained game' }], people: [{ id: person, name: 'Former member' }] } }); return
    }
    if (body.p_limit === 100 && options.delayExport?.()) await new Promise(resolve => setTimeout(resolve, 700))
    const selected = body.p_action ? events.filter(e => e.action === body.p_action) : events
    const offset = body.p_before_id ? selected.findIndex(e => e.id === body.p_before_id) + 1 : 0
    const rows = selected.slice(offset, offset + body.p_limit), hasNext = offset + rows.length < selected.length
    await route.fulfill({ json: { rows, next_cursor: hasNext ? { at, id: rows.at(-1)!.id } : null, as_of: '2026-10-26T04:00:00Z', timezone: 'Asia/Singapore' } })
  })
  return calls
}
async function open(page: Page, role = 'admin') {
  await page.goto(`tests/activity-log.harness.html?role=${role}`)
}
test('non-admin guard sends no activity API requests', async ({ page }) => {
  const calls = await mock(page); await open(page, 'organiser')
  await expect(page.getByRole('alert')).toContainText('Only admins')
  await expect(page.getByRole('table')).toHaveCount(0); expect(calls).toHaveLength(0)
})
test('loads actual component, expands before/after details and paginates', async ({ page }) => {
  const calls = await mock(page); await open(page)
  await expect(page.getByText('Records 1–50 · Page 1')).toBeVisible()
  await page.getByRole('button', { name: 'View details', exact: true }).first().click()
  await expect(page.getByText('Before: Court A')).toBeVisible(); await expect(page.getByText('After: Court B')).toBeVisible()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByText('Records 51–100 · Page 2')).toBeVisible()
  expect(calls.some(c => c.p_before_id === '101')).toBeTruthy()
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await expect(page.getByText('Records 1–50 · Page 1')).toBeVisible()
})
test('filters reach API only after Apply; date changes reset historical selections', async ({ page }) => {
  const calls = await mock(page); await open(page)
  await expect(page.getByRole('table')).toBeVisible()
  await page.getByRole('combobox', { name: 'Game', exact: true }).selectOption(game)
  await page.getByRole('combobox', { name: 'Person (actor or affected)', exact: true }).selectOption(person)
  await page.getByRole('combobox', { name: 'Action', exact: true }).selectOption('withdrew')
  await expect(page.getByText('Filters have changed.', { exact: false })).toBeVisible()
  expect(calls.filter(c => c.p_action === 'withdrew')).toHaveLength(0)
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(page.getByRole('table')).toBeVisible()
  expect(calls.some(c => c.p_game_id === game && c.p_person_id === person && c.p_action === 'withdrew')).toBeTruthy()
  await page.getByLabel('From', { exact: true }).fill('2000-01-01')
  await expect(page.getByRole('combobox', { name: 'Game', exact: true })).toHaveValue('')
  await expect(page.getByRole('combobox', { name: 'Person (actor or affected)', exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Apply filters' })).toBeDisabled()
})
test('CSV exports all pages using applied filters, retaining safe formula text', async ({ page }) => {
  const calls = await mock(page); await open(page)
  await expect(page.getByRole('table')).toBeVisible()
  await page.getByRole('combobox', { name: 'Action', exact: true }).selectOption('withdrew')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export filtered CSV' }).click()
  const file = await download; const path = await file.path(); expect(path).toBeTruthy()
  const csv = await readFile(path!, 'utf8')
  expect(csv).toContain("'=SUM(1,2)"); expect(csv).toContain('Edited game')
  expect(csv.split('\r\n')).toHaveLength(151)
  const exported = calls.filter(c => c.p_limit === 100)
  expect(exported).toHaveLength(2)
  expect(exported.every(c => c.p_action === null && c.p_as_of === '2026-10-26T04:00:00Z')).toBeTruthy()
})
test('cancel export saves no file and leaves the table usable', async ({ page }) => {
  let delay = false; const downloads: string[] = []
  await mock(page, { delayExport: () => delay }); await open(page)
  await expect(page.getByRole('table')).toBeVisible()
  page.on('download', d => downloads.push(d.suggestedFilename())); delay = true
  await page.getByRole('button', { name: 'Export filtered CSV' }).click()
  await page.getByRole('button', { name: 'Cancel export' }).click()
  await page.waitForTimeout(1000)
  expect(downloads).toHaveLength(0)
  await expect(page.getByRole('button', { name: 'Apply filters' })).toBeEnabled()
})
test('permission error clears previously visible data', async ({ page }) => {
  let denied = false; await mock(page, { deny: () => denied }); await open(page)
  await expect(page.getByRole('table')).toBeVisible(); denied = true
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByRole('table')).toHaveCount(0)
})
test('mobile viewport contains horizontal scrolling inside the table', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 }); await mock(page); await open(page)
  await expect(page.getByRole('table')).toBeVisible()
  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth,
    table: document.querySelector('.activity-table-wrap')!.scrollWidth, wrapper: document.querySelector('.activity-table-wrap')!.clientWidth }))
  expect(widths.page).toBeLessThanOrEqual(widths.viewport); expect(widths.table).toBeGreaterThan(widths.wrapper)
})
