/**
 * A page title in the home page's voice: big display type, words that rise into place as the page
 * opens, and a red full stop. The accessible name is just the text (the words are wrapped only
 * visually, and the full stop is decoration).
 */
export default function DisplayTitle({
  text,
  as: Tag = 'h1',
  className = '',
  id,
}: {
  text: string;
  as?: 'h1' | 'h2';
  className?: string;
  id?: string;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <Tag id={id} aria-label={text} className={`title-rise font-display font-medium tracking-[-0.045em] text-slate-900 dark:text-white break-words ${className}`}>
      {words.map((w, i) => (
        <span key={i} aria-hidden="true">
          <span className="word">
            <span style={{ '--w': i } as React.CSSProperties}>
              {w}
              {i === words.length - 1 && <span className="text-accent-500">.</span>}
            </span>
          </span>
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </Tag>
  );
}
