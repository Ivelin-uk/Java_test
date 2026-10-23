ALTER TABLE workspace_assessments ADD COLUMN mobile_allowed BOOLEAN NULL DEFAULT FALSE;

UPDATE workspace_assessments t
SET t.mobile_allowed=CASE
    WHEN EXISTS(
        SELECT 1 FROM exam_assignments a
        JOIN assessment_versions v ON v.organization_id=a.organization_id AND v.id=a.version_id
        WHERE v.organization_id=t.organization_id AND v.assessment_id=t.id AND a.mobile_allowed=TRUE
    ) AND EXISTS(
        SELECT 1 FROM exam_assignments a
        JOIN assessment_versions v ON v.organization_id=a.organization_id AND v.id=a.version_id
        WHERE v.organization_id=t.organization_id AND v.assessment_id=t.id AND a.mobile_allowed=FALSE
    ) THEN NULL
    WHEN EXISTS(
        SELECT 1 FROM exam_assignments a
        JOIN assessment_versions v ON v.organization_id=a.organization_id AND v.id=a.version_id
        WHERE v.organization_id=t.organization_id AND v.assessment_id=t.id AND a.mobile_allowed=TRUE
    ) THEN TRUE
    ELSE FALSE
END;
