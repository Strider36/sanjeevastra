const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SUPPORTED_EXTENSIONS = ['.pdf', '.txt', '.md'];

/**
 * Computes a deterministic SHA-256 hash of a buffer.
 *
 * @param {Buffer} buffer
 * @returns {string} Hex string of hash
 */
function computeContentHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Extracts plain text from a PDF Buffer using pdf-parse.
 *
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
async function extractPdfText(buffer) {
  let pdfModule;
  try {
    pdfModule = require('pdf-parse');
  } catch (err) {
    throw new Error('PDF extraction library (pdf-parse) is not installed or available.');
  }

  // Handle pdf-parse v2 (PDFParse class)
  if (pdfModule && pdfModule.PDFParse) {
    const parser = new pdfModule.PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result?.text || '';
    } catch (parseErr) {
      throw new Error(`Corrupted or unreadable PDF: ${parseErr.message}`);
    } finally {
      if (typeof parser.destroy === 'function') {
        try {
          await parser.destroy();
        } catch (_) {}
      }
    }
  }

  // Handle pdf-parse v1 (callable function)
  if (typeof pdfModule === 'function') {
    try {
      const data = await pdfModule(buffer);
      return data?.text || '';
    } catch (parseErr) {
      throw new Error(`Corrupted or unreadable PDF: ${parseErr.message}`);
    }
  }

  throw new Error('Unsupported pdf-parse module export format.');
}

/**
 * Validates and extracts text from a file path.
 *
 * @param {string} filePath Absolute or relative path to file
 * @param {Object} [options]
 * @param {number} [options.maxSizeMb=20] Max file size allowed in megabytes
 * @param {number} [options.maxTextLength=10000000] Max character length
 * @returns {Promise<{ text: string, contentHash: string, fileSizeBytes: number, fileFormat: string, filename: string }>}
 */
async function extractDocumentText(filePath, options = {}) {
  const maxSizeMb = options.maxSizeMb || parseInt(process.env.MEDICAL_MAX_FILE_SIZE_MB || '20', 10);
  const maxSizeBytes = maxSizeMb * 1024 * 1024;
  const maxTextLength = options.maxTextLength || 10000000;

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    throw new Error(`Path is not a regular file: ${filePath}`);
  }

  if (stats.size === 0) {
    throw new Error(`File is empty (0 bytes): ${filePath}`);
  }

  if (stats.size > maxSizeBytes) {
    throw new Error(`File size (${(stats.size / 1024 / 1024).toFixed(2)} MB) exceeds limit of ${maxSizeMb} MB: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();
  const filename = path.basename(filePath);

  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported document format '${ext}'. Supported formats: ${SUPPORTED_EXTENSIONS.join(', ')}`);
  }

  const buffer = fs.readFileSync(filePath);
  const contentHash = computeContentHash(buffer);
  let rawText = '';
  const fileFormat = ext.replace('.', '');

  if (ext === '.txt' || ext === '.md') {
    try {
      rawText = buffer.toString('utf-8');
    } catch (readErr) {
      throw new Error(`Failed to decode text file as UTF-8: ${readErr.message}`);
    }
  } else if (ext === '.pdf') {
    rawText = await extractPdfText(buffer);
  }

  if (!rawText || rawText.trim().length === 0) {
    throw new Error(`Document contains no readable text content: ${filePath}`);
  }

  if (rawText.length > maxTextLength) {
    throw new Error(`Extracted text length (${rawText.length} chars) exceeds maximum allowed length of ${maxTextLength} chars.`);
  }

  return {
    text: rawText,
    contentHash,
    fileSizeBytes: stats.size,
    fileFormat,
    filename
  };
}

module.exports = {
  extractDocumentText,
  computeContentHash,
  extractPdfText,
  SUPPORTED_EXTENSIONS
};
