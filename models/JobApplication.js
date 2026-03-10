const mongoose = require('mongoose');

const JobApplicationSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  role: { type: String },
  experience: { type: String },
  date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('JobApplication', JobApplicationSchema);
