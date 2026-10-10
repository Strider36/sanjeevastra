const mongoose = require('mongoose');

const medicalDocumentSchema = new mongoose.Schema(
  {
    documentId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    filename: {
      type: String,
      required: true,
      trim: true
    },
    fileFormat: {
      type: String,
      enum: ['pdf', 'txt', 'md'],
      required: true
    },
    fileSizeBytes: {
      type: Number,
      required: true
    },
    sourceUrl: {
      type: String,
      default: null,
      trim: true
    },
    publisher: {
      type: String,
      default: 'Unknown',
      trim: true
    },
    publicationDate: {
      type: String,
      default: null
    },
    language: {
      type: String,
      default: 'en',
      trim: true
    },
    topic: {
      type: String,
      default: 'general_medicine',
      trim: true,
      index: true
    },
    version: {
      type: String,
      default: '1.0',
      trim: true
    },
    contentHash: {
      type: String,
      required: true,
      index: true
    },
    chunkCount: {
      type: Number,
      default: 0
    },
    reviewStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'withdrawn'],
      default: 'pending',
      index: true
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true
    },
    error: {
      type: String,
      default: null
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    ingestedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

medicalDocumentSchema.index({ reviewStatus: 1, status: 1 });

module.exports = mongoose.model('MedicalDocument', medicalDocumentSchema);
