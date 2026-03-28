import type { NearbyPerson } from '../../hooks/useNearbyPeople';

const COORDINATE_COLLISION_METERS = 18;
const USER_COLLISION_METERS = 24;
const STACK_RADIUS_METERS = 12;
const USER_STACK_RADIUS_METERS = 18;

export interface PositionedNearbyPerson {
  person: NearbyPerson;
  coordinate: { latitude: number; longitude: number };
  renderOrder: number;
  zIndex: number;
}

function relationshipPriority(relationship: NearbyPerson['relationship']) {
  switch (relationship) {
    case 'paired':
      return 2;
    case 'friend':
      return 1;
    default:
      return 0;
  }
}

function distanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  const averageLatitudeRadians = ((latitudeA + latitudeB) / 2) * (Math.PI / 180);
  const latDistanceMeters = (latitudeA - latitudeB) * 111_320;
  const lngDistanceMeters =
    (longitudeA - longitudeB) * 111_320 * Math.cos(averageLatitudeRadians);

  return Math.hypot(latDistanceMeters, lngDistanceMeters);
}

function offsetCoordinate(
  latitude: number,
  longitude: number,
  radiusMeters: number,
  angleRadians: number,
) {
  const latitudeOffset = (radiusMeters / 111_320) * Math.sin(angleRadians);
  const longitudeMetersPerDegree = Math.max(
    111_320 * Math.cos(latitude * (Math.PI / 180)),
    1,
  );
  const longitudeOffset = (radiusMeters / longitudeMetersPerDegree) * Math.cos(angleRadians);

  return {
    latitude: latitude + latitudeOffset,
    longitude: longitude + longitudeOffset,
  };
}

function groupNearbyPeople(nearbyPeople: NearbyPerson[]) {
  const groups: NearbyPerson[][] = [];

  const sortedPeople = [...nearbyPeople].sort((left, right) => {
    const latitudeDelta = left.approximateLat - right.approximateLat;
    if (latitudeDelta !== 0) return latitudeDelta;

    const longitudeDelta = left.approximateLng - right.approximateLng;
    if (longitudeDelta !== 0) return longitudeDelta;

    return left.userId.localeCompare(right.userId);
  });

  sortedPeople.forEach((person) => {
    const matchingGroup = groups.find((group) => (
      group.some((candidate) => (
        distanceMeters(
          person.approximateLat,
          person.approximateLng,
          candidate.approximateLat,
          candidate.approximateLng,
        ) <= COORDINATE_COLLISION_METERS
      ))
    ));

    if (matchingGroup) {
      matchingGroup.push(person);
      return;
    }

    groups.push([person]);
  });

  return groups;
}

export function layoutNearbyPeople(
  nearbyPeople: NearbyPerson[],
  options?: {
    userLocation?: { latitude: number; longitude: number } | null;
    selectedPersonId?: string | null;
  },
) {
  const userLocation = options?.userLocation ?? null;
  const selectedPersonId = options?.selectedPersonId ?? null;

  const validPeople = nearbyPeople.filter((person) => (
    Number.isFinite(person.approximateLat) &&
    Number.isFinite(person.approximateLng)
  ));

  const positionedPeople: PositionedNearbyPerson[] = [];

  groupNearbyPeople(validPeople).forEach((group) => {
    const overlapsUser = !!userLocation && group.some((person) => (
      distanceMeters(
        person.approximateLat,
        person.approximateLng,
        userLocation.latitude,
        userLocation.longitude,
      ) <= USER_COLLISION_METERS
    ));

    const spreadPeople = [...group].sort((left, right) => {
      const relationshipDelta =
        relationshipPriority(right.relationship) - relationshipPriority(left.relationship);
      if (relationshipDelta !== 0) return relationshipDelta;

      return left.userId.localeCompare(right.userId);
    });

    const needsSpread = overlapsUser || spreadPeople.length > 1;
    const slotCount = spreadPeople.length + (overlapsUser ? 1 : 0);
    const radiusMeters = overlapsUser
      ? USER_STACK_RADIUS_METERS + Math.max(0, spreadPeople.length - 1) * 4
      : STACK_RADIUS_METERS + Math.max(0, spreadPeople.length - 2) * 3;

    spreadPeople.forEach((person, index) => {
      const selectedBoost = person.userId === selectedPersonId ? 10 : 0;
      const basePriority = relationshipPriority(person.relationship) * 10;

      let coordinate = {
        latitude: person.approximateLat,
        longitude: person.approximateLng,
      };

      if (needsSpread) {
        const slotIndex = overlapsUser ? index + 1 : index;
        const baseAngle =
          overlapsUser && spreadPeople.length === 1
            ? -Math.PI / 4
            : -Math.PI / 2;
        const angle = baseAngle + ((2 * Math.PI * slotIndex) / Math.max(slotCount, 1));

        coordinate = offsetCoordinate(
          person.approximateLat,
          person.approximateLng,
          radiusMeters,
          angle,
        );
      }

      positionedPeople.push({
        person,
        coordinate,
        renderOrder: basePriority + selectedBoost,
        zIndex: 40 + basePriority + selectedBoost,
      });
    });
  });

  return positionedPeople.sort((left, right) => {
    const orderDelta = left.renderOrder - right.renderOrder;
    if (orderDelta !== 0) return orderDelta;

    return left.person.userId.localeCompare(right.person.userId);
  });
}
