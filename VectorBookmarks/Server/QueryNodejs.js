const axios = require('axios');
const MongoClient = require('mongodb').MongoClient;
async function getEmbedding(query) {
    console.log('Query:', query);
    // Define the OpenAI API url and key.
    const url = 'http://localhost:11434/api/embeddings';
    const postData = {        
        model: "mxbai-embed-large",
        prompt: query
    };
    // Call OpenAI API to get the embeddings.
    let response = await axios.post(url, postData);
//     console.log(response.data.embedding);
     return response.data.embedding;
}
async function findSimilarDocuments(embedding) {
    const url = 'mongodb+srv://AdminCluster:admin@testcluster.n2msm.mongodb.net/'; // Replace with your MongoDB url.
    const client = new MongoClient(url);    
    try {
        await client.connect();        
        const db = client.db('BookMarkSS'); // Replace with your database name.
        const collection = db.collection('BMSearch'); // Replace with your collection name.        
        // Query for similar documents.
        const documents = await collection.aggregate([
            {
                "$vectorSearch": {
                    "queryVector": embedding,
                    "path": "Embeddings",
                    "index": "vector_index_BookMarks",
                    "numCandidates": 10, // Adjust the number of candidates as needed.
                    "limit": 5 // Adjust the limit of results as needed.
                }
            }
        ]).toArray();
        
        return documents;
    } finally {
        await client.close();
    }
}
async function main() {
    const query = 'Get me only Mongo URLs'; // Replace with your query.
    try {
        const embedding = await getEmbedding(query);
        console.log(embedding);
        const documents = await findSimilarDocuments(embedding);
        for (var i = 0; i < documents.length; i++) {
            console.log(documents[i].Link);
        }       
    } catch(err) {
        console.error(err);
    }
}
main();