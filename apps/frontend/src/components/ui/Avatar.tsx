import { initials } from '@/lib/menu';
import { gradientFor } from '@/lib/palette';

const SIZE = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-12 h-12 text-base',
} as const;

/**
 * A person's initials on their own stable gradient. Decorative by default: the name is always
 * printed next to it or given by `title`, so screen readers skip it.
 */
export default function Avatar({
  name,
  id,
  size = 'sm',
  className = '',
  title,
}: {
  name: string;
  /** What the color is derived from (default: the name). */
  id?: string;
  size?: keyof typeof SIZE;
  className?: string;
  title?: string;
}) {
  return (
    <span
      aria-hidden="true"
      title={title}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${gradientFor(id ?? name)} text-white font-semibold ring-2 ring-white dark:ring-slate-900 ${SIZE[size]} ${className}`}
    >
      {initials(name)}
    </span>
  );
}
