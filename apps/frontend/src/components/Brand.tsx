/** The OpenPM wordmark: "openpm" in ink with a red full stop, and a small live-activity meter. */
export default function Brand({ size = 'md', meter = true }: { size?: 'md' | 'lg' | 'xl'; meter?: boolean }) {
  const text = size === 'xl' ? 'text-[clamp(5rem,22vw,20rem)] leading-[0.8]' : size === 'lg' ? 'text-3xl' : 'text-[1.4rem]';
  return (
    <span className="inline-flex items-end gap-2.5">
      <span className={`font-display font-semibold tracking-[-0.05em] text-slate-900 dark:text-white ${text}`}>
        openpm<span className="text-accent-500">.</span>
      </span>
      {meter && size !== 'xl' && (
        // Four bars that rise and fall: the board is live.
        <span aria-hidden="true" className="mb-[0.42em] flex h-3 items-end gap-[2px]">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="w-[2px] origin-bottom rounded-full bg-slate-900 dark:bg-white animate-[meter_1.1s_ease-in-out_infinite]"
              style={{ animationDelay: `${i * -0.27}s`, height: `${[40, 100, 65, 85][i]}%` }}
            />
          ))}
        </span>
      )}
    </span>
  );
}
