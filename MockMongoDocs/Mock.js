const { MongoClient } = require("mongodb");
const { faker } = require("@faker-js/faker");

const uri =
  "mongodb+srv://admin:admin@cluster0.n2msm.mongodb.net/?retryWrites=true&w=majority";
const client = new MongoClient(uri);

const departmentsList = ["Engineering", "HR", "Finance", "Sales", "Marketing"];
const projectNames = [
  "Project Alpha",
  "Project Beta",
  "Project Gamma",
  "Project Delta",
];

async function insertDepartments(db) {
  const departments = [];
  for (let i = 0; i < 10000; i++) {
    departments.push({
      departmentId: `DPT${i.toString().padStart(4, "0")}`,
      name: faker.helpers.arrayElement(departmentsList),
      managerId: `EMP${faker.number
        .int({ min: 1, max: 9999 })
        .toString()
        .padStart(5, "0")}`,
      location: faker.location.city(),
    });
  }
  await db.collection("departments").deleteMany({});
  await db.collection("departments").insertMany(departments);
  console.log("✅ Inserted 10,000 departments");
}

async function insertProjects(db) {
  const projects = [];
  for (let i = 0; i < 10000; i++) {
    const startDate = faker.date.past({ years: 2 });
    const endDate =
      Math.random() > 0.5
        ? null
        : faker.date.between({ from: startDate, to: new Date() });
    const team = Array.from(
      { length: faker.number.int({ min: 2, max: 5 }) },
      () =>
        `EMP${faker.number
          .int({ min: 1, max: 9999 })
          .toString()
          .padStart(5, "0")}`
    );
    projects.push({
      projectId: `PRJ${i.toString().padStart(4, "0")}`,
      name: faker.helpers.arrayElement(projectNames),
      department: faker.helpers.arrayElement(departmentsList),
      startDate,
      endDate,
      status: endDate ? "Completed" : "Active",
      teamMembers: team,
    });
  }
  await db.collection("projects").deleteMany({});
  await db.collection("projects").insertMany(projects);
  console.log("✅ Inserted 10,000 projects");
}

async function insertEmployees(db) {
  const collection = db.collection("employees");
  await collection.deleteMany({});

  for (let i = 0; i < 10000; i += 1000) {
    const batch = [];
    for (let j = 0; j < 1000; j++) {
      const empId = `EMP${(i + j).toString().padStart(5, "0")}`;
      const doj = faker.date.past({ years: 5 });
      const salary = faker.number.int({ min: 30000, max: 150000 });
      const skills = faker.helpers.arrayElements(
        ["Python", "Node.js", "MongoDB", "React", "AWS", "Kubernetes", "SQL"],
        3
      );
      const project = {
        name: faker.helpers.arrayElement(projectNames),
        role: faker.helpers.arrayElement([
          "Developer",
          "Lead",
          "QA",
          "Manager",
        ]),
        startDate: faker.date.between({ from: doj, to: new Date() }),
      };

      batch.push({
        employeeId: empId,
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        email: faker.internet.email(),
        phone: faker.phone.number(),
        department: faker.helpers.arrayElement(departmentsList),
        designation: faker.helpers.arrayElement([
          "Software Engineer",
          "QA Engineer",
          "Product Manager",
          "HR Executive",
        ]),
        salary,
        dateOfJoining: doj,
        location: faker.location.city(),
        skills,
        managerId: `EMP${faker.number
          .int({ min: 1, max: 9999 })
          .toString()
          .padStart(5, "0")}`,
        projects: [project],
        isActive: faker.datatype.boolean(),
      });
    }
    await collection.insertMany(batch);
    console.log(`✅ Inserted ${i + 1000} employees`);
  }
}

async function seedDatabase() {
  try {
    await client.connect();
    const db = client.db("company");

    await insertDepartments(db);
    await insertProjects(db);
    await insertEmployees(db);

    console.log("🎉 All data seeded successfully!");
  } catch (error) {
    console.error("❌ Error seeding database:", error);
  } finally {
    await client.close();
  }
}

seedDatabase();

//// If you haven’t already named them, create with explicit names:
// db.employees.createIndex({ dateOfJoining: 1,  salary: -1 }, { name: "doj_1_salary_-1" })
// db.employees.createIndex({ dateOfJoining: -1, salary:  1 }, { name: "doj_-1_salary_1" })
// db.employees.createIndex({ salary: 1 },{ name: "salary_1" })

// db.employees.find({ dateOfJoining: { $gte: ISODate("2023-01-01"), $lt: ISODate("2024-01-01") } },{ _id: 0, dateOfJoining: 1, salary: 1 }).sort({ dateOfJoining: 1, salary: -1 }).explain("executionStats")

//db.employees.find({ dateOfJoining: { $gte: ISODate("2023-01-01"), $lt: ISODate("2024-01-01") } },{ _id: 0, dateOfJoining: 1, salary: 1 }).sort({ dateOfJoining: -1, salary: 1 }).explain("executionStats")

// Equality on dateOfJoining, then sort by salary desc → can use (doj_1_salary_-1)
//const oneDay = ISODate("2024-03-15T00:00:00Z"); db.employees.find({ dateOfJoining: oneDay },{ _id: 0, dateOfJoining: 1, salary: 1 }).sort({ salary: -1 }).explain("executionStats")

//db.employees.find({ salary: { $gte: 90000, $lte: 120000 } },{ _id: 0, salary: 1, employeeId: 1 }).sort({ salary: 1 }).explain("executionStats")

// Force the other compound
//db.employees.find({ dateOfJoining: { $gte: ISODate("2024-01-01") }, salary: { $gte: 80000 } }).sort({ dateOfJoining: 1, salary: -1 }).hint("doj_-1_salary_1").explain("executionStats")

//Forece SIngle field index
//db.employees.find({ dateOfJoining: { $gte: ISODate("2024-01-01") }, salary: { $gte: 80000 } }).sort({ salary: 1 }).hint("salary_1").explain("executionStats")

//Covered Queries
//db.employees.find({ dateOfJoining: { $gte: ISODate("2023-01-01"), $lt: ISODate("2024-01-01") } },{ _id: 0, dateOfJoining: 1, salary: 1 }).explain("executionStats")
