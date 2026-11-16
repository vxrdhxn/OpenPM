import { chipClasses, type Label } from '@/lib/labels';

/** A small colored label. The name is text (never HTML). */
export default function LabelChip({ label, className = '' }: { label: Pick<Label, 'name' | 'color'>; className?: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium max-w-[12rem] truncate ${chipClasses(label.color)} ${className}`}>
      {label.name}
    </span>
  );
}
