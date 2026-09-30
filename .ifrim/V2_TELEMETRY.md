# Telemetrie (V2, Milestone 01)

Scop: rutare bazată pe experiența proprie, nu pe benchmark-uri de marketing. Fiecare AgentRun produce un rând `execution_telemetry` (`v2/server/runtime/telemetry.mjs`), actualizat la finalizarea execuției și la verificarea taskului.

## Câmpuri și sursa fiecăruia

| Câmp | Sursă |
|---|---|
| company, department, role, task_type | DERIVED (din task/misiune) |
| provider, execution_surface | MEASURED (Hub) |
| model | PROVIDER_REPORTED dacă sesiunea l-a raportat, altfel DERIVED (cerut) sau UNKNOWN |
| skill_versions | MEASURED (skills active ale rolului la pornire: id, versiune, SHA-256) |
| start/end, duration | MEASURED (ceasul Hub) |
| attempts | MEASURED (execuții ale aceluiași task și provider) |
| interruptions | MEASURED (evenimente `run.interrupted`) |
| tools/connectors, tests | MEASURED (`tool_calls`) |
| review/QA findings | UNKNOWN în acest build (fără parser de constatări) |
| human intervention | MEASURED (aprobări decise pentru execuție) |
| handoffs | MEASURED |
| failure | PROVIDER_REPORTED (categorie) sau DERIVED |
| verified outcome | DERIVED: `verified` doar când taskul ajunge COMPLETED cu dovezi; `rejected` la FAILED/CANCELLED; altfel `unverified` |
| usage | PROVIDER_REPORTED sau UNKNOWN (nu se estimează) |

Etichetele se salvează în `sources_json`, iar UI-ul (Sistem → Execuții & telemetrie) le afișează lângă valori.

## Agregare pentru router

`telemetry.outcomes({ taskType })` grupează pe (tip task, suprafață): execuții, verificate, respinse, eșecuri, durată medie, întreruperi, intervenții. Routerul folosește rata de succes doar cu **cel puțin 3 rezultate verificate/respinse**; sub prag, factorul „history” este neutru și spune asta explicit.
