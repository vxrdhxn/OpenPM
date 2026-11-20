import DisplayTitle from './DisplayTitle';

/**
 * The top of every signed-in page, in the home page's voice: a mono eyebrow, a big display title
 * with a red full stop (the page's one h1), a subtitle, and the page's main actions.
 * `title` is text; pages that need something richer render their own heading.
 */
export default function PageHeader({
  title,
  subtitle,
  eyebrow,
  icon,
  actions,
  children,
  className = 'mb-10',
}: {
  title: string;
  subtitle?: React.ReactNode;
  eyebrow?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  /** Outer spacing; the default leaves room before the page body. */
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-6 items-end justify-between ${className}`}>
      <div className="min-w-0">
        {(eyebrow || icon) && (
          <p className="eyebrow mb-3 flex items-center gap-2 animate-fade-in">
            {icon && (
              <span aria-hidden="true" className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink text-white dark:bg-paper dark:text-ink [&>svg]:h-3 [&>svg]:w-3">
                {icon}
              </span>
            )}
            {eyebrow}
          </p>
        )}
        <DisplayTitle text={title} className="text-[clamp(2.6rem,5.5vw,4.75rem)] leading-[0.95]" />
        {subtitle && <p className="mt-4 max-w-2xl text-lg text-slate-600 dark:text-slate-400 animate-fade-up [animation-delay:200ms]">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap gap-2 animate-fade-up [animation-delay:250ms]">{actions}</div>}
    </div>
  );
}
