import type { ReactNode } from "react";

type Props = {
  id: string;
  title: string;
  hint?: ReactNode;
  folded: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
  /** Accessible name for the region when expanded. */
  label?: string;
};

/** Compact foldable panel used on Dispatch Live. */
export function FoldPanel({
  id,
  title,
  hint,
  folded,
  onToggle,
  children,
  className = "",
  label,
}: Props) {
  return (
    <section
      className={`panel fold-panel${folded ? " is-folded" : ""}${className ? ` ${className}` : ""}`}
      aria-label={label || title}
      data-fold-id={id}
    >
      <div className="fold-panel-head">
        <div className="fold-panel-titles">
          <h2>{title}</h2>
          {hint ? <span className="fold-panel-hint">{hint}</span> : null}
        </div>
        <button
          type="button"
          className="fold-panel-toggle btn-ghost"
          aria-expanded={!folded}
          aria-controls={`fold-body-${id}`}
          onClick={onToggle}
        >
          {folded ? "Show" : "Hide"}
        </button>
      </div>
      {!folded ? (
        <div className="fold-panel-body" id={`fold-body-${id}`}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
