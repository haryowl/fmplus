type Props = {
  size?: number;
};

export function BrandMark({ size = 18 }: Props) {
  return (
    <div className="mark" aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
        <path d="M3 13.5h12" stroke="#f6fffc" strokeWidth="1.6" strokeLinecap="round" />
        <path
          d="M4 11.5c2.2-4 3.4-6 5-6s2.8 2 5 6"
          stroke="#f6fffc"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <circle cx="9" cy="11.5" r="1.3" fill="#f6fffc" />
      </svg>
    </div>
  );
}
