# 📄 ChatPDF with MongoDB Atlas and LangChain

ChatPDF is a Streamlit-based application that allows users to upload PDF files, process their content using LangChain and MongoDB Atlas, and ask questions based on the document using an LLM-powered interface.

---

## 🚀 Getting Started

Follow these steps to run the application locally.

### ✅ Step 1: Install Dependencies

```bash
pip install -r requirements.txt


### ✅ Step 2: Start the Application

streamlit run app.py


## 📂 Project Structure

├── app.py # Streamlit app file (main UI logic)
├── chat_pdf.py # Core RAG logic using LangChain and MongoDB
├── config.yaml # Configuration file (models, DB connection)
├── requirements.txt # Python dependencies
└── README.md # Project documentation


## 📝 How to Use

### 📤 Upload a PDF file
Use the file uploader in the Streamlit UI to select a PDF file.

### ⚙️ Click "Process PDF"
This processes the PDF: extracts, chunks, embeds content, and stores it in MongoDB Atlas.

### ❓ Ask Questions
After processing, type in questions related to the content of the uploaded PDF.

### ✅ Get Answers
The LLM will return context-aware answers based on the embedded document content.

### 🔁 Ask Multiple Questions
Continue the conversation by asking more questions about the PDF.

### 🔄 Reset the App
Click the **"Reset"** button to clear all session data and start over.
```
