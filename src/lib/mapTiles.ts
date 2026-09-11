/**
 * Basemap tiles for Leaflet.
 * Do not use tile.openstreetmap.org — OSMF blocks apps that hit their
 * volunteer tile CDN (403 “Blocked” / usage policy).
 *
 * Default: Esri World Street Map (no API key).
 * Optional: VITE_MAP_TILE_PROVIDER=carto (+ VITE_CARTO_API_KEY), or full VITE_MAP_TILE_URL.
 */
export type MapTileSpec = {
  url: string;
  maxZoom: number;
  attribution: string;
  subdomains?: string | string[];
};

const ESRI_STREET: MapTileSpec = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
  maxZoom: 19,
  attribution:
    'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, TomTom, Garmin, FAO, NOAA, USGS, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
};

const CARTO_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

function cartoStreet(apiKey: string | undefined): MapTileSpec {
  const key = (apiKey || "").trim();
  const qs = key ? `?apikey=${encodeURIComponent(key)}` : "";
  return {
    url: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png${qs}`,
    maxZoom: 20,
    attribution: CARTO_ATTR,
    subdomains: "abcd",
  };
}

function resolveStreetTile(): MapTileSpec {
  const customUrl = (import.meta.env.VITE_MAP_TILE_URL as string | undefined)?.trim();
  const customAttr = (import.meta.env.VITE_MAP_TILE_ATTR as string | undefined)?.trim();
  const maxZoomEnv = Number(import.meta.env.VITE_MAP_TILE_MAX_ZOOM);
  const provider = String(import.meta.env.VITE_MAP_TILE_PROVIDER || "esri")
    .toLowerCase()
    .trim();

  if (customUrl) {
    return {
      url: customUrl,
      maxZoom: Number.isFinite(maxZoomEnv) && maxZoomEnv > 0 ? maxZoomEnv : 19,
      attribution: customAttr || ESRI_STREET.attribution,
      subdomains: customUrl.includes("{s}") ? "abcd" : undefined,
    };
  }

  if (provider === "carto") {
    const tile = cartoStreet(import.meta.env.VITE_CARTO_API_KEY as string | undefined);
    if (Number.isFinite(maxZoomEnv) && maxZoomEnv > 0) tile.maxZoom = maxZoomEnv;
    if (customAttr) tile.attribution = customAttr;
    return tile;
  }

  return {
    ...ESRI_STREET,
    maxZoom: Number.isFinite(maxZoomEnv) && maxZoomEnv > 0 ? maxZoomEnv : ESRI_STREET.maxZoom,
    attribution: customAttr || ESRI_STREET.attribution,
  };
}

export const STREET_TILE: MapTileSpec = resolveStreetTile();

/** Leaflet tileLayer options from STREET_TILE. */
export function streetTileOptions(): {
  attribution: string;
  maxZoom: number;
  subdomains?: string | string[];
} {
  const opts: {
    attribution: string;
    maxZoom: number;
    subdomains?: string | string[];
  } = {
    attribution: STREET_TILE.attribution,
    maxZoom: STREET_TILE.maxZoom,
  };
  if (STREET_TILE.subdomains) opts.subdomains = STREET_TILE.subdomains;
  return opts;
}
