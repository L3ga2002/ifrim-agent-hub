// Compatibility wrapper (Milestone 02): the procedural 2D core was replaced by the 3D volume in core/Core3D.jsx.
// Old lowercase state names map to the M02 state ids.
import { Core3D } from "./core/Core3D.jsx";

const MAP = { idle: "IDLE", listening: "LISTENING", transcribing: "TRANSCRIBING", processing: "VERIFYING", executing: "EXECUTING",
  verifying: "VERIFYING", approval: "WAITING_APPROVAL", error: "ERROR" };

export function Core({ state = "idle", disabled = false }) {
  return <Core3D state={MAP[state] || String(state).toUpperCase()} disabled={disabled} />;
}
