import { api } from './api';

export const LABEL_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink'] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

export interface Label {
  id: string;
  name: string;
  color: LabelColor;
}

export interface OrgLabel extends Label {
  task_count: number;
}

/**
 * Chip classes per palette color, light and dark. Written out in full so Tailwind can see them (it
 * does not pick up class names built at run time).
 */
const CHIP_CLASSES: Record<LabelColor, string> = {
  gray: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200',
  green: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200',
  teal: 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200',
  indigo: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200',
  pink: 'bg-pink-100 text-pink-800 dark:bg-pink-900/50 dark:text-pink-200',
};

/** Classes for a label chip; an unknown color falls back to gray. */
export const chipClasses = (color: string) => CHIP_CLASSES[color as LabelColor] ?? CHIP_CLASSES.gray;

export const listLabels = (): Promise<OrgLabel[]> => api.get('/labels');
export const createLabel = (name: string, color: LabelColor): Promise<OrgLabel> => api.post('/labels', { name, color });
export const updateLabel = (id: string, patch: { name?: string; color?: LabelColor }): Promise<Label> =>
  api.patch(`/labels/${id}`, patch);
export const deleteLabel = (id: string): Promise<void> => api.delete(`/labels/${id}`);
export const setTaskLabels = (projectId: string, taskId: string, labelIds: string[]): Promise<Label[]> =>
  api.put(`/projects/${projectId}/tasks/${taskId}/labels`, { label_ids: labelIds });

/** Add or remove one label from a task's set, keeping the rest. */
export const toggleLabel = (current: string[], id: string) =>
  current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
