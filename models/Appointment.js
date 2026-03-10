const mongoose = require('mongoose');

const AppointmentSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String },
  service: { type: String },
  date: { type: String },
  status: { type: String, default: 'pendiente' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Appointment', AppointmentSchema);
