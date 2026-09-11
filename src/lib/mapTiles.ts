/**
 * Basemap tiles for Leaflet.
 * Do not use tile.openstreetmap.org — OSMF blocks apps that hit their
 * volunteer tile CDN (403 “Blocked” / usage policy).
 *
 * Default: CARTO Voyager (OSM data). Override with VITE_MAP_TILE_URL if needed.
 */
const DEFAULT_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const DEFAULT_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

export type MapTileSpec = {
  url: string;
  maxZoom: number;
  attribution: string;
  subdomains?: string | string[];
};

export const STREET_TILE: MapTileSpec = {
  url: (import.meta.env.VITE_MAP_TILE_URL as string | undefined)?.trim() || DEFAULT_URL,
  maxZoom: Number(import.meta.env.VITE_MAP_TILE_MAX_ZOOM) || 20,
  attribution:
    (import.meta.env.VITE_MAP_TILE_ATTR as string | undefined)?.trim() || DEFAULT_ATTR,
  subdomains: "abcd",
};

/** Leaflet tileLayer options from STREET_TILE. */
export function streetTileOptions(): {
  attribution: string;
  maxZoom: number;
  subdomains?: string | string[];
} {
  return {
    attribution: STREET_TILE.attribution,
    maxZoom: STREET_TILE.maxZoom,
    subdomains: STREET_TILE.subdomains,
  };
}
