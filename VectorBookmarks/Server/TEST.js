const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const port = 3000;
app.use(cors());
app.use(express.json());

const textURL = 'http://localhost:11434/api/generate';

// POST endpoint to process data
app.post('/processData', async (req, res) => {
    try {
        const formData = req.body;
        const now = new Date();
        // Data to be sent in the POST request
        const postData = {
            model: "llama3",
            prompt: "what is this link, Give me only 3 line introduction? " + req.body.data,
            stream: false,
            trim_output: true
        };

        console.log(postData);

        // Sending POST request to external API
        const response = await axios.post(textURL, postData);
        console.log(response.data.response);

        // Sending response back to the frontend
        res.status(200).json({ description: response.data.response });
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: 'An error occurred while processing the request' });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
