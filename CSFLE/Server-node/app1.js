const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { MongoClient, Binary } = require('mongodb');
const fs = require('fs');
const { ok } = require('assert');
//const path1 = require('path'); // Require the path module

const app = express();
const mongoUri = "mongodb+srv://<>:<>@edge.n2msm.mongodb.net/?retryWrites=true&w=majority&appName=Edge";
const port = 3000;
app.use(express.static('Front-end'));
app.use(cors());
app.use(bodyParser.json());

const dbName = "SecureDB";
const collName = "PII";
const namespace = `${dbName}.${collName}`;
const keyVaultNamespace = "encryption.__keyVault";
const extraOptions = {
  cryptSharedLibRequired: true,
  cryptSharedLibPath: "/Users/Shared/mongo_crypt_shared/lib/mongo_crypt_v1.dylib",
};
const dataKey = "2e49xLQYQYapp7rMIYGcGg==";
const provider = "local";
const path = "../Crypto-js/master-key.txt";
const localMasterKey = fs.readFileSync(path);
const kmsProviders = {
  local: {
    key: localMasterKey,
  },
};

// Define the encryption schema for all PII fields
const schema = {
  bsonType: "object",
  encryptMetadata: {
    keyId: [new Binary(Buffer.from(dataKey, "base64"), 4)],
  },
  properties: {
    Full_Name: {
      encrypt: {
        bsonType: "string",
        algorithm: "AEAD_AES_256_CBC_HMAC_SHA_512-Random",
      },
    },
    DOB: {
      encrypt: {
        bsonType: "string",
        algorithm: "AEAD_AES_256_CBC_HMAC_SHA_512-Random",
      },
    },
    Address: {
      encrypt: {
        bsonType: "string",
        algorithm: "AEAD_AES_256_CBC_HMAC_SHA_512-Random",
      },
    },
    Email: {
      encrypt: {
        bsonType: "string",
        algorithm: "AEAD_AES_256_CBC_HMAC_SHA_512-Random",
      },
    },
    phone_number: {
      encrypt: {
        bsonType: "string",
        algorithm: "AEAD_AES_256_CBC_HMAC_SHA_512-Random",
      },
    },
    Identification_number: {
      encrypt: {
        bsonType: "string",
        algorithm: "AEAD_AES_256_CBC_HMAC_SHA_512-Random",
      },
    },
    cardnumber: {
      encrypt: {
        bsonType: "string",
        algorithm: "AEAD_AES_256_CBC_HMAC_SHA_512-Random",
      },
    },
    Expirydate: {
      encrypt: {
        bsonType: "string",
        algorithm: "AEAD_AES_256_CBC_HMAC_SHA_512-Random",
      },
    },
    JobTitle: {
      encrypt: {
        bsonType: "string",
        algorithm: "AEAD_AES_256_CBC_HMAC_SHA_512-Random",
      },
    },
    employer: {
      encrypt: {
        bsonType: "string",
        algorithm: "AEAD_AES_256_CBC_HMAC_SHA_512-Random",
      },
    },
    workaddress: {
      encrypt: {
        bsonType: "string",
        algorithm: "AEAD_AES_256_CBC_HMAC_SHA_512-Random",
      },
    },
    expirydate: {
      encrypt: {
        bsonType: "string",
        algorithm: "AEAD_AES_256_CBC_HMAC_SHA_512-Random",
      },
    },
    cvv: {
      encrypt: {
        bsonType: "string",
        algorithm: "AEAD_AES_256_CBC_HMAC_SHA_512-Random",
      },
    },
  },
};
console.log(schema);


const PIISchema = {};
PIISchema[namespace] = schema;
console.log(PIISchema);
async function initializeMongoClients() {
  try {
    const secureClient = new MongoClient(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      autoEncryption: {
        keyVaultNamespace,
        kmsProviders,
        schemaMap: PIISchema,
        extraOptions: extraOptions,
      },
    });

    const regularClient = new MongoClient(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    await secureClient.connect();
    await regularClient.connect();

    console.log('Connected successfully to MongoDB server with both secure and regular clients');

    return { secureClient, regularClient };
  } catch (err) {
    console.error('Failed to connect to the database:', err);
    process.exit(1); // Exit the process if the connection fails
  }
}

initializeMongoClients().then(clients => {
  const { secureClient, regularClient } = clients;

  app.post('/add', async (req, res) => {
    try {

      // Personal Information
      const name = req.body.Full_Name;
      const DOB = req.body.DOB;
      const Address = req.body.Address;
      const Email = req.body.Email;
      const phone_number = req.body.phone_number;
      const Identification_number = req.body.Identification_number;

      // Credit Card Information
      const cardnumber = req.body.cardnumber;
      const expirydate = req.body.expirydate;
      const cvv = req.body.cvv;

      // Employment Information
      const JobTitle = req.body.JobTitle;
      const employer = req.body.employer;
      const workaddress = req.body.workaddress;

      // EmployeeObject to be inserted into the database
      const personal_information = {
        name: name,
        DOB: DOB,
        Address: Address,
        Email: Email,
        phone_number: phone_number,
        Identification_number: Identification_number
      };

      // Credit Card Information Object
      const credit_card_information = {
        cardnumber: cardnumber,
        expirydate: expirydate,
        cvv: cvv
      };

      // Employment Information Object
      const employment_information = {
        JobTitle: JobTitle,
        employer: employer,
        workaddress: workaddress
      };

      const object = {
        PII: {
          personal_information: personal_information,
          credit_card_information: credit_card_information,
          employment_information: employment_information
        }
      };



      try {
        await regularClient.connect();
        try {
          await secureClient.connect();
          // start-insert
          try {
            const writeResult = await secureClient
              .db(dbName)
              .collection(collName)
              .insertOne(req.body);
              console.log(writeResult);
          } catch (writeError) {
            console.error("writeError occurred:", writeError);
          }
          // end-insert
          // start-find
          res.status(200).send("Data processed and inserted into MongoDB");
          // end-find
        } finally {
          await secureClient.close();
        }
      } finally {
        await regularClient.close();
      }

    } catch (err) {
      console.error('An error occurred:', err);
      res.status(500).send('Internal Server Error');
    }
  });

  app.get('/get', async (req, res) => {
    try {
      const collection = regularClient.db(dbName).collection(collName);
      const documents = await collection.find({}).toArray();
      res.send(documents);
    } catch (err) {
      console.error('An error occurred:', err);
      res.status(500).send('Internal Server Error');
    }
  });

  app.get('/', (req, res) => {
    res.sendFile(__dirname + '/Front-end/Csfle.html');
  });

  app.listen(3000, () => {
    console.log('Server listening on port 3000');
  });
}).catch(err => {
  console.error('Failed to connect to the database:', err);
});

//lsof -i :3000 , kill -9 <PID>
