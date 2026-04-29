import { expect, type Page, test } from '@playwright/test';

const todoUrl = 'http://127.0.0.1:5173/';
const postFormUrl = 'http://127.0.0.1:5174/';

test.describe('example apps in real browsers', () => {
  test('todo example adds, toggles, filters, and clears todos', async ({ page }) => {
    const problems = recordPageProblems(page);

    await page.goto(todoUrl);

    await expect(page.getByRole('heading', { name: 'Today, plainly' })).toBeVisible();
    await expect(page.locator('.summary')).toHaveText('2 open, 1 done');

    const input = page.getByLabel('New task');
    const addButton = page.getByRole('button', { name: 'Add' });

    await expect(addButton).toBeDisabled();
    await input.fill('Browser e2e task');
    await expect(addButton).toBeEnabled();
    await addButton.click();

    await expect(page.getByRole('checkbox', { name: 'Browser e2e task' })).toBeVisible();
    await expect(input).toHaveValue('');
    await expect(addButton).toBeDisabled();
    await expect(page.locator('.summary')).toHaveText('3 open, 1 done');

    await page.getByRole('checkbox', { name: 'Browser e2e task' }).check();
    await expect(page.locator('.summary')).toHaveText('2 open, 2 done');

    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Browser e2e task' })).toBeVisible();

    await page.getByRole('button', { name: 'Clear done' }).click();
    await expect(page.getByText('Nothing in this view.')).toBeVisible();
    await expect(page.locator('.summary')).toHaveText('2 open, 0 done');

    expect(problems).toEqual([]);
  });

  test('post form example submits JSON and handles request failures', async ({ page }) => {
    const problems = recordPageProblems(page, [
      /Failed to load resource: the server responded with a status of 503/
    ]);
    const requests: unknown[] = [];

    await page.route('**/api/posts', async route => {
      const request = route.request();
      requests.push(JSON.parse(request.postData() ?? '{}'));

      if (requests.length === 1) {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: 42, title: 'Browser post' })
        });
        return;
      }

      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({})
      });
    });

    await page.goto(postFormUrl);

    await expect(page.getByRole('heading', { name: 'Publish a note' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Post note' })).toBeDisabled();

    await page.getByLabel('Title').fill('Browser post');
    await page.getByLabel('Body').fill('Posted from Playwright.');
    await expect(page.getByRole('button', { name: 'Post note' })).toBeEnabled();
    await page.getByRole('button', { name: 'Post note' }).click();

    await expect(page.locator('.success')).toHaveText('Created post #42: Browser post');
    await expect(page.getByLabel('Title')).toHaveValue('');
    await expect(page.getByLabel('Body')).toHaveValue('');
    expect(requests[0]).toEqual({
      title: 'Browser post',
      body: 'Posted from Playwright.'
    });

    await page.getByLabel('Title').fill('Broken post');
    await page.getByLabel('Body').fill('This one fails.');
    await page.getByRole('button', { name: 'Post note' }).click();

    await expect(page.locator('.error')).toHaveText('Could not post: Request failed with HTTP 503');
    expect(requests[1]).toEqual({
      title: 'Broken post',
      body: 'This one fails.'
    });

    expect(problems).toEqual([]);
  });
});

function recordPageProblems(page: Page, ignoredConsoleErrors: RegExp[] = []): string[] {
  const problems: string[] = [];

  page.on('pageerror', error => {
    problems.push(error.message);
  });

  page.on('console', message => {
    const text = message.text();
    if (message.type() === 'error' && !ignoredConsoleErrors.some(pattern => pattern.test(text))) {
      problems.push(text);
    }
  });

  return problems;
}
