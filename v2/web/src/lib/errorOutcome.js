// M15: reads can be retried; mutations need explicit pre-execution evidence for a direct retry. HTTP refusals alone do not prove an unchanged result.
export function errorOutcome(error) {
  if (!error) return "";
  if (String(error.method).toUpperCase() === "GET") return "read_failed";
  if (error.notSent === true) return "not_sent";
  const status = Number(error.status);
  if (!error.method && (error.status == null || error.status === "" || !Number.isFinite(status))) return "";
  if ((error.category === "policy" && error.details?.policy?.decision === "deny") || error.code === "UI_STALE" || (status === 403 && /session token/i.test(error.message || ""))) return "refused_before_execution";
  if (status >= 400 && status < 500) return "refused";
  return "unknown";
}

export function errorContinuation(error) {
  const outcome = errorOutcome(error);
  if (outcome === "read_failed") return "Citirea nu a reușit; o citire nu schimbă nimic. Poți reîncerca.";
  if (outcome === "not_sent") return `Cererea nu a plecat din pagină: nu s-a schimbat nimic.${error.code === "UI_STALE" ? " Reîncarcă pagina." : ""}`;
  if (outcome === "refused_before_execution" && error.category === "policy" && error.details?.policy?.decision === "deny") return "Hub-ul a refuzat cererea înainte s-o execute: nu s-a schimbat nimic (s-a consemnat doar refuzul). Poți corecta și repeta.";
  if (outcome === "refused_before_execution") return "Hub-ul a refuzat cererea înainte s-o execute: nu s-a schimbat nimic. Poți corecta și repeta.";
  if (outcome === "refused" && Number(error.status) !== 409) return "Hub-ul a refuzat cererea (motivul e mai sus). Verifică starea salvată înainte s-o repeți.";
  if (outcome === "refused") return "Hub-ul a refuzat cererea. Verifică starea salvată înainte s-o repeți: o încercare anterioară poate să fi reușit.";
  if (outcome === "unknown") return `${Number(error.status) === 0 ? "Legătura cu Hub-ul s-a întrerupt. " : ""}Nu știu dacă cererea a fost executată. Verifică starea salvată înainte să repeți, ca să nu faci același lucru de două ori.`;
  return "";
}

export function canRetryDirectly(error) {
  return ["read_failed", "not_sent", "refused_before_execution"].includes(errorOutcome(error));
}
