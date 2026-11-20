"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import type { Page } from "@/lib/query";
import {
  AUDIT_FILTERS,
  describeAudit,
  deviceOf,
  isWarning,
  type AuditEntry,
} from "@/lib/audit";
import { timeAgo } from "@/lib/activity";
import { messageOf } from "@/components/ui/feedback";
import {
  EmptyBlock,
  ErrorBlock,
  Field,
  LoadingBlock,
} from "@/components/ui/states";

/**
 * Security log: sign-ins, failed sign-ins, password changes, and changes to who can do or see what
 * (docs/audit-log.md). Admins and owners only: the API refuses anyone else, and the page shows its error.
 */
export default function SecurityLogPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  const query = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams({ limit: "50" });
      if (action) params.set("action", action);
      if (cursor) params.set("cursor", cursor);
      return api.get(`/audit?${params}`) as Promise<Page<AuditEntry>>;
    },
    [action],
  );

  // State is only set when the request settles; callers clear the list first (filter change, retry).
  const load = useCallback(
    () =>
      query()
        .then((page) => {
          setEntries(page.items);
          setNext(page.next_cursor);
          setError("");
        })
        .catch((err) =>
          setError(messageOf(err, "Could not load the security log")),
        ),
    [query],
  );

  const reload = () => {
    setEntries(null);
    setError("");
    load();
  };

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = async () => {
    if (!next) return;
    setLoadingMore(true);
    try {
      const page = await query(next);
      setEntries((prev) => [...(prev ?? []), ...page.items]);
      setNext(page.next_cursor);
    } catch (err) {
      setError(messageOf(err, "Could not load more entries"));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto w-full">
      <h1 className="page-title mb-2">
        Security log
      </h1>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
        Sign-ins, failed sign-ins, password changes, and changes to who can do
        or see what in this workspace. Only admins and owners can see it.
        Entries are kept for a year, then deleted.
      </p>

      <>
        <Field label="Show" className="max-w-xs mb-6">
          <select
            className="input-field"
            value={action}
            onChange={(e) => {
              setEntries(null);
              setError("");
              setAction(e.target.value);
            }}
          >
            <option value="">Everything</option>
            {AUDIT_FILTERS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>

        {error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : !entries ? (
          <LoadingBlock label="Loading the security log" />
        ) : entries.length === 0 ? (
          <EmptyBlock
            icon={<ShieldCheck className="w-8 h-8" />}
            title="Nothing recorded"
          >
            {action
              ? "No entries of this kind."
              : "Security events in this workspace will show up here."}
          </EmptyBlock>
        ) : (
          <section
            aria-label="Security events"
            className="card animate-fade-up"
          >
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {entries.map((e) => {
                const warn = isWarning(e.action);
                return (
                  <li key={e.id} className="p-4 sm:px-6 flex gap-3">
                    {warn ? (
                      <AlertTriangle
                        className="w-5 h-5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
                        aria-label="Warning"
                      />
                    ) : (
                      <ShieldCheck
                        className="w-5 h-5 mt-0.5 shrink-0 text-slate-400"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="text-slate-900 dark:text-slate-100">
                        {describeAudit(e)}
                      </p>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        <time
                          dateTime={e.created_at}
                          title={new Date(e.created_at).toLocaleString()}
                        >
                          {timeAgo(e.created_at)}
                        </time>
                        {e.ip && <> · {e.ip}</>}
                        {e.user_agent && <> · {deviceOf(e.user_agent)}</>}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
            {next && (
              <div className="p-4 border-t border-slate-200 dark:border-slate-800 text-center">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore && (
                    <Loader2
                      className="w-4 h-4 animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  Load more
                </button>
              </div>
            )}
          </section>
        )}
      </>
    </div>
  );
}
