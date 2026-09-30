// Shared, mutable audio levels (0..1) written by the Lega meters and read by the stage renderer every frame.
// A plain object (not React state) so 60 updates per second never re-render the UI.
export const legaLevels = { mic: 0, lega: 0, updatedAt: 0 };

/** Commands from the stage to the Lega session owner (the top-bar component) without coupling their state. */
export const sendLegaCommand = (command) => window.dispatchEvent(new CustomEvent("lega:command", { detail: command }));
