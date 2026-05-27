export const PORT_RESERVATION_MODEL_VERSION = "lumen.protocol-registry.port-reservation.v1";
export const PORT_CONFLICT_MODEL_VERSION = "lumen.protocol-registry.port-conflict.v1";

export const PORT_CONFLICT_TYPES = Object.freeze({
  EXCLUSIVE_BIND_PORT: "exclusive_bind_port"
});

function assertPort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("port must be an integer between 1 and 65535");
  }
}

function normalizeAddress(address) {
  return address ?? "0.0.0.0";
}

function normalizeProtocol(protocol) {
  return (protocol ?? "tcp").toLowerCase();
}

function addressesOverlap(left, right) {
  return left === right ||
    left === "0.0.0.0" ||
    right === "0.0.0.0" ||
    left === "::" ||
    right === "::" ||
    left === "*" ||
    right === "*";
}

function reservationsOverlap(left, right) {
  return left.port === right.port &&
    left.protocol === right.protocol &&
    addressesOverlap(left.address, right.address);
}

function expandReservations(items) {
  return items.flatMap((item) => {
    if (Array.isArray(item?.portReservations)) {
      return item.portReservations;
    }
    if (item?.bind) {
      return [{
        ownerId: item.outboundId ?? item.id,
        address: item.bind.address,
        port: item.bind.port,
        protocol: item.bind.protocol,
        exclusive: item.bind.exclusive
      }];
    }
    return [item];
  });
}

export function createBindReservation(input = {}) {
  assertPort(input.port);

  return Object.freeze({
    modelVersion: PORT_RESERVATION_MODEL_VERSION,
    ownerId: input.ownerId ?? null,
    address: normalizeAddress(input.address),
    port: input.port,
    protocol: normalizeProtocol(input.protocol),
    purpose: input.purpose ?? "xray-listener",
    exclusive: input.exclusive ?? true
  });
}

export function detectExclusiveBindPortConflicts(items = []) {
  const reservations = expandReservations(items).map(createBindReservation);
  const conflicts = [];

  for (let index = 0; index < reservations.length; index += 1) {
    const reservation = reservations[index];
    for (let nextIndex = index + 1; nextIndex < reservations.length; nextIndex += 1) {
      const other = reservations[nextIndex];
      if (reservationsOverlap(reservation, other) && (reservation.exclusive || other.exclusive)) {
        conflicts.push(Object.freeze({
          modelVersion: PORT_CONFLICT_MODEL_VERSION,
          type: PORT_CONFLICT_TYPES.EXCLUSIVE_BIND_PORT,
          severity: "blocking",
          port: reservation.port,
          protocol: reservation.protocol,
          ownerIds: Object.freeze([reservation.ownerId, other.ownerId]),
          message: "Two exclusive bind reservations overlap on address, port, and protocol."
        }));
      }
    }
  }

  return Object.freeze(conflicts);
}
