/**
 * The top of every signed-in page: an optional eyebrow and icon, the one h1, a subtitle and the
 * page's main actions.
 */
export default function PageHeader({
  title,
  subtitle,
  eyebrow,
  icon,
  actions,
  children,
  className = 'mb-8',
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  eyebrow?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  /** Outer spacing; the default leaves room before the page body. */
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-4 items-end justify-between ${className}`}>
      <div className="flex items-start gap-4 min-w-0">
        {icon && (
          <span
            aria-hidden="true"
            className="hidden sm:inline-flex icon-tile w-12 h-12 rounded-2xl bg-brand text-white shadow-glow [&>svg]:w-6 [&>svg]:h-6"
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
          <h1 className="page-title break-words">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
          {children}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
