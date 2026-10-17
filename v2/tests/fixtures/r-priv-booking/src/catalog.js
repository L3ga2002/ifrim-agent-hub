// The synthetic catalog of the demo workshop: three services with a duration, and the bookings every shown day starts with.
// Everything here is fictive. A service has only an id, a name and a duration; a booking only a name and a vehicle.

export const SERVICES = Object.freeze([
  Object.freeze({ id: "spalare-exterior", name: "Spălare exterioară", durationMin: 30 }),
  Object.freeze({ id: "curatare-interior", name: "Curățare interior", durationMin: 60 }),
  Object.freeze({ id: "polish-faruri", name: "Polish faruri", durationMin: 30 }),
]);

export const serviceById = (id) => SERVICES.find((service) => service.id === id) || null;

/** The vehicle of every synthetic booking. */
export const SEED_VEHICLE = "Autoturism test";

/** The synthetic bookings of each shown day (the server re-establishes them per day, see ensureSeeds in server-app.js). */
export const SEED_BOOKINGS = Object.freeze([
  Object.freeze({ time: "10:00", serviceId: "spalare-exterior", name: "Client Demo A" }),
  Object.freeze({ time: "11:30", serviceId: "curatare-interior", name: "Client Demo B" }),
  Object.freeze({ time: "15:00", serviceId: "polish-faruri", name: "Client Demo C" }),
]);
