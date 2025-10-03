import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { CohereClient } from 'cohere-ai';
import fs from 'fs/promises';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Cohere client with the API key from environment variables
const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY
});

// DO NOT CHANGE: File path for caching embeddings
const EMBEDDINGS_FILE = './documents/embeddings.json';
let cachedDocuments = [];

// --- Utility Functions for RAG (No Changes Required) ---

function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((sum, a, idx) => sum + a * vecB[idx], 0);
  const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dotProduct / (magA * magB);
}

function getTopKDocuments(queryEmbedding, documents, k = 10) {
  const similarities = documents.map(doc => ({
    doc,
    score: cosineSimilarity(queryEmbedding, doc.embedding)
  }));

  similarities.sort((a, b) => b.score - a.score);
  return similarities.slice(0, k).map(item => item.doc);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Document Loading and Embedding ---

// UPLOAD YOUR OWN DOCUMENTS HERE: Update this array with your .txt file paths
async function loadDocuments() {
  const files = [
    './documents/pride_prejudice_analysis.txt'
  ];

  const documents = [];

  // Logic to load plain text files
  for (const file of files) {
    try {
      // 1. Read the entire file content as the document body
      const content = await fs.readFile(file, 'utf-8');

      // 2. Extract a clean title/ID from the filename
      const filename = file.split('/').pop().replace(/\.(md|txt)$/i, '');
      const cleanTitle = filename.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

      // 3. Push the new document structure
      documents.push({
        id: filename,
        data: {
          title: cleanTitle,
          snippet: content.trim() // The entire content is the snippet
        }
      });
    } catch (err) {
      console.error(`Error reading ${file}:`, err);
    }
  }

  console.log(`Loaded ${documents.length} documents`);
  return documents;
}

async function embedDocumentsInBatches(documents, batchSize = 96) {
  const allEmbeddings = [];
  const model = 'embed-multilingual-v3.0';

  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    console.log(`Embedding batch ${i / batchSize + 1} of ${Math.ceil(documents.length / batchSize)}...`);

    const response = await cohere.embed({
      texts: batch.map(doc => `${doc.data.title}. ${doc.data.snippet}`),
      model: model,
      input_type: 'search_document'
    });

    allEmbeddings.push(...response.embeddings);
    await sleep(10000); // 10 second delay to respect rate limits
  }

  return allEmbeddings;
}

async function saveEmbeddingsToFile(documents) {
  const embeddingsData = documents.map(doc => ({
    id: doc.id,
    title: doc.data.title,
    snippet: doc.data.snippet,
    embedding: doc.embedding
  }));

  await fs.writeFile(EMBEDDINGS_FILE, JSON.stringify(embeddingsData, null, 2), 'utf-8');
  console.log(`Embeddings saved to ${EMBEDDINGS_FILE}`);
}

async function loadEmbeddingsFromFile() {
  try {
    const content = await fs.readFile(EMBEDDINGS_FILE, 'utf-8');
    const embeddingsData = JSON.parse(content);
    console.log(`Loaded ${embeddingsData.length} embeddings from ${EMBEDDINGS_FILE}`);
    return embeddingsData.map(item => ({
      id: item.id,
      data: { title: item.title, snippet: item.snippet },
      embedding: item.embedding
    }));
  } catch (err) {
    console.warn('No existing embeddings file found. Will compute embeddings.');
    return null;
  }
}

async function initializeDocuments() {
  cachedDocuments = await loadEmbeddingsFromFile();
  if (!cachedDocuments) {
    const documents = await loadDocuments();

    console.log('Embedding documents...');
    const allEmbeddings = await embedDocumentsInBatches(documents);

    allEmbeddings.forEach((embedding, i) => {
      documents[i].embedding = embedding;
    });

    await saveEmbeddingsToFile(documents);
    cachedDocuments = documents;
    console.log('Embeddings ready.');
  }
}

// Initialize on server start
initializeDocuments();

// --- API Routes ---

app.post('/generate', async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  try {
    console.log(`Embedding user prompt: "${prompt.substring(0, 30)}..."`);
    
    // 1. Embed the user's query
    const embedResponse = await cohere.embed({
      texts: [prompt],
      model: 'embed-multilingual-v3.0',
      input_type: 'search_query' // Changed to search_query for query embedding
    });

    const queryEmbedding = embedResponse.embeddings[0];

    // 2. Retrieve the most relevant documents (RAG)
    const topDocuments = getTopKDocuments(queryEmbedding, cachedDocuments, 5); // Use 5 for efficiency

    console.log(`Retrieved top ${topDocuments.length} documents.`);

    // 3. Generate the response using Cohere Chat (RAG-enabled)
    const response = await cohere.chat({
      model: 'command-r-plus',
      message: prompt,
      documents: topDocuments.map(doc => ({
        text: `${doc.data.title}. ${doc.data.snippet}`
      })),
      // FINAL PREAMBLE (System Prompt)
      preamble: "You are a warm, highly knowledgeable literary critic and librarian named 'Bookworm Bot'. Your specialization is summarizing, analyzing themes, identifying characters, and recommending books across all genres and historical periods. When answering, provide insightful literary context and cite your sources (books, journals, or online articles) when possible. Use Google Search to find up-to-date information, and cite your sources.",
      temperature: 0.3
    });

    console.log('Cohere chat successful.');

    // 4. Send the response back to the frontend
    res.json({
      text: response.text,
      citations: response.citations ?? []
    });

  } catch (err) {
    console.error('Error communicating with Cohere API:', err);
    res.status(500).json({ error: 'Cohere request failed' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
