/** User-facing fleet-unit copy. Storage, URLs, and scan types stay `vehicle`. */

export const ASSET = "Asset";
export const ASSETS = "Assets";

export const assetCopy = {
  asset: ASSET,
  assets: ASSETS,
  assetLower: "asset",
  assetsLower: "assets",
  metricsTitle: "Asset Metrics",
  selectAsset: "Select an asset",
  selectAGroup: "Select a group",
  chooseGroupFirst: "Choose a group first",
  noAssetSelected: "No asset selected",
  noAsset: "No asset",
  allAssets: "All assets",
  assetType: "Asset type",
  assetName: "Asset Name",
  scanAsset: "Scan asset",
  assetConfirmed: "Asset confirmed",
  assetLastFix: "Asset last fix",
  assetGps: "Asset GPS",
  assetStart: "Asset start",
  assetComplete: "Asset complete",
  assetTag: "Asset tag",
  openedJobForAsset: "Opened job for this asset",
  wrongAsset: "Wrong asset",
  noOpenJobForAsset: "No open job for this asset",
  scanBeforeComplete: "Scan the asset before completing this job",
  scanBeforeStart: "Scan the asset before starting this route",
  scanBeforeOrder: "Scan the asset before opening this order",
  fromAsset: "from asset",
  fallbackLabel: (id: number | string) => `Asset ${id}`,
} as const;
