// M08 package B4: the INDEPENDENT acceptance test of the ProDelivery pilot. The Software Factory needs acceptance tests that exist
// before the writer starts and that the writer cannot touch (they are protected and byte-checked). For a "write the unit tests"
// task the deliverable itself is the test suite, so this file checks the deliverable objectively instead of re-implementing the
// business rules: the suite exists, runs green with the standard library, has enough tests and exercises every public function of
// the module. It fails before the change (no suite yet), as a FEATURE baseline requires. Written into the project only after the
// owner approves B4 (Windows Hello); never edited per run.

export const PILOT_ACCEPTANCE_PATH = "backend/tests/acceptance/test_driver_ranking_acceptance.py";
export const PILOT_UNIT_PATH = "backend/tests/test_driver_ranking_unit.py";
export const PILOT_REQUIRED_FUNCTIONS = Object.freeze(["calculate_driver_score", "get_tier_for_score", "get_next_tier_for_score", "_build_cycle_window", "build_tier_access_state"]);
export const PILOT_MIN_TESTS = 12;

export const PILOT_ACCEPTANCE_SOURCE = `"""Test de acceptanta INDEPENDENT pentru pilotul Ifrim Agent Hub (pachetul B4, M08).

Pregatit de Hub la aprobarea proprietarului si protejat in misiune (writer-ul nu il poate modifica).
Verifica livrabilul: suita ${PILOT_UNIT_PATH} exista, trece doar cu biblioteca standard,
are cel putin ${PILOT_MIN_TESTS} teste si apeleaza fiecare functie publica a modulului backend/utils/driver_ranking.py.
"""
import ast
import importlib.util
import io
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
UNIT = ROOT / "${PILOT_UNIT_PATH}"
REQUIRED = ${JSON.stringify(PILOT_REQUIRED_FUNCTIONS)}
MIN_TESTS = ${PILOT_MIN_TESTS}


def _test_methods(tree):
    count = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and item.name.startswith("test"):
                    count += 1
    return count


MODULE_FILE = (ROOT / "backend" / "utils" / "driver_ranking.py").resolve()


def _load_suite_module():
    for extra in (str(ROOT), str(ROOT / "backend")):
        if extra not in sys.path:
            sys.path.insert(0, extra)
    try:
        # The same way the check command loads it (package-relative imports keep working).
        return importlib.import_module("backend.tests.test_driver_ranking_unit")
    except ImportError:
        spec = importlib.util.spec_from_file_location("driver_ranking_unit_under_acceptance", UNIT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module


class DriverRankingUnitSuiteAcceptance(unittest.TestCase):
    def test_suite_exists(self):
        self.assertTrue(UNIT.is_file(), "suita unitara lipseste: " + str(UNIT.relative_to(ROOT)))

    def test_suite_has_enough_tests(self):
        self.assertTrue(UNIT.is_file(), "suita unitara lipseste: " + str(UNIT.relative_to(ROOT)))
        tree = ast.parse(UNIT.read_text(encoding="utf-8"))
        self.assertGreaterEqual(_test_methods(tree), MIN_TESTS, "suita are prea putine teste")

    def test_suite_passes_and_really_runs_every_public_function(self):
        self.assertTrue(UNIT.is_file(), "suita unitara lipseste: " + str(UNIT.relative_to(ROOT)))
        module = _load_suite_module()
        suite = unittest.defaultTestLoader.loadTestsFromModule(module)
        called = set()

        def profile(frame, event, arg):
            # Records real calls into the module file (however the suite imports it), not names mentioned in the source.
            if event == "call" and frame.f_code.co_name in REQUIRED:
                try:
                    if pathlib.Path(frame.f_code.co_filename).resolve() == MODULE_FILE:
                        called.add(frame.f_code.co_name)
                except (OSError, ValueError):
                    pass

        stream = io.StringIO()
        sys.setprofile(profile)
        try:
            result = unittest.TextTestRunner(stream=stream, verbosity=1).run(suite)
        finally:
            sys.setprofile(None)
        self.assertGreaterEqual(result.testsRun, MIN_TESTS, "suita a rulat prea putine teste")
        self.assertTrue(result.wasSuccessful(), "suita unitara nu trece:\\n" + stream.getvalue()[-3000:])
        missing = [name for name in REQUIRED if name not in called]
        self.assertEqual(missing, [], "functii fara niciun apel in suita: " + ", ".join(missing))


if __name__ == "__main__":
    unittest.main()
`;

/** The pilot mission (FEATURE) for factory.prepare: the task, its scope, the independent acceptance test and the verification. */
export function pilotMissionInput(task) {
  return {
    workType: "FEATURE",
    title: task.title,
    objective: "Scrie suita de teste unitare pentru backend/utils/driver_ranking.py (biblioteca standard: unittest, datetime, zoneinfo) și remediază minim problemele reale pe care le găsesc testele. Fără rețea, fără MongoDB, fără dependențe noi.",
    spec: {
      inScope: ["backend/utils/driver_ranking.py", PILOT_UNIT_PATH],
      outOfScope: ["routere, modele, baza de date, frontend", "dependențe noi", "deploy, commit, push, mesaje", "credențiale sau date de producție", PILOT_ACCEPTANCE_PATH],
      acceptance: [
        { id: "AC-1", text: `Suita ${PILOT_UNIT_PATH} există, trece doar cu biblioteca standard, are cel puțin ${PILOT_MIN_TESTS} teste și apelează fiecare funcție publică a modulului`, verify: "test", testRef: PILOT_ACCEPTANCE_PATH, expectFailure: "suita unitara lipseste" },
        { id: "AC-2", text: "Pragurile din TIER_CONFIG sunt testate la limite (inclusiv egalitate), fereastra de ciclu în jurul CLOSE_HOUR și la schimbarea orei de vară/iarnă (Europe/Bucharest), lipsa datelor și anulările", verify: "review" },
        { id: "AC-3", text: "Orice remediere din driver_ranking.py e minimă, explicată și nu schimbă contractul public al funcțiilor", verify: "review" },
      ],
      constraints: ["Doar biblioteca standard Python (unittest, datetime, zoneinfo)", "Fără rețea, fără MongoDB, fără dependențe noi", "Testele nu depind de ora curentă (folosesc date fixe)"],
      risks: ["Fusul orar și ora de vară/iarnă pot ascunde erori de o oră", "Modulul poate avea apelanți care depind de comportamentul actual"],
      verification: { checks: [`python3 -m unittest ${PILOT_UNIT_PATH}`], acceptance: [`python3 -m unittest ${PILOT_ACCEPTANCE_PATH}`] },
      sources: {
        user: ["Pilotul real M08: teste unitare pentru clasamentul curierilor și remedierea problemelor găsite."],
        code: [{ ref: "backend/utils/driver_ranking.py", note: "modul pur: TIER_CONFIG, CLOSE_HOUR, Europe/Bucharest; funcțiile publice " + PILOT_REQUIRED_FUNCTIONS.join(", ") }],
        assumptions: ["Comportamentul actual e cel dorit, cu excepția erorilor pe care le arată testele"],
      },
    },
  };
}
