import { expect, type Page } from '@playwright/test';

export const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api';
export const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** Creates a project through the API (with the page's session) and returns its id. */
export async function createProject(page: Page, name = `Project ${unique()}`): Promise<string> {
  const res = await page.request.post(`${API}/projects`, { data: { name, description: 'Created by an e2e test' } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id;
}

/** Creates a task through the API and returns its id. */
export async function createTask(page: Page, projectId: string, title: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await page.request.post(`${API}/projects/${projectId}/tasks`, { data: { title, ...extra } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id;
}
