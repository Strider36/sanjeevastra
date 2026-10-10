const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const documentExtractor = require('./documentExtractor');
const textChunker = require('./textChunker');
const embeddingService = require('./embeddingService');
const MedicalDocument = require('../models/MedicalDocument');
const KnowledgeChunk = require('../models/KnowledgeChunk');

/**
 * Loads and parses the medical sources manifest.
 *
 * @param {string} manifestPath Path to manifest.json
 * @returns {Array<Object>} List of approved manifest records
 */
function loadManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : (data.documents || []);
  } catch (err) {
    throw new Error(`Failed to parse manifest at ${manifestPath}: ${err.message}`);
  }
}

/**
 * Orchestrates the full medical document ingestion pipeline.
 *
 * @param {Object} [options]
 * @param {string} [options.sourcesDir] Directory containing source files
 * @param {string} [options.manifestPath] Path to manifest JSON
 * @param {boolean} [options.dryRun=false] When true, extracts and chunks without embeddings or DB writes
 * @param {boolean} [options.force=false] When true, reprocesses even if content hash is unchanged
 * @param {number} [options.chunkSizeTokens] Chunk size in tokens
 * @param {number} [options.chunkOverlapTokens] Chunk overlap in tokens
 * @returns {Promise<Object>} Ingestion report
 */
async function runIngestionPipeline(options = {}) {
  const sourcesDir = options.sourcesDir || path.resolve(process.env.MEDICAL_KNOWLEDGE_DIR || 'knowledge-base/sources');
  const manifestPath = options.manifestPath || path.resolve(path.dirname(sourcesDir), 'manifest.json');
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const chunkSizeTokens = options.chunkSizeTokens || parseInt(process.env.MEDICAL_CHUNK_SIZE || '600', 10);
  const chunkOverlapTokens = options.chunkOverlapTokens || parseInt(process.env.MEDICAL_CHUNK_OVERLAP || '100', 10);

  const report = {
    dryRun,
    sourcesDir,
    manifestPath,
    filesDiscovered: 0,
    documentsProcessed: 0,
    documentsSkipped: 0,
    chunksCreated: 0,
    embeddingFailures: 0,
    documentsRequiringReview: [],
    failedDocuments: [],
    processedDocuments: [],
    skippedDocuments: []
  };

  if (!fs.existsSync(sourcesDir)) {
    throw new Error(`Medical sources directory does not exist: ${sourcesDir}`);
  }

  // 1. Discover source files
  const dirents = fs.readdirSync(sourcesDir, { withFileTypes: true });
  const sourceFiles = dirents
    .filter(d => d.isFile() && documentExtractor.SUPPORTED_EXTENSIONS.includes(path.extname(d.name).toLowerCase()))
    .map(d => d.name);

  report.filesDiscovered = sourceFiles.length;

  // 2. Load manifest entries
  const manifestEntries = loadManifest(manifestPath);
  const manifestMap = new Map();
  for (const entry of manifestEntries) {
    if (entry.filename) {
      manifestMap.set(entry.filename.toLowerCase(), entry);
    }
  }

  // 3. Process each discovered file
  for (const filename of sourceFiles) {
    const filePath = path.join(sourcesDir, filename);
    const manifestEntry = manifestMap.get(filename.toLowerCase());

    // Source quality guard: enforce explicit manifest approval
    if (!manifestEntry) {
      report.documentsSkipped++;
      report.documentsRequiringReview.push({
        filename,
        documentId: `unmanifested_${filename}`,
        reason: 'Missing from manifest.json. Source is untrusted until cataloged and approved.'
      });
      continue;
    }

    const reviewStatus = (manifestEntry.reviewStatus || 'pending').toLowerCase();
    const documentId = manifestEntry.documentId || `doc_${path.parse(filename).name}`;

    if (reviewStatus !== 'approved') {
      report.documentsSkipped++;
      report.documentsRequiringReview.push({
        filename,
        documentId,
        reviewStatus,
        reason: `Document review status is '${reviewStatus}'. Only 'approved' sources are ingested.`
      });
      continue;
    }

    try {
      // 4. Extract text & content hash
      const extraction = await documentExtractor.extractDocumentText(filePath);
      const contentHash = extraction.contentHash;

      // 5. Idempotency Check (skip if unchanged in DB)
      if (!force && !dryRun && mongoose.connection.readyState === 1) {
        const existingDoc = await MedicalDocument.findOne({ documentId });
        if (existingDoc && existingDoc.status === 'completed' && existingDoc.contentHash === contentHash) {
          report.documentsSkipped++;
          report.skippedDocuments.push({
            documentId,
            filename,
            reason: 'Unchanged content hash'
          });
          continue;
        }
      }

      // 6. Split into overlapping chunks
      const documentMetadata = {
        title: manifestEntry.title || extraction.filename,
        publisher: manifestEntry.publisher || 'Unknown',
        sourceUrl: manifestEntry.sourceUrl || null,
        publicationDate: manifestEntry.publicationDate || null,
        language: manifestEntry.language || 'en',
        topic: manifestEntry.topic || 'general_medicine',
        version: manifestEntry.version || '1.0',
        reviewStatus
      };

      const chunks = textChunker.chunkDocument({
        text: extraction.text,
        documentId,
        documentMetadata,
        chunkSizeTokens,
        chunkOverlapTokens
      });

      if (chunks.length === 0) {
        throw new Error(`Document produced 0 valid chunks after cleaning.`);
      }

      // 7. Embeddings & Persistence
      if (dryRun) {
        // Dry-run mode: record metrics without API calls or DB writes
        report.documentsProcessed++;
        report.chunksCreated += chunks.length;
        report.processedDocuments.push({
          documentId,
          filename,
          title: documentMetadata.title,
          chunkCount: chunks.length,
          status: 'dry_run_extracted',
          contentHash
        });
      } else {
        // Real mode: generate embeddings in batches
        const chunkTexts = chunks.map(c => c.text);
        let embeddingResult;

        try {
          embeddingResult = await embeddingService.generateEmbeddings(chunkTexts);
        } catch (embErr) {
          report.embeddingFailures++;
          throw new Error(`Embedding generation failed: ${embErr.message}`);
        }

        // Attach embeddings to chunks
        for (let i = 0; i < chunks.length; i++) {
          chunks[i].embedding = embeddingResult.embeddings[i];
          chunks[i].embeddingModel = embeddingResult.model;
          chunks[i].embeddingDimensions = embeddingResult.dimensions;
        }

        // Staged replacement strategy in MongoDB
        if (mongoose.connection.readyState === 1) {
          // Detect dimension/model mismatch from previous ingestions and purge outdated vectors
          const existingChunk = await KnowledgeChunk.findOne({ documentId });
          if (existingChunk && (existingChunk.embeddingModel !== embeddingResult.model || existingChunk.embeddingDimensions !== embeddingResult.dimensions)) {
            console.log(`[Reindex Safe Migration]: Document ${documentId} embedding model/dimension changed (${existingChunk.embeddingModel}:${existingChunk.embeddingDimensions} -> ${embeddingResult.model}:${embeddingResult.dimensions}). Purging outdated vectors.`);
            await KnowledgeChunk.deleteMany({ documentId });
          }

          // 1. Bulk upsert new chunks by chunkId to avoid unique key conflicts
          const bulkOps = chunks.map(chunk => ({
            updateOne: {
              filter: { chunkId: chunk.chunkId },
              update: { $set: chunk },
              upsert: true
            }
          }));

          await KnowledgeChunk.bulkWrite(bulkOps);

          // 2. Remove any previous chunks with higher indexes if chunk count decreased
          await KnowledgeChunk.deleteMany({
            documentId,
            chunkIndex: { $gte: chunks.length }
          });

          // 3. Upsert MedicalDocument record
          await MedicalDocument.findOneAndUpdate(
            { documentId },
            {
              documentId,
              title: documentMetadata.title,
              filename,
              fileFormat: extraction.fileFormat,
              fileSizeBytes: extraction.fileSizeBytes,
              sourceUrl: documentMetadata.sourceUrl,
              publisher: documentMetadata.publisher,
              publicationDate: documentMetadata.publicationDate,
              language: documentMetadata.language,
              topic: documentMetadata.topic,
              version: documentMetadata.version,
              contentHash,
              chunkCount: chunks.length,
              reviewStatus: 'approved',
              status: 'completed',
              error: null,
              ingestedAt: new Date(),
              metadata: {
                embeddingModel: embeddingResult.model,
                embeddingDimensions: embeddingResult.dimensions,
                manifestEntry
              }
            },
            { upsert: true, returnDocument: 'after' }
          );
        }

        report.documentsProcessed++;
        report.chunksCreated += chunks.length;
        report.processedDocuments.push({
          documentId,
          filename,
          title: documentMetadata.title,
          chunkCount: chunks.length,
          status: 'completed',
          contentHash,
          embeddingModel: embeddingResult.model
        });
      }
    } catch (procErr) {
      report.failedDocuments.push({
        documentId,
        filename,
        error: procErr.message
      });

      // Update failure status in DB if connected
      if (!dryRun && mongoose.connection.readyState === 1) {
        try {
          await MedicalDocument.findOneAndUpdate(
            { documentId },
            {
              documentId,
              title: manifestEntry.title || filename,
              filename,
              fileFormat: path.extname(filename).replace('.', ''),
              fileSizeBytes: 0,
              contentHash: 'unknown',
              status: 'failed',
              error: procErr.message,
              reviewStatus: 'approved'
            },
            { upsert: true, returnDocument: 'after' }
          );
        } catch (_) {}
      }
    }
  }

  return report;
}

module.exports = {
  runIngestionPipeline,
  loadManifest
};
