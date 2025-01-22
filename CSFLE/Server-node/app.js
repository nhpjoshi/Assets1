const express = require('express');
const app = express();
const mongoclient = require('mongodb').MongoClient;
const bodyParser = require('body-parser');
app.use(bodyParser.json());
async function connectDB(dbname , collectionname){
    const client = await mongoclient.connect('mongodb+srv://<>:<>@edge.n2msm.mongodb.net/?retryWrites=true&w=majority&appName=Edge');
    const db= client.db(dbname);
    const collection = db.collection(collectionname);
    return collection;
}
app.post("/add", async (req, res) => {
 console.log(req.body);
 const collection = await connectDB('SecureDB', 'PII');
 const dbstatus = 'connected';
 console.log(collection);
 if (dbstatus === 'connected') {
    // Personal Information
    const name =req.body.Full_Name;
    const DOB =req.body.DOB;
    const Address =req.body.Address; 
    const Email =req.body.Email;
    const phone_number =req.body.phone_number;
    const Identification_number =req.body.Identification_number;
    // Credit Card Information
    const cardnumber =  req.body.cardnumber;
    const expiredate = req.body.expirydate;
    const cvv= req.body.cvv;
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
    }
    // Credit Card Information Object
    const credit_card_information = {
        cardnumber: cardnumber,
        expiredate: expiredate,
        cvv: cvv
    }
    // Employment Information Object
    const employment_information = {
        JobTitle: JobTitle,
        employer: employer,
        workaddress: workaddress
    }
    
    const object = {
        PII : {
        personal_information: personal_information,
        credit_card_information: credit_card_information,
        employment_information: employment_information
    }
 }
 console.log(object);
 const result =  collection.insertOne(object);

 res.send("Data Inserted Successfully\n");
}




});


app.get('/get', (req, res) => {


})


app.listen(3000, () => {
    console.log('Server is running on port 3000');
    });
