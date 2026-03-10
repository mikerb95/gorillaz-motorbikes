const mongoose = require('mongoose');

const EnrollmentSchema = new mongoose.Schema({
    id: { type: String, required: true },
  slug: { type: String },
  courseTitle: { type: String },
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String },
  notes: { type: String },
