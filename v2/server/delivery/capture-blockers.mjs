// Read-only rule shared by acceptance and the Room view.
export function captureBlockers(db, { missionId, projectId }) {
  const capture = db.prepare(`SELECT s.plan_id FROM ops_plan_steps s JOIN ops_plans p ON p.id = s.plan_id WHERE p.status IN ('RUNNING','CONFIRMED') AND s.kind = 'delivery.capture' AND s.status = 'RUNNING' AND
    (s.plan_id IN (SELECT ops_plan_id FROM deliveries WHERE mission_id = ?) OR s.plan_id IN
    (SELECT r.ops_plan_id FROM delivery_revisions r JOIN deliveries d ON d.id = r.delivery_id WHERE d.mission_id = ?)) LIMIT 1`).get(missionId, missionId);
  const recording = db.prepare(`SELECT c.id FROM media_capture_sessions c WHERE c.status = 'RECORDING' AND
    (json_extract(c.scope_json, '$.projectId') = ? OR json_extract(c.scope_json, '$.deliveryId') IN (SELECT id FROM deliveries WHERE project_id = ?)
    OR c.content_project_id IN (SELECT content_project_id FROM deliveries WHERE project_id = ?)
    OR c.content_project_id IN (SELECT id FROM content_projects WHERE json_extract(scope_json, '$.projectId') = ?)) LIMIT 1`).get(projectId, projectId, projectId, projectId);
  return { planId: capture?.plan_id || null, sessionId: recording?.id || null };
}
