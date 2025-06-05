import os
import re
import tempfile
import time

import streamlit as st
from rag_module import ChatPDF

st.set_page_config(page_title="Local RAG with MongoDB and DeepSeek")

def display_messages():
    st.subheader("Chat History")
    for message in st.session_state["messages"]:
        with st.chat_message(message["role"]):
            if message["role"] == "assistant":
                content = message["content"]
                think_blocks = re.findall(r"<think>(.*?)</think>", content, re.DOTALL)
                visible_content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
                st.markdown(visible_content)
                for think in think_blocks:
                    with st.expander("Show Hidden Reasoning", expanded=False):
                        st.markdown(think)
            else:
                st.markdown(message["content"])

def process_query():
    user_input = st.session_state.get("user_input", "").strip()
    if user_input:
        st.session_state["messages"].append({"role": "user", "content": user_input})
        with st.chat_message("user"):
            st.markdown(user_input)

        conversation_history = [msg["content"] for msg in st.session_state["messages"] if msg["role"] != "system"]

        with st.chat_message("assistant"):
            with st.spinner("Thinking..."):
                try:
                    agent_text = st.session_state["assistant"].query_with_context(
                        user_input,
                        conversation_history=conversation_history,
                        k=st.session_state["retrieval_k"],
                        score_threshold=st.session_state["retrieval_threshold"],
                    )
                except ValueError as e:
                    agent_text = str(e)
            st.markdown(agent_text)

        st.session_state["messages"].append({"role": "assistant", "content": agent_text})
        st.session_state["user_input"] = ""

def upload_and_index_file():
    st.session_state["assistant"].reset_retriever()
    st.session_state["messages"] = []
    st.session_state["user_input"] = ""

    for file in st.session_state["file_uploader"]:
        with tempfile.NamedTemporaryFile(delete=False) as tf:
            tf.write(file.getbuffer())
            file_path = tf.name

        with (
            st.session_state["ingestion_spinner"],
            st.spinner(f"Uploading and indexing {file.name}...")
        ):
            t0 = time.time()
            st.session_state["assistant"].upload_and_index_pdf(file_path)
            t1 = time.time()

        st.session_state["messages"].append({
            "role": "system",
            "content": f"Uploaded and indexed {file.name} in {t1 - t0:.2f} seconds"
        })
        os.remove(file_path)

def initialize_session_state():
    if "messages" not in st.session_state:
        st.session_state["messages"] = []
    if "assistant" not in st.session_state:
        st.session_state["assistant"] = ChatPDF()
    if "ingestion_spinner" not in st.session_state:
        st.session_state["ingestion_spinner"] = st.empty()
    if "retrieval_k" not in st.session_state:
        st.session_state["retrieval_k"] = 5
    if "retrieval_threshold" not in st.session_state:
        st.session_state["retrieval_threshold"] = 0.2
    if "user_input" not in st.session_state:
        st.session_state["user_input"] = ""

def page():
    initialize_session_state()

    st.header("Local RAG with MongoDB and Llama 3")
    st.subheader("Upload a Document")
    st.file_uploader(
        "Upload a PDF document",
        type=["pdf"],
        key="file_uploader",
        on_change=upload_and_index_file,
        label_visibility="collapsed",
        accept_multiple_files=True,
    )

    display_messages()
    prompt = st.chat_input("Type your message here...")
    if prompt:
        st.session_state["user_input"] = prompt
        process_query()

    if st.button("Clear Chat"):
        st.session_state["messages"] = []
        st.session_state["assistant"].reset_retriever()
        st.session_state["user_input"] = ""

if __name__ == "__main__":
    page()