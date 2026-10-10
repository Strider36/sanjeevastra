const crypto = require('crypto');

/**
 * Approximates token count using the widely accepted heuristic for English & Latin/code text:
 * ~4 characters per token (or ~0.75 words per token).
 * For non-Latin or Devanagari text, tokenization ratios vary, so char/word hybrid estimation is used.
 *
 * @param {string} text
 * @returns {number} Estimated token count
 */
function estimateTokenCount(text) {
  if (!text || text.trim().length === 0) return 0;
  // Word count and char count hybrid estimation:
  const words = text.trim().split(/\s+/).length;
  const chars = text.length;
  // 1 token ~= 4 chars or 0.75 words (whichever is larger to ensure conservative chunk sizing)
  const tokenByChars = Math.ceil(chars / 4);
  const tokenByWords = Math.ceil(words * 1.33);
  return Math.max(tokenByChars, tokenByWords);
}

/**
 * Cleans extracted text to remove extraction artifacts while preserving semantic structure.
 *
 * @param {string} rawText
 * @returns {string} Cleaned text
 */
function cleanText(rawText) {
  if (!rawText) return '';

  let text = rawText
    // Normalize Windows line endings
    .replace(/\r\n/g, '\n')
    // Remove null bytes and non-printable control characters (except newline, tab)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Remove common PDF page footer artifacts (e.g., "-- 1 of 10 --" or "Page 2 of 5")
    .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '')
    .replace(/\bPage\s+\d+(\s+of\s+\d+)?\b/gi, '')
    // Replace non-breaking spaces with standard space
    .replace(/\u00A0/g, ' ')
    // Collapse multiple horizontal spaces into a single space
    .replace(/[ \t]+/g, ' ')
    // Collapse multiple blank lines into double newline (preserve paragraph boundaries)
    .replace(/\n\s*\n\s*\n+/g, '\n\n');

  // Trim individual lines
  const lines = text.split('\n').map(l => l.trim());
  return lines.join('\n').trim();
}

/**
 * Identifies if a line is a section heading (Markdown heading or capitalized title).
 *
 * @param {string} line
 * @returns {string|null} Heading text or null
 */
function extractHeading(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Markdown headings (# Title, ## Subtitle)
  const mdMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
  if (mdMatch) {
    return mdMatch[1].trim();
  }

  // Underlined or capitalized title pattern (short, all caps or ending in colon)
  if (trimmed.length <= 80 && (trimmed.endsWith(':') || /^[A-Z0-9\s,–-]{4,80}$/.test(trimmed))) {
    return trimmed.replace(/:$/, '').trim();
  }

  return null;
}

/**
 * Splits a text into sentence units preserving punctuation.
 *
 * @param {string} text
 * @returns {Array<string>}
 */
function splitIntoSentences(text) {
  if (!text) return [];
  // Split on sentence boundaries: period, exclamation, question mark followed by space or newline
  const rawSentences = text.split(/(?<=[.?!])\s+(?=[A-Z0-9\u0900-\u097F"'])/);
  const sentences = [];

  for (const s of rawSentences) {
    const trimmed = s.trim();
    if (trimmed.length > 0) {
      sentences.push(trimmed);
    }
  }

  return sentences.length > 0 ? sentences : [text.trim()];
}

/**
 * Chunks cleaned text into overlapping segments with stable metadata.
 *
 * @param {Object} params
 * @param {string} params.text Cleaned document text
 * @param {string} params.documentId Stable document identifier
 * @param {Object} [params.documentMetadata={}] Source metadata
 * @param {number} [params.chunkSizeTokens=600] Target chunk size in tokens
 * @param {number} [params.chunkOverlapTokens=100] Overlap in tokens
 * @returns {Array<Object>} Array of KnowledgeChunk objects
 */
function chunkDocument({
  text,
  documentId,
  documentMetadata = {},
  chunkSizeTokens = 600,
  chunkOverlapTokens = 100
}) {
  const cleaned = cleanText(text);
  if (!cleaned) return [];

  // Approximate token limits to character thresholds
  const targetChars = chunkSizeTokens * 4;
  const overlapChars = chunkOverlapTokens * 4;

  // Split into paragraphs first
  const paragraphs = cleaned.split(/\n\n+/);
  const units = [];

  // Build semantic units (paragraphs, broken into sentences if large)
  let currentHeading = documentMetadata.title || null;

  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) continue;

    // Check if this paragraph is or begins with a section heading
    const firstLine = trimmedPara.split('\n')[0];
    const detectedHeading = extractHeading(firstLine);
    if (detectedHeading) {
      currentHeading = detectedHeading;
    }

    if (trimmedPara.length > targetChars) {
      // Split large paragraph into sentences
      const sentences = splitIntoSentences(trimmedPara);
      for (const sent of sentences) {
        units.push({ text: sent, heading: currentHeading });
      }
    } else {
      units.push({ text: trimmedPara, heading: currentHeading });
    }
  }

  if (units.length === 0) return [];

  const chunks = [];
  let currentChunkUnits = [];
  let currentChunkLength = 0;
  let chunkIndex = 0;

  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    const unitLen = unit.text.length + 1; // +1 for joining space/newline

    if (currentChunkLength + unitLen > targetChars && currentChunkUnits.length > 0) {
      // Finalize current chunk
      const chunkText = currentChunkUnits.map(u => u.text).join('\n\n').trim();
      const primaryHeading = currentChunkUnits[0].heading || currentHeading;
      const estimatedTokens = estimateTokenCount(chunkText);
      const chunkHash = crypto.createHash('sha256').update(chunkText).digest('hex');

      chunks.push({
        chunkId: `${documentId}_chunk_${chunkIndex}`,
        documentId,
        chunkIndex,
        text: chunkText,
        sectionHeading: primaryHeading,
        estimatedTokens,
        contentHash: chunkHash,
        metadata: {
          ...documentMetadata,
          sectionHeading: primaryHeading,
          chunkIndex
        },
        createdAt: new Date()
      });

      chunkIndex++;

      // Compute overlap: keep trailing units that total up to overlapChars
      let overlapUnits = [];
      let overlapLen = 0;
      for (let j = currentChunkUnits.length - 1; j >= 0; j--) {
        const candidate = currentChunkUnits[j];
        if (overlapLen + candidate.text.length <= overlapChars) {
          overlapUnits.unshift(candidate);
          overlapLen += candidate.text.length;
        } else {
          break;
        }
      }

      currentChunkUnits = [...overlapUnits, unit];
      currentChunkLength = currentChunkUnits.reduce((acc, u) => acc + u.text.length + 2, 0);
    } else {
      currentChunkUnits.push(unit);
      currentChunkLength += unitLen;
    }
  }

  // Push final remaining chunk
  if (currentChunkUnits.length > 0) {
    const chunkText = currentChunkUnits.map(u => u.text).join('\n\n').trim();
    if (chunkText.length > 0) {
      const primaryHeading = currentChunkUnits[0].heading || currentHeading;
      const estimatedTokens = estimateTokenCount(chunkText);
      const chunkHash = crypto.createHash('sha256').update(chunkText).digest('hex');

      chunks.push({
        chunkId: `${documentId}_chunk_${chunkIndex}`,
        documentId,
        chunkIndex,
        text: chunkText,
        sectionHeading: primaryHeading,
        estimatedTokens,
        contentHash: chunkHash,
        metadata: {
          ...documentMetadata,
          sectionHeading: primaryHeading,
          chunkIndex
        },
        createdAt: new Date()
      });
    }
  }

  return chunks;
}

module.exports = {
  cleanText,
  chunkDocument,
  estimateTokenCount,
  extractHeading,
  splitIntoSentences
};
