
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  // Acceso
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' },
  resetToken: { type: String },
  resetTokenExpiry: { type: Date },

  // Datos personales
  name: { type: String, required: true },
  nickname: { type: String },
  cedula: { type: String },
  phone: { type: String },
  birthdate: { type: String },
  bloodType: { type: String },
  city: { type: String },
  address: { type: String }, // Legacy
  clubNotifications: { type: Boolean, default: true },

  // Contacto de emergencia
  emergencyName: { type: String },
  emergencyPhone: { type: String },

  // Membresía
  membership: {
    level: { type: String },
    since: { type: String },
    expires: { type: String },
    benefits: [String]
  },

  // Historial de visitas al taller
  visits: [{
    date: { type: String },
    service: { type: String }
  }],

  // Motos registradas
  vehicles: [{
    brand: { type: String },
    model: { type: String },
    year: { type: String },
    plate: { type: String },
    cc: { type: String },
    color: { type: String },
    soatExpires: { type: String },
    tecnoExpires: { type: String },
    qr: { type: String }
  }],

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
