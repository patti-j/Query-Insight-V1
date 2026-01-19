GRANT SELECT ON SCHEMA::qi TO qi_dash_reader;
-- Or grant on the individual view:
GRANT SELECT ON OBJECT::qi.vw_CapacityDaily TO qi_dash_reader;
GO
