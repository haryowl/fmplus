import type { ReactNode } from "react";
import { SECTION_ICONS } from "./fleetLiveIcons";

type SectionId = keyof typeof SECTION_ICONS;

type Props = {
  section: SectionId;
  title: string;
  subtitle?: ReactNode;
  /** Small status chip next to the title (e.g. LIVE / DAY). */
  badge?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
};

export function FleetLiveSectionHead({
  section,
  title,
  subtitle,
  badge,
  meta,
  actions,
}: Props) {
  const Icon = SECTION_ICONS[section];
  return (
    <header className="fleet-sec-head">
      <div className="fleet-sec-head-main">
        <span className="fleet-sec-badge" aria-hidden>
          <Icon />
        </span>
        <div className="fleet-sec-titles">
          <div className="fleet-sec-title-row">
            <h2>{title}</h2>
            {badge ? <span className="fleet-sec-chip">{badge}</span> : null}
          </div>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
          {meta ? <div className="fleet-sec-meta muted">{meta}</div> : null}
        </div>
      </div>
      {actions ? <div className="fleet-sec-actions">{actions}</div> : null}
    </header>
  );
}
