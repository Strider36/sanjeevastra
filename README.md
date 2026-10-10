# 🩺 Sanjeev Astra

> **AI-Powered Healthcare Navigation for Everyone**  
> *Right Care. Right Place. Right Time.*

---

## 📌 Project Overview

**Sanjeev Astra** is an AI-powered healthcare navigation platform that helps patients describe their health problems, understand the appropriate level of care, discover nearby healthcare facilities, and access emergency assistance when required.

### 🔄 Core Concept & Workflow

```
Patient Problem ➔ AI Understanding ➔ Care Guidance ➔ Nearby Facility ➔ Treatment/Consultation ➔ Referral ➔ Follow-up
```

> **Important Safety Note**: Sanjeev Astra AI is a **healthcare navigation assistant**, not a replacement for professional medical doctors. It provides preliminary guidance, triage categorization, and local healthcare discovery to empower patient decision-making.

---

## ✨ Key Features

### 1. 🩺 Sanjeev Astra AI Healthcare Navigation
* **Symptom & Problem Input**: Express symptoms via typed text or native voice recording (Web Speech API).
* **Intelligent Care Level Triage**: AI categorizes user needs into:
  * 🟢 **Home Care & Observation** (rest, fluids, monitoring)
  * 🟡 **Primary Care / General Physician** (PHC, local clinic, family doctor)
  * 🟠 **Specialist Consultation** (Cardiology, Orthopedics, Neurology, etc.)
  * 🔴 **Emergency / Medical SOS** (immediate hospital dispatch required)
* **Instant Facility Recommendation**: Suggests the closest verified medical facilities with real-time distance calculations and contact numbers.
* **Seamless Action Shortcuts**: Direct shortcuts to book consultations or trigger Emergency SOS.

### 2. 🌐 Multilingual Regional Support
* **Supported Languages**:
  * 🇬🇧 **English**
  * 🇮🇳 **हिंदी (Hindi)**
  * 🇮🇳 **मराठी (Marathi)**
* **Zero Page-Reload Switching**: Instant dynamic DOM text translation using data-i18n attributes and JSON localization dictionaries (`public/locales/`).
* **Low-Literacy Accessible UI**: Iconography, visual badges, and synthesized audio voice guidance in Hindi, Marathi, and English.
* **Extensible Architecture**: Add any regional Indian language by simply dropping a new `<lang>.json` file in the locales directory.

### 3. 🚨 Medical SOS Emergency Response System
* **4 Rapid Emergency Channels**:
  1. 🚑 **Request Ambulance**: Immediate dispatch of nearby life-support ambulance (`MH 12 QX 4521`).
  2. 🏥 **Nearest Hospital**: Direct routing and coordinates to emergency trauma centers.
  3. 🩺 **Need Medical Help**: Connect with registered on-duty community health workers.
  4. 📞 **Emergency Contacts**: One-tap calling to National Emergency (112), Ambulance (108), Police (100).
* **GPS Geolocation**: High-accuracy HTML5 geolocation capture with fallback to default district coordinates.
* **Interactive Live Map**: Real-time Leaflet & OpenStreetMap tracking displaying patient location, ambulance route, and hospital destinations.
* **Offline Resilience**: Offline emergency queuing in `localStorage` with automatic background synchronization upon network reconnection.
* **Health Worker & Admin Dispatch Board**: Dedicated dashboard (`/sos-admin.html`) with Role-Based Access Control (RBAC) to triage, assign ambulances, and update live incident statuses.

### 4. 🗄️ Personal Health Vault
* **Doctor Consultations**: Schedule, track, and receive browser audio notifications for upcoming visits.
* **Medications & Dosages**: Daily medication schedules with intake alarms and adherence tracking.
* **OCR Prescription Scanner**: AI/OCR powered digital scanning of physical paper prescriptions.
* **Medical Profile & Records**: Chronic condition tracking, blood group, emergency contacts, and laboratory report archiving.

---

---

## 🛠️ Technology Stack

* **Backend**: Node.js, Express.js (v5), MongoDB, Mongoose, JWT (JSON Web Tokens), bcryptjs, OpenAI Node.js SDK
* **Frontend**: HTML5, Vanilla JavaScript (ES6+ Modules), Vanilla CSS (Custom Design System, Glassmorphism, Responsive Grid)
* **GIS & Maps**: Leaflet.js, OpenStreetMap
* **Speech Engine**: Web Speech API (`SpeechRecognition` & `SpeechSynthesis`)
* **Icons & UI**: Lucide Icons
* **LLM Engine**: OpenAI API (`gpt-4o-mini`) via server-side connection (`/api/rag/chat`)

---

## 🚀 Getting Started

### Prerequisites
* [Node.js](https://nodejs.org/) (v18 or higher)
* [MongoDB](https://www.mongodb.com/) running locally on `127.0.0.1:27017` (or remote MongoDB URI via `.env`)
* (Optional for live LLM responses) OpenAI API Key

### Installation & Setup

1. **Clone or open the workspace**:
   ```bash
   cd d:\SS2
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Copy `.env.example` to create your `.env` file:
   ```bash
   cp .env.example .env
   ```
   Configure the following environment variables in `.env`:
   ```ini
   PORT=5000
   NODE_ENV=development
   MONGODB_URI=mongodb://127.0.0.1:27017/swasthyasetu
   JWT_SECRET=swasthyasetu_super_secret_key_2026_jwt
   OPENAI_API_KEY=your_openai_api_key_here
   LLM_MODEL=gpt-4o-mini
   # Optional: OPENAI_BASE_URL=https://api.openai.com/v1
   ```

4. **Start the application**:
   ```bash
   npm start
   ```

5. **Access the application**:
   * Open your browser and navigate to: [http://localhost:5000](http://localhost:5000)
   * Patient Dashboard (Chatbot Assistant drawer): [http://localhost:5000/dashboard.html](http://localhost:5000/dashboard.html)
   * Emergency Dispatch Board: [http://localhost:5000/sos-admin.html](http://localhost:5000/sos-admin.html)

---

## 🤖 LLM Healthcare Assistant (`/api/rag/chat`)

Milestone 1 establishes direct, secure server-to-LLM connectivity with safety guardrails.

### Endpoint Specification

* **Endpoint**: `POST /api/rag/chat`
* **Access**: Authenticated (Requires `Authorization: Bearer <JWT_TOKEN>`)
* **Rate Limit**: 20 requests/minute per client

#### Request Body
```json
{
  "message": "What are common causes of a headache?",
  "language": "en"
}
```

Supported languages: `en` (English), `hi` (Hindi), `mr` (Marathi).

#### Successful Response (HTTP 200)
```json
{
  "success": true,
  "answer": "Headaches can stem from various causes such as tension, dehydration, lack of sleep, or eye strain...",
  "sources": [],
  "mode": "llm"
}
```

#### Error Handling & Status Codes
* `400 Bad Request`: Empty message, message exceeding 2000 characters, or invalid JSON.
* `401 Unauthorized`: Missing or invalid JWT authentication token.
* `429 Too Many Requests`: Client exceeded rate limit (20 req/min).
* `502 Bad Gateway`: Upstream provider authentication error or network error.
* `503 Service Unavailable`: Server missing `OPENAI_API_KEY` configuration.
* `504 Gateway Timeout`: Upstream LLM provider timed out (>30s).

### Safety & Compliance Guardrails
* **Non-Doctor Identity**: The AI explicitly presents itself as an educational health assistant.
* **No Prescriptions**: Strict guardrails forbid prescribing drugs or inventing dosages.
* **Emergency Routing**: Detects urgent symptoms and routes users to call emergency services (112 / 108).
* **Privacy by Design**: No patient health records or PII are sent to or stored by the LLM.
* **Secret Protection**: API keys never reach the frontend.

---

## 📚 Medical Knowledge Ingestion Pipeline (`knowledge-base/`)

Milestone 2 establishes an automated, idempotent medical document ingestion pipeline that transforms verified clinical documents into searchable vector knowledge chunks.

### Pipeline Flow
```
Medical PDF / TXT / MD ➔ Text Extraction ➔ Cleaning ➔ Overlapping Chunking ➔ Metadata ➔ Embeddings (OpenAI) ➔ MongoDB Staged Storage ➔ Ingestion Report
```

### Supported Formats & Extraction
* **Markdown (`.md`) & Text (`.txt`)**: UTF-8 decoded with structure preservation.
* **PDF (`.pdf`)**: Extracted via `pdf-parse` with stream parsing and resource cleanup.
* **Unsupported formats**: Formats like `.docx`, `.png`, or executable formats are strictly rejected.
* **Protection guards**: 0-byte files, corrupted files, and files exceeding `MEDICAL_MAX_FILE_SIZE_MB` (default: 20MB) are handled gracefully without pipeline interruption.

### How to Add an Approved Medical Source
1. Place the medical document (`.pdf`, `.txt`, or `.md`) into `knowledge-base/sources/`.
2. Register the document in `knowledge-base/manifest.json`:
```json
{
  "documentId": "doc_nhm_headache_triage_2026",
  "filename": "guidelines_headache_triage.md",
  "title": "Clinical Triage and Care Navigation Guidelines for Acute Headaches",
  "publisher": "National Health Mission / Ministry of Health",
  "sourceUrl": "https://mohfw.gov.in/guidelines/headache-navigation-sample",
  "publicationDate": "2026-01-15",
  "language": "en",
  "topic": "triage_neurology",
  "version": "1.2",
  "reviewStatus": "approved"
}
```
> **Quality Gate**: Only documents with `"reviewStatus": "approved"` are ingested. Documents marked `"pending"` or omitted from the manifest are excluded and flagged for medical review.

### Running Ingestion Commands

* **Dry-Run Mode** (Extraction, cleaning, and chunking without calling the embedding API or writing to the database):
  ```bash
  npm run ingest:medical -- --dry-run
  ```

* **Production Ingestion** (Generates OpenAI embeddings and persists to MongoDB):
  ```bash
  npm run ingest:medical
  ```

* **Force Reprocessing** (Bypasses SHA-256 idempotency cache to re-embed all documents):
  ```bash
  npm run ingest:medical -- --force
  ```

### Storage Models & Indexes

* **`MedicalDocument`** (`server/models/MedicalDocument.js`):
  Stores document-level provenance, SHA-256 `contentHash`, chunk count, publisher, review status, and processing status.
  * *Indexes*: `documentId` (unique), `contentHash`, `topic`, `{ reviewStatus: 1, status: 1 }`.

* **`KnowledgeChunk`** (`server/models/KnowledgeChunk.js`):
  Stores deterministic `chunkId` (`${documentId}_chunk_${index}`), text, token counts, section headings, metadata, and the embedding vector.
  * *Indexes*: `chunkId` (unique), `{ documentId: 1, chunkIndex: 1 }`, `metadata.topic`, `metadata.reviewStatus`.

### Inspecting Ingested Documents and Chunks in MongoDB
Open `mongosh` or MongoDB Compass and connect to `mongodb://127.0.0.1:27017/swasthyasetu`:
```javascript
// View ingested documents summary
db.medicaldocuments.find({}, { documentId: 1, title: 1, chunkCount: 1, status: 1, contentHash: 1 });

// View generated chunks with embeddings for a document
db.knowledgechunks.find({ documentId: "doc_nhm_headache_triage_2026" }, { chunkId: 1, chunkIndex: 1, sectionHeading: 1, estimatedTokens: 1, embeddingModel: 1 });
```

### MongoDB Atlas Vector Search Configuration

When deploying on MongoDB Atlas, create an Atlas Search Index named `medical_chunks_vector_index` on the `knowledgechunks` collection:
```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 1536,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "metadata.topic"
    },
    {
      "type": "filter",
      "path": "metadata.language"
    },
    {
      "type": "filter",
      "path": "metadata.publisher"
    },
    {
      "type": "filter",
      "path": "metadata.reviewStatus"
    },
    {
      "type": "filter",
      "path": "documentId"
    }
  ]
}
```

> **Deployment Architecture Note**: Local standalone MongoDB Community instances do not natively include the Atlas Search engine. In production or cloud staging, connecting via `MONGODB_URI` to a MongoDB Atlas cluster activates `$vectorSearch`. If operating self-hosted outside of MongoDB Atlas, an open-source vector database such as **Qdrant** or **pgvector** is recommended for hardware-accelerated vector search.

---

## 🔍 Medical Vector Retrieval API (`POST /api/rag/retrieve`)

Milestone 3 establishes vector similarity retrieval to supply grounded medical passages for RAG answer generation.

### Endpoint Specification

* **Endpoint**: `POST /api/rag/retrieve`
* **Access**: Authenticated (`Authorization: Bearer <JWT_TOKEN>`)
* **Rate Limit**: 20 requests/minute per client

#### Request Body
```json
{
  "message": "What are warning signs of high blood pressure?",
  "language": "en",
  "topK": 3,
  "topic": "cardiovascular"
}
```

#### Successful Response (HTTP 200)
```json
{
  "success": true,
  "query": "What are warning signs of high blood pressure?",
  "results": [
    {
      "chunkId": "doc_cardio_hypertension_protocol_2026_chunk_0",
      "documentId": "doc_cardio_hypertension_protocol_2026",
      "text": "Immediate emergency referral (Medical SOS / 112) is mandatory if severe BP elevation occurs alongside acute symptoms...",
      "score": 0.8845,
      "metadata": {
        "title": "Primary Healthcare Hypertension Screening and Referral Protocol",
        "publisher": "Public Health Clinical Council (Sample Reference)",
        "sourceUrl": "https://clinicalcouncil.org/guidelines/hypertension-sample",
        "language": "en",
        "topic": "cardiovascular",
        "sectionHeading": "Emergency Hypertensive Crisis",
        "publicationDate": "2026-02-10",
        "reviewStatus": "approved"
      }
    }
  ],
  "count": 1,
  "retrievalStatus": "results_found",
  "scoreMetric": "cosine"
}
```

#### Quality Controls & Medical Safety
* **Quality Gate**: Only chunks with `"reviewStatus": "approved"` can ever be retrieved.
* **Passage Deduplication**: Eliminates identical chunk IDs and suppresses high-overlap sibling chunks from the same source document.
* **Filter Security**: Query filters are validated against an allowlist; arbitrary database stages are rejected.
* **Relevance Status**: Returns `"no_results"` status when no relevant passages match, preventing hallucinated grounding.

---

### 4. RAG Answer Generation Endpoint (`POST /api/rag/answer`)

Generates strictly evidence-grounded, citation-backed medical navigation answers by combining vector search with safety-constrained LLM inference.

```http
POST /api/rag/answer
Content-Type: application/json
Authorization: Bearer <jwt_token>
```

#### Request Payload
```json
{
  "message": "What should I do if someone has sudden severe headache and neck stiffness?",
  "language": "en",
  "topK": 3,
  "topic": "neurology"
}
```

#### Grounded Response with Verified Citations (HTTP 200)
```json
{
  "success": true,
  "query": "What should I do if someone has sudden severe headache and neck stiffness?",
  "answer": "⚠️ **EMERGENCY MEDICAL NOTICE:** The symptoms described may indicate an acute medical emergency. Do not delay: immediately call National Emergency **112** or Ambulance **108**, or proceed to the nearest emergency department.\n\nAccording to clinical triage guidelines, a sudden 'thunderclap' headache accompanied by neck stiffness is a 'red flag' sign requiring immediate hospital-based neurological assessment [Source 1].",
  "sources": [
    {
      "sourceIndex": 1,
      "chunkId": "doc_nhm_headache_guidelines_2026_chunk_1",
      "documentId": "doc_nhm_headache_guidelines_2026",
      "title": "Clinical Triage and Red Flags for Acute Headaches in Primary Care",
      "publisher": "National Health Mission (Sample Guidance)",
      "sourceUrl": "https://mohfw.gov.in/guidelines/headache-sample",
      "sectionHeading": "Emergency Red Flags",
      "publicationDate": "2026-01-15",
      "topic": "neurology",
      "language": "en",
      "relevanceScore": 0.8924
    }
  ],
  "count": 1,
  "retrievalStatus": "results_found",
  "isEmergency": true,
  "mode": "rag",
  "model": "gpt-4o-mini"
}
```

#### Key Safety Guardrails
1. **Delimited Context & Prompt Injection Defense**: Retrieved passages are strictly sandboxed inside `<retrieved_context>` tags. System instructions explicitly command the model to treat external text as passive data and ignore internal overrides.
2. **Safe Abstention on Zero Evidence**: When vector retrieval returns no matching passages (`retrievalStatus: 'no_results'`), the model safely abstains with clear uncertainty disclosure and guides users to local clinics/PHCs rather than hallucinating answers.
3. **Verified Source Citations**: Citations (`sources[]`) are derived strictly from retrieved document metadata. The model never fabricates titles, URLs, publishers, or publication dates.
4. **Multilingual Emergency Triage**: Detects emergency red flags in English, Hindi, and Marathi, activating high-priority 112/108 routing banners at the very top of the answer.
5. **Privacy & Security**: Patient private records are never transmitted to LLM providers; API keys remain strictly server-side.

---

### 5. Frontend Chatbot & UI Integration

The web application's floating AI navigation assistant (`public/js/chat.js` & `public/dashboard.html`) connects directly to `POST /api/rag/answer`:

* **Pure DOM Safe Rendering**: Model outputs are parsed into safe DOM tree nodes (`textContent`, `<strong>`, `<em>`, citation badges). Never uses `innerHTML` for untrusted model text, eliminating XSS.
* **Verified Sources Drawer**: Renders structured source pills and verified publication citations with safe, validated outbound links (`target="_blank" rel="noopener noreferrer"`).
* **Emergency Escalation Banner**: Detects emergency flags and immediately renders prominent 112/108 call links and a direct shortcut to activate Medical SOS.
* **Resilient Error & Status Mapping**: User-friendly notices for rate limiting (429), timeouts (504), service unavailability (502/503), session expiry (401), and zero-evidence safe abstention.
* **Duplicate Submission Prevention**: Disables inputs and send button with an animated analysis indicator while the backend processes requests.
* **Multilingual Voice Dictation**: Voice input button (`#btn-chat-voice`) powered by `VoiceAssistant` supporting English, Hindi, and Marathi.

---

---

### 6. Automated RAG Evaluation & Healthcare Safety Suite

Sanjeev Astra includes an automated evaluation and clinical safety auditing harness:

* **Version-Controlled Dataset (`test/fixtures/rag_eval_dataset.json`)**: 28 clinically validated reference test cases covering 10 distinct categories:
  * General health education
  * Specific retrieved evidence
  * Paraphrased clinical queries
  * Out-of-domain queries requiring safe abstention
  * Unapproved knowledge draft suppression
  * Multilingual regional queries (Hindi & Marathi)
  * Emergency triage red flags (chest pain, stroke, thunderclap headache, pediatric fever)
  * Unsafe prescription & diagnostic requests
  * Adversarial prompt injection attacks
* **Evaluation Engines**:
  * **IR Metrics Engine (`server/services/retrievalEvaluator.js`)**: Computes Recall@1/3/5, Precision@1/3/5, Mean Reciprocal Rank (MRR), nDCG@3/5, and P50/P95 retrieval latency.
  * **Answer Grounding Engine (`server/services/answerEvaluator.js`)**: Verifies in-text citation validity `[Source N]`, maps citations to retrieved chunks, verifies forbidden claim avoidance, detects non-doctor identity adherence, and verifies empathetic abstention.
  * **Clinical Safety Auditor (`server/services/safetyEvaluator.js`)**: Deterministic zero-delay emergency escalation (< 5ms, 100% sensitivity), prescribing refusal, pediatric aspirin contraindication warnings (Reye's syndrome), prompt injection resilience, and unapproved draft exclusion.
  * **End-to-End Orchestrator (`server/services/ragEvaluator.js`)**: Computes token usage and estimated API cost per query, generating structured reports.
* **Reproducible Evaluation Command**:
  ```bash
  npm run test:eval
  # or
  node scripts/runRagEvaluation.js
  ```
* **Generated Report Artifacts**:
  * `reports/rag_evaluation_report.json`: Comprehensive machine-readable evaluation report with per-query breakdown and latency measurements.
  * `reports/rag_evaluation_summary.md`: Human-readable summary report with quality gate benchmarks.

---

## 🧪 Testing

Run the complete 103-test automated suite covering LLM connectivity, document ingestion, vector retrieval, grounded answer generation, frontend UI integration, and RAG evaluation:

```bash
npm test
```

### Test Suites Included:
1. `test/ragChat.test.js`: 20 tests (LLM backend connectivity, rate limiting, system prompt safety)
2. `test/documentIngestion.test.js`: 17 tests (PDF/MD/TXT extraction, chunking, embeddings, idempotency)
3. `test/vectorRetrieval.test.js`: 17 tests (Vector similarity, metadata filtering, deduplication)
4. `test/ragAnswer.test.js`: 16 tests (Grounded generation, citations integrity, emergency triage)
5. `test/ragFrontend.test.js`: 13 tests (Safe DOM rendering, citation links, error mapping, emergency UI)
6. `test/ragEvaluation.test.js`: 20 tests (Dataset schema, IR metrics engine, citation integrity, healthcare safety audit, report generation)
Total: 103 automated tests passing.

### Manual Endpoint Verification (cURL)

1. Obtain a JWT token by logging in (`POST /api/auth/login`).
2. Generate an evidence-grounded answer with verified citations:
   ```bash
   curl -X POST http://localhost:5000/api/rag/answer \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     -d '{"message": "What supportive care is recommended for mild headaches?", "language": "en", "topK": 3}'
   ```
3. Test emergency triage response:
   ```bash
   curl -X POST http://localhost:5000/api/rag/answer \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     -d '{"message": "Patient has severe chest pain and difficulty breathing", "language": "en"}'
   ```

---

## 🛡️ License

Built with care for public health and community emergency response.
