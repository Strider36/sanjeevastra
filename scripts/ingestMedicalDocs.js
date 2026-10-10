#!/usr/bin/env node
require('dotenv').config();

const path = require('path');
const mongoose = require('mongoose');
const { runIngestionPipeline } = require('../server/services/ingestionService');

function printReport(report) {
  console.log('\n========================================================');
  console.log(`📋 MEDICAL DOCUMENT INGESTION REPORT ${report.dryRun ? '[DRY-RUN MODE]' : '[PRODUCTION]'}`);
  console.log('========================================================\n');

  console.log(`📂 Source Directory : ${report.sourcesDir}`);
  console.log(`📜 Manifest File    : ${report.manifestPath}`);
  console.log(`📄 Files Discovered : ${report.filesDiscovered}`);
  console.log(`✅ Docs Processed   : ${report.documentsProcessed}`);
  console.log(`⏭️  Docs Skipped     : ${report.documentsSkipped}`);
  console.log(`🧩 Chunks Created   : ${report.chunksCreated}`);
  console.log(`⚠️  Embedding Errors : ${report.embeddingFailures}`);

  if (report.processedDocuments.length > 0) {
    console.log('\n--- 📥 Ingested Documents ---');
    for (const doc of report.processedDocuments) {
      console.log(`  • [${doc.documentId}] "${doc.title}" (${doc.filename}) ➔ ${doc.chunkCount} chunks [Status: ${doc.status}]`);
    }
  }

  if (report.skippedDocuments.length > 0) {
    console.log('\n--- ⏭️  Skipped Documents (Unchanged) ---');
    for (const doc of report.skippedDocuments) {
      console.log(`  • [${doc.documentId}] ${doc.filename}: ${doc.reason}`);
    }
  }

  if (report.documentsRequiringReview.length > 0) {
    console.log('\n--- ⏳ Documents Requiring Review / Unapproved ---');
    for (const doc of report.documentsRequiringReview) {
      console.log(`  • [${doc.documentId}] ${doc.filename}: ${doc.reason}`);
    }
  }

  if (report.failedDocuments.length > 0) {
    console.log('\n--- ❌ Ingestion Failures ---');
    for (const doc of report.failedDocuments) {
      console.log(`  • [${doc.documentId}] ${doc.filename}: ${doc.error}`);
    }
  }

  console.log('\n========================================================\n');
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');

  let sourcesDir = null;
  let manifestPath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) {
      sourcesDir = path.resolve(args[i + 1]);
    }
    if (args[i] === '--manifest' && args[i + 1]) {
      manifestPath = path.resolve(args[i + 1]);
    }
  }

  let dbConnected = false;

  if (!dryRun) {
    try {
      const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/swasthyasetu';
      await mongoose.connect(uri);
      dbConnected = true;
      console.log('📦 Connected to MongoDB for knowledge storage.');
    } catch (dbErr) {
      console.error(`❌ Database connection failed: ${dbErr.message}`);
      process.exitCode = 1;
      return;
    }
  }

  const clean = args.includes('--clean') || args.includes('--reindex');
  if (clean && dbConnected) {
    console.log('🧹 Clean re-indexing requested: purging existing knowledge chunks & medical documents...');
    const KnowledgeChunk = require('../server/models/KnowledgeChunk');
    const MedicalDocument = require('../server/models/MedicalDocument');
    await KnowledgeChunk.deleteMany({});
    await MedicalDocument.deleteMany({});
    console.log('✅ Previous knowledge collections purged.');
  }

  try {
    const report = await runIngestionPipeline({
      dryRun,
      force: force || clean,
      sourcesDir,
      manifestPath
    });

    printReport(report);

    if (report.failedDocuments.length > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`\n❌ Ingestion pipeline encountered an error: ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    if (dbConnected) {
      await mongoose.disconnect();
    }
  }
}

main().catch((err) => {
  console.error('Fatal CLI error:', err);
  process.exitCode = 1;
});
