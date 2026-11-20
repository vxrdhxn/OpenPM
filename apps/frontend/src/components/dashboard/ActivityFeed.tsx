import Link from 'next/link';
import { describeActivity, timeAgo, type ActivityEntry } from '@/lib/activity';
import Avatar from '@/components/ui/Avatar';

/**
 * Recent product activity in the organization: who did what, and when, as a timeline. Names render
 * as text.
 */
export default function ActivityFeed({ entries, compact = true }: { entries: ActivityEntry[]; compact?: boolean }) {
  if (entries.length === 0) return <p className="text-sm text-slate-500">Nothing has happened yet.</p>;

  return (
    <ol className="relative stagger">
      {entries.map((a, i) => {
        const name = a.entity_name ?? 'something';
        // Link while the thing still exists; a deleted task or project is plain text.
        const target =
          a.project_id && a.action !== 'deleted' ? (
            <Link
              href={`/projects/${a.project_id}`}
              className="font-medium text-slate-900 dark:text-white hover:text-indigo-700 dark:hover:text-indigo-300 underline-offset-2 hover:underline"
            >
              {name}
            </Link>
          ) : (
            <span className="font-medium text-slate-900 dark:text-white">{name}</span>
          );
        const last = i === entries.length - 1;
        return (
          <li key={a.id} style={{ '--i': i } as React.CSSProperties} className={`relative flex gap-3 ${compact ? 'pb-4' : 'pb-6'} last:pb-0`}>
            {!last && (
              <span aria-hidden="true" className="absolute left-4 top-9 bottom-1 w-px bg-gradient-to-b from-slate-200 to-transparent dark:from-slate-700" />
            )}
            <Avatar name={a.user_name} id={a.user_id} size="sm" />
            <div className="min-w-0 pt-0.5 text-sm text-slate-600 dark:text-slate-400">
              <p className="break-words">
                <span className="font-semibold text-slate-900 dark:text-white">{a.user_name}</span> {describeActivity(a)} {target}
              </p>
              <time dateTime={a.created_at} className="block text-xs text-slate-500 mt-0.5">
                {timeAgo(a.created_at)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
