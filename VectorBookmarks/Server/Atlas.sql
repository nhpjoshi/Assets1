
jdbc:mongodb://atlas-sql-65c5a4e2ac4ff753b751a2c5-n2msm.a.query.mongodb.net/BatteryMonitoring?ssl=true&authSource=admin







SELECT * FROM sample_restaurants.restaurants;
SELECT * FROM sample_restaurants.restaurants where cuisine='American';
SELECT * FROM sample_restaurants.restaurants where cuisine='American' AND borough ='Manhattan';


SELECT *
FROM FLATTEN(sample_restaurants.restaurants
 WITH DEPTH => 4,
 SEPARATOR => '/'
) WHERE cuisine='American' AND borough ='Manhattan';

