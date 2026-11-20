/** The OpenPM wordmark: "openpm" in ink with a red full stop. */
export default function Brand({ size = 'md' }: { size?: 'md' | 'lg' | 'xl' }) {
  const text = size === 'xl' ? 'text-[clamp(5rem,22vw,20rem)] leading-[0.8]' : size === 'lg' ? 'text-3xl' : 'text-[1.4rem]';
  return (
    <span className={`font-display font-semibold tracking-[-0.05em] text-slate-900 dark:text-white ${text}`}>
      openpm<span className="text-accent-500">.</span>
    </span>
  );
}
