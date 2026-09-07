type Props = {
  size?: number;
  /** Accessible label; decorative by default in nav chrome */
  alt?: string;
};

/**
 * Armada brand mark used on topbars, login, admin, and field.
 * Container size comes from `.mark` CSS (page context); `size` is kept for call-site compatibility.
 */
export function BrandMark({ size: _size = 18, alt = "" }: Props) {
  return (
    <div className="mark" aria-hidden={alt ? undefined : true}>
      <img src="/armada-logo.png" alt={alt} draggable={false} />
    </div>
  );
}
