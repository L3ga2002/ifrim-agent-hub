// 2.15.1: the Software Factory rejection as the page sends it and as it was recorded. Pure functions (tested without a browser).

/** The body of POST /api/factory/:id/reject: the exact target the page shows (view.rejectTarget), or null when nothing can be rejected. */
export function rejectBody(view, note) {
  const t = view?.rejectTarget;
  if (!t || !Number.isInteger(t.displayedVersion)) return null;
  return { note, displayedVersion: t.displayedVersion, bundleId: t.bundleId || null, bundleSha: t.bundleSha || null };
}

/** The authority RECORDED on a rejection (never the viewer's current session); the local profile is never called Windows Hello. */
export function rejectionAuthorityText(rejection) {
  const a = rejection?.authority;
  return a === "webauthn" ? "Respins în sesiunea verificată cu Windows Hello / cheia ta."
    : a === "local_dev_profile" ? "Respins într-o sesiune locală de dezvoltare (încredere în acest calculator, nu dovada prezenței tale)."
      : a === "test" ? "Respins pe canalul de test."
        : "Autoritatea respingerii nu e înregistrată (decizie anterioară versiunii 2.15.1).";
}
