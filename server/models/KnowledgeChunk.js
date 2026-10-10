const mongoose = require('mongoose');

const knowledgeChunkSchema = new mongoose.Schema(
  {
    chunkId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    documentId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    chunkIndex: {
      type: Number,
      required: true
    },
    text: {
      type: String,
      required: true
    },
    sectionHeading: {
      type: String,
      default: null,
      trim: true
    },
    estimatedTokens: {
      type: Number,
      required: true
    },
    contentHash: {
      type: String,
      required: true
    },
    embedding: {
      type: [Number],
      default: undefined
    },
    embeddingModel: {
      type: String,
      default: null
    },
    embeddingDimensions: {
      type: Number,
      default: null
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }
);

knowledgeChunkSchema.index({ documentId: 1, chunkIndex: 1 });
knowledgeChunkSchema.index({ 'metadata.topic': 1 });
knowledgeChunkSchema.index({ 'metadata.reviewStatus': 1 });

module.exports = mongoose.model('KnowledgeChunk', knowledgeChunkSchema);
