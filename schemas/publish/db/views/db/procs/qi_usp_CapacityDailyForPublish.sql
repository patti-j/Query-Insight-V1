CREATE OR ALTER PROCEDURE qi.usp_CapacityDailyForPublish
  @PublishDate DATETIME = NULL
AS
BEGIN
  SET NOCOUNT ON;

  IF @PublishDate IS NULL
  BEGIN
    SELECT @PublishDate = COALESCE(
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
    );
  END

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
    res.PlanningAreaName, res.PlantName, res.DepartmentName, res.WorkcenterName, @PublishDate AS PublishDate
  FROM publish.DASHt_Resources res
  LEFT JOIN publish.DASHt_CapacityPlanning_ResourceDemand rd
    ON rd.ResourceId = res.ResourceId AND rd.PublishDate = @PublishDate
  LEFT JOIN publish.DASHt_CapacityPlanning_ResourceCapacity c
    ON c.ResourceId = res.ResourceId AND c.PublishDate = @PublishDate
  GROUP BY res.ResourceId, res.ResourceName, CAST(COALESCE(rd.DemandDate, c.ShiftDate) AS date),
           res.PlanningAreaName, res.PlantName, res.DepartmentName, res.WorkcenterName;
END
GO
