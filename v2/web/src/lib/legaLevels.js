// Shared, mutable audio levels (0..1) written by the Lega meters and read by the stage renderer every frame.
// A plain object (not React state) so 60 updates per second never re-render the UI.
export const legaLevels = { mic: 0, lega: 0, updatedAt: 0 };

/** Commands from the stage to the Lega session owner (the top-bar component) without coupling their state. */
/**
 * Options of the next "start", set by the sender right before the event and read once by the session owner. `expectWebSearch`
 * is the web-search mode the sender showed the owner (the cockpit reply names it): the Hub refuses a start under another one.
 */
export const legaStartOptions = { expectWebSearch: null };
export const sendLegaCommand = (command, options = null) => {
  if (command === "start") legaStartOptions.expectWebSearch = typeof options?.expectWebSearch === "string" ? options.expectWebSearch : null;
  window.dispatchEvent(new CustomEvent("lega:command", { detail: command }));
};
