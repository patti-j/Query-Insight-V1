# publish.DASHt_NetInventoryBalance

Generated: 2026-01-16T23:22:04.400Z

| # | Column | Type | MaxLen | Nullable | Default |
|---:|---|---|---:|---:|---|
| 1 | PlanningAreaName | nvarchar | -1 | YES |  |
| 2 | PlantName | nvarchar | -1 | YES |  |
| 3 | ItemId | bigint | 0 | YES |  |
| 4 | ItemName | nvarchar | -1 | YES |  |
| 5 | ItemDescription | nvarchar | -1 | YES |  |
| 6 | WarehouseId | bigint | 0 | YES |  |
| 7 | WarehouseName | nvarchar | -1 | YES |  |
| 8 | InventoryId | nvarchar | -1 | YES |  |
| 9 | InitialOnHandQty | float | 0 | YES |  |
| 10 | AdjustmentDate | datetime | 0 | YES |  |
| 11 | AdjustmentQty | float | 0 | YES |  |
| 12 | OnHandQtyAfterAdjustmentDate | float | 0 | YES |  |
| 13 | CumulativeAdjustments | float | 0 | YES |  |
| 14 | FinalOnHandQty | float | 0 | YES |  |
| 15 | AdjustmentType | nvarchar | -1 | YES |  |
| 16 | AdjustmentTypeId | bigint | 0 | YES |  |
| 17 | AdjustmentReason | nvarchar | -1 | YES |  |
| 18 | Cost | float | 0 | YES |  |
| 19 | InventoryCost | float | 0 | YES |  |
| 20 | ItemExternalId | nvarchar | -1 | YES |  |
| 21 | ItemSource | nvarchar | -1 | YES |  |
| 22 | ItemType | nvarchar | -1 | YES |  |
| 23 | ItemGroup | nvarchar | -1 | YES |  |
| 24 | PublishDate | datetime | 0 | YES |  |
| 25 | PublisherUserId | int | 0 | YES |  |
| 26 | ScenarioId | bigint | 0 | YES |  |
| 27 | NewScenarioId | nvarchar | -1 | YES |  |
| 28 | ScenarioName | nvarchar | -1 | YES |  |
| 29 | ScenarioType | nvarchar | -1 | YES |  |
