import logging
from typing import Optional

import yaml
from langchain.schema.output_parser import StrOutputParser
from langchain.schema.runnable import RunnablePassthrough
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import PyPDFLoader
from langchain_community.vectorstores.utils import filter_complex_metadata
from langchain_core.globals import set_debug, set_verbose
from langchain_core.prompts import ChatPromptTemplate
from langchain_mongodb.vectorstores import MongoDBAtlasVectorSearch
from langchain_ollama import ChatOllama, OllamaEmbeddings
from pymongo import MongoClient
import certifi

# Enable detailed logging and debugging
set_debug(True)
set_verbose(True)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def load_config(config_file: str = "config.yaml") -> dict:
    """Load configuration from a YAML file."""
    with open(config_file) as file:
        return yaml.safe_load(file)

class ChatPDF:
    """Handles PDF ingestion and querying using a LangChain RAG pipeline."""

    def __init__(self, config_file: str = "config.yaml"):
        config = load_config(config_file)

        # Load configuration
        self.model = ChatOllama(model=config["llm_model"])
        self.embeddings = OllamaEmbeddings(model=config["embedding_model"])
        self.text_splitter = RecursiveCharacterTextSplitter(chunk_size=1024, chunk_overlap=100)
        self.prompt = ChatPromptTemplate.from_template(
            """
            You are a helpful assistant answering questions based on the uploaded document and the conversation.

            Conversation History:
            {conversation_history}

            Context from Documents:
            {context}

            Question:
            {question}

            Provide a concise, accurate answer (preferably within three sentences), ensuring it directly addresses the question.
            """
        )

        # MongoDB Atlas connection
        self.client = MongoClient(
            config["mongo_connection_str"],
            appname="devrel.showcase.local_rag_pdf_app",
            tlsCAFile=certifi.where()
        )
        self.collection = self.client[config["database_name"]][config["collection_name"]]
        logger.info(f"MongoDB Connection Established - Document Count: {self.collection.count_documents({})}")

        # Setup Vector Store
        self.vector_store = MongoDBAtlasVectorSearch(
            collection=self.collection,
            embedding=self.embeddings,
            index_name="vector_index",
            relevance_score_fn="cosine",
        )
        self.vector_store.create_vector_search_index(dimensions=768)
        logger.info("Vector Store Initialized")

        self.retriever = None

    def upload_and_index_pdf(self, pdf_file_path: str):
        """Ingest and index a PDF file into the vector store."""
        logger.info(f"Ingesting PDF: {pdf_file_path}")
        documents = PyPDFLoader(file_path=pdf_file_path).load()
        logger.info(f"Loaded {len(documents)} pages")

        chunks = self.text_splitter.split_documents(documents)
        logger.info(f"Split into {len(chunks)} chunks")

        for i, chunk in enumerate(chunks[:3]):
            logger.debug(f"Chunk {i+1}: {chunk.page_content[:200]}...")

        cleaned_chunks = filter_complex_metadata(chunks)
        self.vector_store.add_documents(documents=cleaned_chunks)
        logger.info("Document embeddings stored in MongoDB Atlas")

    def query_with_context(self, query: str, conversation_history: Optional[list] = None, k: int = 5, score_threshold: float = 0.2) -> str:
        """Query the vector store using RAG pipeline and return the response."""
        if not self.vector_store:
            raise ValueError("Vector store is not initialized. Please upload and index a PDF first.")

        if not self.retriever:
            self.retriever = self.vector_store.as_retriever(
                search_type="similarity_score_threshold",
                search_kwargs={"k": k, "score_threshold": score_threshold},
            )

        logger.info(f"Processing query: {query}")
        query_embedding = self.embeddings.embed_query(query)
        logger.debug(f"Query embedding sample: {query_embedding[:10]} (total length: {len(query_embedding)})")

        retrieved_docs = self.retriever.invoke(query)
        if not retrieved_docs:
            logger.warning("No relevant documents found.")
            return "No relevant context found in the document to answer your question."

        logger.info(f"Retrieved {len(retrieved_docs)} documents")
        for i, doc in enumerate(retrieved_docs):
            logger.debug(f"Doc {i+1}: {doc.page_content[:200]}...")

        input_data = {
            "conversation_history": "\n".join(conversation_history) if conversation_history else "",
            "context": "\n\n".join(doc.page_content for doc in retrieved_docs),
            "question": query,
        }

        chain = RunnablePassthrough() | self.prompt | self.model | StrOutputParser()
        response = chain.invoke(input_data)
        logger.debug(f"Generated response: {response}")
        return response

    def reset_retriever(self):
        """Reset the retriever to clear any cached state."""
        logger.info("Retriever has been reset.")
        self.retriever = None