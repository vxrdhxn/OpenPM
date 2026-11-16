import Link from 'next/link';
import { describeActivity, timeAgo, type ActivityEntry } from '@/lib/activity';

/** Recent product activity in the organization: who did what, and when. Names render as text. */
export default function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) return <p className="text-sm text-slate-500">Nothing has happened yet.</p>;

  return (
    <ol className="space-y-3">
      {entries.map((a) => {
        const name = a.entity_name ?? 'something';
        // Link while the thing still exists; a deleted task or project is plain text.
        const target =
          a.project_id && a.action !== 'deleted' ? (
            <Link href={`/projects/${a.project_id}`} className="font-medium text-slate-900 dark:text-white hover:underline">
              {name}
            </Link>
          ) : (
            <span className="font-medium text-slate-900 dark:text-white">{name}</span>
          );
        return (
          <li key={a.id} className="text-sm text-slate-600 dark:text-slate-400">
            <span className="font-medium text-slate-900 dark:text-white">{a.user_name}</span> {describeActivity(a)} {target}
            <time dateTime={a.created_at} className="block text-xs text-slate-500">
              {timeAgo(a.created_at)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
