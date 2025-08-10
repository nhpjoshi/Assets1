db.games.insertMany([
  { gamertag: "Ace", score: 100 },
  { gamertag: "Bob", score: 15000 },
  { gamertag: "Bob", score: 50000 },
  { gamertag: "Ace", score: 99999 },
]);

//   (E → R) Equality before Sort
// 5 Doc Scan
db.games.createIndex({ score: 1, gamertag: 1 });
db.games.find({ gamertag: "Ace", score: { $gt: 9000 } });
db.games.find({ gamertag: "Ace", score: { $gt: 9000 } }).explain("executionStats").executionStats;
db.games.dropIndex("score_1_gamertag_1");
//3 Docscal
db.games.createIndex({ gamertag: 1, score: 1 });
db.games.find({ gamertag: "Ace", score: { $gt: 9000 } });
db.games.find({ gamertag: "Ace", score: { $gt: 9000 } }).explain("executionStats").executionStats;
db.games.dropIndex("gamertag_1_score_1");

//(E → S) Equality before Range
//3 Scan
db.games.createIndex({ score: 1, gamertag: 1 });
db.games.find({ gamertag: "Ace" }).sort({ score: 1 });
db.games.find({ gamertag: "Ace" }).sort({ score: 1 }).explain("executionStats").executionStats;
db.games.dropIndex("score_1_gamertag_1");
//2 Scan
db.games.createIndex({ gamertag: 1, score: 1 });
db.games.find({ gamertag: "Ace" }).sort({ score: 1 });
db.games.find({ gamertag: "Ace" }).sort({ score: 1 }).explain("executionStats").executionStats;
db.games.dropIndex("gamertag_1_score_1");

//(S → R) Sort before Rannge

db.games.createIndex({ score: 1, gamertag: 1 });
db.games.find({ score: { $gt: 9000 } }).sort({ gamertag: 1 });
db.games.dropIndex("score_1_gamertag_1");

//In memory-sort

db.games.createIndex({ score: 1 });
db.games.find({ score: { $gt: 9000 } }).sort({ gamertag: 1 }).explain("executionStats").executionStats;
