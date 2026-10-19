import type { ReactNode } from "react";
import { SECTION_ICONS } from "./fleetLiveIcons";

type SectionId = keyof typeof SECTION_ICONS;

type Props = {
  section: SectionId;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
};

export function FleetLiveSectionHead({ section, title, subtitle, actions }: Props) {
  const Icon = SECTION_ICONS[section];
  return (
    <header className="fleet-sec-head">
      <div className="fleet-sec-head-main">
        <span className="fleet-sec-badge" aria-hidden>
          <Icon />
        </span>
        <div className="fleet-sec-titles">
          <h2>{title}</h2>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="fleet-sec-actions">{actions}</div> : null}
    </header>
  );
}
