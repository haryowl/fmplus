import type { ReactNode } from "react";

/** Compact stroke icons for Fleet Live — no external icon package. */
type IconProps = { className?: string; title?: string };

function Svg({ className, title, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className ? `fleet-ico ${className}` : "fleet-ico"}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export function IcoLive(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M5.5 12a6.5 6.5 0 0 1 13 0" />
      <path d="M2.5 12a9.5 9.5 0 0 1 19 0" />
    </Svg>
  );
}

export function IcoDash(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="5" rx="1.5" />
      <rect x="13" y="10" width="8" height="11" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
    </Svg>
  );
}

export function IcoRank(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </Svg>
  );
}

export function IcoTrips(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <path d="M8.2 16.2 15.8 7.8" />
    </Svg>
  );
}

export function IcoHistory(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </Svg>
  );
}

export function IcoMedia(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </Svg>
  );
}

export function IcoAlerts(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3a6 6 0 0 0-6 6v3.5L4.5 15h15L18 12.5V9a6 6 0 0 0-6-6z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </Svg>
  );
}

export function IcoRules(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 5H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
      <path d="M16 3h5v5" />
      <path d="M10 14 21 3" />
    </Svg>
  );
}

export function IcoRefresh(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M21 12a9 9 0 1 1-2.6-6.3" />
      <path d="M21 3v6h-6" />
    </Svg>
  );
}

export function IcoMenu(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  );
}

export function IcoCollapse(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M15 6 9 12l6 6" />
    </Svg>
  );
}

export function IcoExpand(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 6l6 6-6 6" />
    </Svg>
  );
}

export function IcoSearch(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16.5 16.5 4 4" />
    </Svg>
  );
}

export function IcoGroup(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3.5 19c.8-3 3-4.5 5.5-4.5S13.7 16 14.5 19" />
      <path d="M14.2 14.2c1.4-.6 3-.6 4.8.3 1.2.6 2 1.8 2.5 3.5" />
    </Svg>
  );
}

export function IcoZone(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18M3 12h18" />
      <path d="M5.5 7.5c2.2 1.2 5 1.8 6.5 1.8s4.3-.6 6.5-1.8" />
      <path d="M5.5 16.5c2.2-1.2 5-1.8 6.5-1.8s4.3.6 6.5 1.8" />
    </Svg>
  );
}

export function IcoFuel(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 21V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15" />
      <path d="M5 21h12" />
      <path d="M15 10h2.5a2 2 0 0 1 2 2v5.5a1.5 1.5 0 0 0 3 0V9l-2-2" />
      <path d="M7 9h6" />
    </Svg>
  );
}

export function IcoSpeed(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5.5 17a8 8 0 1 1 13 0" />
      <path d="M12 13l3.5-3.5" />
      <circle cx="12" cy="13" r="1.2" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IcoOdo(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="7" width="18" height="10" rx="2" />
      <path d="M7 12h2M11 12h2M15 12h2" />
    </Svg>
  );
}

export function IcoWrench(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14.5 6.5a4 4 0 0 0-5.6 5.6L4 17v3h3l4.9-4.9a4 4 0 0 0 5.6-5.6l-2.2 2.2-2.1-.7-.7-2.1 2.2-2.2z" />
    </Svg>
  );
}

export function IcoFleet(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 16h13l3-5H8L5.5 16" />
      <path d="M5 16v2M14 16v2" />
      <circle cx="7" cy="18.5" r="1.5" />
      <circle cx="15" cy="18.5" r="1.5" />
      <path d="M8 11V8h5l2 3" />
    </Svg>
  );
}

export function IcoUtil(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M8 15v-4M12 15V8M16 15v-6" />
    </Svg>
  );
}

export function IcoCover(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3 4 7v5c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V7l-8-4z" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  );
}

export function IcoPicture(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m21 16-5-5-4 4-2-2-5 5" />
    </Svg>
  );
}

export function IcoVideo(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3z" />
    </Svg>
  );
}

export function IcoReport(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 3h8l4 4v14H7z" />
      <path d="M15 3v4h4" />
      <path d="M10 12h6M10 16h6M10 8h2" />
    </Svg>
  );
}

export function IcoMail(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </Svg>
  );
}

export function IcoWhatsApp(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 4a8 8 0 0 0-6.9 12.1L4 20l4-1.1A8 8 0 1 0 12 4z" />
      <path d="M9.2 9.5c.3-.6.6-.6.9-.6h.3c.2 0 .4 0 .5.4l.7 1.7c.1.2 0 .4-.1.6l-.4.5c-.1.1-.2.3 0 .5.4.6 1 1.2 1.7 1.6.3.2.5.1.7 0l.6-.4c.2-.1.4-.1.6 0l1.6.8c.3.1.4.3.4.5v.4c0 .3 0 .6-.3.9-.5.5-1.3.8-2.1.7-2.2-.2-4.3-1.5-5.7-3.2-1.2-1.4-1.8-3-1.7-4.6.1-.7.4-1.3.8-1.6z" />
    </Svg>
  );
}

export function IcoClose(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function IcoDevice(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </Svg>
  );
}

export function IcoCalendar(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </Svg>
  );
}

export function IcoAttention(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3 2.5 20h19L12 3z" />
      <path d="M12 10v5M12 17.5v.5" />
    </Svg>
  );
}

export function IcoProtocol(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8M8 12h8M8 15h5" />
    </Svg>
  );
}

export function IcoIgnition(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 1.5" />
      <path d="M12 4v2M12 18v2M4 12H6M18 12h2" />
    </Svg>
  );
}

export function IcoFix(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </Svg>
  );
}

export function IcoChevronUp(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m6 14 6-6 6 6" />
    </Svg>
  );
}

export function IcoChevronDown(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m6 10 6 6 6-6" />
    </Svg>
  );
}

export function IcoSortAsc(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 16V8M8 8l-2.5 2.5M8 8l2.5 2.5M13 8h7M13 12h5M13 16h3" />
    </Svg>
  );
}

export function IcoSortDesc(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 8v8M8 16l-2.5-2.5M8 16l2.5-2.5M13 8h3M13 12h5M13 16h7" />
    </Svg>
  );
}

export function IcoEye(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 12s3.6-6 9.5-6 9.5 6 9.5 6-3.6 6-9.5 6-9.5-6-9.5-6z" />
      <circle cx="12" cy="12" r="2.4" />
    </Svg>
  );
}

export function IcoFilter(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 6h16l-6.2 7.4V18l-3.6 2v-6.6L4 6z" />
    </Svg>
  );
}

export function IcoCopy(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="8" y="8" width="11" height="13" rx="2" />
      <path d="M5 16V5a2 2 0 0 1 2-2h8" />
    </Svg>
  );
}

export function IcoPin(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 21s7-6.2 7-11.2A7 7 0 1 0 5 9.8C5 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.8" r="2.2" />
    </Svg>
  );
}

export function IcoSignal(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 18a9 9 0 0 1 14 0" />
      <path d="M8.2 14.8a5 5 0 0 1 7.6 0" />
      <circle cx="12" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IcoUnits(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 8h16" />
      <path d="M4 16h16" />
      <path d="M8 5v6M16 13v6" />
    </Svg>
  );
}

export const SECTION_ICONS = {
  live: IcoLive,
  full: IcoOdo,
  fleet: IcoUtil,
  dashboard: IcoDash,
  ranking: IcoRank,
  trips: IcoTrips,
  history: IcoHistory,
  media: IcoMedia,
  alerts: IcoAlerts,
  reports: IcoReport,
} as const;
