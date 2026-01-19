CREATE OR ALTER VIEW qi.vw_CapacityDaily AS
WITH LatestPub AS (
  SELECT COALESCE(
    (
      SELECT TOP (1) r.PublishDate
      FROM publish.DASHt_RecentPublishedScenariosArchive r
      WHERE r.NewPublishDateForBI = 1
        AND EXISTS (SELECT 1 FROM publish.DASHt_Resources res WHERE res.PublishDate = r.PublishDate)
        AND EXISTS (SELECT 1 FROM publish.DASHt_CapacityPlanning_ResourceCapacity c WHERE c.PublishDate = r.PublishDate)
        AND EXISTS (SELECT 1 FROM publish.DASHt_CapacityPlanning_ResourceDemand d WHERE d.PublishDate = r.PublishDate)
      ORDER BY r.PublishDate DESC
    ),
    (SELECT MAX(PublishDate) FROM publish.DASHt_RecentPublishedScenariosArchive)
  ) AS PublishDate
)
SELECT
  res.ResourceId,
  res.ResourceName,
  CAST(COALESCE(rd.DemandDate, c.ShiftDate) AS date) AS [Date],
  SUM(COALESCE(c.NormalOnlineHours,0) + COALESCE(c.OvertimeHours,0)) AS CapacityHours,
  SUM(COALESCE(rd.DemandHours,0)) AS LoadHours,
  CASE
    WHEN SUM(COALESCE(rd.DemandHours,0)) > SUM(COALESCE(c.NormalOnlineHours,0) + COALESCE(c.OvertimeHours,0))
      THEN SUM(COALESCE(rd.DemandHours,0)) - SUM(COALESCE(c.NormalOnlineHours,0) + COALESCE(c.OvertimeHours,0))
    ELSE 0
  END AS OverloadHours,
  CASE
    WHEN SUM(COALESCE(c.NormalOnlineHours,0) + COALESCE(c.OvertimeHours,0)) = 0 THEN NULL
    ELSE 100.0 * SUM(COALESCE(rd.DemandHours,0)) / NULLIF(SUM(COALESCE(c.NormalOnlineHours,0) + COALESCE(c.OvertimeHours,0)),0)
  END AS UtilizationPct,
  res.PlanningAreaName,
  res.PlantName AS Plant,
  res.DepartmentName,
  res.WorkcenterName AS WorkCenter,
  lp.PublishDate
FROM publish.DASHt_Resources res
CROSS JOIN LatestPub lp
LEFT JOIN publish.DASHt_CapacityPlanning_ResourceDemand rd
  ON rd.ResourceId = res.ResourceId
  AND rd.PublishDate = lp.PublishDate
LEFT JOIN publish.DASHt_CapacityPlanning_ResourceCapacity c
  ON c.ResourceId = res.ResourceId
  AND c.PublishDate = lp.PublishDate
GROUP BY
  res.ResourceId, res.ResourceName,
  CAST(COALESCE(rd.DemandDate, c.ShiftDate) AS date),
  res.PlanningAreaName, res.PlantName, res.DepartmentName, res.WorkcenterName,
  lp.PublishDate;
GO
