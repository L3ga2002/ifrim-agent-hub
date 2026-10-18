// UI of the booking demo: service → day → slot → form. It talks only to this origin's /api and writes every value with
// textContent. What a slot shows and whether it can be chosen comes from slots-view.mjs.
import { layoutSlots } from "./slots-view.mjs";

const COMPACT_QUERY = "(max-width: 600px)"; // the narrow-screen breakpoint, the same as in styles.css
const MONTHS = Object.freeze(["ian.", "feb.", "mar.", "apr.", "mai", "iun.", "iul.", "aug.", "sept.", "oct.", "nov.", "dec."]);
const TEXT = Object.freeze({
  loading: "Se încarcă…",
  sending: "Se trimite…",
  fixFields: "Corectează câmpurile marcate.",
  taken: "Intervalul tocmai a fost ocupat. Alege alt interval.",
  confirmed: "Programare confirmată",
  loadFailed: "Datele nu pot fi încărcate. Reîncarcă pagina.",
  offline: "Nu se poate contacta serverul. Încearcă din nou.",
  failed: "A apărut o eroare. Încearcă din nou.",
  noSlot: "Alege un interval liber din grilă.",
  nameLength: "Numele are între 2 și 60 de caractere.",
  vehicleLength: "Vehiculul are între 2 și 60 de caractere.",
  noneChosen: "Niciun interval ales.",
  emptyDay: "Nicio programare în această zi.",
});
const FIELDS = Object.freeze(["start", "name", "vehicle"]);
// How many placeholder cards stand in for the services, the days and the slots while data loads.
const PLACEHOLDERS = Object.freeze({ services: 3, days: 3, slots: 16 });

const $ = (selector) => document.querySelector(selector);
const ui = {
  services: $("#services"), days: $("#days"), slots: $("#slots"), form: $("#booking-form"), chosen: $("#chosen"),
  status: $("#status"), list: $("#day-list"), submit: $("#booking-form button[type='submit']"),
};
const compact = window.matchMedia(COMPACT_QUERY);
const state = { services: [], days: [], serviceId: "", day: 0, slots: [], chosen: "", sending: false, loads: 0 };

/** A new element with a class, text, attributes, data-* values and children. Text always goes through textContent. */
function node(tag, { className = "", text = "", attrs = {}, data = {} } = {}, children = []) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  for (const [name, value] of Object.entries(data)) element.dataset[name] = value;
  element.append(...children);
  return element;
}

/** A JSON call to this origin: { status, body } (an answer that is not JSON has an empty body). Throws when offline. */
async function api(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options, headers: { Accept: "application/json", ...(options.headers || {}) } });
  let body = null;
  try { body = await response.json(); } catch { /* judged by its status */ }
  return { status: response.status, body: body && typeof body === "object" ? body : {} };
}

/**
 * Fills a container with placeholder cards that have the box of the real ones, so the page keeps its layout while data loads.
 * They are not buttons: nothing in a loading grid can be clicked, focused or read out.
 */
function placeholders(container, count, kind) {
  container.replaceChildren(...Array.from({ length: count }, () => node("span", { className: `placeholder placeholder-${kind}`, attrs: { "aria-hidden": "true" } })));
}

function setStatus(kind, text) {
  ui.status.dataset.state = kind;
  ui.status.textContent = text;
}

function setFieldError(field, message) {
  const target = ui.form.querySelector(`.field-error[data-for="${field}"]`);
  if (target) target.textContent = message || "";
  const input = ui.form.querySelector(`input[name="${field}"]`);
  if (input) { if (message) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid"); }
}
const clearErrors = () => { for (const field of FIELDS) setFieldError(field, ""); };
const showErrors = (errors) => { for (const field of FIELDS) if (typeof errors[field] === "string") setFieldError(field, errors[field]); };

const serviceOf = (id) => state.services.find((service) => service.id === id) || null;
const dayOf = (date) => state.days.find((day) => day.date === date) || null;
/** "Mâine, 6 oct." for a day of the list; the label alone when the date is not a date key. */
function dayText(day) {
  if (!day) return "";
  const [, month, dayOfMonth] = String(day.date).split("-").map(Number);
  return MONTHS[month - 1] && dayOfMonth ? `${day.label}, ${dayOfMonth} ${MONTHS[month - 1]}` : String(day.label || "");
}

function renderServices() {
  ui.services.replaceChildren(...state.services.map((service) => {
    const input = node("input", { className: "svc-input", attrs: { type: "radio", name: "service", value: service.id } });
    input.checked = service.id === state.serviceId;
    return node("label", { className: "svc", data: { service: service.id } }, [input, node("span", { className: "svc-card" }, [
      node("span", { className: "svc-name", text: service.name }),
      node("span", { className: "svc-meta", text: `${service.durationMin} min` }),
    ])]);
  }));
}

function renderDays() {
  ui.days.replaceChildren(...state.days.map((day, index) => {
    const [, month, dayOfMonth] = String(day.date).split("-").map(Number);
    return node("button", { className: "day", attrs: { type: "button", "aria-pressed": String(index === state.day) }, data: { day: String(index) } }, [
      node("span", { className: "day-label", text: day.label }),
      node("span", { className: "day-date", text: MONTHS[month - 1] && dayOfMonth ? `${dayOfMonth} ${MONTHS[month - 1]}` : "" }),
    ]);
  }));
}

/** Draws the grid from the loaded slots. data-booked is the server's status; what can be chosen is the view model's answer. */
function renderSlots() {
  const view = layoutSlots(state.slots, { compact: compact.matches });
  ui.slots.replaceChildren(...state.slots.map((slot, index) => {
    const entry = view[index] || { time: slot.time, available: false, note: "" };
    return node("button", {
      className: "slot",
      attrs: { type: "button", "aria-disabled": String(!entry.available), "aria-pressed": String(slot.start === state.chosen) },
      data: { slot: slot.start, booked: String(slot.status === "booked") },
    }, [node("span", { className: "slot-time", text: entry.time }), node("span", { className: "slot-note", text: entry.note })]);
  }));
}

function renderList(bookings) {
  if (!bookings.length) { ui.list.replaceChildren(node("li", {}, [node("span", { className: "empty", text: TEXT.emptyDay })])); return; }
  ui.list.replaceChildren(...bookings.map((booking) => node("li", {}, [
    node("span", { className: "b-time", text: booking.time }),
    node("span", { className: "b-what" }, [
      node("span", { className: "b-service", text: booking.service }),
      node("span", { className: "b-who", text: `${booking.name} · ${booking.vehicle}` }),
    ]),
  ])));
}

/** Marks the chosen slot (or none, with "") in the grid and in the form. */
function choose(start) {
  const slot = state.slots.find((s) => s.start === start) || null;
  state.chosen = slot ? slot.start : "";
  for (const button of ui.slots.querySelectorAll(".slot")) button.setAttribute("aria-pressed", String(button.dataset.slot === state.chosen));
  const service = serviceOf(state.serviceId);
  ui.chosen.textContent = slot && service ? `Interval ales: ${dayText(state.days[state.day])}, ${slot.time} · ${service.name} (${service.durationMin} min)` : TEXT.noneChosen;
  ui.chosen.dataset.empty = String(!slot);
  if (slot) setFieldError("start", "");
}

/**
 * Loads the slots and the bookings of the chosen day and service. The grid shows placeholders at once, so nothing from the
 * previous choice can be clicked while the new one loads, and an answer that arrives after a newer choice is dropped.
 * `quiet` keeps the message of the form (after a confirmation).
 */
async function loadDay({ quiet = false } = {}) {
  const load = ++state.loads;
  const day = state.days[state.day];
  state.slots = [];
  placeholders(ui.slots, PLACEHOLDERS.slots, "slot");
  ui.slots.setAttribute("aria-busy", "true");
  if (!quiet) setStatus("loading", TEXT.loading);
  try {
    const [slots, bookings] = await Promise.all([
      api(`/api/slots?date=${encodeURIComponent(day.date)}&service=${encodeURIComponent(state.serviceId)}`),
      api(`/api/bookings?date=${encodeURIComponent(day.date)}`),
    ]);
    if (load !== state.loads) return;
    if (slots.status !== 200 || bookings.status !== 200 || !Array.isArray(slots.body.slots) || !Array.isArray(bookings.body.bookings)) throw new Error("load");
    state.slots = slots.body.slots;
    renderSlots();
    // A choice survives a reload only while its slot is still free.
    choose(state.slots.some((s) => s.start === state.chosen && s.status === "free") ? state.chosen : "");
    renderList(bookings.body.bookings);
    if (!quiet) setStatus("idle", "");
  } catch {
    if (load !== state.loads) return;
    ui.slots.replaceChildren();
    choose("");
    setStatus("error", TEXT.loadFailed);
  } finally {
    if (load === state.loads) ui.slots.setAttribute("aria-busy", "false");
  }
}

ui.services.addEventListener("change", (event) => {
  const input = event.target instanceof Element ? event.target.closest("input[name='service']") : null;
  if (!input || input.value === state.serviceId) return;
  state.serviceId = input.value;
  choose("");
  loadDay();
});

ui.days.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest("button[data-day]") : null;
  const index = button ? Number(button.dataset.day) : NaN;
  if (!Number.isInteger(index) || !state.days[index] || index === state.day) return;
  state.day = index;
  for (const other of ui.days.querySelectorAll("button[data-day]")) other.setAttribute("aria-pressed", String(other === button));
  choose("");
  loadDay();
});

ui.slots.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest(".slot") : null;
  if (!button || button.getAttribute("aria-disabled") === "true") return;
  choose(button.dataset.slot);
});

// The narrow and the desktop grid differ; redraw when the width crosses the breakpoint (the choice is kept).
compact.addEventListener("change", () => { if (state.slots.length) renderSlots(); });

ui.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.sending) return; // one request at a time: a double click or a second Enter sends nothing
  clearErrors();
  const data = new FormData(ui.form);
  const name = String(data.get("name") || "").trim();
  const vehicle = String(data.get("vehicle") || "").trim();
  const errors = {};
  if (!state.chosen) errors.start = TEXT.noSlot;
  if (name.length < 2 || name.length > 60) errors.name = TEXT.nameLength;
  if (vehicle.length < 2 || vehicle.length > 60) errors.vehicle = TEXT.vehicleLength;
  if (Object.keys(errors).length) { showErrors(errors); setStatus("error", TEXT.fixFields); return; }

  state.sending = true;
  ui.submit.disabled = true;
  setStatus("loading", TEXT.sending);
  try {
    const { status, body } = await api("/api/bookings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceId: state.serviceId, start: state.chosen, name, vehicle }),
    });
    if (status === 201) {
      const booking = body.booking && typeof body.booking === "object" ? body.booking : {};
      const where = [dayText(dayOf(booking.date)), booking.time].filter(Boolean).join(", ");
      ui.form.reset();
      choose("");
      setStatus("success", `${TEXT.confirmed}${where ? `: ${where}` : ""}${booking.service ? ` · ${booking.service}` : ""}.`);
      await loadDay({ quiet: true });
    } else if (status === 400) {
      const fieldErrors = body.errors && typeof body.errors === "object" ? body.errors : {};
      showErrors(fieldErrors);
      setStatus("error", TEXT.fixFields);
      if (fieldErrors.start) { choose(""); await loadDay({ quiet: true }); }
    } else if (status === 409) {
      choose("");
      setStatus("error", TEXT.taken);
      await loadDay({ quiet: true });
    } else {
      setStatus("error", TEXT.failed);
    }
  } catch {
    setStatus("error", TEXT.offline);
  } finally {
    state.sending = false;
    ui.submit.disabled = false;
  }
});

async function boot() {
  setStatus("loading", TEXT.loading);
  placeholders(ui.services, PLACEHOLDERS.services, "svc");
  placeholders(ui.days, PLACEHOLDERS.days, "day");
  placeholders(ui.slots, PLACEHOLDERS.slots, "slot");
  try {
    const { status, body } = await api("/api/services");
    if (status !== 200 || !Array.isArray(body.services) || !body.services.length || !Array.isArray(body.days) || !body.days.length) throw new Error("boot");
    state.services = body.services;
    state.days = body.days;
    state.serviceId = body.services[0].id;
    state.day = 0;
    renderServices();
    renderDays();
    await loadDay();
  } catch {
    for (const container of [ui.services, ui.days, ui.slots]) container.replaceChildren();
    ui.slots.setAttribute("aria-busy", "false");
    setStatus("error", TEXT.loadFailed);
  }
}

boot();
