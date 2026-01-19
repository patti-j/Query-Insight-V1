# publish.DASHt_PurchaseOrders

Generated: 2026-01-16T23:22:04.637Z

| # | Column | Type | MaxLen | Nullable | Default |
|---:|---|---|---:|---:|---|
| 1 | PlanningAreaName | nvarchar | -1 | YES |  |
| 2 | PurchaseToStockId | bigint | 0 | YES |  |
| 3 | PurchaseToStockName | nvarchar | -1 | YES |  |
| 4 | PurchaseToStockDescription | nvarchar | -1 | YES |  |
| 5 | InventoryId | bigint | 0 | YES |  |
| 6 | WarehouseId | bigint | 0 | YES |  |
| 7 | WarehouseName | nvarchar | -1 | YES |  |
| 8 | ItemId | bigint | 0 | YES |  |
| 9 | ItemName | nvarchar | -1 | YES |  |
| 10 | QtyOrdered | float | 0 | YES |  |
| 11 | QtyReceived | float | 0 | YES |  |
| 12 | AvailableDate | datetime | 0 | YES |  |
| 13 | ScheduledReceiptDate | datetime | 0 | YES |  |
| 14 | ActualReceiptDate | datetime | 0 | YES |  |
| 15 | UnloadEndDate | datetime | 0 | YES |  |
| 16 | UnloadHrs | float | 0 | YES |  |
| 17 | TransferHrs | float | 0 | YES |  |
| 18 | VendorExternalId | nvarchar | -1 | YES |  |
| 19 | BuyerExternalId | nvarchar | -1 | YES |  |
| 20 | Notes | nvarchar | -1 | YES |  |
| 21 | Firm | bit | 0 | YES |  |
| 22 | Closed | bit | 0 | YES |  |
| 23 | MaintenanceMethod | nvarchar | -1 | YES |  |
| 24 | DbrReceivingBufferHrs | float | 0 | YES |  |
| 25 | DbrReceiptDate | datetime | 0 | YES |  |
| 26 | DbrCurrentPenetrationPercent | float | 0 | YES |  |
| 27 | DeletedDemand | bit | 0 | YES |  |
| 28 | ForecastDemand | bit | 0 | YES |  |
| 29 | SafetyStockDemand | bit | 0 | YES |  |
| 30 | SalesOrderDemand | bit | 0 | YES |  |
| 31 | TransferOrderDemand | bit | 0 | YES |  |
| 32 | DateDeleted | datetime | 0 | YES |  |
| 33 | DeletedDemandId | bigint | 0 | YES |  |
| 34 | ForecastShipmentId | bigint | 0 | YES |  |
| 35 | SalesOrderDistributionId | bigint | 0 | YES |  |
| 36 | TransferOrderDistributionId | bigint | 0 | YES |  |
| 37 | PublishDate | datetime | 0 | YES |  |
| 38 | PublisherUserId | int | 0 | YES |  |
| 39 | ScenarioId | bigint | 0 | YES |  |
| 40 | NewScenarioId | nvarchar | -1 | YES |  |
| 41 | ScenarioName | nvarchar | -1 | YES |  |
| 42 | ScenarioType | nvarchar | -1 | YES |  |
