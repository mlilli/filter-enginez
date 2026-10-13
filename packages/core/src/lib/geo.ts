/**
 * Shared geographic primitives — the single source of truth for the `GeoCoords` shape and the
 * great-circle math used by both `GeoProximityRule` (the per-item predicate) and `SpatialIndex`
 * (the R-tree accelerator). Kept here in `lib/` so neither the rule nor the accelerator owns the
 * other's geometry and the haversine implementation exists exactly once.
 *
 * @packageDocumentation
 */

/**
 * A geographic coordinate pair. Convention: `lat` in [-90, 90], `lng` in [-180, 180].
 */
export interface GeoCoords {
	readonly lat: number;
	readonly lng: number;
}

/**
 * Earth's mean radius in kilometers — the spherical-Earth approximation shared by every
 * distance computation in the engine.
 */
export const EARTH_RADIUS_KM = 6371;

/**
 * Convert degrees to radians.
 */
export function toRadians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

/**
 * Haversine great-circle distance in kilometers between two lat/lng points.
 *
 * @remarks
 * Spherical-Earth approximation (see {@link EARTH_RADIUS_KM}). Reported in kilometers; multiply
 * by `0.621371` to convert to miles in consumer code.
 */
export function haversineKm(pointA: GeoCoords, pointB: GeoCoords): number {
	const deltaLat = toRadians(pointB.lat - pointA.lat);
	const deltaLng = toRadians(pointB.lng - pointA.lng);
	const latARad = toRadians(pointA.lat);
	const latBRad = toRadians(pointB.lat);
	const haversineCoefficient =
		Math.sin(deltaLat / 2) ** 2 +
		Math.cos(latARad) * Math.cos(latBRad) * Math.sin(deltaLng / 2) ** 2;

	return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(haversineCoefficient));
}
