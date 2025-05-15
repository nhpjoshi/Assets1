rs.initiate({
  _id: "rs0",
  members: [
    { _id: 0, host: "mongo1:27017", priority: 1 }, // DC primary candidate
    { _id: 1, host: "mongo2:27017", priority: 1 }, // DC secondary
    { _id: 2, host: "mongo3:27017", priority: 1 }, // DR secondary
    { _id: 3, host: "arbiter:27017", arbiterOnly: true }, // DC arbiter
    { _id: 4, host: "mongo4:27017", priority: 1 }, // DR secondary
  ],
});
