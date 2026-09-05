import { describe, expect, it } from "vitest";
import {
  addressAt,
  clearReverseGeocodeCache,
  geocodeCacheKey,
  parseReverseGeocodeAddress,
  resolveAddressesForCoords,
} from "./reverseGeocode";

describe("reverseGeocode", () => {
  it("rounds cache keys", () => {
    expect(geocodeCacheKey(-6.1753921, 106.8271539)).toBe("-6.17539,106.82715");
  });

  it("parses common response shapes", () => {
    expect(parseReverseGeocodeAddress(" Jl. Merdeka ")).toBe("Jl. Merdeka");
    expect(parseReverseGeocodeAddress({ address: "Depot A" })).toBe("Depot A");
    expect(parseReverseGeocodeAddress({ formattedAddress: "POI · 120 m N" })).toBe("POI · 120 m N");
    expect(parseReverseGeocodeAddress({ result: { Address: "Nested" } })).toBe("Nested");
    expect(parseReverseGeocodeAddress({ results: [{ name: "First" }] })).toBe("First");
    expect(parseReverseGeocodeAddress(null)).toBe("");
    expect(parseReverseGeocodeAddress({})).toBe("");
  });

  it("parses Armada GpsGate location payload", () => {
    expect(
      parseReverseGeocodeAddress({
        geocoderProviderSource: "GpsGate(1)",
        location: {
          countryName: "Indonesia",
          cityName: "Special Capital Region of Jakarta",
          postalCodeNumber: "10110",
          streetBox: "Gambir",
          streetName: "",
          streetNumber: "",
          address: "Special Capital Region of Jakarta",
          formattedResult: "Special Capital Region of Jakarta",
        },
      }),
    ).toBe("Special Capital Region of Jakarta");

    expect(
      parseReverseGeocodeAddress({
        location: {
          streetNumber: "12",
          streetName: "Sudirman",
          streetBox: "",
          cityName: "Jakarta",
          countryName: "Indonesia",
        },
      }),
    ).toBe("12 Sudirman, Jakarta, Indonesia");
  });

  it("resolves unique coords with cache", async () => {
    clearReverseGeocodeCache();
    let calls = 0;
    const fetcher = async (lat: number, lon: number) => {
      calls += 1;
      return `A:${lat.toFixed(2)},${lon.toFixed(2)}`;
    };
    const first = await resolveAddressesForCoords(
      [
        { lat: -6.2, lon: 106.8 },
        { lat: -6.200001, lon: 106.800001 },
        { lat: -6.3, lon: 106.9 },
      ],
      fetcher,
      { concurrency: 2 },
    );
    expect(Object.keys(first).length).toBe(2);
    expect(calls).toBe(2);

    const second = await resolveAddressesForCoords([{ lat: -6.2, lon: 106.8 }], fetcher);
    expect(second[geocodeCacheKey(-6.2, 106.8)]).toBe(first[geocodeCacheKey(-6.2, 106.8)]);
    expect(calls).toBe(2);
  });

  it("looks up addressAt", () => {
    const key = geocodeCacheKey(1, 2);
    expect(addressAt({ [key]: "Here" }, 1, 2)).toBe("Here");
    expect(addressAt({}, 1, 2)).toBe("");
    expect(addressAt({ [key]: "Here" }, null, 2)).toBe("");
  });
});
