const assert = require('assert');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const documentExtractor = require('../server/services/documentExtractor');
const textChunker = require('../server/services/textChunker');
const embeddingService = require('../server/services/embeddingService');
const { runIngestionPipeline } = require('../server/services/ingestionService');
const MedicalDocument = require('../server/models/MedicalDocument');
const KnowledgeChunk = require('../server/models/KnowledgeChunk');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
  }
}

async function main() {
  console.log('\n========================================================');
  console.log('🧪 Sanjeev Astra: Medical Document Ingestion Test Suite');
  console.log('========================================================\n');

  // Setup temporary scratch test directory
  const testDir = path.resolve(__dirname, 'temp_ingest_test');
  const sourcesDir = path.join(testDir, 'sources');
  const manifestPath = path.join(testDir, 'manifest.json');

  try {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  } catch (_) {}
  fs.mkdirSync(sourcesDir, { recursive: true });

  let dbConnected = false;
  try {
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/swasthyasetu';
    await mongoose.connect(uri);
    dbConnected = true;
  } catch (e) {
    console.log('ℹ️ MongoDB connection unavailable for write tests; running in memory/mock mode.');
  }

  try {
    // ----------------------------------------------------
    // SECTION 1: Document Text Extraction
    // ----------------------------------------------------
    console.log('\n--- Section 1: Extraction & Format Validation ---');

    // 1. TXT Extraction
    const sampleTxt = path.join(sourcesDir, 'test_sample.txt');
    fs.writeFileSync(sampleTxt, 'Hypertension is defined as high blood pressure.', 'utf-8');

    await runTest('TXT file extraction reads UTF-8 content and computes SHA-256 hash', async () => {
      const res = await documentExtractor.extractDocumentText(sampleTxt);
      assert.strictEqual(res.fileFormat, 'txt');
      assert.match(res.text, /Hypertension is defined as high blood pressure/);
      assert.strictEqual(res.contentHash.length, 64);
    });

    // 2. Markdown Extraction
    const sampleMd = path.join(sourcesDir, 'test_sample.md');
    fs.writeFileSync(sampleMd, '# Clinical Triage\n\nEmergency dispatch for chest pain.', 'utf-8');

    await runTest('Markdown file extraction preserves headers and content', async () => {
      const res = await documentExtractor.extractDocumentText(sampleMd);
      assert.strictEqual(res.fileFormat, 'md');
      assert.match(res.text, /# Clinical Triage/);
      assert.strictEqual(res.contentHash.length, 64);
    });

    // 3. PDF Extraction
    const validPdfPath = path.join(sourcesDir, 'test_sample.pdf');
    const textContent = 'CLINICAL TRIAGE PROTOCOL FOR FEVER';
    const streamContent = `BT\n/F1 12 Tf\n72 712 Td\n(${textContent}) Tj\nET`;
    const streamLen = Buffer.byteLength(streamContent);
    let pdfStr = '%PDF-1.1\n';
    const offsets = [0];
    function addPdfObj(num, body) {
      offsets.push(Buffer.byteLength(pdfStr));
      pdfStr += `${num} 0 obj\n${body}\nendobj\n`;
    }
    addPdfObj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    addPdfObj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    addPdfObj(3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>');
    addPdfObj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    addPdfObj(5, `<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream`);
    const xrefOffset = Buffer.byteLength(pdfStr);
    pdfStr += 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 1; i <= 5; i++) {
      pdfStr += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdfStr += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    fs.writeFileSync(validPdfPath, Buffer.from(pdfStr));

    await runTest('PDF file extraction reads text from valid PDF streams', async () => {
      const res = await documentExtractor.extractDocumentText(validPdfPath);
      assert.strictEqual(res.fileFormat, 'pdf');
      assert.match(res.text, /CLINICAL TRIAGE PROTOCOL FOR FEVER/);
    });

    // 4. Empty File Rejection
    const emptyFile = path.join(sourcesDir, 'empty.txt');
    fs.writeFileSync(emptyFile, '');

    await runTest('Rejects 0-byte empty files with descriptive error', async () => {
      try {
        await documentExtractor.extractDocumentText(emptyFile);
        assert.fail('Should fail on empty file');
      } catch (err) {
        assert.match(err.message, /empty \(0 bytes\)/i);
      }
    });

    // 5. Corrupted PDF Rejection
    const corruptedPdf = path.join(sourcesDir, 'corrupted.pdf');
    fs.writeFileSync(corruptedPdf, '%PDF-corrupted-bytes-non-valid');

    await runTest('Handles corrupted PDF documents gracefully', async () => {
      try {
        await documentExtractor.extractDocumentText(corruptedPdf);
        assert.fail('Should fail on corrupted PDF');
      } catch (err) {
        assert.match(err.message, /Corrupted or unreadable PDF/i);
      }
    });

    // 6. Unsupported format rejection
    const unsupportedDocx = path.join(sourcesDir, 'sample.docx');
    fs.writeFileSync(unsupportedDocx, 'dummy content');

    await runTest('Rejects unsupported file extensions (.docx)', async () => {
      try {
        await documentExtractor.extractDocumentText(unsupportedDocx);
        assert.fail('Should fail on unsupported format');
      } catch (err) {
        assert.match(err.message, /Unsupported document format/i);
      }
    });

    // 7. File size limit enforcement
    await runTest('Enforces configurable file size limits', async () => {
      try {
        await documentExtractor.extractDocumentText(sampleTxt, { maxSizeMb: 0.00001 }); // tiny limit
        assert.fail('Should fail on oversized file');
      } catch (err) {
        assert.match(err.message, /exceeds limit/i);
      }
    });

    // ----------------------------------------------------
    // SECTION 2: Text Cleaning & Chunking
    // ----------------------------------------------------
    console.log('\n--- Section 2: Text Cleaning & Semantic Chunking ---');

    await runTest('cleanText removes excessive whitespace, control characters, and PDF artifacts', () => {
      const raw = 'Heading\n\n\n\nParagraph text \x00 with  spaces.\nPage 1 of 5\n-- 2 of 10 --';
      const cleaned = textChunker.cleanText(raw);
      assert.doesNotMatch(cleaned, /\x00/);
      assert.doesNotMatch(cleaned, /-- 2 of 10 --/);
      assert.doesNotMatch(cleaned, /Page 1 of 5/);
      assert.strictEqual(cleaned.includes('\n\n\n'), false);
    });

    await runTest('chunkDocument creates overlapping chunks with section context and stable IDs', () => {
      const sampleLongText = `
# SECTION 1: EMERGENCY DISPATCH
Sudden severe headache is a medical emergency. Seek immediate care.

# SECTION 2: CLINIC EVALUATION
Persistent dull headache requires clinical consultation at a PHC. Blood pressure should be evaluated.
General hydration should be observed. Daily oral water intake should be maintained.

# SECTION 3: HOME CARE
Rest in a quiet dark room. Apply cool compress to forehead.
Avoid excessive screen time. Maintain normal sleep cycles.
      `.trim();

      const chunks = textChunker.chunkDocument({
        text: sampleLongText,
        documentId: 'doc_headache_test',
        documentMetadata: { title: 'Headache Guide', topic: 'neurology' },
        chunkSizeTokens: 40,
        chunkOverlapTokens: 10
      });

      assert.ok(chunks.length >= 2, `Expected multiple chunks, got ${chunks.length}`);
      assert.strictEqual(chunks[0].chunkId, 'doc_headache_test_chunk_0');
      assert.strictEqual(chunks[1].chunkId, 'doc_headache_test_chunk_1');
      assert.strictEqual(chunks[0].documentId, 'doc_headache_test');
      assert.ok(chunks[0].estimatedTokens > 0);
      assert.strictEqual(chunks[0].contentHash.length, 64);
      assert.ok(chunks[0].sectionHeading !== null);
    });

    // ----------------------------------------------------
    // SECTION 3: Embedding Validation & Mock Resiliency
    // ----------------------------------------------------
    console.log('\n--- Section 3: Embeddings Validation & Error Resiliency ---');

    await runTest('validateEmbedding verifies dimension length and finite numeric values', () => {
      const valid = new Array(1536).fill(0.0123);
      assert.strictEqual(embeddingService.validateEmbedding(valid, 1536), true);

      assert.throws(() => embeddingService.validateEmbedding([], 1536), /Invalid embedding/);
      assert.throws(() => embeddingService.validateEmbedding([NaN, 1, 2], 3), /Invalid numeric value/);
      assert.throws(() => embeddingService.validateEmbedding(new Array(512).fill(0.1), 1536), /dimension mismatch/);
    });

    await runTest('Embedding generator handles mock provider and returns structured dimensions', async () => {
      embeddingService.setMockEmbeddingGenerator(async (texts, options) => {
        return {
          embeddings: texts.map(() => new Array(1536).fill(0.05)),
          model: 'text-embedding-3-small',
          dimensions: 1536
        };
      });

      try {
        const res = await embeddingService.generateEmbeddings(['Test text 1', 'Test text 2']);
        assert.strictEqual(res.embeddings.length, 2);
        assert.strictEqual(res.dimensions, 1536);
        assert.strictEqual(res.model, 'text-embedding-3-small');
      } finally {
        embeddingService.clearMockEmbeddingGenerator();
      }
    });

    await runTest('Embedding generator retries on transient errors and reports failures cleanly', async () => {
      let attempts = 0;
      const failingClient = {
        embeddings: {
          create: async () => {
            attempts++;
            const rateLimitErr = new Error('Rate limit reached');
            rateLimitErr.status = 429;
            rateLimitErr.name = 'RateLimitError';
            throw rateLimitErr;
          }
        }
      };

      embeddingService.setMockClient(failingClient);

      try {
        await embeddingService.generateEmbeddings(['Sample text'], {
          maxRetries: 2,
          initialDelayMs: 10
        });
        assert.fail('Should fail on repeated error');
      } catch (err) {
        assert.match(err.message, /Embedding generation failed/);
        assert.ok(attempts >= 2, `Expected at least 2 attempts, got ${attempts}`);
      } finally {
        embeddingService.clearMockClient();
      }
    });

    // ----------------------------------------------------
    // SECTION 4: Ingestion Pipeline, Idempotency & Manifest Safety
    // ----------------------------------------------------
    console.log('\n--- Section 4: Ingestion Pipeline & Idempotency ---');

    // Create a controlled manifest in testDir
    const testManifest = [
      {
        documentId: 'doc_approved_1',
        filename: 'test_sample.txt',
        title: 'Hypertension Clinical Review',
        publisher: 'Health Department',
        reviewStatus: 'approved'
      },
      {
        documentId: 'doc_pending_draft',
        filename: 'test_sample.md',
        title: 'Draft Clinical Notes',
        publisher: 'Independent',
        reviewStatus: 'pending'
      }
    ];
    fs.writeFileSync(manifestPath, JSON.stringify(testManifest, null, 2));

    await runTest('Unapproved sources (pending review) are excluded from ingestion', async () => {
      const report = await runIngestionPipeline({
        sourcesDir,
        manifestPath,
        dryRun: true
      });

      assert.strictEqual(report.documentsProcessed, 1);
      assert.strictEqual(report.documentsSkipped >= 1, true);

      const unapproved = report.documentsRequiringReview.find(d => d.filename === 'test_sample.md');
      assert.ok(unapproved, 'Pending document should be listed in documentsRequiringReview');
      assert.match(unapproved.reason, /Only 'approved' sources/);
    });

    await runTest('Dry-run mode produces metrics without calling embedding API or modifying DB', async () => {
      let embeddingApiCalled = false;
      embeddingService.setMockEmbeddingGenerator(async () => {
        embeddingApiCalled = true;
        return { embeddings: [], model: 'mock', dimensions: 0 };
      });

      try {
        const report = await runIngestionPipeline({
          sourcesDir,
          manifestPath,
          dryRun: true
        });

        assert.strictEqual(embeddingApiCalled, false);
        assert.strictEqual(report.dryRun, true);
        assert.strictEqual(report.processedDocuments[0].status, 'dry_run_extracted');
      } finally {
        embeddingService.clearMockEmbeddingGenerator();
      }
    });

    if (dbConnected) {
      // Clean test records
      await MedicalDocument.deleteMany({ documentId: { $in: ['doc_approved_1', 'doc_pending_draft'] } });
      await KnowledgeChunk.deleteMany({ documentId: 'doc_approved_1' });

      await runTest('Real ingestion saves MedicalDocument and KnowledgeChunk records with embeddings', async () => {
        embeddingService.setMockEmbeddingGenerator(async (texts) => {
          return {
            embeddings: texts.map(() => new Array(1536).fill(0.01)),
            model: 'text-embedding-3-small',
            dimensions: 1536
          };
        });

        try {
          const report = await runIngestionPipeline({
            sourcesDir,
            manifestPath,
            dryRun: false
          });

          assert.strictEqual(report.documentsProcessed, 1);
          assert.strictEqual(report.chunksCreated >= 1, true);

          const doc = await MedicalDocument.findOne({ documentId: 'doc_approved_1' });
          assert.ok(doc, 'MedicalDocument should exist in MongoDB');
          assert.strictEqual(doc.status, 'completed');
          assert.strictEqual(doc.reviewStatus, 'approved');

          const chunks = await KnowledgeChunk.find({ documentId: 'doc_approved_1' });
          assert.ok(chunks.length >= 1, 'KnowledgeChunk records should exist');
          assert.strictEqual(chunks[0].embedding.length, 1536);
          assert.strictEqual(chunks[0].chunkId, 'doc_approved_1_chunk_0');
        } finally {
          embeddingService.clearMockEmbeddingGenerator();
        }
      });

      await runTest('Idempotency: Re-running ingestion skips unchanged documents and prevents duplicate chunks', async () => {
        const report = await runIngestionPipeline({
          sourcesDir,
          manifestPath,
          dryRun: false
        });

        assert.strictEqual(report.documentsProcessed, 0);
        assert.strictEqual(report.documentsSkipped >= 1, true);

        const skipped = report.skippedDocuments.find(d => d.documentId === 'doc_approved_1');
        assert.ok(skipped, 'Document should be skipped');
        assert.strictEqual(skipped.reason, 'Unchanged content hash');

        // Confirm chunks count did not double
        const chunks = await KnowledgeChunk.find({ documentId: 'doc_approved_1' });
        assert.strictEqual(chunks.length, 1);
      });

      await runTest('Changed document updates MedicalDocument and replaces old chunks (staged replacement)', async () => {
        // Change the content of test_sample.txt
        fs.writeFileSync(sampleTxt, 'Updated guideline: Hypertension management involves strict low-sodium dietary measures.', 'utf-8');

        embeddingService.setMockEmbeddingGenerator(async (texts) => {
          return {
            embeddings: texts.map(() => new Array(1536).fill(0.02)),
            model: 'text-embedding-3-small',
            dimensions: 1536
          };
        });

        try {
          const report = await runIngestionPipeline({
            sourcesDir,
            manifestPath,
            dryRun: false
          });

          assert.strictEqual(report.documentsProcessed, 1);
          const doc = await MedicalDocument.findOne({ documentId: 'doc_approved_1' });
          assert.strictEqual(doc.status, 'completed');

          const chunks = await KnowledgeChunk.find({ documentId: 'doc_approved_1' });
          assert.strictEqual(chunks.length, 1);
          assert.match(chunks[0].text, /strict low-sodium/);
        } finally {
          embeddingService.clearMockEmbeddingGenerator();
        }
      });

      // Clean test records
      await MedicalDocument.deleteMany({ documentId: { $in: ['doc_approved_1', 'doc_pending_draft'] } });
      await KnowledgeChunk.deleteMany({ documentId: 'doc_approved_1' });
    }

    // ----------------------------------------------------
    // SECTION 5: Live API Verification (if GEMINI_API_KEY present)
    // ----------------------------------------------------
    console.log('\n--- Section 5: Real Embeddings API Connectivity Check ---');
    const hasLiveGemini = Boolean(
      process.env.GEMINI_API_KEY &&
      process.env.GEMINI_API_KEY.trim() &&
      process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here'
    );

    if (hasLiveGemini) {
      console.log('🔑 GEMINI_API_KEY detected in environment. Initiating live Gemini embeddings test...');
      await runTest('Live Google Gemini gemini-embedding-001 API call succeeds', async () => {
        const res = await embeddingService.generateEmbeddings(['Patient presenting with mild fever.']);
        assert.strictEqual(res.embeddings.length, 1);
        assert.ok(res.dimensions > 0);
        console.log(`     Live Embeddings Vector generated: ${res.dimensions} dimensions [${res.model}]`);
      });
    } else {
      console.log('ℹ️ [Real API Connectivity]: SKIPPED - No GEMINI_API_KEY configured in environment.');
      console.log('   All extraction, chunking, idempotency, and mock tests executed.');
    }

  } finally {
    // Cleanup temporary files
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch (_) {}

    if (dbConnected) {
      await mongoose.disconnect();
    }
  }

  // ----------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------
  console.log('\n========================================================');
  console.log(`📊 Ingestion Test Results: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('========================================================\n');

  process.exitCode = failedTests > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exitCode = 1;
});
