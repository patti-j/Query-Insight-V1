# publish.DASHt_CapacityPlanning_ResourceCapacity

Generated: 2026-01-16T23:22:03.784Z

| # | Column | Type | MaxLen | Nullable | Default |
|---:|---|---|---:|---:|---|
| 1 | PlanningAreaName | nvarchar | -1 | YES |  |
| 2 | PlantName | nvarchar | -1 | YES |  |
| 3 | PlantId | nvarchar | -1 | YES |  |
| 4 | DepartmentName | nvarchar | -1 | YES |  |
| 5 | DepartmentId | nvarchar | -1 | YES |  |
| 6 | Workcenter | nvarchar | -1 | YES |  |
| 7 | ResourceName | nvarchar | -1 | YES |  |
| 8 | ResourceId | nvarchar | -1 | YES |  |
| 9 | ResourceType | nvarchar | 50 | YES |  |
| 10 | ResourceBottleneck | bit | 0 | YES |  |
| 11 | ResourceDrum | bit | 0 | YES |  |
| 12 | CapacityType | nvarchar | 50 | YES |  |
| 13 | ShiftDate | date | 0 | YES |  |
| 14 | NormalOnlineHours | float | 0 | YES |  |
| 15 | OvertimeHours | float | 0 | YES |  |
| 16 | PotentialOvertimeHours | float | 0 | YES |  |
| 17 | OfflineHours | float | 0 | YES |  |
| 18 | CleanoutHours | float | 0 | YES |  |
| 19 | PublishDate | datetime | 0 | YES |  |
| 20 | PublisherUserId | int | 0 | YES |  |
| 21 | ScenarioId | bigint | 0 | YES |  |
| 22 | NewScenarioId | nvarchar | -1 | YES |  |
| 23 | ScenarioName | nvarchar | -1 | YES |  |
| 24 | ScenarioType | nvarchar | -1 | YES |  |
