import { KanbanSquare } from 'lucide-react';

/** The OpenPM mark: a gradient tile with the board icon, and the name. */
export default function Brand({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const tile = size === 'lg' ? 'w-10 h-10 rounded-xl' : 'w-8 h-8 rounded-lg';
  const icon = size === 'lg' ? 'w-5 h-5' : 'w-4 h-4';
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={`relative inline-flex items-center justify-center ${tile} bg-brand text-white shadow-glow`}
      >
        <KanbanSquare className={icon} />
        <span className="absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/25" />
      </span>
      <span className={`font-display font-extrabold tracking-tight text-slate-900 dark:text-white ${size === 'lg' ? 'text-2xl' : 'text-lg'}`}>
        Open<span className="gradient-text">PM</span>
      </span>
    </div>
  );
}
